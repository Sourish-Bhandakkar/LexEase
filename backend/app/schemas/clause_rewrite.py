from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.document import ClauseSegment


class ClauseRewriteRequest(BaseModel):
    clauses: list[ClauseSegment] = Field(min_length=1, max_length=300)
    selected_clause_ids: list[str] = Field(min_length=1, max_length=8)
    negotiation_goals: str | None = Field(default=None, max_length=1000)
    ai_processing_consent: Literal[True]

    @model_validator(mode="after")
    def validate_selection(self):
        clause_ids = [clause.clause_id for clause in self.clauses]
        if len(set(clause_ids)) != len(clause_ids):
            raise ValueError("Clause IDs must be unique.")
        if sum(len(clause.text) for clause in self.clauses) > 500_000:
            raise ValueError("The extracted draft is too large to export in one request.")
        if len(set(self.selected_clause_ids)) != len(self.selected_clause_ids):
            raise ValueError("Selected clause IDs must be unique.")
        by_id = {clause.clause_id: clause for clause in self.clauses}
        missing = set(self.selected_clause_ids) - by_id.keys()
        if missing:
            raise ValueError("Every selected clause must exist in the supplied document.")
        if any(len(by_id[clause_id].text) > 6000 for clause_id in self.selected_clause_ids):
            raise ValueError("A selected clause is too long to rewrite in one request.")
        if sum(len(by_id[clause_id].text) for clause_id in self.selected_clause_ids) > 18000:
            raise ValueError("Selected clauses exceed the safe one-request text limit.")
        return self


class ClauseRewriteItem(BaseModel):
    clause_id: str
    clause_number: str | None
    replacement_text: str = Field(min_length=1, max_length=12000)
    changes_summary: str = Field(min_length=1, max_length=2000)
    client_tradeoff: str = Field(min_length=1, max_length=2000)
    review_note: str = Field(min_length=1, max_length=2000)
    estimated_customer_risk: Literal["LOW", "MEDIUM", "HIGH", "NEEDS_REVIEW"] = "NEEDS_REVIEW"
    risk_estimate_note: str = Field(default="Estimate applies to the generated wording only.", min_length=1, max_length=1000)


class ClauseRewriteAIItem(ClauseRewriteItem):
    # Required from the drafting model; defaults on the transport item are only
    # for backward-compatible exports constructed outside this generation path.
    estimated_customer_risk: Literal["LOW", "MEDIUM", "HIGH", "NEEDS_REVIEW"]
    risk_estimate_note: str = Field(min_length=1, max_length=1000)


class ClauseRewriteAIResponse(BaseModel):
    rewrites: list[ClauseRewriteAIItem] = Field(min_length=1, max_length=8)


class ClauseRewriteResponse(BaseModel):
    rewrites: list[ClauseRewriteItem]
    draft_notice: str


class ProposedDraftExportRequest(BaseModel):
    clauses: list[ClauseSegment] = Field(min_length=1, max_length=300)
    rewrites: list[ClauseRewriteItem] = Field(min_length=1, max_length=8)
    source_filename: str | None = Field(default=None, max_length=180)

    @model_validator(mode="after")
    def validate_rewrites_belong_to_document(self):
        clause_ids = [clause.clause_id for clause in self.clauses]
        rewrite_ids = [rewrite.clause_id for rewrite in self.rewrites]
        if len(set(clause_ids)) != len(clause_ids):
            raise ValueError("Clause IDs must be unique.")
        if sum(len(clause.text) for clause in self.clauses) > 500_000:
            raise ValueError("The extracted draft is too large to export in one request.")
        if len(set(rewrite_ids)) != len(rewrite_ids):
            raise ValueError("A clause can only be revised once.")
        if not set(rewrite_ids).issubset(clause_ids):
            raise ValueError("Every proposed revision must match a clause in the document.")
        return self
