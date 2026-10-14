# LexEase System Architecture

## Overview

LexEase is designed around a modular, layered backend architecture built with FastAPI, Pydantic, and a Multi-Provider AI Foundation Layer supporting Groq, OpenRouter, and Google Gemini.

```
+-------------------------------------------------------------------------------------------------------------------+
|                                                 API Layer                                                         |
|  GET /api/health  |  POST /documents/upload  |  POST /documents/summarize  |  POST /clauses/analyze |  POST /documents/ask |
+-------------------+--------------------------+-----------------------------+------------------------+-------------------+
                                              |
                                              v
+-------------------------------------------------------------------------------------------------------------------+
|                                              Services Layer                                                       |
|   DocumentService  |  DocumentSummaryService  |  ClauseAnalysisService  |  DocumentQAService  |  ClauseRetrievalService   |
+--------------------+--------------------------+-------------------------+---------------------+-------------------+
                                              |
                                              v
+-------------------------------------------------------------------------------------------------------------------+
|                                           Storage & AI Layer                                                      |
|   DocumentContextStore (In-Memory)  <-->  PromptBuilder  <-->  AIService  <-->  ResponseParser                   |
|                                                                    |                                              |
|                                                          ProviderFactory                                          |
|                                                                    |                                              |
|                                            +-----------------------+-----------------------+                      |
|                                            |                       |                       |                      |
|                                     GeminiProvider           GroqProvider          OpenRouterProvider             |
|                                            |                       |                       |                      |
|                                       Gemini API                Groq API             OpenRouter API               |
+-------------------------------------------------------------------------------------------------------------------+
```

## Adaptive Learning

User corrections are stored as consented, PII-masked clause rows with `pending` status. A token-protected reviewer approves or rejects each clause. The explicit ML training command exports approved rows only, checks for overlap with the fixed held-out set, fine-tunes a separate candidate risk checkpoint, and compares accuracy, macro F1, and high-risk recall against the active model. The active risk-model pointer changes only when every configured acceptance check passes. Uploaded documents and model predictions alone never create training labels.

## Clause Drafting

The clause drafting flow accepts up to eight user-selected clauses and requires explicit consent before sending selected clause text to the configured AI provider. Rewrites pass the same response-schema and material-term validation, including at most one corrective retry when new material terms are detected. The user can edit or exclude suggestions before downloading a proposed PDF; the original upload is not changed or persisted by this flow.

---

## 1. Multi-Provider AI Architecture

The AI layer decouples domain services from concrete AI providers using the Dependency Inversion Principle:

- **`BaseAIProvider` (`app/ai/base_provider.py`)**: Abstract base class enforcing the contract:
  ```python
  async def generate(prompt: str, system_instruction: str | None = None) -> str
  ```
- **`ProviderFactory` (`app/ai/provider_factory.py`)**: Factory function `get_ai_provider()` that instantiates the active provider based on `settings.AI_PROVIDER`:
  - `AI_PROVIDER=groq` -> `GroqProvider`
  - `AI_PROVIDER=openrouter` -> `OpenRouterProvider`
  - `AI_PROVIDER=gemini` -> `GeminiProvider`
- **`AIService` (`app/services/ai.py`)**: Orchestrates prompt formatting, raw generation via the injected `BaseAIProvider`, and JSON response parsing/validation.
- **Provider Implementations**:
  - `GroqProvider` (`app/ai/groq_provider.py`): OpenAI-compatible completions API using async `httpx` with exponential backoff retries.
  - `OpenRouterProvider` (`app/ai/openrouter_provider.py`): OpenRouter completions API using async `httpx` with exponential backoff retries.
  - `GeminiProvider` (`app/ai/gemini_provider.py`): Google GenAI SDK integration with exponential backoff retries.

---

## 2. Request Invocation Pipeline (`POST /documents/summarize`)

When a client submits a list of preprocessed clause segments for whole document summarization:

1. **Router (`app/api/routers/summary.py`)**:
   - Accepts `DocumentSummaryRequest`.
   - Delegates request processing to `DocumentSummaryService`.
   - Catches domain-specific exceptions (`EmptyClauseListError` -> 400 Bad Request, `SummaryGenerationError` -> 500 Internal Server Error).

2. **Summary Service (`app/services/summary.py`)**:
   - Validates that `clauses` array is non-empty.
   - Formats each `ClauseSegment` and concatenates them into a unified full-document text string.
   - Formulates the payload `{"document_text": full_document_text}`.
   - Obtains provider via `get_ai_provider()` and invokes `AIService.generate(AITask.DOCUMENT_SUMMARY, payload, DocumentSummaryResponse)`.

3. **AI Service (`app/services/ai.py`)**:
   - Orchestrates prompt creation via `PromptBuilder`.
   - Invokes the active provider (`GroqProvider`, `OpenRouterProvider`, or `GeminiProvider`).
   - Passes raw response string to `ResponseParser`.

