"""Run one explicit candidate cycle; never trains during document analysis."""

from __future__ import annotations

import json
import os
import random
import sys
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv

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

load_dotenv(ROOT / "backend" / ".env")
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"

import yaml

_ml_import_error: str | None = None

try:
    import numpy as np
    import pandas as pd
    import torch
    import torch.nn as nn
    from torch.utils.data import DataLoader
    from transformers import AutoTokenizer
    from ml.evaluation.evaluate_pretrained_risk_models import MultiTaskLegalModel
except Exception as exc:
    _ml_import_error = f"{type(exc).__name__}: {exc}"
    np = None  # type: ignore
    pd = None  # type: ignore
    torch = None  # type: ignore
    nn = None  # type: ignore
    DataLoader = None  # type: ignore
    AutoTokenizer = None  # type: ignore
    MultiTaskLegalModel = None  # type: ignore

from app.database.migrations.init_db import init_db
from app.database.models import AdaptiveModelVersion, ClauseFeedback
from app.database.session import SessionLocal
from ml.adaptive_learning.dataset import RiskRegressionDataset, export_approved_feedback
from ml.models.artifact_manager import ensure_lexease_model_artifacts


def _require_ml():
    if _ml_import_error or any(m is None for m in (np, pd, torch, nn, DataLoader, AutoTokenizer, MultiTaskLegalModel)):
        err_detail = f": {_ml_import_error}" if _ml_import_error else ""
        raise RuntimeError(
            f"ML dependencies (torch, transformers, pandas, numpy) failed to import{err_detail}. "
            "Please ensure dependencies in ml/requirements.txt are installed or run inside ml/.venv."
        )



CLASSES = ["low", "medium", "high"]
TARGETS = {"LOW": 0.25, "MEDIUM": 0.50, "HIGH": 0.75}


def _metric_values(truth: list[str], predictions: list[str]) -> dict:
    from sklearn.metrics import accuracy_score, f1_score, recall_score, confusion_matrix
    cm = confusion_matrix(truth, predictions, labels=CLASSES).tolist()
    return {
        "accuracy": float(accuracy_score(truth, predictions)),
        "macro_f1": float(f1_score(truth, predictions, labels=CLASSES, average="macro", zero_division=0)),
        "high_risk_recall": float(recall_score(truth, predictions, labels=CLASSES, average=None, zero_division=0)[2]),
        "confusion_matrix": cm,
        "classes": CLASSES,
        "test_samples": len(truth),
    }


def normalize_clause_text(text: str) -> str:
    """Normalize text by lowercasing, stripping leading/trailing whitespace, punctuation, and collapsing internal spaces."""
    import re
    cleaned = re.sub(r"[^\w\s]", "", str(text).lower())
    return " ".join(cleaned.split())


def _extract_items(data, col_name: str) -> list[str]:
    if hasattr(data, "columns"):  # pandas DataFrame
        if col_name in data.columns:
            return [str(x) for x in data[col_name].dropna()]
        return []
    if isinstance(data, list):
        return [str(x[col_name]) for x in data if isinstance(x, dict) and col_name in x and x[col_name] is not None]
    return []


def check_data_leakage(train_frame, eval_frame, eval_name: str = "validation"):
    """
    Guarantees no data leakage between approved training feedback and evaluation datasets
    via exact text match, normalized text match, and document/source group overlap.
    Supports either pandas DataFrames or list of dicts.
    """
    train_clauses = _extract_items(train_frame, "clause_text")
    eval_clauses = _extract_items(eval_frame, "clause_text")

    train_raw = {s.strip() for s in train_clauses}
    eval_raw = {s.strip() for s in eval_clauses}
    exact_overlap = train_raw & eval_raw
    if exact_overlap:
        raise ValueError(
            f"Data leakage detected: {len(exact_overlap)} approved training clauses exactly match clauses in the {eval_name} set."
        )

    train_norm = {normalize_clause_text(s) for s in train_clauses}
    eval_norm = {normalize_clause_text(s) for s in eval_clauses}
    norm_overlap = train_norm & eval_norm
    if norm_overlap:
        raise ValueError(
            f"Data leakage detected: {len(norm_overlap)} approved training clauses have normalized match with clauses in the {eval_name} set."
        )

    train_groups = set(_extract_items(train_frame, "source_group_id"))
    eval_groups = set(_extract_items(eval_frame, "document_name") or _extract_items(eval_frame, "source_group_id"))
    if train_groups and eval_groups:
        group_overlap = train_groups & eval_groups
        if group_overlap:
            raise ValueError(
                f"Data leakage detected: {len(group_overlap)} source groups overlap between training data and {eval_name} set ({group_overlap})."
            )


