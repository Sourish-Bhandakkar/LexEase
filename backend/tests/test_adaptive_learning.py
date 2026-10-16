import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.database.models import ClauseFeedback
import app.database.session as session_module
from app.api.routers.adaptive_learning import (
    get_dashboard,
    list_pending_feedback,
    require_admin,
    review_feedback,
    review_feedback_submission,
    submit_feedback,
    submit_feedback_batch,
    list_pending_feedback_submissions,
)
from app.schemas.adaptive_learning import (
    ClauseFeedbackCreate,
    ClauseFeedbackReview,
    ClauseFeedbackSubmissionCreate,
    ClauseFeedbackSubmissionReview,
)
from ml.adaptive_learning.dataset import export_approved_feedback


def test_feedback_requires_consent_and_stores_clause_only():
    with session_module.SessionLocal() as db:
        with pytest.raises(HTTPException) as error:
            submit_feedback(ClauseFeedbackCreate(
                clause_text="The supplier may terminate at any time.",
                predicted_risk_level="low",
                corrected_risk_level="high",
                consent=False,
            ), db)
        assert getattr(error.value, "status_code", None) == 400

        response = submit_feedback(ClauseFeedbackCreate(
            clause_text="Contact test@example.com at 9876543210. Supplier has unlimited liability.",
            predicted_risk_level="low",
            corrected_risk_level="high",
            consent=True,
        ), db)
        assert response.status == "pending"
    with session_module.SessionLocal() as db:
        record = db.query(ClauseFeedback).filter_by(id=response.id).one()
        assert record.status == "pending"
        assert record.consent is True
        assert "test@example.com" not in record.clause_text
        assert "9876543210" not in record.clause_text


def test_feedback_requires_admin_review_before_export(monkeypatch):
    monkeypatch.setattr(settings, "ADAPTIVE_LEARNING_ADMIN_TOKEN", "review-secret")
    with session_module.SessionLocal() as db:
        response = submit_feedback(ClauseFeedbackCreate(
            clause_text="The tenant may terminate this lease without notice.",
            predicted_risk_level="low",
            corrected_risk_level="high",
            consent=True,
        ), db)
        with pytest.raises(HTTPException) as error:
            require_admin(x_adaptive_admin_token=None)
        assert getattr(error.value, "status_code", None) == 403
        require_admin(x_adaptive_admin_token="review-secret")
        pending = list_pending_feedback(db)
        assert any(item.id == response.id for item in pending)
        approved = review_feedback(
            response.id,
            ClauseFeedbackReview(decision="approve"),
            db,
        )
        assert approved.status == "approved"
    with session_module.SessionLocal() as db:
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1]) as temp_dir:
            output_path = Path(temp_dir) / "approved.csv"
            exported = export_approved_feedback(db, output_path)
            assert set(exported[0]) == {"clause_text", "risk_level", "source_group_id"}
            assert len(exported) == 1
            assert exported[0]["risk_level"] == "HIGH"
            assert exported[0]["source_group_id"].startswith("single_") or len(exported[0]["source_group_id"]) > 0
            assert output_path.read_text(encoding="utf-8").splitlines()[0] == "clause_text,risk_level,source_group_id"


def test_dashboard_does_not_invent_metrics():
    with session_module.SessionLocal() as db:
        response = get_dashboard(db)
    assert response.active_metrics is None
    assert response.history == []


def test_document_batch_submission_is_pii_masked_and_only_admin_annotations_train():
    with session_module.SessionLocal() as db:
        batch = submit_feedback_batch(ClauseFeedbackSubmissionCreate(
            clauses=[
                {
                    "clause_id": "batch-clause-a",
                    "clause_number": "1",
                    "clause_text": "Email test@example.com. Provider may suspend services immediately.",
                    "predicted_risk_level": "medium",
                    "confidence": 0.73,
                },
                {
                    "clause_id": "batch-clause-b",
                    "clause_number": "2",
                    "clause_text": "Either party may terminate on thirty days notice.",
                    "predicted_risk_level": "low",
                    "confidence": 0.91,
                },
            ],
            consent=True,
        ), db)
        assert batch.status == "pending"
        assert batch.clause_count == 2
        pending = next(item for item in list_pending_feedback_submissions(db) if item.id == batch.id)
        assert "test@example.com" not in pending.clauses[0].clause_text

        reviewed = review_feedback_submission(
            batch.id,
            ClauseFeedbackSubmissionReview(
                decision="annotate",
                annotations=[{"clause_id": "batch-clause-a", "corrected_risk_level": "high"}],
            ),
            db,
        )
        assert reviewed.status == "annotated"
        assert reviewed.clause_count == 1
        approved = db.query(ClauseFeedback).filter_by(
            predicted_risk_level="medium",
            corrected_risk_level="high",
            status="approved",
        ).all()
        assert any("Provider may suspend services" in item.clause_text for item in approved)


