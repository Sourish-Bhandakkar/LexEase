import hmac
import json
import os
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.database import session as session_module
from app.database.models import AdaptiveModelVersion, ClauseFeedback, ClauseFeedbackSubmission
from app.database.session import get_db
from app.schemas.adaptive_learning import (
    AdaptiveDashboard,
    ClauseFeedbackCreate,
    ClauseFeedbackCreated,
    ClauseFeedbackItem,
    ClauseFeedbackReview,
    ClauseFeedbackSubmissionCreate,
    ClauseFeedbackSubmissionCreated,
    ClauseFeedbackSubmissionReview,
    ModelDisplayLabelUpdate,
    PendingClauseFeedbackSubmission,
)
from app.services.clause_analysis import ClauseAnalysisService
from app.services.preprocessing import PreprocessingService

router = APIRouter(prefix="/adaptive-learning", tags=["Adaptive Learning"])
DEMO_MIN_APPROVED_TOTAL = 15
DEMO_MIN_APPROVED_PER_CLASS = 5


def _approved_feedback_counts(db: Session) -> tuple[int, dict[str, int]]:
    approved = db.query(ClauseFeedback).filter_by(status="approved", consent=True).all()
    counts = {
        label: sum(1 for row in approved if (row.corrected_risk_level or "").upper() == label)
        for label in ("LOW", "MEDIUM", "HIGH")
    }
    return len(approved), counts


def _get_project_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "ml").is_dir():
            return parent
    cwd = Path.cwd()
    if (cwd / "ml").is_dir():
        return cwd
    parents = current.parents
    return parents[4] if len(parents) > 4 else parents[-1]


def require_admin(x_adaptive_admin_token: str | None = Header(default=None)) -> None:
    expected = settings.ADAPTIVE_LEARNING_ADMIN_TOKEN
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Adaptive-learning review is not configured.",
        )
    if not x_adaptive_admin_token or not hmac.compare_digest(x_adaptive_admin_token, expected):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin token is invalid.")


@router.get("/dashboard", response_model=AdaptiveDashboard)
def get_dashboard(db: Session = Depends(get_db)) -> AdaptiveDashboard:
    versions = (
        db.query(AdaptiveModelVersion)
        .order_by(AdaptiveModelVersion.created_at.desc())
        .limit(25)
        .all()
    )
    active = next((item for item in versions if item.status in {"promoted", "baseline"}), None)
    active_version = active.version if active else None
    active_checkpoint_path = None

    project_root = _get_project_root()
    manifest_path = project_root / "ml" / "models" / "active_risk_model.json"
    if manifest_path.is_file():
        try:
            m_data = json.loads(manifest_path.read_text(encoding="utf-8"))
            active_version = m_data.get("version", active_version)
            active_checkpoint_path = m_data.get("model_path")
        except (OSError, json.JSONDecodeError):
            pass

    if active_version is None:
        metadata_path = project_root / "ml" / "models" / "final_risk_model" / "metadata.json"
        try:
            active_version = json.loads(metadata_path.read_text(encoding="utf-8")).get("model_version")
        except (OSError, json.JSONDecodeError):
            active_version = None

    # Calculate approved feedback and class counts
    approved_count, approved_class_counts = _approved_feedback_counts(db)

    min_total = DEMO_MIN_APPROVED_TOTAL
    min_per_class = DEMO_MIN_APPROVED_PER_CLASS
    gate_met = (
        approved_count >= min_total
        and all(approved_class_counts[k] >= min_per_class for k in ["LOW", "MEDIUM", "HIGH"])
    )

    live_loaded_version = ClauseAnalysisService.get_active_loaded_version()
    needs_reload = bool(
        active_version and live_loaded_version and active_version != live_loaded_version
    )

    # A baseline is only displayed after a run has actually measured it on the validation set.
    active_metrics = json.loads(active.metrics_json) if active and active.metrics_json else None
    active_display_label = getattr(active, "display_label", None) if active else None
    return AdaptiveDashboard(
        active_version=active_version,
        active_display_label=active_display_label,
        active_metrics=active_metrics,
        pending_feedback_count=db.query(ClauseFeedback).filter_by(status="pending").count(),
        pending_feedback_submission_count=db.query(ClauseFeedbackSubmission).filter_by(status="pending").count(),
        approved_feedback_count=approved_count,
        approved_class_counts=approved_class_counts,
        gate_met=gate_met,
        gate_requirements={"minimum_approved": min_total, "minimum_total": min_total, "minimum_per_class": min_per_class},
        gate_label="Demonstration-only gate (15 approved clauses, ≥5 per class); does not guarantee model improvement",
        active_checkpoint_path=active_checkpoint_path,
        live_loaded_version=live_loaded_version,
        needs_reload=needs_reload,
        history=[
            {
                "version": item.version,
                "display_label": getattr(item, "display_label", None),
                "parent_version": item.parent_version,
                "status": item.status,
                "metrics": json.loads(item.metrics_json or "{}"),
                "acceptance": json.loads(item.acceptance_json or "{}"),
                "approved_feedback_count": item.approved_feedback_count,
                "test_sample_count": item.test_sample_count,
                "created_at": item.created_at,
                "completed_at": item.completed_at,
                "error_message": item.error_message,
            }
            for item in versions
        ],
    )