def _evaluate(model, tokenizer, eval_frame: pd.DataFrame, device: torch.device) -> dict:
    label_col = "correct_risk_level" if "correct_risk_level" in eval_frame.columns else "risk_level"
    truth = eval_frame[label_col].astype(str).str.lower().tolist()
    predictions: list[str] = []
    model.eval()
    with torch.no_grad():
        for text in eval_frame["clause_text"].astype(str):
            tokens = tokenizer(text, return_tensors="pt", truncation=True, max_length=256, padding=True)
            _, output = model(tokens["input_ids"].to(device), tokens["attention_mask"].to(device))
            score = float(output.item()) * 100
            predictions.append("low" if score < 41 else "medium" if score < 60 else "high")
    return _metric_values(truth, predictions)


def _accept(candidate: dict, baseline: dict, criteria: dict, parent_version: str | None = None) -> dict:
    """
    Evaluates candidate against parent baseline. A candidate is promoted ONLY when:
    1. It improves at least one configured primary metric (accuracy or macro F1) over its
       active parent by a configured minimum absolute improvement (e.g. >= 0.005).
       Ties and rounding-only differences fail promotion.
    2. No protected metric (accuracy, macro F1, high-risk recall) regresses beyond its
       explicitly configured tolerance (default 0.0).
    3. High-risk recall meets the configured safety floor (default >= 0.80) and does
       not regress from the parent.
    All comparisons use full-precision metrics.
    """
    cand_acc = float(candidate["accuracy"])
    base_acc = float(baseline["accuracy"])
    acc_delta = cand_acc - base_acc

    cand_f1 = float(candidate["macro_f1"])
    base_f1 = float(baseline["macro_f1"])
    f1_delta = cand_f1 - base_f1

    cand_recall = float(candidate["high_risk_recall"])
    base_recall = float(baseline["high_risk_recall"])
    recall_delta = cand_recall - base_recall

    min_acc_imp = float(criteria.get("min_accuracy_improvement", criteria.get("min_improvement", criteria.get("minimum_accuracy_delta", 0.005))))
    min_f1_imp = float(criteria.get("min_macro_f1_improvement", criteria.get("min_improvement", criteria.get("minimum_macro_f1_delta", 0.005))))
    max_reg_tol = float(criteria.get("max_regression_tolerance", 0.0))
    max_recall_drop = float(criteria.get("maximum_high_risk_recall_drop", max_reg_tol))
    safety_floor = float(criteria.get("safety_floor_high_risk_recall", criteria.get("minimum_high_risk_recall", 0.80)))

    acc_improved = acc_delta >= min_acc_imp
    f1_improved = f1_delta >= min_f1_imp
    has_primary_improvement = bool(acc_improved or f1_improved)

    acc_non_regressed = acc_delta >= -max_reg_tol
    f1_non_regressed = f1_delta >= -max_reg_tol
    recall_non_regressed = recall_delta >= -max_recall_drop
    meets_safety_floor = cand_recall >= safety_floor

    passed = bool(has_primary_improvement and acc_non_regressed and f1_non_regressed and recall_non_regressed and meets_safety_floor)

    reasons: list[str] = []
    if passed:
        reasons.append(
            f"Candidate passed: achieved measurable primary improvement (acc_delta: {acc_delta:+.6f}, f1_delta: {f1_delta:+.6f}) "
            f"without regression and satisfied high-risk recall safety floor ({cand_recall:.6f} >= {safety_floor:.6f})."
        )
    else:
        if not has_primary_improvement:
            if abs(acc_delta) < 1e-9 and abs(f1_delta) < 1e-9:
                reasons.append(
                    f"Rejected: candidate tied parent on primary metrics (acc_delta: {acc_delta:+.6f}, f1_delta: {f1_delta:+.6f}); "
                    f"minimum absolute improvement of {min(min_acc_imp, min_f1_imp):.6f} is required."
                )
            else:
                reasons.append(
                    f"Rejected: candidate did not achieve required minimum primary improvement over parent "
                    f"(accuracy delta: {acc_delta:+.6f} vs required +{min_acc_imp:.6f}; macro F1 delta: {f1_delta:+.6f} vs required +{min_f1_imp:.6f})."
                )
        if not meets_safety_floor:
            reasons.append(
                f"Rejected: candidate high-risk recall ({cand_recall:.6f}) is below configured safety floor ({safety_floor:.6f})."
            )
        if not recall_non_regressed:
            reasons.append(
                f"Rejected: candidate high-risk recall regressed from parent ({recall_delta:+.6f} vs max allowed drop {-max_recall_drop:+.6f})."
            )
        if not acc_non_regressed:
            reasons.append(
                f"Rejected: candidate accuracy regressed from parent beyond tolerance ({acc_delta:+.6f} vs max allowed drop {-max_reg_tol:+.6f})."
            )
        if not f1_non_regressed:
            reasons.append(
                f"Rejected: candidate macro F1 regressed from parent beyond tolerance ({f1_delta:+.6f} vs max allowed drop {-max_reg_tol:+.6f})."
            )

    checks = {
        "accuracy": acc_delta >= float(criteria.get("minimum_accuracy_delta", min_acc_imp)),
        "macro_f1": f1_delta >= float(criteria.get("minimum_macro_f1_delta", min_f1_imp)),
        "accuracy_improvement": acc_improved,
        "macro_f1_improvement": f1_improved,
        "has_primary_improvement": has_primary_improvement,
        "accuracy_non_regression": acc_non_regressed,
        "macro_f1_non_regression": f1_non_regressed,
        "high_risk_recall_non_regression": recall_non_regressed,
        "minimum_high_risk_recall": meets_safety_floor,
    }

    deltas = {
        "accuracy": acc_delta,
        "macro_f1": f1_delta,
        "high_risk_recall": recall_delta,
    }

    thresholds = {
        "min_accuracy_improvement": min_acc_imp,
        "min_macro_f1_improvement": min_f1_imp,
        "max_regression_tolerance": max_reg_tol,
        "maximum_high_risk_recall_drop": max_recall_drop,
        "safety_floor_high_risk_recall": safety_floor,
    }

    return {
        "passed": passed,
        "primary_improvement": has_primary_improvement,
        "checks": checks,
        "deltas": deltas,
        "thresholds": thresholds,
        "reasons": reasons,
        "parent_version": parent_version,
        "criteria": criteria,
    }