def test_dashboard_eligibility_gate_and_demonstration_label():
    with session_module.SessionLocal() as db:
        dashboard = get_dashboard(db)
        assert dashboard.approved_feedback_count == 0
        assert dashboard.approved_class_counts == {"LOW": 0, "MEDIUM": 0, "HIGH": 0}
        assert dashboard.gate_met is False
        assert "demonstration" in dashboard.gate_label.lower()
        assert dashboard.gate_requirements["minimum_total"] == 15
        assert dashboard.gate_requirements["minimum_per_class"] == 5

        # Add 15 LOW clauses -> count=15, but per-class requirement is NOT met for MEDIUM and HIGH
        for i in range(15):
            db.add(ClauseFeedback(
                clause_text=f"Low risk clause number {i} for demonstration.",
                predicted_risk_level="low",
                corrected_risk_level="low",
                consent=True,
                status="approved",
                source_group_id=f"group_low_{i}",
            ))
        db.commit()

        dashboard = get_dashboard(db)
        assert dashboard.approved_feedback_count == 15
        assert dashboard.approved_class_counts["LOW"] == 15
        assert dashboard.approved_class_counts["MEDIUM"] == 0
        assert dashboard.approved_class_counts["HIGH"] == 0
        assert dashboard.gate_met is False

        # Add 5 MEDIUM and 5 HIGH clauses
        for i in range(5):
            db.add(ClauseFeedback(
                clause_text=f"Medium risk clause number {i} for demonstration.",
                predicted_risk_level="low",
                corrected_risk_level="medium",
                consent=True,
                status="approved",
                source_group_id=f"group_med_{i}",
            ))
            db.add(ClauseFeedback(
                clause_text=f"High risk clause number {i} for demonstration.",
                predicted_risk_level="low",
                corrected_risk_level="high",
                consent=True,
                status="approved",
                source_group_id=f"group_high_{i}",
            ))
        db.commit()

        dashboard = get_dashboard(db)
        assert dashboard.approved_feedback_count == 25
        assert dashboard.approved_class_counts["LOW"] == 15
        assert dashboard.approved_class_counts["MEDIUM"] == 5
        assert dashboard.approved_class_counts["HIGH"] == 5
        assert dashboard.gate_met is True


def test_source_group_tracking_and_batch_isolation():
    with session_module.SessionLocal() as db:
        batch = submit_feedback_batch(ClauseFeedbackSubmissionCreate(
            clauses=[
                {
                    "clause_id": "c1",
                    "clause_number": "1",
                    "clause_text": "Clause 1 from document A.",
                    "predicted_risk_level": "low",
                },
                {
                    "clause_id": "c2",
                    "clause_number": "2",
                    "clause_text": "Clause 2 from document A.",
                    "predicted_risk_level": "medium",
                },
            ],
            consent=True,
        ), db)

        review_feedback_submission(
            batch.id,
            ClauseFeedbackSubmissionReview(
                decision="annotate",
                annotations=[
                    {"clause_id": "c1", "corrected_risk_level": "medium"},
                    {"clause_id": "c2", "corrected_risk_level": "high"},
                ],
            ),
            db,
        )

        records = db.query(ClauseFeedback).filter_by(status="approved").all()
        # Both approved clauses from this submission must share the submission's source_group_id
        batch_records = [r for r in records if f"submission_{batch.id}" == r.source_group_id]
        assert len(batch_records) == 2
        assert batch_records[0].source_group_id == batch_records[1].source_group_id
        assert batch_records[0].source_group_id == f"submission_{batch.id}"

        # Single submission has its own source_group_id
        single = submit_feedback(ClauseFeedbackCreate(
            clause_text="Standalone single clause from document B.",
            predicted_risk_level="low",
            corrected_risk_level="high",
            consent=True,
        ), db)
        review_feedback(single.id, ClauseFeedbackReview(decision="approve"), db)
        single_record = db.query(ClauseFeedback).filter_by(id=single.id).one()
        assert single_record.source_group_id != batch_records[0].source_group_id
        assert len(single_record.source_group_id) > 0


def test_data_leakage_detection():
    from ml.adaptive_learning.train_candidate import check_data_leakage, normalize_clause_text

    # Normalization check
    assert normalize_clause_text("  This IS a Test! Clause, with punctuation...  ") == "this is a test clause with punctuation"

    # Disjoint datasets pass
    train_data = [
        {"clause_text": "The tenant shall maintain premises.", "source_group_id": "group_1"},
        {"clause_text": "Payment due within 30 days.", "source_group_id": "group_2"},
    ]
    eval_data = [
        {"clause_text": "Supplier shall deliver goods by Friday.", "document_name": "doc_val_1"},
        {"clause_text": "Governing law is Delaware.", "document_name": "doc_val_2"},
    ]
    # Should not raise
    check_data_leakage(train_data, eval_data, "validation")

    # Exact overlap check
    leaky_data = [
        {"clause_text": "The tenant shall maintain premises.", "document_name": "doc_val_1"},
        {"clause_text": "Other clause.", "document_name": "doc_val_2"},
    ]
    with pytest.raises(ValueError) as exc_exact:
        check_data_leakage(train_data, leaky_data, "validation")
    assert "exactly match" in str(exc_exact.value).lower()

    # Normalized overlap check (punctuation/casing)
    norm_leaky_data = [
        {"clause_text": "the tenant SHALL maintain premises!", "document_name": "doc_val_1"},
        {"clause_text": "Other clause.", "document_name": "doc_val_2"},
    ]
    with pytest.raises(ValueError) as exc_norm:
        check_data_leakage(train_data, norm_leaky_data, "validation")
    assert "normalized match" in str(exc_norm.value).lower()

    # Source group overlap check
    group_leaky_data = [
        {"clause_text": "Completely different text here.", "document_name": "group_1"},
        {"clause_text": "Other clause.", "document_name": "doc_val_2"},
    ]
    with pytest.raises(ValueError) as exc_group:
        check_data_leakage(train_data, group_leaky_data, "validation")
    assert "source groups overlap" in str(exc_group.value).lower()