4. **Prompt Builder (`app/ai/prompt_builder.py`)**:
   - Reads `app/prompts/document_summary.txt` and substitutes `{{document}}`.

5. **AI Provider**:
   - Sends request to the configured AI API asynchronously with retries.

6. **Response Parser (`app/ai/response_parser.py`)**:
   - Strips markdown formatting if present and validates against `DocumentSummaryResponse`.

---

## 3. Request Invocation Pipeline (`POST /clauses/analyze`)

When a client submits clause segments for clause-level risk analysis:

1. **Router (`app/api/routers/clause_analysis.py`)**:
   - Accepts `ClauseAnalysisRequest`.
   - Delegates request processing to `ClauseAnalysisService`.
   - Catches domain-specific exceptions (`EmptyClauseListError` -> 400 Bad Request, `ClauseAnalysisError` -> 500 Internal Server Error).

2. **Clause Analysis Service (`app/services/clause_analysis.py`)**:
   - Validates that `clauses` array is non-empty.
   - Serializes all `ClauseSegment` objects into a single JSON array string.
   - Formulates the payload `{"clauses_json": <json_string>}` — a single batched request covering all clauses.
   - Obtains provider via `get_ai_provider()` and invokes `AIService.generate(AITask.CLAUSE_ANALYSIS, payload, ClauseAnalysisAIResponse)`.
   - Wraps `ClauseAnalysisAIResponse.results` into `ClauseAnalysisResponse` with `total_clauses`.

3. **Prompt Builder & AI Execution**:
   - Reads `app/prompts/clause_risk.txt` and substitutes `{{clauses_json}}`.
   - Calls active AI provider and validates output against `ClauseAnalysisAIResponse`.

---

## 4. Request Invocation Pipeline (`POST /documents/ask`)

When a client asks a question about an uploaded document:

1. **Router (`app/api/routers/qa.py`)**:
   - Accepts `DocumentQARequest` (`document_id`, `question`).
   - Delegates request processing to `DocumentQAService`.
   - Catches domain-specific exceptions (`DocumentContextNotFoundError` -> 404 Not Found, `QAGenerationError` -> 500 Internal Server Error).

2. **Q&A Service (`app/services/qa.py`)**:
   - Fetches stored `ClauseSegment` list from `DocumentContextStore` by `document_id`.
   - Invokes `ClauseRetrievalService.retrieve(question, clauses)` to rank and select relevant clauses.
   - **Early Exit (No AI Call)**: If no clause meets the minimum relevance threshold (`min_score = 0.6`), immediately returns `DocumentQAResponse(answer="...", source_clauses=[], confidence=0.0, cannot_answer=True)` without calling `AIService` or the AI provider.
   - **AI Path**: Formats retrieved clauses into `clauses_context` string and invokes `AIService.generate(AITask.DOCUMENT_QA, payload, DocumentQAResponse)`.

3. **Clause Retrieval Service (`app/services/retrieval.py`)**:
   - Operates independently without embeddings or remote APIs.
   - Tokenizes text, normalizes English suffixes via lightweight stemmer (`monthly` -> `month`, `payable` -> `pay`), filters English and interrogative framing stop words, scores clauses by term overlap ratio (`matching_terms / len(question_terms)`), enforces a minimum relevance threshold (`min_score = 0.6`), and ranks top-5 relevant clauses.

---

## 5. Reusable Schemas & Storage

- **`DocumentContext`**: Reusable base schema containing `clauses: list[ClauseSegment]`.
- **`DocumentUploadResponse`**: Upload response containing `filename`, `page_count`, `character_count`, `clauses`, and `document_id: str | None`.
- **`DocumentContextStore`**: Modular in-memory store for PII-masked `ClauseSegment` lists, indexed by `document_id`. Prepared for Sprint 9 PostgreSQL migration.
- **`DocumentQARequest`**: Contains `document_id` (str) and `question` (str, max 2000 chars).
- **`DocumentQAResponse`**: Contains `answer` (str), `source_clauses` (list[str]), `confidence` (float, 0.0–1.0), and `cannot_answer` (bool).
- **`DocumentSummaryRequest`**: Inherits from `DocumentContext`.
- **`DocumentSummaryResponse`**: Contains `summary: str`, `key_points: list[str]`, and optional `document_type: str | None`.
- **`ClauseAnalysisRequest`**: Inherits from `DocumentContext`.
- **`RiskLevel`**: `StrEnum` with values `low`, `medium`, `high`.
- **`ClauseRiskResult`**: Contains `clause_id`, `clause_number`, `risk_level` (`RiskLevel`), `explanation`, `recommendation`, and `confidence` (float, 0.0–1.0).
- **`ClauseAnalysisAIResponse`**: Internal wrapper `{ results: list[ClauseRiskResult] }` used exclusively by `ResponseParser`.
- **`ClauseAnalysisResponse`**: Public HTTP response containing `total_clauses: int` and `results: list[ClauseRiskResult]`.
