from enum import StrEnum
from pydantic import BaseModel

class AITask(StrEnum):
    SIMPLIFICATION = "simplification"
    DOCUMENT_SUMMARY = "document_summary"
    CLAUSE_ANALYSIS = "clause_analysis"
    CLAUSE_REWRITE = "clause_rewrite"
    DOCUMENT_QA = "document_qa"


class ClauseSimplificationResponse(BaseModel):
    simplified_text: str
