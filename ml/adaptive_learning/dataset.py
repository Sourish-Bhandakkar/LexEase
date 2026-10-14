"""Export only explicitly approved, clause-level labels for the training job."""

from pathlib import Path
import csv
import sys

from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.database.models import ClauseFeedback


def export_approved_feedback(db: Session, destination: Path) -> list[dict[str, str]]:
    records = (
        db.query(ClauseFeedback)
        .filter_by(status="approved", consent=True)
        .order_by(ClauseFeedback.created_at.asc())
        .all()
    )
    rows = [
        {
            "clause_text": row.clause_text,
            "risk_level": row.corrected_risk_level.upper(),
            "source_group_id": getattr(row, "source_group_id", None) or f"single_{row.id}",
        }
        for row in records
    ]
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=["clause_text", "risk_level", "source_group_id"])
        writer.writeheader()
        writer.writerows(rows)
    return rows


try:
    import torch
    from torch.utils.data import Dataset
    _TORCH_AVAILABLE = True
except ImportError:
    torch = None
    Dataset = object
    _TORCH_AVAILABLE = False


class RiskRegressionDataset(Dataset):
    def __init__(self, texts, risk_targets, sample_weights, tokenizer, max_len):
        if not _TORCH_AVAILABLE:
            raise ImportError("PyTorch is required to use RiskRegressionDataset.")
        self.texts = texts
        self.risk_targets = risk_targets
        self.sample_weights = sample_weights
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self):
        return len(self.texts)

    def __getitem__(self, idx):
        text = str(self.texts[idx])
        target = self.risk_targets[idx]
        weight = self.sample_weights[idx]

        encoding = self.tokenizer(
            text,
            add_special_tokens=True,
            max_length=self.max_len,
            padding="max_length",
            truncation=True,
            return_attention_mask=True,
            return_tensors="pt",
        )

        return {
            "input_ids": encoding["input_ids"].flatten(),
            "attention_mask": encoding["attention_mask"].flatten(),
            "risk_target": torch.tensor(target, dtype=torch.float),
            "sample_weight": torch.tensor(weight, dtype=torch.float),
        }
