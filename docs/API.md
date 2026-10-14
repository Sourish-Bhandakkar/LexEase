# LexEase Backend API Documentation

**Version:** 0.1.0
**Backend Framework:** FastAPI
**Base URL (Development):**
```
http://localhost:8000
```

---

# Overview

LexEase is an AI-powered legal document simplification platform.

Current backend capabilities include:

- Health Check
- PDF Upload
- PDF Text Extraction
- Text Cleaning
- Clause Segmentation
- Indian PII Masking
- AI Foundation Layer (Internal)
- Google Gemini Provider Integration (Internal)
- Whole Document Summarization
- Clause-Level Legal Risk Analysis

---

# Authentication

Currently **no authentication** is required.

Future versions will use session-based APIs.

---

# Response Codes

| Code | Meaning |
|------|----------|
|200|Success|
|400|Bad Request|
|404|Not Found|
|415|Unsupported Media Type|
|422|Validation Error|
|500|Internal Server Error|

---

# API Endpoints

---

# 1. Health Check

## Endpoint

```
GET /api/health
```

## Description

Checks whether the backend server is running.

---

### Success Response

```json
{
    "status": "healthy"
}
```

---

### Status Codes

|Code|Meaning|
|----|-------|
|200|Backend running|

---

# 2. Upload Legal Document

## Endpoint

```
POST /documents/upload
```

## Description

Uploads a legal PDF document.

The backend automatically:

1. Validates the PDF
2. Extracts text
3. Cleans formatting
4. Segments clauses
5. Masks Indian PII
6. Returns structured clauses

---

## Request

Content-Type

```
multipart/form-data
```

### Parameters

|Name|Type|Required|Description|
|----|----|--------|-----------|
|file|PDF|Yes|Legal document|

---

## Success Response

```json
{
    "filename": "RentalAgreement.pdf",
    "page_count": 6,
    "character_count": 7852,
    "document_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "clauses": [
        {
            "clause_id": "clause_1",
            "clause_number": "1",
            "text": "This agreement begins on..."
        },
        {
            "clause_id": "clause_2",
            "clause_number": "2.1",
            "text": "The tenant shall pay..."
        }
    ]
}
```

---

## Response Fields

|Field|Description|
|------|-----------|
|filename|Uploaded PDF name|
|page_count|Total PDF pages|
|character_count|Characters extracted before masking|
|document_id|Generated document context identifier for Q&A|
|clauses|List of cleaned clauses|


---

## Clause Object

```json
{
    "clause_id": "clause_3",
    "clause_number": "3.2",
    "text": "Masked and cleaned clause text"
}
```

|Field|Description|
|------|-----------|
|clause_id|Internal identifier|
|clause_number|Clause number if detected|
|text|Cleaned + masked clause|

---

# Automatic Processing Pipeline

Every uploaded PDF passes through the following pipeline:

```
PDF Upload
      │
      ▼
PDF Validation
      │
      ▼
Text Extraction (PyMuPDF)
      │
      ▼
Text Cleaning
      │
      ▼
Clause Segmentation
      │
      ▼
PII Masking
      │
      ▼
JSON Response
```

---

# PII Masking

Currently supported:

|Type|Replacement|
|----|-----------|
|Email|[EMAIL]|
|Phone|[PHONE]|
|Aadhaar|[AADHAAR]|
|PAN|[PAN]|

Example

Input

```
Email:
abc@gmail.com

Phone:
9876543210

PAN:
ABCDE1234F
```

Output

```
Email:
[EMAIL]

Phone:
[PHONE]

PAN:
[PAN]
```

---

# Possible Errors

## Invalid File Type

Status

```
400
```

Response

```json
{
    "detail": "Only PDF files are supported."
}
```

---

## Empty File

```json
{
    "detail": "Uploaded file is empty."
}
```

---

## Corrupted PDF

```json
{
    "detail": "Invalid or corrupted PDF."
}
```

---

## PDF Without Extractable Text

```json
{
    "detail": "No extractable text found in PDF."
}
```

---

# Internal AI Architecture

> These components are internal and **are not exposed as REST APIs.**

Current modules:

- `AIService` (High-level orchestration for prompt generation, invocation, response parsing)
- `BaseAIProvider` (Abstract base interface for all AI model providers)
- `ProviderFactory` (`get_ai_provider()` resolver based on `AI_PROVIDER` config)
- `GroqProvider` (High-speed OpenAI-compatible chat completions provider via httpx)
- `OpenRouterProvider` (Multi-model aggregator chat completions provider via httpx)
- `GeminiProvider` (Google GenAI SDK provider)
- `PromptBuilder` (Template substitution driven by `AITask` enum)
- `ResponseParser` (JSON stripping and Pydantic model validation)

