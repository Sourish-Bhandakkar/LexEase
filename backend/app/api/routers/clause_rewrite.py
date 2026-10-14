from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.ai.exceptions import AIProviderError, AIResponseValidationError
from app.schemas.clause_rewrite import (
    ClauseRewriteRequest,
    ClauseRewriteResponse,
    ProposedDraftExportRequest,
)
from app.services.clause_rewrite import (
    DRAFT_NOTICE,
    ClauseRewriteService,
    build_proposed_draft_docx,
    build_proposed_draft_pdf,
    proposed_draft_filename,
    proposed_pdf_filename,
)

router = APIRouter(tags=["Proposed Drafting"])


@router.post("/clauses/rewrite", response_model=ClauseRewriteResponse)
async def rewrite_selected_clauses(request: ClauseRewriteRequest):
    """Draft alternatives for explicitly selected clauses after user consent."""
    try:
        rewrites = await ClauseRewriteService().propose_rewrites(request)
    except AIProviderError as exc:
        detail_msg = f"The AI provider could not draft alternatives: {exc}" if str(exc) else "The AI provider could not draft alternatives."
        raise HTTPException(status_code=502, detail=detail_msg) from exc
    except AIResponseValidationError as exc:
        raise HTTPException(status_code=502, detail=f"The AI draft response was incomplete or invalid: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Drafting alternatives failed: {exc}") from exc
    return ClauseRewriteResponse(rewrites=rewrites, draft_notice=DRAFT_NOTICE)


@router.post("/documents/proposed-draft")
async def download_proposed_draft(request: ProposedDraftExportRequest):
    """Return a separate reconstructed DOCX containing only user-approved replacements."""
    output = build_proposed_draft_docx(request)
    filename = proposed_draft_filename(request.source_filename)
    return StreamingResponse(
        output,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/documents/proposed-pdf")
async def download_proposed_pdf(
    file: UploadFile = File(...),
    request_json: str = Form(...),
):
    """Generate proposed PDF draft: in-place where layout allows, with addendum fallback."""
    if file.content_type not in {"application/pdf", "application/octet-stream"} and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Upload the original PDF to preserve its layout.")
    source_pdf = await file.read(25 * 1024 * 1024 + 1)
    if len(source_pdf) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="The PDF must be 25 MB or smaller for proposed draft export.")
    try:
        request = ProposedDraftExportRequest.model_validate_json(request_json)
        output, mode, note = build_proposed_draft_pdf(source_pdf, request, return_mode=True)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    filename = proposed_pdf_filename(file.filename)
    return StreamingResponse(
        output,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Mode": mode,
        },
    )