def evaluate_active_baseline() -> str:
    """Measure the currently active checkpoint on the validation set without training or promotion."""
    _require_ml()
    config = yaml.safe_load((ROOT / "ml/config/adaptive_learning.yaml").read_text(encoding="utf-8"))
    val_rel_path = config["dataset"].get("validation_set") or config["dataset"].get("fixed_test_set")
    val_path = ROOT / val_rel_path
    model_root = ROOT / "ml/models"
    manifest_path = model_root / "active_risk_model.json"
    active_dir = model_root / "final_risk_model"
    manifest = None
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        active_dir = (ROOT / "ml" / manifest["model_path"]).resolve()
        if os.path.commonpath([str(active_dir), str(model_root.resolve())]) != str(model_root.resolve()):
            raise ValueError("Active risk model path must stay within ml/models.")
    meta = json.loads((active_dir / "metadata.json").read_text(encoding="utf-8"))
    version = str(manifest.get("version") if manifest else meta.get("model_version", "baseline"))

    init_db()
    with SessionLocal() as db:
        existing = db.query(AdaptiveModelVersion).filter_by(version=version).one_or_none()
        if existing and existing.metrics_json and existing.metrics_json != "{}":
            return version

    val_frame = pd.read_csv(val_path)
    label_col = "correct_risk_level" if "correct_risk_level" in val_frame.columns else "risk_level"
    min_samples = int(config["dataset"].get("minimum_validation_samples", config["dataset"].get("minimum_test_samples", 30)))
    if "clause_text" not in val_frame.columns or label_col not in val_frame.columns or len(val_frame) < min_samples:
        raise ValueError("Held-out validation set is missing required fields or samples.")
    if not set(val_frame[label_col].astype(str).str.lower()).issubset(set(CLASSES)):
        raise ValueError("Held-out validation set contains an unsupported risk label.")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(active_dir, local_files_only=True)
    model = MultiTaskLegalModel(
        "nlpaueb/legal-bert-base-uncased",
        int(meta["num_labels"]),
        hidden_size=int(meta.get("hidden_size", 768)),
        dropout_rate=float(meta.get("dropout_rate", 0.25)),
        pretrained=False,
        vocab_size=tokenizer.vocab_size,
    )
    ensure_lexease_model_artifacts(active_dir)
    weights = active_dir / "pytorch_model.bin"
    if not weights.is_file() or weights.stat().st_size < 1_000_000:
        raise FileNotFoundError("The active risk checkpoint is missing or incomplete; restore its Git LFS file first.")
    model.load_state_dict(torch.load(weights, map_location=device))
    model.to(device)
    measured_metrics = _evaluate(model, tokenizer, val_frame, device)
    checkpoint_path = str(active_dir.relative_to(ROOT / "ml"))

    with SessionLocal() as db:
        record = db.query(AdaptiveModelVersion).filter_by(version=version).one_or_none()
        if record is None:
            record = AdaptiveModelVersion(version=version, status="baseline")
            db.add(record)
        record.status = "baseline"
        record.checkpoint_path = checkpoint_path
        record.metrics_json = json.dumps(measured_metrics)
        record.acceptance_json = json.dumps({"baseline_evaluation": True, "promotion": "not applicable"})
        record.test_sample_count = len(val_frame)
        record.completed_at = datetime.now(timezone.utc)
        db.commit()
    return version