These modules are consumed by `/documents/summarize`, `/clauses/analyze`, and `/documents/ask`.

---

# Adaptive Learning

Clause corrections are optional and require explicit consent. `POST /adaptive-learning/feedback` accepts only one PII-masked clause, the model's risk label, the suggested risk label, and `consent: true`. It does not accept or store a full document. New feedback is pending and is never used as training data automatically.

`GET /adaptive-learning/dashboard` returns the active version, measured metrics when a fixed-test run exists, pending count, and recent cycle history. Missing measurements are returned as `null` rather than estimated.

Review routes require the `X-Adaptive-Admin-Token` header, configured with `ADAPTIVE_LEARNING_ADMIN_TOKEN`:

- `GET /adaptive-learning/feedback/pending`
- `POST /adaptive-learning/feedback/{feedback_id}/review` with `{ "decision": "approve" }` or `{ "decision": "reject" }`

Run `python -m ml.adaptive_learning.train_candidate --evaluate-baseline` from the repository root to measure the active checkpoint without training. Only approved, consented clauses are exported for a manually launched candidate cycle. Run `python -m ml.adaptive_learning.train_candidate` to evaluate baseline and candidate on the same fixed held-out set, record accuracy, macro F1, and high-risk recall, and update the active checkpoint only if all thresholds in `ml/config/adaptive_learning.yaml` pass. Candidate checkpoints, exported clause data, and the active-model pointer are local ignored files.

---

# 3. Summarize Legal Document

## Endpoint

```
POST /documents/summarize
```

## Description

Summarizes a legal document represented as a list of preprocessed clause segments (produced by `/documents/upload`).

The backend automatically:
1. Validates the non-empty clause segment array (`DocumentSummaryRequest` extending `DocumentContext`).
2. Concatenates clause segments into full document text.
3. Invokes `AIService` with `AITask.DOCUMENT_SUMMARY` and `GeminiProvider`.
4. Parses and validates the AI response against `DocumentSummaryResponse`.
5. Returns a structured JSON summary.

---

## Request

Content-Type

```json
application/json
```

### Request Body Schema (`DocumentSummaryRequest`)

```json
{
  "clauses": [
    {
      "clause_id": "clause_1",
      "clause_number": "1.1",
      "text": "The tenant shall pay monthly rent on or before the 5th of each month."
    },
    {
      "clause_id": "clause_2",
      "clause_number": "2.1",
      "text": "The landlord reserves the right to inspect the property with 24 hours notice."
    }
  ]
}
```

---

## Success Response (200 OK)

```json
{
  "summary": "This rental agreement sets out the tenant's obligation to make prompt monthly rent payments by the 5th of each month and grants the landlord right of property inspection with advance notice.",
  "key_points": [
    "Rent must be paid monthly by the 5th",
    "Landlord may inspect property after giving 24 hours advance notice"
  ],
  "document_type": "Rental Agreement"
}
```

---

## Error Responses

### Empty Clause List (400 Bad Request)

```json
{
  "detail": "Clause list cannot be empty for document summarization."
}
```

### AI Generation Failure (500 Internal Server Error)

```json
{
  "detail": "Document summarization failed: Gemini API Error..."
}
```

---

---

# 4. Clause-Level Risk Analysis

## Endpoint

```
POST /clauses/analyze
```

## Description

Analyzes a list of preprocessed clause segments for legal risk from the perspective of an ordinary Indian citizen. All clauses are processed in a **single batched AI request**.

The backend automatically:
1. Validates the non-empty clause segment array (`ClauseAnalysisRequest` extending `DocumentContext`).
2. Serializes all clauses into a single JSON payload and constructs a batched prompt.
3. Invokes `AIService` with `AITask.CLAUSE_ANALYSIS` and `GeminiProvider`.
4. Parses and validates the AI response against `ClauseAnalysisAIResponse`.
5. Returns a structured JSON response with per-clause risk results.

---

## Request

Content-Type

```
application/json
```

### Request Body Schema (`ClauseAnalysisRequest`)