def test_candidate_acceptance_conservative_rules():
    from ml.adaptive_learning.train_candidate import _accept

    criteria = {
        "minimum_accuracy_delta": 0.0,
        "minimum_macro_f1_delta": 0.0,
        "maximum_high_risk_recall_drop": 0.0,
        "minimum_high_risk_recall": 0.80,
    }
    baseline = {
        "accuracy": 0.88,
        "macro_f1": 0.85,
        "high_risk_recall": 0.85,
    }

    # Case 1: High-risk recall falls below floor (0.80) -> must reject
    res1 = _accept({"accuracy": 0.90, "macro_f1": 0.88, "high_risk_recall": 0.78}, baseline, criteria)
    assert res1["passed"] is False
    assert res1["checks"]["minimum_high_risk_recall"] is False

    # Case 2: High-risk recall regresses vs baseline (0.82 vs 0.85) -> must reject
    res2 = _accept({"accuracy": 0.90, "macro_f1": 0.88, "high_risk_recall": 0.82}, baseline, criteria)
    assert res2["passed"] is False
    assert res2["checks"]["high_risk_recall_non_regression"] is False

    # Case 3: Macro F1 regresses vs baseline (0.83 vs 0.85) -> must reject
    res3 = _accept({"accuracy": 0.90, "macro_f1": 0.83, "high_risk_recall": 0.85}, baseline, criteria)
    assert res3["passed"] is False
    assert res3["checks"]["macro_f1"] is False

    # Case 4: Accuracy regresses vs baseline (0.86 vs 0.88) -> must reject
    res4 = _accept({"accuracy": 0.86, "macro_f1": 0.86, "high_risk_recall": 0.86}, baseline, criteria)
    assert res4["passed"] is False
    assert res4["checks"]["accuracy"] is False

    # Case 5: All metrics meet or exceed baseline with recall >= floor -> accepts
    res5 = _accept({"accuracy": 0.89, "macro_f1": 0.87, "high_risk_recall": 0.86}, baseline, criteria)
    assert res5["passed"] is True
    assert all(res5["checks"].values())


def test_model_reload_and_rollback_endpoints(monkeypatch):
    from app.api.routers.adaptive_learning import reload_active_model, rollback_active_model, run_candidate_cycle
    from app.services.clause_analysis import ClauseAnalysisService
    from ml.adaptive_learning import train_candidate

    # Endpoint behavior should not load large model checkpoints or mutate the live manifest.
    monkeypatch.setattr(ClauseAnalysisService, "reload_models", classmethod(lambda cls: None))
    monkeypatch.setattr(ClauseAnalysisService, "get_active_loaded_version", classmethod(lambda cls: "baseline"))
    monkeypatch.setattr(train_candidate, "rollback_active_model", lambda: "baseline")

    # Reload active model succeeds
    reload_resp = reload_active_model()
    assert reload_resp["status"] == "reloaded"
    assert "active_version" in reload_resp

    # Rollback when no candidate version promoted returns baseline
    rollback_resp = rollback_active_model()
    assert rollback_resp["status"] in ("rolled_back", "baseline")
    assert rollback_resp["active_version"] in ("baseline", "V7")

    # Run cycle with unmet gate (< 15 approved feedback) raises HTTPException 400
    with session_module.SessionLocal() as db:
        with pytest.raises(HTTPException) as exc_info:
            run_candidate_cycle(db)
        assert exc_info.value.status_code == 400
        assert "Demonstration gate unmet" in exc_info.value.detail

        # A balanced total is also mandatory; total count alone cannot bypass the gate.
        for i in range(15):
            db.add(ClauseFeedback(
                clause_text=f"Low-only gate clause {i}.",
                predicted_risk_level="medium",
                corrected_risk_level="low",
                consent=True,
                status="approved",
            ))
        db.commit()
        with pytest.raises(HTTPException) as class_gate_error:
            run_candidate_cycle(db)
        assert class_gate_error.value.status_code == 400
        assert "MEDIUM=0" in class_gate_error.value.detail


