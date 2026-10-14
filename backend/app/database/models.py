"""
SQLAlchemy ORM models for LexEase persistence layer.

Tables:
  - documents           — uploaded document metadata
  - clauses             — PII-masked clause segments (ordered, per document)
  - summaries           — generated document summaries (one per document)
  - clause_risk_results — per-clause risk analysis results
  - qa_interactions     — Q&A interactions per document
"""

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship


def _utcnow() -> datetime:
    """Returns the current UTC datetime (timezone-aware)."""
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    """Generates a new UUID4 string."""
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    """Shared declarative base for all LexEase ORM models."""
    pass


# ---------------------------------------------------------------------------
# Document
# ---------------------------------------------------------------------------

class Document(Base):
    """
    Represents a successfully uploaded and preprocessed legal document.

    The ``id`` column is a UUID4 string and serves as the ``document_id``
    returned to the API caller — preserving the existing public contract.
    """
    __tablename__ = "documents"

    id: str = Column(String, primary_key=True, default=_new_uuid)
    filename: str = Column(String, nullable=False)
    page_count: int = Column(Integer, nullable=False)
    character_count: int = Column(Integer, nullable=False)
    created_at: datetime = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    # Relationships
    clauses = relationship(
        "Clause",
        back_populates="document",
        cascade="all, delete-orphan",
        order_by="Clause.position",
    )
    summary = relationship(
        "Summary",
        back_populates="document",
        uselist=False,
        cascade="all, delete-orphan",
    )
    risk_results = relationship(
        "ClauseRiskResult",
        back_populates="document",
        cascade="all, delete-orphan",
    )
    qa_interactions = relationship(
        "QAInteraction",
        back_populates="document",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Document id={self.id!r} filename={self.filename!r}>"


# ---------------------------------------------------------------------------
# Clause
# ---------------------------------------------------------------------------

class Clause(Base):
    """
    A single PII-masked clause segment belonging to a Document.

    ``clause_id`` preserves the existing sequential label format
    (``"clause_1"``, ``"clause_2"``, …) used by the API and frontend.

    ``position`` (0-indexed) guarantees stable ordering on retrieval.
    """
    __tablename__ = "clauses"

    id: str = Column(String, primary_key=True, default=_new_uuid)
    document_id: str = Column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    clause_id: str = Column(String, nullable=False)      # e.g. "clause_1"
    clause_number: str | None = Column(String, nullable=True)   # e.g. "1.", "1.1"
    text: str = Column(Text, nullable=False)             # PII-masked
    position: int = Column(Integer, nullable=False)      # 0-indexed ordering

    document = relationship("Document", back_populates="clauses")

    def __repr__(self) -> str:
        return (
            f"<Clause id={self.id!r} clause_id={self.clause_id!r} "
            f"document_id={self.document_id!r}>"
        )


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

class Summary(Base):
    """
    Stores the generated summary for a Document.

    At most one summary per document (enforced by UNIQUE constraint on
    ``document_id``). Upsert via delete-then-insert on the service layer.

    ``key_points`` is serialized as a JSON array string.
    """
    __tablename__ = "summaries"
    __table_args__ = (UniqueConstraint("document_id", name="uq_summaries_document"),)

    id: str = Column(String, primary_key=True, default=_new_uuid)
    document_id: str = Column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    summary_text: str = Column(Text, nullable=False)
    key_points_json: str = Column(Text, nullable=False, default="[]")
    document_type: str | None = Column(String, nullable=True)
    created_at: datetime = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    document = relationship("Document", back_populates="summary")

    # ------------------------------------------------------------------
    # Helper properties — transparent JSON serialization/deserialization
    # ------------------------------------------------------------------

    @property
    def key_points(self) -> list[str]:
        try:
            return json.loads(self.key_points_json)
        except (TypeError, json.JSONDecodeError):
            return []

    @key_points.setter
    def key_points(self, value: list[str]) -> None:
        self.key_points_json = json.dumps(value or [])

    def __repr__(self) -> str:
        return f"<Summary id={self.id!r} document_id={self.document_id!r}>"


# ---------------------------------------------------------------------------
# ClauseRiskResult
# ---------------------------------------------------------------------------

class ClauseRiskResult(Base):
    """
    Stores the risk analysis result for a single clause within a Document.

    All hybrid ML pipeline fields are persisted to preserve the full output
    of the local classifier + Groq reconciliation pipeline.

    List fields (``reasons``, ``issues``) are stored as JSON TEXT.
    """
    __tablename__ = "clause_risk_results"

    id: str = Column(String, primary_key=True, default=_new_uuid)
    document_id: str = Column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    # Matches the ClauseSegment.clause_id label (e.g. "clause_1")
    clause_id: str = Column(String, nullable=False)
    clause_number: str | None = Column(String, nullable=True)

    # Core risk fields
    risk_level: str = Column(String, nullable=False)      # "low" / "medium" / "high"
    explanation: str = Column(Text, nullable=False)
    recommendation: str = Column(Text, nullable=False)
    confidence: float = Column(Float, nullable=False)

    # Hybrid pipeline fields (nullable for backward compat)
    risk_score: float | None = Column(Float, nullable=True)
    risk_label: str | None = Column(String, nullable=True)
    reasons_json: str = Column(Text, nullable=False, default="[]")
    issues_json: str = Column(Text, nullable=False, default="[]")
    recommended_action: str | None = Column(Text, nullable=True)

    created_at: datetime = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    document = relationship("Document", back_populates="risk_results")

    # ------------------------------------------------------------------
    # Helper properties
    # ------------------------------------------------------------------

    @property
    def reasons(self) -> list[str]:
        try:
            return json.loads(self.reasons_json)
        except (TypeError, json.JSONDecodeError):
            return []

    @reasons.setter
    def reasons(self, value: list[str] | None) -> None:
        self.reasons_json = json.dumps(value or [])

    @property
    def issues(self) -> list[str]:
        try:
            return json.loads(self.issues_json)
        except (TypeError, json.JSONDecodeError):
            return []

    @issues.setter
    def issues(self, value: list[str] | None) -> None:
        self.issues_json = json.dumps(value or [])

    def __repr__(self) -> str:
        return (
            f"<ClauseRiskResult id={self.id!r} clause_id={self.clause_id!r} "
            f"risk_level={self.risk_level!r}>"
        )


# ---------------------------------------------------------------------------
# QAInteraction
# ---------------------------------------------------------------------------

class QAInteraction(Base):
    """
    Stores a single completed Q&A interaction against a Document.

    Append-only; supports future Q&A history display.

    ``source_clauses`` (list of clause_id strings) is stored as JSON TEXT.
    ``cannot_answer`` is stored as a Boolean column.
    """
    __tablename__ = "qa_interactions"

    id: str = Column(String, primary_key=True, default=_new_uuid)
    document_id: str = Column(
        String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    question: str = Column(Text, nullable=False)
    answer: str = Column(Text, nullable=False)
    source_clauses_json: str = Column(Text, nullable=False, default="[]")
    confidence: float = Column(Float, nullable=False)
    cannot_answer: bool = Column(Boolean, nullable=False, default=False)
    created_at: datetime = Column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    document = relationship("Document", back_populates="qa_interactions")

    # ------------------------------------------------------------------
    # Helper properties
    # ------------------------------------------------------------------

    @property
    def source_clauses(self) -> list[str]:
        try:
            return json.loads(self.source_clauses_json)
        except (TypeError, json.JSONDecodeError):
            return []

    @source_clauses.setter
    def source_clauses(self, value: list[str]) -> None:
        self.source_clauses_json = json.dumps(value or [])

    def __repr__(self) -> str:
        return (
            f"<QAInteraction id={self.id!r} document_id={self.document_id!r}>"
        )


class ClauseFeedback(Base):
    """A consented, clause-only label awaiting explicit human review."""
    __tablename__ = "clause_feedback"

    id: str = Column(String, primary_key=True, default=_new_uuid)
    clause_text: str = Column(Text, nullable=False)
    predicted_risk_level: str = Column(String, nullable=False)
    corrected_risk_level: str = Column(String, nullable=False)
    consent: bool = Column(Boolean, nullable=False)
    status: str = Column(String, nullable=False, default="pending", index=True)
    review_note: str | None = Column(Text, nullable=True)
    source_group_id: str = Column(String, nullable=False, default=_new_uuid, index=True)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    reviewed_at: datetime | None = Column(DateTime(timezone=True), nullable=True)


class ClauseFeedbackSubmission(Base):
    """A consented document-level batch of PII-masked clauses awaiting annotation."""
    __tablename__ = "clause_feedback_submissions"

    id: str = Column(String, primary_key=True, default=_new_uuid)
    clauses_json: str = Column(Text, nullable=False)
    clause_count: int = Column(Integer, nullable=False)
    consent: bool = Column(Boolean, nullable=False)
    status: str = Column(String, nullable=False, default="pending", index=True)
    review_note: str | None = Column(Text, nullable=True)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    reviewed_at: datetime | None = Column(DateTime(timezone=True), nullable=True)


class AdaptiveModelVersion(Base):
    """Measured training-cycle history; metrics are recorded only after evaluation."""
    __tablename__ = "adaptive_model_versions"

    id: str = Column(String, primary_key=True, default=_new_uuid)
    version: str = Column(String, nullable=False, unique=True, index=True)
    parent_version: str | None = Column(String, nullable=True)
    status: str = Column(String, nullable=False, default="running", index=True)
    checkpoint_path: str | None = Column(String, nullable=True)
    metrics_json: str = Column(Text, nullable=False, default="{}")
    acceptance_json: str = Column(Text, nullable=False, default="{}")
    approved_feedback_count: int = Column(Integer, nullable=False, default=0)
    test_sample_count: int = Column(Integer, nullable=False, default=0)
    display_label: str | None = Column(String, nullable=True)
    error_message: str | None = Column(Text, nullable=True)
    created_at: datetime = Column(DateTime(timezone=True), nullable=False, default=_utcnow)
    completed_at: datetime | None = Column(DateTime(timezone=True), nullable=True)
