# LexEase Machine Learning & Risk Analysis Module

This directory contains the isolated, multi-task transformer-based legal text classification and risk reasoning system for LexEase.

## Purpose

The purpose of this module is to classify legal clauses into their respective types and dataset-annotated risk levels, and to reason about those classifications using an independent legal rule engine layer.

## Dataset and Statistics

The system is designed for the **Legal Indian Contract Clauses Dataset** consisting of:
- **Total size**: 9,447 rows
- **Labels**: 
  - `clause_type`: 41 unique classes
  - `risk_level`: 3 risk levels (`low`, `medium`, `high`)
- **Missing values**: None

### Dataset Splits (Stratified by `risk_level` with seed 42)
- **Train split**: 7,557 rows
- **Validation split**: 945 rows
- **Test split**: 945 rows

*Note: The original dataset splits are not distributed in this repository. They should be copied into `ml/data/splits/` as `train.csv`, `validation.csv`, and `test.csv` before running the training pipeline.*

## Architecture

The system uses a **Multi-Task Transformer** architecture. A shared pretrained transformer encoder (e.g. `bert-base-uncased` or `nlpaueb/legal-bert-base-uncased`) extracts representations from the raw `clause_text` input, which then feed two independent linear classification heads:

```
                 Transformer Encoder
                        │
              ┌─────────┴─────────┐
              ↓                   ↓
      Clause Type Head       Risk Level Head
        (41 classes)          (3 classes)
```

The combined model is trained by minimizing the sum of Cross Entropy losses from both heads:

$$\text{total\_loss} = w_1 \cdot \text{clause\_type\_loss} + w_2 \cdot \text{risk\_level\_loss}$$

Loss weights ($w_1, w_2$) are configurable in `ml/config/config.yaml`.

## Training Procedure

The training script [train.py](file:///c:/Users/Sourish%20Bhandakkar/OneDrive/Desktop/Final%20yr%20Project/ml/training/train.py):
1. Loads the splits from `ml/data/splits/`.
2. Encodes the text using the configured tokenizer.
3. Performs stratified training over the specified epochs.
4. Evaluates on validation data after each epoch.
5. Saves the best model weights, tokenizer configs, and label mappings to `ml/models/best_model`.

## Evaluation

The evaluation script [evaluate.py](file:///c:/Users/Sourish%20Bhandakkar/OneDrive/Desktop/Final%20yr%20Project/ml/evaluation/evaluate.py):
1. Evaluates the best model on test data (`test.csv`).
2. Computes and reports:
   - Clause type accuracy, macro F1, and weighted F1.
   - Risk level accuracy, macro F1, and weighted F1.
   - Confusion matrix for risk levels.
   - Classification reports.

## Reviewed Adaptive Learning

Adaptive learning is opt-in and cycle-based. Corrections enter the backend database as pending, consented clause-only records. A reviewer must approve them before export. To run a cycle from the repository root, use:

```powershell
python -m ml.adaptive_learning.train_candidate
```

Measure the active model before collecting feedback with `python -m ml.adaptive_learning.train_candidate --evaluate-baseline`. It records the model's actual metrics on the fixed held-out set without training or promotion.

The job exports approved labels under the ignored `ml/data/adaptive/` directory, checks that the approved clauses do not overlap `ml/data/real_world_validation/validation_clauses.csv`, evaluates the existing checkpoint and candidate on that same fixed set, and promotes only when all configured thresholds in `ml/config/adaptive_learning.yaml` pass. The dashboard reads measured run records from the database and shows no score until a run has measured it.

The model checkpoints are stored with Git LFS. Restore them before running the job; without the local weight files, the cycle records a failure and does not promote anything. Training never runs automatically during upload or clause analysis.

## Inference Usage

The prediction helper [predict.py](file:///c:/Users/Sourish%20Bhandakkar/OneDrive/Desktop/Final%20yr%20Project/ml/inference/predict.py) exposes the `predict_clause(text)` function, returning:

```json
{
  "clause_text": "...",
  "predicted_clause_type": "...",
  "predicted_risk_level": "...",
  "confidence": 0.85,
  "clause_type_confidence": 0.90,
  "risk_level_confidence": 0.94
}
```

## Risk Engine & Separation of Concerns

We maintain a strict separation of concerns between statistical prediction and rule-based legal reasoning:
1. **Machine Learning Model**: Predicts the statistical correlation between clause text and metadata labels (`clause_type` and `risk_level`) based on the dataset annotations. The ML model is **NOT** a legal decision-maker and does not decide statutory enforceability.
2. **Legal Risk Engine**: A separate deterministic rule layer located in [engine.py](file:///c:/Users/Sourish%20Bhandakkar/OneDrive/Desktop/Final%20yr%20Project/ml/risk_engine/engine.py). It takes the clause text and ML predictions and matches them against legal heuristics, assessing:
   - **Risk Signals**: Specific patterns that present liability (e.g. unilateral no-notice termination).
   - **Protective Signals**: Standard mitigations (e.g. notice periods, liability caps).
   - **Required Surrounding Context**: Dependent clauses that need to be cross-referenced.
   - **External Legal Information**: Statutes under Indian Law (e.g., Section 27 of the Indian Contract Act, 1872 for post-employment non-compete clauses, or state Rent Control Acts).
   - **Uncertainty/Escalation**: Flags cases with low model confidence or high-risk mismatch for human review.

If a rule is not grounded by the current project's uploaded source documents, it is explicitly annotated with `"Not established by uploaded sources"`.

## Limitations & Disclaimer

> [!WARNING]
> This machine learning model is an academic/technical helper for automated categorization. It **does NOT render legal advice** and is **NOT a legal decision-maker**. Statutorily, only qualified legal practitioners can evaluate contract enforceability. Users should consult professional legal counsel before entering any binding agreements.