def test_customer_vs_admin_endpoint_authorization(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app

    test_admin_token = "secure-review-token-12345"
    monkeypatch.setattr(settings, "ADAPTIVE_LEARNING_ADMIN_TOKEN", test_admin_token)
    client = TestClient(app)

    # 1. Customer-accessible endpoints (no token needed)
    dashboard_resp = client.get("/adaptive-learning/dashboard")
    assert dashboard_resp.status_code == 200
    assert "active_version" in dashboard_resp.json()
    assert "gate_met" in dashboard_resp.json()

    # Customer submission requires explicit consent
    no_consent_resp = client.post("/adaptive-learning/feedback", json={
        "clause_text": "Customer submitted clause without consent.",
        "predicted_risk_level": "low",
        "corrected_risk_level": "high",
        "consent": False,
    })
    assert no_consent_resp.status_code == 400

    consented_resp = client.post("/adaptive-learning/feedback", json={
        "clause_text": "Customer submitted clause with explicit consent.",
        "predicted_risk_level": "low",
        "corrected_risk_level": "high",
        "consent": True,
    })
    assert consented_resp.status_code == 201
    feedback_id = consented_resp.json()["id"]

    # 2. Reviewer/Admin endpoints accessed WITHOUT token -> must return 403 Forbidden
    assert client.get("/adaptive-learning/feedback/pending").status_code == 403
    assert client.get("/adaptive-learning/feedback/submissions/pending").status_code == 403
    assert client.post(f"/adaptive-learning/feedback/{feedback_id}/review", json={"decision": "approve"}).status_code == 403
    assert client.post("/adaptive-learning/cycle/run").status_code == 403
    assert client.post("/adaptive-learning/models/reload").status_code == 403
    assert client.post("/adaptive-learning/models/rollback").status_code == 403

    # 3. Reviewer/Admin endpoints accessed with WRONG token -> must return 403 Forbidden
    wrong_headers = {"X-Adaptive-Admin-Token": "invalid-token"}
    assert client.get("/adaptive-learning/feedback/pending", headers=wrong_headers).status_code == 403
    assert client.get("/adaptive-learning/feedback/submissions/pending", headers=wrong_headers).status_code == 403

    # 4. Reviewer/Admin endpoints accessed with VALID token -> succeeds
    valid_headers = {"X-Adaptive-Admin-Token": test_admin_token}
    pending_resp = client.get("/adaptive-learning/feedback/pending", headers=valid_headers)
    assert pending_resp.status_code == 200
    assert any(item["id"] == feedback_id for item in pending_resp.json())

    pending_subs_resp = client.get("/adaptive-learning/feedback/submissions/pending", headers=valid_headers)
    assert pending_subs_resp.status_code == 200


def test_sanitize_error_summary():
    from app.api.routers.adaptive_learning import _sanitize_error_summary

    # Redacts tokens, passwords, keys
    raw = "ValueError: Failed with token=secret_token_123 and password=mypassword"
    sanitized = _sanitize_error_summary(raw)
    assert "secret_token_123" not in sanitized
    assert "mypassword" not in sanitized
    assert "[REDACTED]" in sanitized

    # Redacts database URLs
    raw_db = "OperationalError: unable to open database file at sqlite:///C:/secret/path/lexease.db"
    sanitized_db = _sanitize_error_summary(raw_db)
    assert "sqlite:///" not in sanitized_db
    assert "[DATABASE_URL]" in sanitized_db

    # Extracts exception from multiline traceback and limits length
    tb = """Traceback (most recent call last):
  File "app/main.py", line 42, in some_function
    raise RuntimeError("Worker process out of memory during epoch 1")
RuntimeError: Worker process out of memory during epoch 1
"""
    sanitized_tb = _sanitize_error_summary(tb)
    assert "RuntimeError: Worker process out of memory during epoch 1" in sanitized_tb
    assert len(sanitized_tb) <= 150


def test_candidate_cycle_single_record_on_failure(monkeypatch):
    from unittest.mock import MagicMock
    from app.api.routers.adaptive_learning import run_candidate_cycle
    from app.database.models import AdaptiveModelVersion

    # Simulate worker failure with non-zero exit code
    mock_proc = MagicMock()
    mock_proc.returncode = 1
    mock_proc.stdout = "Worker started...\n"
    mock_proc.stderr = "Traceback (most recent call last):\n  File 'worker.py', line 10\nValueError: Intentional worker test error\n"

    monkeypatch.setattr("app.api.routers.adaptive_learning.subprocess.run", lambda *args, **kwargs: mock_proc)

    # Ensure approved count meets gate for this unit test
    monkeypatch.setattr(
        "app.api.routers.adaptive_learning._approved_feedback_counts",
        lambda db: (18, {"LOW": 6, "MEDIUM": 6, "HIGH": 6}),
    )

    with session_module.SessionLocal() as db:
        initial_count = db.query(AdaptiveModelVersion).count()
        response = run_candidate_cycle(db)

        assert response["status"] == "queued"
        cycle_version = response["version"]

        from ml.adaptive_learning.worker import claim_next_queued_job, execute_claimed_job

        claimed = claim_next_queued_job(session_module.SessionLocal)
        assert claimed is not None
        assert claimed.version == cycle_version
        assert claimed.status == "running"

        def failing_runner(cycle_version: str):
            raise ValueError("Intentional worker test error")

        success = execute_claimed_job(cycle_version, db_factory=session_module.SessionLocal, runner=failing_runner)
        assert success is False

        # Exactly 1 new record created for this cycle
        db.expire_all()
        final_count = db.query(AdaptiveModelVersion).count()
        assert final_count == initial_count + 1

        # The record is marked failed, has sanitized error message, no duplicates
        all_records = db.query(AdaptiveModelVersion).filter_by(version=cycle_version).all()
        assert len(all_records) == 1
        assert all_records[0].status == "failed"
        assert "ValueError: Intentional worker test error" in all_records[0].error_message
        assert len(all_records[0].error_message) <= 150

        # Clean up test record to preserve database state
        db.delete(all_records[0])
        db.commit()


def test_candidate_cycle_single_record_when_worker_already_marked_failed(monkeypatch):
    from app.api.routers.adaptive_learning import run_candidate_cycle
    from app.database.models import AdaptiveModelVersion
    from ml.adaptive_learning.worker import claim_next_queued_job, execute_claimed_job

    monkeypatch.setattr(
        "app.api.routers.adaptive_learning._approved_feedback_counts",
        lambda db: (18, {"LOW": 6, "MEDIUM": 6, "HIGH": 6}),
    )

    with session_module.SessionLocal() as db:
        initial_count = db.query(AdaptiveModelVersion).count()
        response = run_candidate_cycle(db)

        cycle_version = response["version"]
        claimed = claim_next_queued_job(session_module.SessionLocal)
        assert claimed is not None

        def runner_that_fails(cycle_version: str):
            with session_module.SessionLocal() as s:
                rec = s.query(AdaptiveModelVersion).filter_by(version=cycle_version).first()
                if rec:
                    rec.status = "failed"
                    rec.error_message = "ValueError: Data leakage detected between training and validation"
                    s.commit()
            raise RuntimeError("Data leakage error")

        execute_claimed_job(cycle_version, db_factory=session_module.SessionLocal, runner=runner_that_fails)

        db.expire_all()
        # Exactly 1 record created
        assert db.query(AdaptiveModelVersion).count() == initial_count + 1

        records = db.query(AdaptiveModelVersion).filter_by(version=cycle_version).all()
        assert len(records) == 1
        assert records[0].status == "failed"
        assert "Data leakage detected" in records[0].error_message

        db.delete(records[0])
        db.commit()


def test_rollback_when_already_at_baseline(monkeypatch, tmp_path):
    from app.api.routers.adaptive_learning import rollback_active_model

    # Ensure no active_risk_model.json manifest exists
    fake_models_dir = tmp_path / "ml" / "models"
    fake_models_dir.mkdir(parents=True)
    (fake_models_dir / "final_risk_model").mkdir()
    (fake_models_dir / "final_risk_model" / "metadata.json").write_text(
        '{"model_version": "V7"}', encoding="utf-8"
    )

    monkeypatch.setattr("app.api.routers.adaptive_learning._get_project_root", lambda: tmp_path)

    result = rollback_active_model()
    assert result["status"] == "baseline"
    assert result["active_version"] == "V7"
    assert "already at the baseline version" in result["message"]


def test_rollback_success_with_model_reload(monkeypatch, tmp_path):
    from app.api.routers.adaptive_learning import rollback_active_model
    from app.database.models import AdaptiveModelVersion
    from app.services.clause_analysis import ClauseAnalysisService

    fake_models_dir = tmp_path / "ml" / "models"
    fake_models_dir.mkdir(parents=True)
    manifest = fake_models_dir / "active_risk_model.json"
    manifest.write_text('{"version": "adaptive-v2", "model_path": "models/adaptive/adaptive-v2"}', encoding="utf-8")

    (fake_models_dir / "final_risk_model").mkdir()
    (fake_models_dir / "final_risk_model" / "metadata.json").write_text(
        '{"model_version": "V7"}', encoding="utf-8"
    )

    monkeypatch.setattr("app.api.routers.adaptive_learning._get_project_root", lambda: tmp_path)
    monkeypatch.setattr("ml.adaptive_learning.train_candidate.ROOT", tmp_path)

    # Mock ml_rollback to return V7 and ClauseAnalysisService.reload_models
    reloaded = []
    monkeypatch.setattr(ClauseAnalysisService, "reload_models", lambda: reloaded.append(True))
    monkeypatch.setattr(ClauseAnalysisService, "get_active_loaded_version", lambda: "V7")
    monkeypatch.setattr("ml.adaptive_learning.train_candidate.rollback_active_model", lambda: "V7")

    result = rollback_active_model()
    assert result["status"] == "rolled_back"
    assert result["active_version"] == "V7"
    assert result["loaded_version"] == "V7"
    assert len(reloaded) == 1
    assert "successfully rolled back" in result["message"]


def test_rollback_safe_error_handling(monkeypatch, tmp_path):
    import pytest
    from fastapi import HTTPException
    from app.api.routers.adaptive_learning import rollback_active_model

    fake_models_dir = tmp_path / "ml" / "models"
    fake_models_dir.mkdir(parents=True)
    manifest = fake_models_dir / "active_risk_model.json"
    manifest.write_text('{"version": "candidate-xyz"}', encoding="utf-8")

    monkeypatch.setattr("app.api.routers.adaptive_learning._get_project_root", lambda: tmp_path)

    def crashing_rollback():
        raise PermissionError("Access denied at sqlite:///C:/secret/path with token=secret123")

    monkeypatch.setattr("ml.adaptive_learning.train_candidate.rollback_active_model", crashing_rollback)

    with pytest.raises(HTTPException) as exc_info:
        rollback_active_model()

    assert exc_info.value.status_code == 500
    # Error message must be sanitized and not contain secrets or DB paths
    detail = str(exc_info.value.detail)
    assert "secret123" not in detail
    assert "sqlite:///" not in detail
    assert "Rollback failed on server" in detail


def test_queue_creation_endpoint(monkeypatch):
    from app.api.routers.adaptive_learning import run_candidate_cycle
    from app.database.models import AdaptiveModelVersion

    monkeypatch.setattr(
        "app.api.routers.adaptive_learning._approved_feedback_counts",
        lambda db: (18, {"LOW": 6, "MEDIUM": 6, "HIGH": 6}),
    )

    with session_module.SessionLocal() as db:
        res = run_candidate_cycle(db)
        assert res["status"] == "queued"
        assert "version" in res
        version = res["version"]

        # Verify exactly one record in the database with status="queued"
        rec = db.query(AdaptiveModelVersion).filter_by(version=version).first()
        assert rec is not None
        assert rec.status == "queued"
        assert rec.approved_feedback_count >= 18

        # Clean up test row
        db.delete(rec)
        db.commit()


def test_duplicate_concurrent_cycle_prevention():
    import pytest
    from fastapi import HTTPException
    from app.api.routers.adaptive_learning import run_candidate_cycle
    from app.database.models import AdaptiveModelVersion
    from datetime import datetime, timezone

    with session_module.SessionLocal() as db:
        active_job = AdaptiveModelVersion(
            version="adaptive-active-concurrency-test",
            status="running",
            approved_feedback_count=18,
            created_at=datetime.now(timezone.utc),
        )
        db.add(active_job)
        db.commit()

        # Attempt to run another candidate cycle while one is running -> must raise 409
        with pytest.raises(HTTPException) as exc_info:
            run_candidate_cycle(db)

        assert exc_info.value.status_code == 409
        assert "already in progress or queued" in str(exc_info.value.detail).lower()

        db.delete(active_job)
        db.commit()


def test_fastapi_restart_preserves_live_running_job_and_queued_jobs():
    import asyncio
    import json
    from app.main import lifespan, app
    from app.database.models import AdaptiveModelVersion
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    active_lease = json.dumps({
        "lease": {
            "worker_id": "worker-live-1",
            "heartbeat_at": now.isoformat(),
            "lease_expires_at": (now + timedelta(seconds=60)).isoformat(),
        }
    })

    with session_module.SessionLocal() as db:
        running_job = AdaptiveModelVersion(
            version="adaptive-live-running-test",
            status="running",
            acceptance_json=active_lease,
            approved_feedback_count=18,
            created_at=now,
        )
        queued_job = AdaptiveModelVersion(
            version="adaptive-restart-queued-test",
            status="queued",
            approved_feedback_count=18,
            created_at=now,
        )
        db.add_all([running_job, queued_job])
        db.commit()

    # Simulate FastAPI startup / restart
    async def run_restart():
        async with lifespan(app):
            pass

    asyncio.run(run_restart())

    # Verify both running job and queued job are completely intact
    with session_module.SessionLocal() as db:
        r_rec = db.query(AdaptiveModelVersion).filter_by(version="adaptive-live-running-test").first()
        q_rec = db.query(AdaptiveModelVersion).filter_by(version="adaptive-restart-queued-test").first()

        assert r_rec.status == "running"
        assert r_rec.error_message is None
        assert r_rec.completed_at is None

        assert q_rec.status == "queued"
        assert q_rec.error_message is None

        db.delete(r_rec)
        db.delete(q_rec)
        db.commit()


def test_live_worker_job_not_marked_failed_by_new_worker():
    import json
    from ml.adaptive_learning.worker import cleanup_orphaned_running_jobs
    from app.database.models import AdaptiveModelVersion
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    active_lease = json.dumps({
        "lease": {
            "worker_id": "worker-active-99",
            "heartbeat_at": now.isoformat(),
            "lease_expires_at": (now + timedelta(seconds=60)).isoformat(),
        }
    })

    with session_module.SessionLocal() as db:
        live_job = AdaptiveModelVersion(
            version="adaptive-live-worker-job",
            status="running",
            acceptance_json=active_lease,
            approved_feedback_count=18,
            created_at=now,
        )
        db.add(live_job)
        db.commit()

    # A newly started worker invokes startup cleanup
    cleaned = cleanup_orphaned_running_jobs(session_module.SessionLocal)
    assert cleaned == 0  # Must NOT clean up live worker's job!

    with session_module.SessionLocal() as db:
        rec = db.query(AdaptiveModelVersion).filter_by(version="adaptive-live-worker-job").first()
        assert rec.status == "running"
        assert rec.error_message is None
        assert rec.completed_at is None

        db.delete(rec)
        db.commit()


def test_genuinely_orphaned_worker_job_safely_recovered():
    import json
    from ml.adaptive_learning.worker import cleanup_orphaned_running_jobs
    from app.database.models import AdaptiveModelVersion
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    expired_lease = json.dumps({
        "lease": {
            "worker_id": "worker-dead-99",
            "heartbeat_at": (now - timedelta(seconds=120)).isoformat(),
            "lease_expires_at": (now - timedelta(seconds=60)).isoformat(),  # expired 60s ago
        }
    })

    with session_module.SessionLocal() as db:
        dead_job = AdaptiveModelVersion(
            version="adaptive-dead-orphaned-job",
            status="running",
            acceptance_json=expired_lease,
            approved_feedback_count=18,
            created_at=now - timedelta(seconds=120),
        )
        db.add(dead_job)
        db.commit()

    # Worker recovery on startup detects expired lease on orphaned job
    cleaned = cleanup_orphaned_running_jobs(session_module.SessionLocal)
    assert cleaned >= 1

    with session_module.SessionLocal() as db:
        rec = db.query(AdaptiveModelVersion).filter_by(version="adaptive-dead-orphaned-job").first()
        assert rec.status == "failed"
        assert "lease expired" in rec.error_message.lower()
        assert rec.completed_at is not None

        db.delete(rec)
        db.commit()


def test_one_history_record_per_cycle():
    from ml.adaptive_learning.worker import claim_next_queued_job, execute_claimed_job
    from app.database.models import AdaptiveModelVersion
    from datetime import datetime, timezone

    cycle_version = "adaptive-single-record-lifecycle-test"

    # 1. Queue job
    with session_module.SessionLocal() as db:
        q = AdaptiveModelVersion(
            version=cycle_version,
            status="queued",
            approved_feedback_count=18,
            created_at=datetime.now(timezone.utc),
        )
        db.add(q)
        db.commit()

    # 2. Worker claims job -> status becomes running
    claimed = claim_next_queued_job(session_module.SessionLocal)
    assert claimed.version == cycle_version
    assert claimed.status == "running"

    # 3. Worker executes job with mock runner
    def mock_runner(cycle_version: str):
        with session_module.SessionLocal() as db:
            rec = db.query(AdaptiveModelVersion).filter_by(version=cycle_version).first()
            rec.status = "promoted"
            rec.completed_at = datetime.now(timezone.utc)
            db.commit()

    success = execute_claimed_job(cycle_version, db_factory=session_module.SessionLocal, runner=mock_runner)
    assert success is True

    # 4. Verify exactly ONE history record exists with final status promoted
    with session_module.SessionLocal() as db:
        records = db.query(AdaptiveModelVersion).filter_by(version=cycle_version).all()
        assert len(records) == 1
        assert records[0].status == "promoted"
        assert records[0].completed_at is not None

        # Clean up
        db.delete(records[0])
        db.commit()


# ---------------------------------------------------------------------------
# Strict Promotion & Acceptance Logic Tests
# ---------------------------------------------------------------------------

def test_accept_promotes_on_meaningful_primary_improvement():
    from ml.adaptive_learning.train_candidate import _accept

    criteria = {
        "min_improvement": 0.005,
        "max_regression_tolerance": 0.0,
        "maximum_high_risk_recall_drop": 0.0,
        "safety_floor_high_risk_recall": 0.80,
    }
    baseline = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8500}
    # Candidate improves accuracy by +0.0100 (exceeds 0.005 threshold) without regression
    candidate = {"accuracy": 0.8600, "macro_f1": 0.8200, "high_risk_recall": 0.8500}

    result = _accept(candidate, baseline, criteria, parent_version="V7")
    assert result["passed"] is True
    assert result["primary_improvement"] is True
    assert result["checks"]["accuracy_improvement"] is True
    assert result["deltas"]["accuracy"] == pytest.approx(0.0100)
    assert len(result["reasons"]) > 0
    assert "Candidate passed" in result["reasons"][0]