def rollback_active_model() -> str:
    """Restores the previous/parent checkpoint or baseline in active_risk_model.json."""
    model_root = ROOT / "ml/models"
    manifest_path = model_root / "active_risk_model.json"
    active_dir = model_root / "final_risk_model"
    meta = {}
    if (active_dir / "metadata.json").is_file():
        try:
            meta = json.loads((active_dir / "metadata.json").read_text(encoding="utf-8"))
        except Exception:
            pass
    baseline_version = str(meta.get("model_version", "baseline"))

    if not manifest_path.is_file():
        return baseline_version

    init_db()
    with SessionLocal() as db:
        current_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        current_version = current_manifest.get("version")
        record = db.query(AdaptiveModelVersion).filter_by(version=current_version).one_or_none()
        parent_version = record.parent_version if record else None

        if not parent_version or parent_version in ("baseline", baseline_version):
            manifest_path.unlink(missing_ok=True)
            restored = baseline_version
        else:
            parent_dir = model_root / "adaptive" / parent_version
            if not parent_dir.is_dir() or not (parent_dir / "pytorch_model.bin").is_file():
                manifest_path.unlink(missing_ok=True)
                restored = baseline_version
            else:
                new_manifest = {"version": parent_version, "model_path": f"models/adaptive/{parent_version}"}
                manifest_path.write_text(json.dumps(new_manifest, indent=2), encoding="utf-8")
                restored = parent_version

        if record:
            record.status = "rolled_back"
        restored_record = db.query(AdaptiveModelVersion).filter_by(version=restored).one_or_none()
        if restored_record:
            restored_record.status = "promoted" if restored != baseline_version else "baseline"
        db.commit()
        return restored