@router.post("/feedback", response_model=ClauseFeedbackCreated, status_code=201)
def submit_feedback(
    request: ClauseFeedbackCreate,
    db: Session = Depends(get_db),
) -> ClauseFeedbackCreated:
    if request.consent is not True:
        raise HTTPException(status_code=400, detail="Consent is required to submit clause feedback.")
    if request.predicted_risk_level == request.corrected_risk_level:
        raise HTTPException(status_code=400, detail="Choose a different risk label to submit a correction.")
    text = PreprocessingService.mask_pii(PreprocessingService.clean_text(request.clause_text)).strip()
    if not text:
        raise HTTPException(status_code=400, detail="Clause text is required.")
    group_id = request.source_group_id.strip() if request.source_group_id and request.source_group_id.strip() else f"single_{uuid4()}"
    record = ClauseFeedback(
        clause_text=text,
        predicted_risk_level=request.predicted_risk_level.value,
        corrected_risk_level=request.corrected_risk_level.value,
        consent=True,
        status="pending",
        source_group_id=group_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return ClauseFeedbackCreated(id=record.id, status=record.status)


@router.post("/feedback/submissions", response_model=ClauseFeedbackSubmissionCreated, status_code=201)
def submit_feedback_batch(
    request: ClauseFeedbackSubmissionCreate,
    db: Session = Depends(get_db),
) -> ClauseFeedbackSubmissionCreated:
    if request.consent is not True:
        raise HTTPException(status_code=400, detail="Consent is required to submit document clauses.")

    clauses = []
    for clause in request.clauses:
        text = PreprocessingService.mask_pii(PreprocessingService.clean_text(clause.clause_text)).strip()
        if not text:
            continue
        clauses.append({
            "clause_id": clause.clause_id,
            "clause_number": clause.clause_number,
            "clause_text": text,
            "predicted_risk_level": clause.predicted_risk_level.value,
            "confidence": clause.confidence,
        })
    if not clauses:
        raise HTTPException(status_code=400, detail="No usable clauses were found in the submission.")

    record = ClauseFeedbackSubmission(
        clauses_json=json.dumps(clauses, ensure_ascii=False),
        clause_count=len(clauses),
        consent=True,
        status="pending",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return ClauseFeedbackSubmissionCreated(
        id=record.id,
        status=record.status,
        clause_count=record.clause_count,
    )


@router.get("/feedback/submissions/pending", response_model=list[PendingClauseFeedbackSubmission], dependencies=[Depends(require_admin)])
def list_pending_feedback_submissions(db: Session = Depends(get_db)) -> list[PendingClauseFeedbackSubmission]:
    records = (
        db.query(ClauseFeedbackSubmission)
        .filter_by(status="pending")
        .order_by(ClauseFeedbackSubmission.created_at.asc())
        .limit(100)
        .all()
    )
    return [
        PendingClauseFeedbackSubmission(
            id=record.id,
            status=record.status,
            consent=record.consent,
            created_at=record.created_at,
            clauses=json.loads(record.clauses_json or "[]"),
        )
        for record in records
    ]


@router.post("/feedback/submissions/{submission_id}/review", response_model=ClauseFeedbackSubmissionCreated, dependencies=[Depends(require_admin)])
def review_feedback_submission(
    submission_id: str,
    request: ClauseFeedbackSubmissionReview,
    db: Session = Depends(get_db),
) -> ClauseFeedbackSubmissionCreated:
    record = db.query(ClauseFeedbackSubmission).filter_by(id=submission_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Feedback submission was not found.")
    if record.status != "pending":
        raise HTTPException(status_code=409, detail="Feedback submission has already been reviewed.")

    submitted_clauses = json.loads(record.clauses_json or "[]")
    clauses_by_id = {clause["clause_id"]: clause for clause in submitted_clauses}
    unknown_ids = {item.clause_id for item in request.annotations} - clauses_by_id.keys()
    if unknown_ids:
        raise HTTPException(status_code=400, detail="Annotations must refer to clauses in this submission.")

    now = datetime.now(timezone.utc)
    if request.decision == "annotate":
        submission_group = f"submission_{record.id}"
        for annotation in request.annotations:
            clause = clauses_by_id[annotation.clause_id]
            db.add(ClauseFeedback(
                clause_text=clause["clause_text"],
                predicted_risk_level=clause["predicted_risk_level"],
                corrected_risk_level=annotation.corrected_risk_level.value,
                consent=True,
                status="approved",
                review_note=request.review_note or f"Batch annotation from submission {record.id}.",
                source_group_id=submission_group,
                reviewed_at=now,
            ))
        record.status = "annotated"
    else:
        record.status = "rejected"
    record.review_note = request.review_note
    record.reviewed_at = now
    db.commit()
    return ClauseFeedbackSubmissionCreated(
        id=record.id,
        status=record.status,
        clause_count=len(request.annotations) if request.decision == "annotate" else 0,
    )


@router.get("/feedback/pending", response_model=list[ClauseFeedbackItem], dependencies=[Depends(require_admin)])
def list_pending_feedback(db: Session = Depends(get_db)) -> list[ClauseFeedbackItem]:
    return (
        db.query(ClauseFeedback)
        .filter_by(status="pending")
        .order_by(ClauseFeedback.created_at.asc())
        .limit(200)
        .all()
    )


@router.post("/feedback/{feedback_id}/review", response_model=ClauseFeedbackItem, dependencies=[Depends(require_admin)])
def review_feedback(
    feedback_id: str,
    request: ClauseFeedbackReview,
    db: Session = Depends(get_db),
) -> ClauseFeedbackItem:
    record = db.query(ClauseFeedback).filter_by(id=feedback_id).first()
    if record is None:
        raise HTTPException(status_code=404, detail="Feedback record was not found.")
    if record.status != "pending":
        raise HTTPException(status_code=409, detail="Feedback has already been reviewed.")
    record.status = "approved" if request.decision == "approve" else "rejected"
    record.review_note = request.review_note
    record.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return record


@router.post("/models/reload", dependencies=[Depends(require_admin)])
def reload_active_model() -> dict:
    ClauseAnalysisService.reload_models()
    return {
        "status": "reloaded",
        "active_version": ClauseAnalysisService.get_active_loaded_version(),
    }


@router.patch("/models/{version}/label", dependencies=[Depends(require_admin)])
def update_model_display_label(
    version: str,
    request: ModelDisplayLabelUpdate,
    db: Session = Depends(get_db),
) -> dict:
    """Updates the reviewer display label for a model version. The system-generated version ID remains immutable."""
    record = db.query(AdaptiveModelVersion).filter_by(version=version).first()
    if record is None:
        raise HTTPException(status_code=404, detail=f"Model version '{version}' not found.")
    clean_label = request.display_label.strip() if request.display_label and request.display_label.strip() else None
    record.display_label = clean_label
    db.commit()
    db.refresh(record)
    return {
        "status": "updated",
        "version": record.version,
        "display_label": record.display_label,
    }


@router.post("/models/rollback", dependencies=[Depends(require_admin)])
def rollback_active_model() -> dict:
    project_root = _get_project_root()
    manifest_p = project_root / "ml" / "models" / "active_risk_model.json"
    meta_p = project_root / "ml" / "models" / "final_risk_model" / "metadata.json"
    baseline_version = "V7"
    if meta_p.is_file():
        try:
            baseline_version = json.loads(meta_p.read_text(encoding="utf-8")).get("model_version", "V7")
        except Exception:
            pass

    if not manifest_p.is_file():
        ClauseAnalysisService.reload_models()
        loaded_ver = ClauseAnalysisService.get_active_loaded_version() or baseline_version
        return {
            "status": "baseline",
            "active_version": baseline_version,
            "loaded_version": loaded_ver,
            "message": f"Active model is already at the baseline version '{baseline_version}'. No earlier checkpoint is active.",
        }

    try:
        from ml.adaptive_learning.train_candidate import rollback_active_model as ml_rollback
        restored_version = ml_rollback()
        ClauseAnalysisService.reload_models()
        loaded_version = ClauseAnalysisService.get_active_loaded_version() or restored_version
        if loaded_version != restored_version and loaded_version != baseline_version:
            raise RuntimeError(
                f"Model reload verification failed: loaded version '{loaded_version}' does not match restored active version '{restored_version}'."
            )
        return {
            "status": "rolled_back",
            "active_version": restored_version,
            "loaded_version": loaded_version,
            "message": f"Active model successfully rolled back to '{restored_version}'.",
        }
    except Exception as exc:
        safe_msg = _sanitize_error_summary(str(exc), default_msg="Rollback operation failed.")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Rollback failed on server: {safe_msg}",
        )


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
    if "File \"" in summary:
        summary = summary.split("File \"")[-1]
    summary = re.sub(r"(token|key|password|secret)[=:\s]+[^\s]+", r"\1=[REDACTED]", summary, flags=re.IGNORECASE)
    summary = re.sub(r"(sqlite|postgres|postgresql)://[^\s]+", r"[DATABASE_URL]", summary)
    clean = " ".join(summary.split())[:150].strip()
    return clean or default_msg


def cleanup_stale_jobs(include_queued: bool = False) -> int:
    """
    On-demand maintenance helper.
    Running-cycle recovery is owned by the worker service, which validates leases
    so active jobs running on live workers are never marked failed.
    Queued jobs are never aborted.
    """
    from ml.adaptive_learning.worker import cleanup_orphaned_running_jobs
    return cleanup_orphaned_running_jobs(session_module.SessionLocal)


@router.post("/cycle/run", status_code=status.HTTP_202_ACCEPTED, dependencies=[Depends(require_admin)])
def run_candidate_cycle(db: Session = Depends(get_db)) -> dict:
    if db.query(AdaptiveModelVersion).filter(AdaptiveModelVersion.status.in_(["running", "queued"])).count():
        raise HTTPException(status_code=409, detail="An adaptive-learning cycle is already in progress or queued.")

    approved_count, class_counts = _approved_feedback_counts(db)
    missing_classes = [
        label for label, count in class_counts.items()
        if count < DEMO_MIN_APPROVED_PER_CLASS
    ]
    if approved_count < DEMO_MIN_APPROVED_TOTAL or missing_classes:
        class_detail = ", ".join(f"{label}={class_counts[label]}" for label in ("LOW", "MEDIUM", "HIGH"))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Demonstration gate unmet: requires at least {DEMO_MIN_APPROVED_TOTAL} approved clauses "
                f"and at least {DEMO_MIN_APPROVED_PER_CLASS} per class; found {approved_count} total ({class_detail})."
            ),
        )

    now = datetime.now(timezone.utc)
    cycle_version = f"adaptive-{now.strftime('%Y%m%d-%H%M%S')}"

    # Pre-create the single record with status="queued" for the durable worker to claim
    cycle_record = AdaptiveModelVersion(
        version=cycle_version,
        status="queued",
        approved_feedback_count=approved_count,
        created_at=now,
    )
    db.add(cycle_record)
    db.commit()

    return {
        "status": "queued",
        "version": cycle_version,
        "message": f"Candidate training cycle '{cycle_version}' successfully queued for worker processing.",
    }