def test_accept_rejects_exact_ties():
    from ml.adaptive_learning.train_candidate import _accept

    criteria = {
        "min_improvement": 0.005,
        "max_regression_tolerance": 0.0,
        "maximum_high_risk_recall_drop": 0.0,
        "safety_floor_high_risk_recall": 0.80,
    }
    baseline = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8500}
    # Exact tie on primary metrics
    candidate = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8500}

    result = _accept(candidate, baseline, criteria, parent_version="V7")
    assert result["passed"] is False
    assert result["primary_improvement"] is False
    assert result["checks"]["has_primary_improvement"] is False
    assert any("tied parent" in r.lower() for r in result["reasons"])


def test_accept_rejects_rounding_only_differences():
    from ml.adaptive_learning.train_candidate import _accept

    criteria = {
        "min_improvement": 0.005,
        "max_regression_tolerance": 0.0,
        "maximum_high_risk_recall_drop": 0.0,
        "safety_floor_high_risk_recall": 0.80,
    }
    baseline = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8500}
    # Tiny delta of +0.0001 (below configured 0.005 threshold)
    candidate = {"accuracy": 0.8501, "macro_f1": 0.8200, "high_risk_recall": 0.8500}

    result = _accept(candidate, baseline, criteria, parent_version="V7")
    assert result["passed"] is False
    assert result["primary_improvement"] is False
    assert any("did not achieve required minimum primary improvement" in r for r in result["reasons"])


