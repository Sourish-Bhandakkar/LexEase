from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class RiskLabel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ClauseFeedbackCreate(BaseModel):
    clause_text: str = Field(min_length=1, max_length=8000)
    predicted_risk_level: RiskLabel
    corrected_risk_level: RiskLabel
    consent: bool
    explanation: str | None = Field(default=None, max_length=1000)
    source_group_id: str | None = Field(default=None, max_length=100)


class ClauseFeedbackCreated(BaseModel):
    id: str
    status: str


class ClauseFeedbackReview(BaseModel):
    decision: str = Field(pattern="^(approve|reject)$")
    review_note: str | None = Field(default=None, max_length=500)


class ClauseFeedbackItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    clause_text: str
    predicted_risk_level: str
    corrected_risk_level: str
    status: str
    review_note: str | None
    source_group_id: str
    created_at: datetime


class FeedbackSubmissionClause(BaseModel):
    clause_id: str = Field(min_length=1, max_length=100)
    clause_number: str | None = Field(default=None, max_length=50)
    clause_text: str = Field(min_length=1, max_length=6000)
    predicted_risk_level: RiskLabel
    confidence: float | None = Field(default=None, ge=0, le=1)


class ClauseFeedbackSubmissionCreate(BaseModel):
    clauses: list[FeedbackSubmissionClause] = Field(min_length=1, max_length=200)
    consent: bool

    @model_validator(mode="after")
    def validate_submission(self):
        ids = [clause.clause_id for clause in self.clauses]
        if len(ids) != len(set(ids)):
            raise ValueError("Clause IDs must be unique within a submission.")
        if sum(len(clause.clause_text) for clause in self.clauses) > 50000:
            raise ValueError("A submission may contain at most 50,000 characters of clause text.")
        return self


class ClauseFeedbackSubmissionCreated(BaseModel):
    id: str
    status: str
    clause_count: int


class PendingClauseFeedbackSubmission(BaseModel):
    id: str
    status: str
    consent: bool
    created_at: datetime
    clauses: list[FeedbackSubmissionClause]


class FeedbackBatchAnnotation(BaseModel):
    clause_id: str = Field(min_length=1, max_length=100)
    corrected_risk_level: RiskLabel


class ClauseFeedbackSubmissionReview(BaseModel):
    decision: Literal["annotate", "reject"]
    annotations: list[FeedbackBatchAnnotation] = Field(default_factory=list, max_length=200)
    review_note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def validate_review(self):
        ids = [annotation.clause_id for annotation in self.annotations]
        if len(ids) != len(set(ids)):
            raise ValueError("Each clause may be annotated only once.")
        if self.decision == "annotate" and not self.annotations:
            raise ValueError("Provide at least one corrected label or reject the batch.")
        if self.decision == "reject" and self.annotations:
            raise ValueError("Rejected batches cannot contain training labels.")
        return self


class ModelDisplayLabelUpdate(BaseModel):
    display_label: str | None = Field(default=None, max_length=100)


class AdaptiveDashboard(BaseModel):
    active_version: str | None
    active_display_label: str | None = None
    active_metrics: dict | None
    pending_feedback_count: int
    pending_feedback_submission_count: int = 0
    approved_feedback_count: int = 0
    approved_class_counts: dict[str, int] = Field(default_factory=lambda: {"low": 0, "medium": 0, "high": 0})
    gate_met: bool = False
    gate_requirements: dict = Field(default_factory=lambda: {"minimum_approved": 15, "minimum_per_class": 5})
    gate_label: str = "Demonstration-only gate (15 approved clauses, ≥5 per class); does not guarantee model improvement"
    active_checkpoint_path: str | None = None
    live_loaded_version: str | None = None
    needs_reload: bool = False
    history: list[dict]