def run_cycle(cycle_version: str | None = None) -> str:
    _require_ml()
    config = yaml.safe_load((ROOT / "ml/config/adaptive_learning.yaml").read_text(encoding="utf-8"))
    now = datetime.now(timezone.utc)
    version = cycle_version or os.getenv("ADAPTIVE_CYCLE_VERSION") or f"adaptive-{now.strftime('%Y%m%d-%H%M%S-%f')}"
    export_path = ROOT / config["dataset"]["export_dir"] / f"approved-{version}.csv"
    val_rel_path = config["dataset"].get("validation_set") or config["dataset"].get("fixed_test_set")
    val_path = ROOT / val_rel_path
    locked_test_rel_path = config["dataset"].get("locked_test_set")
    locked_test_path = ROOT / locked_test_rel_path if locked_test_rel_path else None
    model_root = ROOT / "ml/models"
    active_dir = model_root / "final_risk_model"
    manifest_path = model_root / "active_risk_model.json"
    manifest = None
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        active_dir = (ROOT / "ml" / manifest["model_path"]).resolve()
        if os.path.commonpath([str(active_dir), str(model_root.resolve())]) != str(model_root.resolve()):
            raise ValueError("Active risk model path must stay within ml/models.")
    weight_path = active_dir / "pytorch_model.bin"
    checkpoint_dir = model_root / "adaptive" / version

    init_db()
    with SessionLocal() as db:
        existing = db.query(AdaptiveModelVersion).filter_by(version=version).one_or_none()
        if existing:
            existing.status = "running"
            db.commit()
        else:
            if db.query(AdaptiveModelVersion).filter_by(status="running").count():
                raise RuntimeError("An adaptive-learning cycle is already running.")
            approved = db.query(ClauseFeedback).filter_by(status="approved", consent=True).count()
            running = AdaptiveModelVersion(version=version, status="running", approved_feedback_count=approved)
            db.add(running)
            db.commit()

    try:
        with SessionLocal() as db:
            exported_rows = export_approved_feedback(db, export_path)
        frame = pd.DataFrame(exported_rows)
        if "clause_text" not in frame.columns or "risk_level" not in frame.columns:
            raise ValueError("Exported approved feedback is missing required clause_text or risk_level columns.")
        minimum = int(config["dataset"]["minimum_approved_feedback"])
        if len(frame) < minimum:
            raise ValueError(f"Need at least {minimum} approved clauses; found {len(frame)}.")
        counts = frame["risk_level"].value_counts().to_dict()
        required_per_class = int(config["dataset"]["minimum_per_class"])
        missing_classes = [label for label in TARGETS if counts.get(label, 0) < required_per_class]
        if missing_classes:
            raise ValueError(f"Need at least {required_per_class} approved examples per class; insufficient: {', '.join(missing_classes)}.")
        if not val_path.is_file():
            raise FileNotFoundError(f"Held-out validation set not found: {val_path}")
        val_frame = pd.read_csv(val_path)
        val_label_col = "correct_risk_level" if "correct_risk_level" in val_frame.columns else "risk_level"
        if "clause_text" not in val_frame.columns or val_label_col not in val_frame.columns:
            raise ValueError("Validation set must contain clause_text and correct_risk_level/risk_level columns.")
        min_val_samples = int(config["dataset"].get("minimum_validation_samples", config["dataset"].get("minimum_test_samples", 30)))
        if len(val_frame) < min_val_samples:
            raise ValueError("Held-out validation set is smaller than its configured minimum.")
        val_labels = set(val_frame[val_label_col].astype(str).str.lower())
        if not val_labels.issubset(set(CLASSES)):
            raise ValueError("Validation set contains an unsupported risk label.")

        # Rigorous data leakage prevention
        check_data_leakage(frame, val_frame, "validation")
        if locked_test_path and locked_test_path.is_file():
            locked_test_frame = pd.read_csv(locked_test_path)
            if "clause_text" in locked_test_frame.columns:
                check_data_leakage(frame, locked_test_frame, "locked test")

        ensure_lexease_model_artifacts(active_dir)
        if not weight_path.is_file() or weight_path.stat().st_size < 1_000_000:
            raise FileNotFoundError("The tracked final-risk checkpoint is not present. Restore Git LFS model files with `git lfs pull` before training.")

        meta = json.loads((active_dir / "metadata.json").read_text(encoding="utf-8"))
        parent_version = str(manifest.get("version") if manifest else meta.get("model_version", "baseline"))
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        tokenizer = AutoTokenizer.from_pretrained(active_dir, local_files_only=True)
        baseline_model = MultiTaskLegalModel(
            "nlpaueb/legal-bert-base-uncased",
            int(meta["num_labels"]),
            hidden_size=int(meta.get("hidden_size", 768)),
            dropout_rate=float(meta.get("dropout_rate", 0.25)),
            pretrained=False,
            vocab_size=tokenizer.vocab_size,
        )
        baseline_model.load_state_dict(torch.load(weight_path, map_location=device))
        baseline_model.to(device)
        baseline_metrics = _evaluate(baseline_model, tokenizer, val_frame, device)
        del baseline_model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        cfg = config["training"]
        random.seed(int(cfg["seed"]))
        np.random.seed(int(cfg["seed"]))
        torch.manual_seed(int(cfg["seed"]))
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(int(cfg["seed"]))
        training_data = RiskRegressionDataset(
            texts=frame["clause_text"].astype(str).tolist(),
            risk_targets=frame["risk_level"].map(TARGETS).tolist(),
            sample_weights=[1.0] * len(frame),
            tokenizer=tokenizer,
            max_len=int(cfg["max_length"]),
        )
        loader = DataLoader(training_data, batch_size=int(cfg["batch_size"]), shuffle=True)
        candidate = MultiTaskLegalModel(
            "nlpaueb/legal-bert-base-uncased",
            int(meta["num_labels"]),
            hidden_size=int(meta.get("hidden_size", 768)),
            dropout_rate=float(meta.get("dropout_rate", 0.25)),
            pretrained=False,
            vocab_size=tokenizer.vocab_size,
        )
        candidate.load_state_dict(torch.load(weight_path, map_location=device))
        for param in candidate.bert.parameters():
            param.requires_grad = False
        candidate.to(device)
        optimizer = torch.optim.AdamW(candidate.regressor.parameters(), lr=float(cfg["learning_rate"]))
        loss_fn = nn.HuberLoss(delta=0.1)
        for _ in range(int(cfg["epochs"])):
            candidate.train()
            candidate.bert.eval()
            for batch in loader:
                optimizer.zero_grad()
                _, output = candidate(batch["input_ids"].to(device), batch["attention_mask"].to(device))
                target = batch["risk_target"].to(device)
                loss = loss_fn(output, target)
                loss.backward()
                nn.utils.clip_grad_norm_(candidate.regressor.parameters(), max_norm=1.0)
                optimizer.step()

        # Decision is made strictly on the held-out validation set
        candidate_metrics = _evaluate(candidate, tokenizer, val_frame, device)
        acceptance = _accept(candidate_metrics, baseline_metrics, config["acceptance"], parent_version=parent_version)

        checkpoint_dir.mkdir(parents=True, exist_ok=False)
        torch.save(candidate.state_dict(), checkpoint_dir / "pytorch_model.bin")
        tokenizer.save_pretrained(checkpoint_dir)
        candidate_metadata = {
            "model_version": version,
            "parent_version": parent_version,
            "model_name": meta.get("model_name", "nlpaueb/legal-bert-base-uncased"),
            "num_labels": int(meta["num_labels"]),
            "label_names": meta.get("label_names", []),
            "max_sequence_length": int(cfg["max_length"]),
            "metrics": {"baseline": baseline_metrics, "candidate": candidate_metrics},
            "acceptance": acceptance,
        }
        (checkpoint_dir / "metadata.json").write_text(
            json.dumps(candidate_metadata, indent=2),
            encoding="utf-8",
        )

        old_manifest_bytes = manifest_path.read_bytes() if manifest_path.is_file() else None
        if acceptance["passed"]:
            temp_manifest = manifest_path.with_suffix(".json.tmp")
            temp_manifest.write_text(json.dumps({"version": version, "model_path": str(checkpoint_dir.relative_to(ROOT / "ml"))}, indent=2), encoding="utf-8")
            os.replace(temp_manifest, manifest_path)
        with SessionLocal() as db:
            current = db.query(AdaptiveModelVersion).filter_by(version=version).one()
            current.parent_version = parent_version
            current.status = "promoted" if acceptance["passed"] else "rejected"
            current.checkpoint_path = str(checkpoint_dir.relative_to(ROOT / "ml"))
            current.metrics_json = json.dumps({"baseline": baseline_metrics, "candidate": candidate_metrics})
            current.acceptance_json = json.dumps(acceptance)
            current.test_sample_count = len(val_frame)
            current.completed_at = datetime.now(timezone.utc)
            if acceptance["passed"]:
                for previous in db.query(AdaptiveModelVersion).filter(AdaptiveModelVersion.status.in_(["promoted", "baseline"])).all():
                    previous.status = "superseded"
            try:
                db.commit()
            except Exception:
                db.rollback()
                if acceptance["passed"]:
                    if old_manifest_bytes is None:
                        manifest_path.unlink(missing_ok=True)
                    else:
                        manifest_path.write_bytes(old_manifest_bytes)
                raise
        return version
    except Exception as exc:
        with SessionLocal() as db:
            current = db.query(AdaptiveModelVersion).filter_by(version=version).one_or_none()
            if current:
                current.status = "failed"
                exc_type = type(exc).__name__
                import re
                raw_line = str(exc).splitlines()[0] if str(exc) else ""
                raw_line = re.sub(r"(token|key|password|secret)[=:\s]+[^\s]+", r"\1=[REDACTED]", raw_line, flags=re.IGNORECASE)
                raw_line = re.sub(r"(sqlite|postgres|postgresql)://[^\s]+", r"[DATABASE_URL]", raw_line)
                exc_line = " ".join(raw_line.split())[:120].strip()
                current.error_message = f"{exc_type}: {exc_line}" if exc_line else exc_type
                current.completed_at = datetime.now(timezone.utc)
                db.commit()
        raise