def test_accept_rejects_when_only_safety_floor_passed_without_improvement():
    from ml.adaptive_learning.train_candidate import _accept

    criteria = {
        "min_improvement": 0.005,
        "max_regression_tolerance": 0.0,
        "maximum_high_risk_recall_drop": 0.0,
        "safety_floor_high_risk_recall": 0.80,
    }
    baseline = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8000}
    # High-risk recall meets safety floor (0.8200 >= 0.80) but neither primary metric improved
    candidate = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8200}

    result = _accept(candidate, baseline, criteria, parent_version="V7")
    assert result["passed"] is False
    assert result["primary_improvement"] is False


def test_accept_rejects_when_protected_metric_regresses():
    from ml.adaptive_learning.train_candidate import _accept

    criteria = {
        "min_improvement": 0.005,
        "max_regression_tolerance": 0.0,
        "maximum_high_risk_recall_drop": 0.0,
        "safety_floor_high_risk_recall": 0.80,
    }
    baseline = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8500}
    # Accuracy improved +0.02, but macro F1 regressed by -0.01
    candidate = {"accuracy": 0.8700, "macro_f1": 0.8100, "high_risk_recall": 0.8500}

    result = _accept(candidate, baseline, criteria, parent_version="V7")
    assert result["passed"] is False
    assert result["checks"]["macro_f1_non_regression"] is False
    assert any("regressed" in r.lower() for r in result["reasons"])


