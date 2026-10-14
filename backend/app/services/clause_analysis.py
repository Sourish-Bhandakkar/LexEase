import asyncio
import json
import logging
import os
import sys
from typing import Sequence
from app.ai.base_provider import BaseAIProvider
from app.ai.exceptions import AIProviderError, AIResponseValidationError
from app.ai.provider_factory import get_ai_provider
from app.core.config import settings
from app.schemas.ai import AITask
from app.schemas.clause_analysis import (
    ClauseAnalysisAIResponse,
    ClauseAnalysisResponse,
    ClauseRiskResult,
    RiskLevel,
)
from app.schemas.document import ClauseSegment
from app.services.ai import AIService
from app.services.exceptions import ClauseAnalysisError, EmptyClauseListError

logger = logging.getLogger(__name__)

# Default maximum estimated tokens per chunk sent to AI provider.
DEFAULT_MAX_CHUNK_TOKENS = 3500
# Right-sized Groq contextual chunk targets to keep completions comfortably below 4,096 tokens and respect 8,000 TPM limit
DEFAULT_GROQ_MAX_CHUNK_TOKENS = 1800
DEFAULT_GROQ_MAX_CLAUSES_PER_CHUNK = 8


def estimate_tokens(text: str) -> int:
    """
    Conservatively estimates the token count for a given text.
    In legal English text, 1 token is approximately 3 to 4 characters.
    Using len(text) / 3.0 provides a safe upper bound.
    """
    if not text:
        return 0
    return max(1, int(len(text) / 3.0))


def _serialize_clauses(clauses: Sequence[ClauseSegment]) -> str:
    """Serializes a list of ClauseSegment objects into formatted JSON for prompt insertion."""
    payload = [
        {
            "clause_id": clause.clause_id,
            "clause_number": clause.clause_number,
            "text": clause.text,
        }
        for clause in clauses
    ]
    return json.dumps(payload, ensure_ascii=False, indent=2)