```json
{
  "clauses": [
    {
      "clause_id": "clause_1",
      "clause_number": "1.1",
      "text": "The tenant shall pay monthly rent on or before the 5th of each month."
    },
    {
      "clause_id": "clause_2",
      "clause_number": "2.1",
      "text": "The landlord may terminate the agreement without notice at any time."
    }
  ]
}
```

---

## Success Response (200 OK)

```json
{
  "total_clauses": 2,
  "results": [
    {
      "clause_id": "clause_1",
      "clause_number": "1.1",
      "risk_level": "low",
      "explanation": "This is a standard rent payment clause with a clear due date and no unusual penalty terms.",
      "recommendation": "Review for completeness; this clause is generally acceptable as written.",
      "confidence": 0.91
    },
    {
      "clause_id": "clause_2",
      "clause_number": "2.1",
      "risk_level": "high",
      "explanation": "This clause grants the landlord unchecked termination rights with no notice requirement, which is highly one-sided and offers the tenant no protection.",
      "recommendation": "Negotiate a minimum notice period (e.g., 30 days) and seek legal advice before signing.",
      "confidence": 0.95
    }
  ]
}
```

---

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `total_clauses` | int | Number of clauses analyzed |
| `results` | list | List of `ClauseRiskResult` objects |

### ClauseRiskResult Object

| Field | Type | Description |
|-------|------|-------------|
| `clause_id` | str | Echoed verbatim from input for deterministic mapping |
| `clause_number` | str \| null | Echoed verbatim from input |
| `risk_level` | `low` \| `medium` \| `high` | AI-assigned risk classification |
| `explanation` | str | 1–3 sentence plain-English risk explanation |
| `recommendation` | str | 1–2 sentence actionable advice before signing |
| `confidence` | float [0.0–1.0] | AI confidence score for the assigned risk level |

---

## Error Responses

### Empty Clause List (400 Bad Request)

```json
{
  "detail": "Clause list cannot be empty for clause risk analysis."
}
```

### AI Generation Failure (500 Internal Server Error)

```json
{
  "detail": "Clause risk analysis failed: Gemini API Error..."
}
```

---

# 5. Grounded Document Q&A

## Endpoint

```
POST /documents/ask
```

## Description

Answers user questions about a previously uploaded legal document based strictly on its preprocessed clause segments. Uses lightweight lexical relevance retrieval to select top relevant clauses before sending context to Gemini.

The backend automatically:
1. Retrieves the preprocessed `ClauseSegment` list from `DocumentContextStore` by `document_id`.
2. Runs `ClauseRetrievalService` (lexical overlap scoring with minimum relevance threshold `min_score = 0.6`) to rank and select relevant clauses.
3. **Early Termination**: If no clauses meet the minimum relevance threshold (`min_score = 0.6`) — such as when asking unrelated questions like *"What is the capital of France?"* — the service terminates early and returns `cannot_answer: true`, `confidence: 0.0`, and `source_clauses: []` **without invoking the AI provider or Gemini API**.
4. Otherwise formats relevant clauses into prompt payload and invokes `AIService` with `AITask.DOCUMENT_QA`.
5. Parses and validates the AI response against `DocumentQAResponse`.
6. Returns structured answer, source clause IDs, confidence score, and cannot_answer flag.


---

## Request

Content-Type

```
application/json
```

### Request Body Schema (`DocumentQARequest`)

```json
{
  "document_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "question": "What is the rent payment due date?"
}
```

### Parameters

|Field|Type|Required|Description|
|-----|----|--------|-----------|
|`document_id`|str|Yes|Generated document context identifier returned from `/documents/upload`|
|`question`|str|Yes|User question string (max 2000 characters)|

---

## Success Response (200 OK)

```json
{
  "answer": "According to clause_1, the tenant must pay monthly rent on or before the 5th of each calendar month.",
  "source_clauses": ["clause_1"],
  "confidence": 0.94,
  "cannot_answer": false
}
```

### Unanswerable Context Response (200 OK)

```json
{
  "answer": "The provided document does not contain relevant information to answer this question.",
  "source_clauses": [],
  "confidence": 0.0,
  "cannot_answer": true
}
```

---

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `answer` | str | Grounded plain-English answer or explanation if unanswerable |
| `source_clauses` | list[str] | List of `clause_id` strings used to construct the answer |
| `confidence` | float [0.0–1.0] | AI certainty score (0.0 if `cannot_answer` is true) |
| `cannot_answer` | bool | Flag indicating if the document lacked sufficient information |

---

## Error Responses

### Validation Error (422 Unprocessable Entity)