def test_accept_rejects_when_recall_drops_below_floor_or_regresses():
    from ml.adaptive_learning.train_candidate import _accept

    criteria = {
        "min_improvement": 0.005,
        "max_regression_tolerance": 0.0,
        "maximum_high_risk_recall_drop": 0.0,
        "safety_floor_high_risk_recall": 0.80,
    }
    baseline = {"accuracy": 0.8500, "macro_f1": 0.8200, "high_risk_recall": 0.8500}

    # Case 1: Drops below safety floor
    candidate_below_floor = {"accuracy": 0.8700, "macro_f1": 0.8400, "high_risk_recall": 0.7800}
    res1 = _accept(candidate_below_floor, baseline, criteria, parent_version="V7")
    assert res1["passed"] is False
    assert res1["checks"]["minimum_high_risk_recall"] is False

    # Case 2: Above safety floor but regresses from parent (0.8500 -> 0.8200)
    candidate_regressed = {"accuracy": 0.8700, "macro_f1": 0.8400, "high_risk_recall": 0.8200}
    res2 = _accept(candidate_regressed, baseline, criteria, parent_version="V7")
    assert res2["passed"] is False
    assert res2["checks"]["high_risk_recall_non_regression"] is False


# ---------------------------------------------------------------------------
# Immutable Version ID & Reviewer Display Label Tests
# ---------------------------------------------------------------------------

def test_model_version_id_is_immutable_and_display_label_can_be_updated(monkeypatch):
    from app.api.routers.adaptive_learning import update_model_display_label
    from app.database.models import AdaptiveModelVersion
    from app.schemas.adaptive_learning import ModelDisplayLabelUpdate
    from datetime import datetime, timezone

    cycle_version = "adaptive-20261014-label-test"
    with session_module.SessionLocal() as db:
        rec = AdaptiveModelVersion(
            version=cycle_version,
            status="baseline",
            created_at=datetime.now(timezone.utc),
        )
        db.add(rec)
        db.commit()

    with session_module.SessionLocal() as db:
        res = update_model_display_label(
            version=cycle_version,
            request=ModelDisplayLabelUpdate(display_label="Production Release 1.0"),
            db=db,
        )
        assert res["status"] == "updated"
        assert res["version"] == cycle_version  # System ID unchanged
        assert res["display_label"] == "Production Release 1.0"

    with session_module.SessionLocal() as db:
        reloaded = db.query(AdaptiveModelVersion).filter_by(version=cycle_version).first()
        assert reloaded.version == cycle_version
        assert reloaded.display_label == "Production Release 1.0"

        # Cleanup
        db.delete(reloaded)
        db.commit()