class ClauseAnalysisService:
    """
    Service responsible for orchestrating clause-level legal risk analysis.
    Integrates the local ML models (domain detector, clause classifier, risk safety signal)
    with Groq contextual analysis and token-safe chunking/pacing.
    """

    # Class-level lazy singletons for local ML models
    _device = None
    _domain_detector = None
    _clause_classifier = None
    _risk_engine = None
    _router = None

    @classmethod
    def _init_models(cls):
        """Initializes the local ML singletons once if available."""
        if cls._clause_classifier is None:
            logger.info("Initializing local ML models for hybrid pipeline...")
            current_file = os.path.abspath(__file__)
            # backend/app/services/clause_analysis.py -> project root
            project_root = os.path.dirname(
                os.path.dirname(os.path.dirname(os.path.dirname(current_file)))
            )
            if project_root not in sys.path:
                sys.path.insert(0, project_root)

            # Bridge ML virtual environment if torch is not in current environment
            ml_site_packages = os.path.join(project_root, "ml", ".venv", "Lib", "site-packages")
            if os.path.isdir(ml_site_packages) and ml_site_packages not in sys.path:
                sys.path.append(ml_site_packages)

            # Enforce offline loading for Hugging Face Hub (eliminates ~55s cold-start network timeout)
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            os.environ["HF_HUB_OFFLINE"] = "1"

            try:
                import torch
                from ml.final_pipeline.domain_detector import LegalDomainDetector
                from ml.final_pipeline.clause_classifier import HierarchicalClauseClassifier
                from ml.final_pipeline.risk_engine import LegalRiskEngine
                from ml.final_pipeline.hybrid_router import HybridRiskRouter

                cls._device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                cls._domain_detector = LegalDomainDetector()
                
                try:
                    cls._clause_classifier = HierarchicalClauseClassifier(cls._device)
                except Exception as e:
                    logger.error(f"Could not load HierarchicalClauseClassifier ({e}), using default fallback.", exc_info=True)
                    cls._clause_classifier = None

                try:
                    cls._risk_engine = LegalRiskEngine(cls._device)
                except Exception as e:
                    logger.error(f"Could not load LegalRiskEngine ({e}), using default fallback.", exc_info=True)
                    cls._risk_engine = None

                cls._router = HybridRiskRouter()
                logger.info(f"Local ML models initialized (device: {cls._device}).")
            except Exception as e:
                logger.error(f"Local ML pipeline initialization failed ({e}). Proceeding with Groq fallback routing.", exc_info=True)

    @classmethod
    def reload_models(cls):
        """Forces reloading of the local ML risk engine checkpoint."""
        cls._init_models()
        if cls._risk_engine is not None:
            cls._risk_engine.reload()
            logger.info(f"Reloaded LegalRiskEngine (active_version: {cls.get_active_loaded_version()}).")

    @classmethod
    def get_active_loaded_version(cls) -> str | None:
        """Returns the active model version currently loaded in memory, if initialized."""
        if cls._risk_engine is not None:
            cls._risk_engine.reload_if_updated()
            return getattr(cls._risk_engine, "active_version", None)
        return None

    def __init__(
        self,
        ai_service: AIService | None = None,
        max_chunk_tokens: int | None = None,
        max_clauses_per_chunk: int | None = None,
        chunk_delay: float | None = None,
    ):
        if ai_service is None:
            provider: BaseAIProvider = get_ai_provider()
            self.ai_service = AIService(provider=provider)
        else:
            self.ai_service = ai_service

        provider_cls = self.ai_service.provider.__class__.__name__
        is_mock = "mock" in provider_cls.lower()
        is_groq = provider_cls == "GroqProvider" or (
            getattr(settings, "AI_PROVIDER", "").lower() == "groq" and not is_mock
        )

        # Right-size Groq contextual chunks to max 8 clauses and <= 1800 tokens to fit safely within 4,096 completion limit
        if max_clauses_per_chunk is not None:
            self.max_clauses_per_chunk = max_clauses_per_chunk
        elif is_groq:
            self.max_clauses_per_chunk = DEFAULT_GROQ_MAX_CLAUSES_PER_CHUNK
        else:
            self.max_clauses_per_chunk = None

        if max_chunk_tokens is not None:
            self.max_chunk_tokens = max_chunk_tokens
        elif is_groq:
            self.max_chunk_tokens = DEFAULT_GROQ_MAX_CHUNK_TOKENS
        else:
            self.max_chunk_tokens = DEFAULT_MAX_CHUNK_TOKENS

        self.chunk_delay = (
            chunk_delay if chunk_delay is not None else settings.GROQ_REQUEST_DELAY
        )

    def _chunk_clauses(
        self, clauses: Sequence[ClauseSegment]
    ) -> list[list[ClauseSegment]]:
        """
        Splits clauses into groups where each group has at most `self.max_clauses_per_chunk`
        clauses (if set) AND its serialized JSON token estimate is within `self.max_chunk_tokens`.
        Preserves exact clause ordering, drops zero clauses, and never duplicates clauses.
        """
        if not clauses:
            return []

        chunks: list[list[ClauseSegment]] = []
        current_chunk: list[ClauseSegment] = []

        for clause in clauses:
            if not current_chunk:
                current_chunk.append(clause)
                continue

            # Hard ceiling on clauses per chunk to guarantee response fits within 4,096 completion tokens
            if self.max_clauses_per_chunk and len(current_chunk) >= self.max_clauses_per_chunk:
                chunks.append(current_chunk)
                current_chunk = [clause]
                continue

            candidate_json = _serialize_clauses(current_chunk + [clause])
            candidate_tokens = estimate_tokens(candidate_json)

            if candidate_tokens <= self.max_chunk_tokens:
                current_chunk.append(clause)
            else:
                chunks.append(current_chunk)
                current_chunk = [clause]

        if current_chunk:
            chunks.append(current_chunk)

        # Integrity verification: verify clause counts, ordering, and absence of duplicates
        flattened = [c.clause_id for ch in chunks for c in ch]
        original_ids = [c.clause_id for c in clauses]
        assert len(flattened) == len(clauses), f"Chunking lost clauses: {len(flattened)} vs {len(clauses)}"
        assert flattened == original_ids, "Chunking altered clause ordering!"
        assert len(set(flattened)) == len(clauses), "Chunking introduced duplicate clauses!"
        logger.info(
            f"Chunked {len(clauses)} clauses into {len(chunks)} chunks (max_clauses={self.max_clauses_per_chunk}, max_tokens={self.max_chunk_tokens}). Sizes: {[len(ch) for ch in chunks]}"
        )

        return chunks

    def _persist_results(
        self, document_id: str, results: Sequence[ClauseRiskResult]
    ) -> None:
        """Persists or replaces the clause risk results for a document in the database."""
        from app.database.models import ClauseRiskResult as DBClauseRiskResult, Document
        from app.database.session import SessionLocal

        with SessionLocal() as session:
            doc = session.query(Document).filter(Document.id == document_id).first()
            if not doc:
                doc = Document(
                    id=document_id,
                    filename="uploaded_document.pdf",
                    page_count=1,
                    character_count=sum(len(r.explanation) for r in results),
                )
                session.add(doc)
                session.flush()

            # Remove previous risk results for this document if re-analyzing
            session.query(DBClauseRiskResult).filter(
                DBClauseRiskResult.document_id == document_id
            ).delete()

            for res in results:
                db_res = DBClauseRiskResult(
                    document_id=document_id,
                    clause_id=res.clause_id,
                    clause_number=res.clause_number,
                    risk_level=(
                        res.risk_level.value
                        if hasattr(res.risk_level, "value")
                        else str(res.risk_level)
                    ),
                    explanation=res.explanation,
                    recommendation=res.recommendation,
                    confidence=res.confidence,
                    risk_score=res.risk_score,
                    risk_label=res.risk_label,
                    recommended_action=res.recommended_action,
                )
                db_res.reasons = res.reasons
                db_res.issues = res.issues
                session.add(db_res)

            session.commit()

    async def analyze_clauses(
        self, clauses: list[ClauseSegment], document_id: str | None = None
    ) -> ClauseAnalysisResponse:
        """
        Analyzes a list of clause segments using the hybrid local ML + Groq pipeline.
        Only clauses requiring contextual evaluation are routed to Groq.
        Preserves token-safe chunking and pacing for routed clauses.
        """
        if not clauses:
            raise EmptyClauseListError(
                "Clause list cannot be empty for clause risk analysis."
            )

        # 1. Initialize local ML models
        self._init_models()
        from app.utils.reconciler import RiskReconciler

        # Combine text to detect overall document domain
        combined_text = "\n\n".join([c.text for c in clauses])
        domain = "Corporate/Commercial"
        if self._domain_detector:
            domain = self._domain_detector.detect_domain(combined_text)
        logger.info(f"Detected document domain: {domain}")

        # 2. Local Clause Classification and Risk Scoring
        local_results = {}
        clauses_to_route = []

        for clause in clauses:
            if self._clause_classifier:
                clause_type, confidence = self._clause_classifier.classify_clause(clause.text, domain)
            else:
                clause_type, confidence = "UNKNOWN/OTHER", 0.0

            if self._risk_engine:
                local_risk = self._risk_engine.predict_risk(clause.text)
            else:
                local_risk = {
                    "risk_score": 50.0,
                    "risk_level": "medium",
                    "high_risk_warning": False,
                    "requires_contextual_review": True,
                }

            local_results[clause.clause_id] = {
                "clause_type": clause_type,
                "confidence": confidence,
                "local_risk": local_risk,
            }

            # Determine routing
            if self._router:
                should_route = self._router.should_route_to_groq(
                    domain, clause_type, confidence, local_risk
                )
            else:
                should_route = True

            if should_route:
                clauses_to_route.append(clause)

        logger.info(
            f"Hybrid Router: Routing {len(clauses_to_route)}/{len(clauses)} clauses to Groq for contextual analysis."
        )

        # 3. Call Groq for routed clauses with token-safe chunking and pacing
        groq_results = {}
        if clauses_to_route:
            chunks = self._chunk_clauses(clauses_to_route)
            for chunk_index, chunk in enumerate(chunks, 1):
                if chunk_index > 1 and self.chunk_delay > 0:
                    logger.debug(
                        f"Pacing delay: sleeping {self.chunk_delay}s before chunk {chunk_index}..."
                    )
                    await asyncio.sleep(self.chunk_delay)

                clauses_json_str = _serialize_clauses(chunk)
                payload = {"clauses_json": clauses_json_str}

                try:
                    ai_response: ClauseAnalysisAIResponse = await self.ai_service.generate(
                        task_type=AITask.CLAUSE_ANALYSIS,
                        payload=payload,
                        response_schema=ClauseAnalysisAIResponse,
                    )
                    for res in ai_response.results:
                        groq_results[res.clause_id] = {
                            "final_risk": res.risk_level.lower(),
                            "explanation": res.explanation,
                            "recommendation": res.recommendation,
                            "confidence": getattr(res, "confidence", 1.0),
                            "risk_score": getattr(res, "risk_score", None),
                            "risk_label": getattr(res, "risk_label", None),
                            "reasons": getattr(res, "reasons", []),
                            "issues": getattr(res, "issues", []),
                            "recommended_action": getattr(res, "recommended_action", None),
                        }
                except (AIProviderError, AIResponseValidationError, ValueError) as e:
                    logger.error(
                        f"Groq query failed for chunk {chunk_index}: {e}. Falling back to local risk values."
                    )

        # 4. Reconciliation and Output Formatting
        final_results = []
        for clause in clauses:
            local_data = local_results[clause.clause_id]
            groq_res = groq_results.get(clause.clause_id)

            reconciled = RiskReconciler.reconcile(local_data["local_risk"], groq_res)

            final_level_str = reconciled["final_risk_level"].lower()
            if final_level_str == "high":
                final_level = RiskLevel.HIGH
            elif final_level_str == "medium":
                final_level = RiskLevel.MEDIUM
            else:
                final_level = RiskLevel.LOW

            result = ClauseRiskResult(
                clause_id=clause.clause_id,
                clause_number=clause.clause_number,
                risk_level=final_level,
                explanation=reconciled["explanation"],
                recommendation=reconciled["recommendation"],
                confidence=groq_res.get("confidence", 1.0) if groq_res else 1.0,
                risk_score=reconciled["final_risk_score"],
                risk_label=reconciled["final_risk_level"].upper(),
                reasons=groq_res.get("reasons", []) if groq_res else [],
                issues=groq_res.get("issues", []) if groq_res else [],
                recommended_action=reconciled["recommendation"],
            )
            final_results.append(result)

        if document_id:
            try:
                self._persist_results(document_id, final_results)
            except Exception as e:
                logger.error(
                    f"Failed to persist risk results for document {document_id}: {e}",
                    exc_info=True,
                )

        return ClauseAnalysisResponse(
            total_clauses=len(final_results),
            results=final_results,
        )
