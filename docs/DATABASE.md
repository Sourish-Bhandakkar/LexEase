# LexEase Database Documentation

## Adaptive Learning Tables

`clause_feedback` stores a single consented, PII-masked clause per submission, the original and corrected risk labels, and its pending/approved/rejected review state. It does not store a document ID or full uploaded contract. Only rows that are both approved and consented are eligible for export.

`adaptive_model_versions` stores each explicit training cycle, its parent version, checkpoint location, measured baseline/candidate metrics, acceptance checks, and final state. The active model pointer is a local ignored file and changes only when the candidate passes the configured gates.

## Sprint 8 Status

> [!NOTE]
> **No database changes were introduced in Sprint 8.**
> The Multi-Provider AI architecture (`GroqProvider`, `OpenRouterProvider`, `ProviderFactory`) interacts statelessly with external AI APIs using transient HTTP requests. No changes to database schemas, migrations, or models were required.

---

## Sprint 7 Status

> [!NOTE]
> **Temporary In-Memory Storage (`DocumentContextStore`)**
> Sprint 7 introduces server-side document context storage for preprocessed, PII-masked `ClauseSegment` lists, indexed by `document_id`.
> Currently implemented using an ephemeral in-memory dictionary (`app/database/document_context_store.py`).
> 
> **Sprint 9 Migration Plan:**
> In Sprint 9, PostgreSQL database persistence (using SQLAlchemy / Alembic) will replace the internal dictionary storage without changing the public `DocumentContextStore` interface (`store`, `get`, `delete`) or API contracts.

---

## Sprint 6 Status


> [!NOTE]
> **No database changes were introduced in Sprint 6.**
> The clause risk analysis service (`POST /clauses/analyze`) operates statelessly in-memory on the provided `ClauseSegment` payloads and AI Foundation Layer responses. No persistence layer is required.

---

## Sprint 5 Status

> [!NOTE]
> **No database changes were introduced in Sprint 5.**
> The whole document summarization service (`POST /documents/summarize`) operates statelessly in-memory on the provided `ClauseSegment` payloads and AI Foundation Layer responses.

---

## Planned Database Schema (Upcoming Integration)

Future sprints will introduce PostgreSQL database persistence for user sessions, document history, and saved risk analyses using SQLAlchemy / Alembic migrations.