def run_final_test_check() -> dict:
    """Evaluates the active model on the locked test set for held-out verification."""
    _require_ml()
    config = yaml.safe_load((ROOT / "ml/config/adaptive_learning.yaml").read_text(encoding="utf-8"))
    locked_test_rel_path = config["dataset"].get("locked_test_set") or "ml/data/splits/test.csv"
    locked_test_path = ROOT / locked_test_rel_path
    if not locked_test_path.is_file():
        raise FileNotFoundError(f"Locked test set not found at {locked_test_path}")

    model_root = ROOT / "ml/models"
    manifest_path = model_root / "active_risk_model.json"
    active_dir = model_root / "final_risk_model"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        active_dir = (ROOT / "ml" / manifest["model_path"]).resolve()

    meta = json.loads((active_dir / "metadata.json").read_text(encoding="utf-8"))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(active_dir, local_files_only=True)
    model = MultiTaskLegalModel(
        "nlpaueb/legal-bert-base-uncased",
        int(meta["num_labels"]),
        hidden_size=int(meta.get("hidden_size", 768)),
        dropout_rate=float(meta.get("dropout_rate", 0.25)),
        pretrained=False,
        vocab_size=tokenizer.vocab_size,
    )
    weights = active_dir / "pytorch_model.bin"
    model.load_state_dict(torch.load(weights, map_location=device))
    model.to(device)

    test_frame = pd.read_csv(locked_test_path)
    metrics = _evaluate(model, tokenizer, test_frame, device)
    return metrics


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate the active model, run a reviewed candidate cycle, or rollback.")
    parser.add_argument("--evaluate-baseline", action="store_true", help="Measure the active model on the validation set without training.")
    parser.add_argument("--run-final-test", action="store_true", help="Run locked test set verification on the active model.")
    parser.add_argument("--rollback", action="store_true", help="Roll back the active model to its parent checkpoint or baseline.")
    parser.add_argument("--version", type=str, default=None, help="Explicit candidate version identifier.")
    args = parser.parse_args()

    if args.rollback:
        restored = rollback_active_model()
        print(f"Active model rolled back to: {restored}")
    elif args.run_final_test:
        test_metrics = run_final_test_check()
        print(f"Locked test set verification: {test_metrics}")
    elif args.evaluate_baseline:
        completed_version = evaluate_active_baseline()
        print(f"Baseline evaluation recorded: {completed_version}")
    else:
        completed_version = run_cycle(cycle_version=args.version)
        print(f"Adaptive learning cycle completed: {completed_version}")
