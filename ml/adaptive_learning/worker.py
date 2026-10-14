"""
Dedicated durable worker for LexEase Adaptive Learning.

Polls the database for queued candidate training cycles, atomically claims them,
executes the training and validation pipeline, and records outcomes.
Uses worker leases and heartbeats to ensure a newly started worker cannot
mark another live worker's job as failed.
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import time
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

# Bridge to ml/.venv site-packages when executing in a dual-venv local environment
for _c in [
    ROOT / "ml" / ".venv" / "Lib" / "site-packages",
    ROOT / "ml" / ".venv" / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages",
]:
    if _c.is_dir() and str(_c) not in sys.path:
        sys.path.insert(0, str(_c))
        break


from app.database.migrations.init_db import init_db
from app.database.models import AdaptiveModelVersion
from app.database.session import SessionLocal
from ml.adaptive_learning.train_candidate import run_cycle

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [AdaptiveWorker] %(message)s",
)
logger = logging.getLogger("AdaptiveWorker")

DEFAULT_LEASE_DURATION = 30.0  # seconds
DEFAULT_HEARTBEAT_INTERVAL = 5.0  # seconds


def generate_worker_id() -> str:
    """Generates a unique identifier for the worker process instance."""
    return f"worker-{os.getpid()}-{int(time.time())}-{uuid.uuid4().hex[:6]}"


def _sanitize_error_summary(raw_error: str, default_msg: str = "Training worker process failed") -> str:
    if not raw_error or not raw_error.strip():
        return default_msg
    import re
    lines = [line.strip() for line in raw_error.splitlines() if line.strip()]
    exc_line = ""
    for line in reversed(lines):
        if any(term in line for term in ("Error:", "Exception:", "Failed:", "Error", "Exception")):
            exc_line = line
            break
    summary = exc_line if exc_line else lines[-1]
    if 'File "' in summary:
        summary = summary.split('File "')[-1]
    summary = re.sub(r"(token|key|password|secret)[=:\s]+[^\s]+", r"\1=[REDACTED]", summary, flags=re.IGNORECASE)
    summary = re.sub(r"(sqlite|postgres|postgresql)://[^\s]+", r"[DATABASE_URL]", summary)
    clean = " ".join(summary.split())[:150].strip()
    return clean or default_msg


def _parse_lease(acceptance_json: str | None) -> dict | None:
    if not acceptance_json:
        return None
    try:
        data = json.loads(acceptance_json)
        if isinstance(data, dict) and "lease" in data:
            return data["lease"]
    except Exception:
        pass
    return None


def _build_lease_payload(worker_id: str, lease_duration: float) -> str:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=lease_duration)
    return json.dumps({
        "lease": {
            "worker_id": worker_id,
            "heartbeat_at": now.isoformat(),
            "lease_expires_at": expires.isoformat(),
        }
    })


def is_job_lease_active(acceptance_json: str | None, now: datetime | None = None) -> bool:
    """Checks whether the lease on a running job is currently active."""
    lease = _parse_lease(acceptance_json)
    if not lease or "lease_expires_at" not in lease:
        return False
    check_time = now or datetime.now(timezone.utc)
    try:
        expires_at = datetime.fromisoformat(lease["lease_expires_at"])
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return check_time < expires_at
    except Exception:
        return False


def cleanup_orphaned_running_jobs(db_factory=SessionLocal) -> int:
    """
    On worker startup or periodic recovery, detect any jobs left with status='running'
    whose lease has expired (i.e. whose previous worker process crashed, terminated, or stopped heartbeating).
    Active leases held by live workers are left untouched.
    """
    with db_factory() as db:
        running_jobs = (
            db.query(AdaptiveModelVersion)
            .filter_by(status="running")
            .all()
        )
        if not running_jobs:
            return 0

        now = datetime.now(timezone.utc)
        cleaned_count = 0
        for job in running_jobs:
            # If the lease is still actively held by a live worker, do NOT touch it
            if is_job_lease_active(job.acceptance_json, now):
                logger.info(f"Running cycle '{job.version}' has an active lease from a live worker; skipping.")
                continue

            # Lease is expired or missing: genuinely orphaned
            job.status = "failed"
            job.error_message = "Worker lease expired; prior worker process was terminated or crashed."
            job.completed_at = now
            logger.warning(f"Recovered orphaned running cycle '{job.version}' (lease expired); marked as failed.")
            cleaned_count += 1

        if cleaned_count > 0:
            db.commit()
        return cleaned_count


def claim_next_queued_job(
    db_factory=SessionLocal,
    worker_id: str | None = None,
    lease_duration: float = DEFAULT_LEASE_DURATION,
) -> AdaptiveModelVersion | None:
    """
    Atomically claims the oldest queued training cycle.
    Enforces concurrency limit: if any job is currently 'running' with an active lease, returns None.
    Uses atomic conditional update so competing workers cannot claim or train the same cycle.
    Attaches a lease with worker_id and expiration.
    """
    assigned_worker_id = worker_id or generate_worker_id()
    with db_factory() as db:
        # Enforce single concurrent training cycle
        running_jobs = db.query(AdaptiveModelVersion).filter_by(status="running").all()
        now = datetime.now(timezone.utc)
        for r_job in running_jobs:
            if is_job_lease_active(r_job.acceptance_json, now):
                return None

        candidate = (
            db.query(AdaptiveModelVersion)
            .filter_by(status="queued")
            .order_by(AdaptiveModelVersion.created_at.asc())
            .first()
        )
        if not candidate:
            return None

        candidate_id = candidate.id
        candidate_version = candidate.version
        lease_payload = _build_lease_payload(assigned_worker_id, lease_duration)

        # Atomic conditional claim: transition status to running and attach lease
        claimed_rows = (
            db.query(AdaptiveModelVersion)
            .filter(
                AdaptiveModelVersion.id == candidate_id,
                AdaptiveModelVersion.status == "queued",
            )
            .update(
                {"status": "running", "acceptance_json": lease_payload},
                synchronize_session=False,
            )
        )
        db.commit()

        if claimed_rows == 1:
            logger.info(f"Worker '{assigned_worker_id}' successfully claimed queued cycle: {candidate_version}")
            return db.query(AdaptiveModelVersion).filter_by(id=candidate_id).first()

        # Another worker claimed it first
        return None


def execute_claimed_job(
    cycle_version: str,
    db_factory=SessionLocal,
    runner=run_cycle,
    worker_id: str | None = None,
    lease_duration: float = DEFAULT_LEASE_DURATION,
    heartbeat_interval: float = DEFAULT_HEARTBEAT_INTERVAL,
) -> bool:
    """
    Executes the training and validation cycle for the claimed job version.
    Maintains a periodic heartbeat thread extending the worker lease while training.
    Guarantees the job status is finalized to promoted, rejected, or failed.
    """
    assigned_worker_id = worker_id or generate_worker_id()
    logger.info(f"Worker '{assigned_worker_id}' executing candidate cycle: {cycle_version}")

    stop_heartbeat = threading.Event()

    def _heartbeat_worker():
        while not stop_heartbeat.wait(timeout=heartbeat_interval):
            try:
                with db_factory() as db:
                    rec = db.query(AdaptiveModelVersion).filter_by(version=cycle_version).first()
                    if rec and rec.status == "running":
                        rec.acceptance_json = _build_lease_payload(assigned_worker_id, lease_duration)
                        db.commit()
            except Exception:
                pass

    heartbeat_thread = threading.Thread(target=_heartbeat_worker, daemon=True)
    heartbeat_thread.start()

    try:
        runner(cycle_version=cycle_version)
        logger.info(f"Candidate cycle '{cycle_version}' execution finished.")
        return True
    except Exception as exc:
        exc_type = type(exc).__name__
        raw_msg = _sanitize_error_summary(str(exc), default_msg="Candidate training failed")
        safe_msg = f"{exc_type}: {raw_msg}" if not raw_msg.startswith(exc_type) else raw_msg
        logger.error(f"Candidate cycle '{cycle_version}' failed: {safe_msg}")
        with db_factory() as db:
            record = db.query(AdaptiveModelVersion).filter_by(version=cycle_version).first()
            if record and record.status == "running":
                record.status = "failed"
                record.error_message = safe_msg
                record.completed_at = datetime.now(timezone.utc)
                db.commit()
        return False
    finally:
        stop_heartbeat.set()
        heartbeat_thread.join(timeout=1.0)


def run_worker_loop(
    poll_interval: float = 5.0,
    once: bool = False,
    max_iterations: int | None = None,
    db_factory=SessionLocal,
    runner=run_cycle,
) -> None:
    """
    Main worker polling loop.
    Cleans up any orphaned running jobs with expired leases on startup,
    then continuously polls for queued jobs.
    """
    worker_id = generate_worker_id()
    logger.info(f"Initializing Adaptive Learning durable worker (ID: {worker_id})...")
    init_db()

    cleaned = cleanup_orphaned_running_jobs(db_factory=db_factory)
    if cleaned > 0:
        logger.info(f"Cleaned up {cleaned} orphaned running job(s) with expired leases on startup.")

    stop_requested = False

    def handle_signal(signum, frame):
        nonlocal stop_requested
        logger.info(f"Received signal {signum}, preparing to shut down worker {worker_id}...")
        stop_requested = True

    try:
        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)
    except (ValueError, AttributeError):
        pass  # Running in non-main thread or environment without signals

    logger.info(f"Worker {worker_id} listening for queued jobs (polling every {poll_interval}s)...")
    iterations = 0

    while not stop_requested:
        iterations += 1
        job = claim_next_queued_job(db_factory=db_factory, worker_id=worker_id)
        if job:
            execute_claimed_job(job.version, db_factory=db_factory, runner=runner, worker_id=worker_id)
        else:
            if once:
                break
            time.sleep(poll_interval)

        if max_iterations is not None and iterations >= max_iterations:
            break

    logger.info(f"Adaptive Learning worker {worker_id} stopped.")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="LexEase Adaptive Learning Durable Worker")
    parser.add_argument("--once", action="store_true", help="Poll once and exit immediately")
    parser.add_argument("--interval", type=float, default=5.0, help="Polling interval in seconds")
    args = parser.parse_args()

    run_worker_loop(poll_interval=args.interval, once=args.once)