Returned when `document_id` or `question` is missing/empty, or `question` exceeds 2000 characters.

```json
{
  "detail": [
    {
      "loc": ["body", "question"],
      "msg": "String should have at least 1 character",
      "type": "string_type"
    }
  ]
}
```

### Document Not Found (404 Not Found)

```json
{
  "detail": "No document context found for document_id: unknown_doc_id"
}
```

### AI Generation Failure (500 Internal Server Error)

```json
{
  "detail": "Document Q&A failed: Gemini API Error..."
}
```

---

# Upcoming Endpoints

These APIs are planned and are **not yet implemented**.

|Method|Endpoint|Purpose|
|------|--------|-------|
|POST|/translate|Hindi/Marathi translation|

---

# Testing Status

Current backend test coverage:

- Health endpoint
- Upload endpoint
- Invalid file validation
- Empty file validation
- Corrupt PDF validation
- No-text PDF validation
- Text cleaning
- Clause segmentation
- PII masking
- AI Foundation Layer
- Response parsing
- Gemini provider integration
- Groq provider integration (missing keys, success, system prompt, 401/403, 429/503 retry, backoff, timeout, malformed)
- OpenRouter provider integration (missing keys, success, system prompt, 401/403, 429/503 retry, backoff, timeout, malformed)
- Provider Factory (`gemini`, `groq`, `openrouter`, override, invalid provider error)
- Document summarization prompt building
- Whole document summarization service
- Large document summarization (50+ clauses)
- Summarization router endpoint
- Clause risk analysis service & router
- Grounded document Q&A service & router (valid questions, missing doc, lexical retrieval, min_score threshold filtering, ranking, irrelevant question regression tests, zero AI calls on unrelated questions, grounded source clause IDs, cannot_answer response, 422/404/500 endpoint errors, large document retrieval)

Current Result

```
94 tests passed
```


---

# Technologies Used

|Component|Technology|
|----------|----------|
|Backend|FastAPI|
|Language|Python 3.11|
|PDF Parsing|PyMuPDF|
|Validation|Pydantic|
|Testing|Pytest|
|AI Providers|Groq, OpenRouter, Google Gemini|
|HTTP Client|httpx|
|Package Manager|uv|
|Containerization|Docker|
|Database|PostgreSQL (Upcoming Integration)|

---

# Project Status

|Sprint|Status|
|-------|------|
|Sprint 1 – Backend Architecture|Completed|
|Sprint 2 – PDF Upload & Extraction|Completed|
|Sprint 3 – Text Preprocessing|Completed|
|Sprint 4A – AI Foundation Layer|Completed|
|Sprint 4B – Gemini Integration|Completed|
|Sprint 5 – Whole Document Summarization|Completed|
|Sprint 6 – Clause Risk Analysis|Completed|
|Sprint 7 – Grounded Document Q&A|Completed|
|Sprint 8 – Multi-Provider AI Architecture (Groq + OpenRouter + Factory)|Completed|

---

# Clause Drafting

`POST /clauses/rewrite` drafts alternatives for 1–8 explicitly selected clauses and requires `ai_processing_consent` to be `true`. The drafting perspective is always customer/service-recipient. Only selected clause text is sent to the configured AI provider.

`POST /documents/proposed-pdf` accepts the original PDF as multipart upload plus the extracted clauses and user-approved revisions. It reproduces the original PDF pages unchanged and appends an addendum with original and proposed wording, preserving the source layout instead of rebuilding the contract from extracted text. The uploaded PDF is processed in memory and is not persisted by this endpoint.

The legacy `POST /documents/proposed-draft` endpoint still returns a reconstructed `.docx` for existing clients; it does not preserve the source PDF design. The frontend uses the PDF addendum endpoint.

# Batch Model-Improvement Contributions

`POST /adaptive-learning/feedback/submissions` accepts one consented batch containing analyzed clause text, current predicted risk labels, and confidence values. The backend applies PII masking and stores only those clause-level fields; it does not store the filename or original document. Submissions remain pending and are not treated as ground truth.

Administrators can load pending batches with `GET /adaptive-learning/feedback/submissions/pending` and, using the `X-Adaptive-Admin-Token` header, submit verified labels through `POST /adaptive-learning/feedback/submissions/{submission_id}/review`. Only explicitly annotated clauses become approved training rows. Training remains a separate periodic command and candidate checkpoints must still pass the configured held-out evaluation before promotion.