# ---------------------------------------------------------------------------
# Model Artifact Manager Tests
# ---------------------------------------------------------------------------

def test_artifact_manager_detects_git_lfs_pointer_stub():
    from ml.models.artifact_manager import is_valid_weights_file, verify_checkpoint_artifacts

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        stub_file = tmp_path / "pytorch_model.bin"
        stub_file.write_bytes(
            b"version https://git-lfs.github.com/spec/v1\n"
            b"oid sha256:4d7083fbb22b10086884394017b2b64d36ef55fa879579d469ecaa30456c6ffc\n"
            b"size 440000000\n"
        )
        # Should be rejected as an unpulled Git LFS pointer
        assert is_valid_weights_file(stub_file) is False

        is_valid, missing = verify_checkpoint_artifacts(tmp_path)
        assert is_valid is False
        assert any("Git LFS pointer" in item for item in missing)


def test_artifact_manager_sanitizes_errors():
    from ml.models.artifact_manager import _sanitize_error_text

    raw_msg = "Error downloading from repo: token=hf_secretToken123456789 and password: mySuperSecretPassword"
    sanitized = _sanitize_error_text(raw_msg)
    assert "hf_secretToken123456789" not in sanitized
    assert "mySuperSecretPassword" not in sanitized
    assert "[REDACTED]" in sanitized


def test_artifact_manager_validates_complete_checkpoint():
    from ml.models.artifact_manager import verify_checkpoint_artifacts

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        # Create valid binary (>1MB, non-LFS)
        weights = tmp_path / "pytorch_model.bin"
        weights.write_bytes(b"\x00" * 1_100_000)

        (tmp_path / "metadata.json").write_text('{"model_version": "test"}', encoding="utf-8")
        (tmp_path / "tokenizer_config.json").write_text('{}', encoding="utf-8")
        (tmp_path / "vocab.txt").write_text('token\n', encoding="utf-8")

        is_valid, missing = verify_checkpoint_artifacts(tmp_path)
        assert is_valid is True
        assert len(missing) == 0


def test_require_ml_reports_specific_import_error(monkeypatch):
    """Ensure _require_ml does not hide import failures behind a vague generic message."""
    import ml.adaptive_learning.train_candidate as tc

    monkeypatch.setattr(tc, "_ml_import_error", "ModuleNotFoundError: No module named 'fake_package'")
    with pytest.raises(RuntimeError) as exc_info:
        tc._require_ml()

    err_text = str(exc_info.value)
    assert "ModuleNotFoundError: No module named 'fake_package'" in err_text
    assert "ml/requirements.txt" in err_text


def test_ml_dependencies_available_in_worker_environment():
    """Verify that ML dependencies (torch, transformers, pandas, numpy) are present and bridge works."""
    import ml.adaptive_learning.train_candidate as tc
    if tc._ml_import_error:
        pytest.skip(f"ML worker dependencies not installed in current test environment: {tc._ml_import_error}")
    tc._require_ml()
    assert tc.torch is not None
    assert tc.np is not None
    assert tc.pd is not None
    assert tc.AutoTokenizer is not None


def test_reviewed_feedback_workflow_with_explanation_and_no_training(monkeypatch):
    """
    Verify the reviewed feedback workflow:
    1. User flags a clause with explanation.
    2. Pending queue displays the user's explanation in review_note.
    3. Reviewer approves the feedback, preserving user explanation and updating status.
    4. Approved record is persisted, but does NOT modify active model or start training.
    """
    from app.services.clause_analysis import ClauseAnalysisService

    initial_version = ClauseAnalysisService.get_active_loaded_version()

    with session_module.SessionLocal() as db:
        # 1. User submits feedback with explanation
        resp = submit_feedback(ClauseFeedbackCreate(
            clause_text="The customer shall indemnify the vendor for all losses exceeding contract value.",
            predicted_risk_level="low",
            corrected_risk_level="high",
            consent=True,
            explanation="Uncapped indemnity clause poses significant liability risk.",
        ), db)
        assert resp.status == "pending"
        item_id = resp.id

        # 2. Reviewer queue inspection
        pending_items = list_pending_feedback(db)
        target = next(item for item in pending_items if item.id == item_id)
        assert "Uncapped indemnity clause" in target.review_note
        assert target.predicted_risk_level == "low"
        assert target.corrected_risk_level == "high"

        # 3. Reviewer approves feedback with reviewer comment
        reviewed = review_feedback(
            item_id,
            ClauseFeedbackReview(decision="approve", review_note="Verified high risk indemnity clause."),
            db,
        )
        assert reviewed.status == "approved"
        assert "Uncapped indemnity clause" in reviewed.review_note
        assert "Verified high risk indemnity clause" in reviewed.review_note

    # 4. Verify persistence in DB and that active model version is unaffected
    with session_module.SessionLocal() as db:
        record = db.query(ClauseFeedback).filter_by(id=item_id).one()
        assert record.status == "approved"
        assert record.reviewed_at is not None
        assert "Uncapped indemnity clause" in record.review_note

    assert ClauseAnalysisService.get_active_loaded_version() == initial_version
