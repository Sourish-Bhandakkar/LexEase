# LexEase Adaptive Learning & Model Governance

## 1. Overview & Architecture

The LexEase Adaptive Learning pipeline provides human-in-the-loop continuous improvement for the clause risk classification model (`Legal-BERT` backbone with regression head).

The pipeline enforces strict separation between user interactions, human review, candidate training, evaluation, and live model serving.

```
+----------------------------------------------------------------------------------------------------+
|                                    1. User Feedback Ingestion                                      |
|  User flags risk prediction  -->  PII Redaction (regex)  -->  source_group_id  -->  Pending Queue  |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                      2. Human Review Gate                                          |
|  Admin reviews pending queue  -->  Explicit Approve / Correct  -->  Approved Clause Database       |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                  3. Eligibility & Demonstration Gate                               |
|  Count >= 15 total  AND  >= 5 per class (LOW, MEDIUM, HIGH)  [Demonstration setting]               |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                4. Leakage Checks & Candidate Training                              |
|  - Leakage checks: exact text, normalized text, source_group_id against validation set             |
|  - Freeze Legal-BERT backbone, fine-tune regression head on approved clauses                       |
|  - Evaluate candidate vs active baseline on held-out validation set                                |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                     5. Conservative Acceptance                                     |
|  - Accuracy non-regression (delta >= 0.0)                                                          |
|  - Macro F1 non-regression (delta >= 0.0)                                                           |
|  - High-risk recall non-regression (drop <= 0.0)                                                    |
|  - High-risk recall floor >= 0.80                                                                  |
|  --> If PASSED: promote candidate (update active_risk_model.json)                                  |
|  --> If FAILED: retain active baseline, record failure metrics                                    |
+----------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                 6. Live Service Reload & Rollback                                  |
|  - Process cache check: LegalRiskEngine checks manifest mtime on inference                         |
|  - Manual / API reload: POST /api/adaptive-learning/models/reload                                  |
|  - Rollback: POST /api/adaptive-learning/models/rollback restores parent or baseline               |
+----------------------------------------------------------------------------------------------------+
```

---

## 2. Core Safeguards

### Consent and PII Masking
- Raw user text submitted through feedback endpoints (`POST /api/adaptive-learning/feedback` or `POST /api/adaptive-learning/feedback/batch`) requires explicit consent (`consent: true`).
- PII sanitization automatically strips emails, phone numbers, and identifying strings before records are written to SQLite/PostgreSQL.

### Human Review Guarantee
- Raw user uploads, user suggestions, and unreviewed model predictions **never** enter the training set.
- All training clauses must be explicitly approved or annotated by an authorized reviewer via the token-protected review endpoints (`POST /api/adaptive-learning/feedback/{id}/review` or `POST /api/adaptive-learning/feedback/submissions/{id}/review`).

### Document & Source Group Tracking
- To avoid leaking related clauses from the same contract into both training and validation splits, every feedback submission is assigned a non-identifying `source_group_id` (e.g. `submission_{uuid}`).
- Whole contracts are never stored or exposed for group tracking.

### Multi-level Data Leakage Checks
Before training or evaluation:
1. **Exact Text Overlap**: Matches exact string content between training feedback and validation/test sets.
2. **Normalized Text Overlap**: Matches normalized strings (lowercased, punctuation removed, whitespace collapsed).
3. **Source Group Overlap**: Matches `source_group_id` in training clauses against `document_name` or `source_group_id` in validation data.
If any overlap is detected, training halts immediately with a descriptive `ValueError`.

### Conservative Acceptance Gate
Candidates are evaluated against the held-out validation set (`ml/data/real_world_validation/validation_clauses.csv`) and must satisfy:
1. `accuracy >= baseline_accuracy`
2. `macro_f1 >= baseline_macro_f1`
3. `high_risk_recall >= baseline_high_risk_recall`
4. `high_risk_recall >= 0.80` (conservative safety floor to protect against false negatives on high-risk legal clauses).

A candidate failing any of these criteria is marked `rejected` and is never promoted.

---

## 3. Demonstration Gate vs. Production Settings

> [!WARNING]
> **Demonstration Setting Notice**:
> The eligibility threshold of **15 approved clauses (>= 5 each of LOW, MEDIUM, and HIGH)** is a demonstration gate designed to allow developers and operators to test the end-to-end retraining, promotion, reload, and rollback workflows without waiting for massive datasets.
>
> Meeting this 15-sample gate is **not** statistical proof that a candidate will improve general model accuracy or generalize to arbitrary legal agreements. For production environments, the minimum recommended dataset is 200–500 approved clauses per category across diverse agreement types.

---

## 4. Live Promotion, Process Caching, & Hosting Prerequisites

### Process Caching
FastAPI services typically run as long-lived Uvicorn workers. The `LegalRiskEngine` maintains an in-memory PyTorch model singleton.
- **Dynamic Check**: `LegalRiskEngine.reload_if_updated()` checks the file modification timestamp (`mtime`) of `ml/models/active_risk_model.json` on inference requests.
- **Explicit Reload**: The operator can trigger `POST /api/adaptive-learning/models/reload` or use the "Reload Live Model" button on the UI dashboard to immediately refresh the model without restarting the server.
- **Rollback**: If a promoted candidate degrades real-world performance, `POST /api/adaptive-learning/models/rollback` unlinks or points the manifest back to `parent_version` or baseline.

### Hosting Prerequisites & Persistent Storage
- **Ephemeral Containers (Docker, Kubernetes, Render, Fly.io)**: Checkpoints in `ml/models/adaptive/` and `ml/models/active_risk_model.json` are written to the local filesystem. In containerized environments, `ml/models` **must be mounted on a persistent volume**. Without persistent volume storage, any promoted checkpoints will be lost when a container restarts or deploys a new replica.
- **Multi-Worker Synchronization**: On multi-worker setups, each worker process detects `mtime` updates on the shared persistent volume or responds to reload signals.

---

## 5. Operator Runbook

### Prerequisites
Ensure the admin token is set in your environment:
```powershell
$env:ADAPTIVE_LEARNING_ADMIN_TOKEN="lexease-admin-secret-2026"
```

### Method A: Running via UI Dashboard
1. Open the LexEase Web UI and navigate to the **Adaptive Learning** page.
2. Enter the Admin Review Token in the review prompt to authenticate.
3. Review pending feedback items: click **Approve** or **Reject** on individual clauses, or annotate batch submissions.
4. Observe the **Demonstration Eligibility Gate** card:
   - Check the total approved count and class distribution (`LOW`, `MEDIUM`, `HIGH`).
   - If the gate requirement is met, click **Run Candidate Cycle**.
5. Once candidate evaluation completes, if a new model version is promoted and the dashboard indicates "Reload Recommended", click **Reload Live Model**.
6. To undo a promotion, click **Rollback Active Model**.

### Method B: Running via CLI
1. **Evaluate Baseline**:
   ```bash
   python -m ml.adaptive_learning.train_candidate --evaluate-baseline
   ```
2. **Run Training Cycle**:
   ```bash
   python -m ml.adaptive_learning.train_candidate
   ```
3. **Run Final Test Set Check (Optional)**:
   ```bash
   python -m ml.adaptive_learning.train_candidate --run-final-test
   ```
4. **Rollback to Previous Version**:
   ```bash
   python -m ml.adaptive_learning.train_candidate --rollback
   ```
