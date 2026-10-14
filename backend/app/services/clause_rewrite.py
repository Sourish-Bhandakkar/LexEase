import json
import logging
import re
from io import BytesIO
from pathlib import Path
from re import sub
import textwrap
import unicodedata
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

import fitz

logger = logging.getLogger(__name__)

from app.ai.exceptions import AIResponseValidationError
from app.ai.provider_factory import get_ai_provider
from app.schemas.ai import AITask
from app.schemas.clause_rewrite import (
    ClauseRewriteAIItem,
    ClauseRewriteAIResponse,
    ClauseRewriteItem,
    ClauseRewriteRequest,
    ProposedDraftExportRequest,
)
from app.schemas.document import ClauseSegment
from app.services.ai import AIService


_UNREQUESTED_MATERIAL_TERMS = (
    ("arbitration or mediation", re.compile(r"\b(arbitrat\w*|mediat\w*|alternative dispute resolution|\badr\b)\b", re.IGNORECASE)),
    ("attorney-fee shifting", re.compile(r"\b(attorneys?' fees|lawyers?' fees|legal fees|prevailing party)\b", re.IGNORECASE)),
    ("venue or court forum", re.compile(r"\b(venue|forum|exclusive jurisdiction|jurisdiction of (?:the )?courts?|courts? of competent jurisdiction)\b", re.IGNORECASE)),
    ("governing law", re.compile(r"\b(governed by (?:the )?laws?|governing law)\b", re.IGNORECASE)),
    ("indemnity", re.compile(r"\bindemnif(?:y|ies|ied|ication|ications)\b", re.IGNORECASE)),
    ("waiver", re.compile(r"\b(waive|waiver|waived|waiving)\b", re.IGNORECASE)),
    ("termination for convenience", re.compile(r"\b(termination|terminate|terminating)\b.{0,80}\b(convenience|without cause|any reason)\b|\b(for convenience|without cause)\b.{0,80}\b(termination|terminate|cancel)\b", re.IGNORECASE)),
    ("refund or repayment obligation", re.compile(r"\b(refund\w*|reimburse\w*|repay\w*)\b", re.IGNORECASE)),
    ("transition or handover obligation", re.compile(r"\b(transition assistance|handover assistance|transfer (?:of )?(?:data|work product)|deliver (?:all )?(?:work product|data|documentation))\b", re.IGNORECASE)),
    ("survival obligation", re.compile(r"\b(surviv\w*|shall remain in effect after termination)\b", re.IGNORECASE)),
)


def _find_unrequested_material_terms(source_text: str, replacement_text: str, priorities: str | None = None) -> list[str]:
    source_and_priorities = f"{source_text}\n{priorities or ''}"
    violations = [
        label
        for label, pattern in _UNREQUESTED_MATERIAL_TERMS
        if pattern.search(replacement_text) and not pattern.search(source_and_priorities)
    ]
    # New lettered subclauses often hide several new rights or obligations in a rewrite.
    # Permit them only when the source already uses that structure.
    subsection_pattern = re.compile(r"(?:^|\n)\s*\([a-z]\)\s+", re.IGNORECASE)
    if len(subsection_pattern.findall(replacement_text)) > len(subsection_pattern.findall(source_text)):
        violations.append("new lettered subclauses")
    return violations


def _validate_structural_response(
    parsed: ClauseRewriteAIResponse,
    expected_ids: set[str],
    clause_by_id: dict[str, ClauseSegment],
) -> dict[str, ClauseRewriteAIItem]:
    by_id = {item.clause_id: item for item in parsed.rewrites}
    if len(by_id) != len(parsed.rewrites) or set(by_id) != expected_ids:
        raise AIResponseValidationError(
            "The AI response did not return exactly one rewrite for each selected clause."
        )
    for clause_id, rewrite in by_id.items():
        source = clause_by_id[clause_id]
        if rewrite.clause_number != source.clause_number:
            raise AIResponseValidationError(
                "The AI response changed a clause number; the revision was rejected."
            )
    return by_id


def _find_all_unrequested_terms(
    by_id: dict[str, ClauseRewriteAIItem],
    clause_by_id: dict[str, ClauseSegment],
    priorities: str | None = None,
) -> list[str]:
    all_unrequested: list[str] = []
    for clause_id, rewrite in by_id.items():
        source = clause_by_id[clause_id]
        terms = _find_unrequested_material_terms(source.text, rewrite.replacement_text, priorities)
        for term in terms:
            if term not in all_unrequested:
                all_unrequested.append(term)
    return all_unrequested


DRAFT_NOTICE = (
    "AI-assisted negotiation draft. This is not legal advice or a substitute for review by a qualified professional. "
    "The draft is reconstructed from extracted clause text; PDF formatting, tables, signatures, exhibits, and cross-references "
    "may be missing or altered. Compare it with the original before use."
)


class ClauseRewriteService:
    def __init__(self, ai_service: AIService | None = None):
        self.ai_service = ai_service or AIService(provider=get_ai_provider())

    async def propose_rewrites(self, request: ClauseRewriteRequest) -> list[ClauseRewriteItem]:
        clause_by_id = {clause.clause_id: clause for clause in request.clauses}
        selected = [clause_by_id[clause_id] for clause_id in request.selected_clause_ids]
        expected_ids = set(request.selected_clause_ids)
        payload = {
            "negotiation_goals": (request.negotiation_goals or "").strip(),
            "clauses_json": json.dumps(
                [clause.model_dump(mode="json") for clause in selected], ensure_ascii=False
            ),
        }

        # Attempt 1
        parsed = await self.ai_service.generate(
            AITask.CLAUSE_REWRITE, payload, ClauseRewriteAIResponse
        )
        by_id = _validate_structural_response(parsed, expected_ids, clause_by_id)
        unrequested_terms = _find_all_unrequested_terms(by_id, clause_by_id, request.negotiation_goals)

        # Successful first draft: return immediately with zero extra AI calls
        if not unrequested_terms:
            return [
                ClauseRewriteItem.model_validate(by_id[clause_id].model_dump())
                for clause_id in request.selected_clause_ids
            ]

        # Corrective retry: exactly one retry if and only if unrequested material terms were detected
        rejected_terms_str = ", ".join(unrequested_terms)
        retry_instruction = (
            f"The previous draft was rejected because it introduced unrequested material terms: {rejected_terms_str}. "
            f"Provide a narrower replacement based strictly and only on the original selected clauses. "
            f"Do not introduce or add {rejected_terms_str}, or any other new terms, rights, remedies, or obligations not present in the original clause text. "
            f"Preserve the original clause's scope and structure while improving protections for the customer/client."
        )
        retry_payload = {
            **payload,
            "retry_instruction": retry_instruction,
        }

        # Attempt 2 (corrective retry)
        parsed_retry = await self.ai_service.generate(
            AITask.CLAUSE_REWRITE, retry_payload, ClauseRewriteAIResponse
        )
        by_id_retry = _validate_structural_response(parsed_retry, expected_ids, clause_by_id)
        retry_unrequested = _find_all_unrequested_terms(by_id_retry, clause_by_id, request.negotiation_goals)

        if retry_unrequested:
            raise AIResponseValidationError(
                "The AI added major terms not present in the original clause: "
                + ", ".join(retry_unrequested)
                + ". The draft was rejected to preserve the original contract scope."
            )

        return [
            ClauseRewriteItem.model_validate(by_id_retry[clause_id].model_dump())
            for clause_id in request.selected_clause_ids
        ]


def build_proposed_draft_docx(request: ProposedDraftExportRequest) -> BytesIO:
    """Create a minimal valid Word document without persisting source contract text."""
    replacements = {item.clause_id: item for item in request.rewrites}
    body = [
        _paragraph("Proposed Contract Draft", bold=True, size=34),
        _paragraph("Prepared for: Customer / service recipient", bold=True),
        _paragraph(DRAFT_NOTICE),
        _paragraph("Only clauses marked PROPOSED REVISION have been changed. Other extracted clauses are reproduced as text."),
    ]

    for index, clause in enumerate(request.clauses, start=1):
        label = f"Clause {clause.clause_number}" if clause.clause_number else f"Clause {index}"
        rewrite = replacements.get(clause.clause_id)
        if rewrite:
            body.append(_paragraph(f"{label} — PROPOSED REVISION", bold=True, size=26))
            body.append(_paragraph(rewrite.replacement_text))
            body.append(_paragraph(f"Changes: {rewrite.changes_summary}"))
            body.append(_paragraph(f"Trade-off: {rewrite.client_tradeoff}"))
            body.append(_paragraph(f"Review note: {rewrite.review_note}"))
        else:
            body.append(_paragraph(label, bold=True, size=26))
            body.append(_paragraph(clause.text))

    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{"".join(body)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>'
        '</w:sectPr></w:body></w:document>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/document.xml", document_xml)
    output.seek(0)
    return output


def _normalize_text(text: str) -> str:
    return " ".join(re.findall(r"[a-zA-Z0-9]+", unicodedata.normalize("NFKD", str(text)).lower()))


def _map_font(font_name: str | None, flags: int = 0) -> str:
    fn = (font_name or "").lower()
    is_bold = "bold" in fn or (flags & 2 != 0)
    is_italic = "italic" in fn or "oblique" in fn or (flags & 1 != 0)
    if "times" in fn:
        if is_bold and is_italic:
            return "tibi"
        if is_bold:
            return "tibo"
        if is_italic:
            return "tiit"
        return "times"
    if "courier" in fn:
        if is_bold and is_italic:
            return "cobi"
        if is_bold:
            return "cobo"
        if is_italic:
            return "coit"
        return "couri"
    if is_bold:
        return "hebo"
    if is_italic:
        return "heit"
    return "helv"


def _build_proposed_draft_addendum_pdf(document: fitz.Document, request: ProposedDraftExportRequest) -> BytesIO:
    """Keep every source PDF page intact and append proposed wording as an addendum."""
    page_width = document[0].rect.width
    page_height = document[0].rect.height
    margin = 54
    content_width = page_width - 2 * margin
    addendum_page_numbers = []
    page = None
    y = 0.0

    def start_page():
        nonlocal page, y
        page = document.new_page(width=page_width, height=page_height)
        addendum_page_numbers.append(page.number)
        page.draw_line((margin, 45), (page_width - margin, 45), color=(0.09, 0.42, 0.30), width=1)
        page.insert_text((margin, 35), "PROPOSED CLAUSE ADDENDUM", fontname="helv", fontsize=9, color=(0.09, 0.42, 0.30))
        y = 70

    def safe_text(value: str) -> str:
        normalized = unicodedata.normalize("NFKD", str(value))
        normalized = normalized.replace("\u2018", "'").replace("\u2019", "'")
        normalized = normalized.replace("\u201c", '"').replace("\u201d", '"')
        normalized = normalized.replace("\u2013", "-").replace("\u2014", "-")
        return normalized.encode("ascii", "replace").decode("ascii")

    def add_paragraph(value: str, *, fontsize: float = 10, bold: bool = False, color=(0.12, 0.16, 0.14), gap: float = 7):
        nonlocal page, y
        fontname = "hebo" if bold else "helv"
        max_width = content_width
        paragraphs = safe_text(value).splitlines() or [""]
        line_height = fontsize * 1.42
        for paragraph in paragraphs:
            words = paragraph.split()
            lines = []
            line = ""
            for word in words:
                candidate = f"{line} {word}".strip()
                if line and fitz.get_text_length(candidate, fontname="helv", fontsize=fontsize) > max_width:
                    lines.append(line)
                    line = word
                else:
                    line = candidate
            if line or not lines:
                lines.append(line)
            for text_line in lines:
                if page is None or y + line_height > page_height - 55:
                    start_page()
                page.insert_text((margin, y + fontsize), text_line, fontname=fontname, fontsize=fontsize, color=color)
                y += line_height
            y += 2
        y += gap

    start_page()
    add_paragraph("Proposed clause addendum", fontsize=21, bold=True, color=(0.07, 0.22, 0.17), gap=10)
    add_paragraph("Prepared for: Customer / service recipient", fontsize=11, bold=True, gap=12)
    add_paragraph(
        "The original contract pages are reproduced unchanged before this addendum. This addendum contains suggested replacement wording only; it does not amend or replace the original contract unless all parties agree to adopt it. Compare each proposal with the source contract. This AI-assisted draft is not legal advice.",
        fontsize=9.5,
        color=(0.35, 0.30, 0.16),
        gap=16,
    )

    clauses_by_id = {clause.clause_id: clause for clause in request.clauses}
    for index, rewrite in enumerate(request.rewrites, start=1):
        clause = clauses_by_id[rewrite.clause_id]
        label = f"Clause {rewrite.clause_number}" if rewrite.clause_number else f"Clause {index}"
        add_paragraph(f"{label} - proposed replacement", fontsize=13, bold=True, color=(0.07, 0.30, 0.21), gap=4)
        add_paragraph("Original wording", fontsize=9, bold=True, color=(0.36, 0.41, 0.38), gap=2)
        add_paragraph(clause.text, fontsize=9.5, color=(0.30, 0.34, 0.32), gap=6)
        add_paragraph("Suggested wording", fontsize=9, bold=True, color=(0.07, 0.30, 0.21), gap=2)
        add_paragraph(rewrite.replacement_text, fontsize=10.5, color=(0.12, 0.16, 0.14), gap=6)
        add_paragraph(f"What changed: {rewrite.changes_summary}", fontsize=9, gap=3)
        add_paragraph(f"Trade-off: {rewrite.client_tradeoff}", fontsize=9, gap=3)
        if rewrite.review_note:
            add_paragraph(f"Drafting note: {rewrite.review_note}", fontsize=9, color=(0.42, 0.33, 0.12), gap=10)

    total_addendum_pages = len(addendum_page_numbers)
    for index, pno in enumerate(addendum_page_numbers, start=1):
        addendum_page = document[pno]
        addendum_page.insert_text((margin, page_height - 27), f"Addendum page {index} of {total_addendum_pages}", fontname="helv", fontsize=8, color=(0.40, 0.45, 0.42))

    output = BytesIO(document.tobytes(garbage=4, deflate=True))
    document.close()
    output.seek(0)
    return output


def _try_in_place_replacement(
    source_pdf: bytes, request: ProposedDraftExportRequest
) -> tuple[bool, BytesIO | None, str]:
    """Attempt in-place replacement while preserving original design, unselected clauses, and pages.

    Returns (True, BytesIO, note) if successfully reflowed within design bounds,
    or (False, None, reason) if text overflows or cannot be safely placed in-place.
    """
    if not request.rewrites:
        return False, None, "No replacements requested."

    try:
        doc = fitz.open(stream=source_pdf, filetype="pdf")
    except Exception as exc:
        return False, None, f"Could not parse PDF: {exc}"

    if not doc.page_count:
        doc.close()
        return False, None, "Document has no pages."

    clauses_by_id = {c.clause_id: c for c in request.clauses}
    replacements_by_id = {rw.clause_id: rw for rw in request.rewrites}
    replacement_bodies = {
        clause_id: _strip_repeated_clause_heading(rewrite.replacement_text, rewrite.clause_number)
        for clause_id, rewrite in replacements_by_id.items()
    }
    for cid, body in replacement_bodies.items():
        if not body or not body.strip():
            doc.close()
            return False, None, f"Replacement for clause {cid} is empty after heading normalization."


    page_block_replacements: dict[int, dict[int, ClauseRewriteItem]] = {}
    pages_to_modify: set[int] = set()

    page_content_blocks: dict[int, list[dict]] = {}
    for pno in range(doc.page_count):
        p = doc[pno]
        p_h = p.rect.height
        c_blocks = [b for b in p.get_text("dict")["blocks"] if b.get("type") == 0 and b["bbox"][1] < p_h - 60]
        c_blocks.sort(key=lambda b: b["bbox"][1])
        page_content_blocks[pno] = c_blocks

    for cid, rw in replacements_by_id.items():
        clause = clauses_by_id.get(cid)
        if not clause or not clause.text:
            doc.close()
            return False, None, f"Clause {cid} text is empty or missing."

        lines = [l.strip() for l in clause.text.splitlines() if l.strip()]
        body_text = " ".join(lines[1:]) if len(lines) > 1 else clause.text
        body_words = re.findall(r"[a-zA-Z0-9]+", body_text.lower())
        q_primary = " ".join(body_words[:6])
        q_secondary = " ".join(body_words[:3]) if len(body_words) >= 3 else ""
        c_full = _normalize_text(clause.text)

        matched_pno = None
        matched_bi = None

        # Pass 1: Match substantive body words
        if q_primary:
            for pno in range(doc.page_count):
                c_blocks = page_content_blocks[pno]
                for bi, b in enumerate(c_blocks):
                    lines_b = b.get("lines", [])
                    b_raw = " ".join("".join(s["text"] for s in l.get("spans", [])) for l in lines_b)
                    b_norm = _normalize_text(b_raw)
                    if q_primary in b_norm:
                        matched_pno = pno
                        matched_bi = bi
                        break
                if matched_pno is not None:
                    break

        # Pass 2: Secondary / overlap match if primary was not found
        if matched_pno is None:
            for pno in range(doc.page_count):
                c_blocks = page_content_blocks[pno]
                for bi, b in enumerate(c_blocks):
                    lines_b = b.get("lines", [])
                    b_raw = " ".join("".join(s["text"] for s in l.get("spans", [])) for l in lines_b)
                    b_norm = _normalize_text(b_raw)
                    if not b_norm:
                        continue
                    if q_secondary and q_secondary in b_norm and len(b_norm) >= 20:
                        matched_pno = pno
                        matched_bi = bi
                        break
                    if len(b_norm) >= 40 and b_norm in c_full:
                        matched_pno = pno
                        matched_bi = bi
                        break
                if matched_pno is not None:
                    break

        if matched_pno is None:
            doc.close()
            return False, None, f"Could not reliably locate clause {rw.clause_number or cid} in selectable text."

        if matched_pno not in page_block_replacements:
            page_block_replacements[matched_pno] = {}
        page_block_replacements[matched_pno][matched_bi] = rw
        pages_to_modify.add(matched_pno)

    page_layout_info: dict[int, dict] = {}

    for pno in pages_to_modify:
        page = doc[pno]
        p_w = page.rect.width
        p_h = page.rect.height

        dict_blocks = [b for b in page.get_text("dict")["blocks"] if b.get("type") == 0]
        footer_blocks = [b for b in dict_blocks if b["bbox"][1] >= p_h - 60]
        footer_y = min(b["bbox"][1] for b in footer_blocks) - 15 if footer_blocks else p_h - 54

        content_blocks = page_content_blocks[pno]
        replacements_on_page = page_block_replacements[pno]
        first_mod_idx = min(replacements_on_page.keys())

        margin_x = content_blocks[0]["bbox"][0]
        content_w = p_w - 2 * margin_x
        start_y = content_blocks[first_mod_idx]["bbox"][1]

        sim_y = start_y
        for bi in range(first_mod_idx, len(content_blocks)):
            b = content_blocks[bi]
            lines = b.get("lines", [])
            first_span = lines[0]["spans"][0] if (lines and lines[0].get("spans")) else None
            f_font = _map_font(first_span["font"] if first_span else "Helvetica", first_span.get("flags", 0) if first_span else 0)

            if bi in replacements_on_page:
                rw = replacements_on_page[bi]
                replacement_body = replacement_bodies[rw.clause_id]
                needed_lines = max(1.0, len(replacement_body) / 75.0)
                needed_h = max(35.0, needed_lines * 13.0 + 8.0)
                sim_y += needed_h + 10.0
            else:
                orig_h = b["bbox"][3] - b["bbox"][1]
                sim_y += orig_h + (6.0 if f_font == "hebo" else 10.0)

        if sim_y > footer_y:
            doc.close()
            return (
                False,
                None,
                f"Proposed replacement text exceeds page layout bounds on page {pno + 1} (needs {sim_y:.1f} pt, page capacity is {footer_y:.1f} pt).",
            )

        page_layout_info[pno] = {
            "content_blocks": content_blocks,
            "first_mod_idx": first_mod_idx,
            "margin_x": margin_x,
            "content_w": content_w,
            "start_y": start_y,
            "footer_y": footer_y,
            "p_w": p_w,
            "replacements_on_page": replacements_on_page,
        }

    for pno in pages_to_modify:
        page = doc[pno]
        info = page_layout_info[pno]
        content_blocks = info["content_blocks"]
        first_mod_idx = info["first_mod_idx"]
        margin_x = info["margin_x"]
        content_w = info["content_w"]
        start_y = info["start_y"]
        footer_y = info["footer_y"]
        p_w = info["p_w"]
        replacements_on_page = info["replacements_on_page"]

        redact_rect = fitz.Rect(margin_x - 10, start_y - 2, p_w - margin_x + 10, footer_y + 10)
        # Redaction removes more than text. If it would touch artwork or
        # interactive elements, preserve the source page and use the addendum.
        for image in page.get_images(full=True):
            for image_rect in page.get_image_rects(image[0]):
                if redact_rect.intersects(image_rect):
                    doc.close()
                    return False, None, f"In-place edit would cover an image on page {pno + 1}."
        if any(redact_rect.intersects(drawing["rect"]) for drawing in page.get_drawings()):
            doc.close()
            return False, None, f"In-place edit would cover page artwork on page {pno + 1}."
        if any(redact_rect.intersects(link.get("from", fitz.Rect())) for link in page.get_links()):
            doc.close()
            return False, None, f"In-place edit would cover a link on page {pno + 1}."
        annotation = page.first_annot
        while annotation:
            if redact_rect.intersects(annotation.rect):
                doc.close()
                return False, None, f"In-place edit would cover an annotation on page {pno + 1}."
            annotation = annotation.next

        page.add_redact_annot(redact_rect, fill=(1, 1, 1))
        page.apply_redactions()

        y = start_y
        for bi in range(first_mod_idx, len(content_blocks)):
            b = content_blocks[bi]
            lines = b.get("lines", [])
            first_span = lines[0]["spans"][0] if (lines and lines[0].get("spans")) else None
            f_size = first_span["size"] if first_span else 9.5
            f_font = _map_font(first_span["font"] if first_span else "Helvetica", first_span.get("flags", 0) if first_span else 0)

            if bi in replacements_on_page:
                rw = replacements_on_page[bi]
                rect = fitz.Rect(margin_x, y, margin_x + content_w, footer_y)
                color = (0.07, 0.30, 0.20)  # Forest green indicates proposed wording
                body_to_insert = replacement_bodies[rw.clause_id].strip()
                if not body_to_insert:
                    doc.close()
                    return False, None, f"Replacement text for clause {rw.clause_id} is empty."
                rc = page.insert_textbox(rect, body_to_insert, fontname="helv", fontsize=9.5, color=color)
                if rc < 0:
                    doc.close()
                    return False, None, f"Replacement text could not be safely reflowed on page {pno + 1}."
                used_h = rect.height - rc
                if used_h < 6.0:
                    doc.close()
                    return False, None, f"Replacement text for clause {rw.clause_id} rendered with negligible height."
                page.draw_line((margin_x - 6, y + 2), (margin_x - 6, y + used_h - 2), color=(0.09, 0.42, 0.30), width=2)
                y += used_h + 10.0
            else:
                b_text = " ".join("".join(s["text"] for s in l.get("spans", [])) for l in lines)
                rect = fitz.Rect(margin_x, y, margin_x + content_w, footer_y)
                rc = page.insert_textbox(rect, b_text.strip(), fontname=f_font, fontsize=f_size, color=(0, 0, 0))
                if rc < 0:
                    doc.close()
                    return False, None, f"Existing page text could not be safely reflowed on page {pno + 1}."
                used_h = rect.height - rc
                y += used_h + (6.0 if f_font == "hebo" else 10.0)

    output = BytesIO(doc.tobytes(garbage=4, deflate=True))
    doc.close()
    output.seek(0)
    return True, output, "In-place replacement succeeded"


def _strip_repeated_clause_heading(text: str, clause_number: str | None) -> str:
    """Keep the PDF's original heading when the model repeats it in its rewrite.

    Preserves the replacement body when heading and body appear on the same line,
    and guarantees the returned text is never empty if the replacement had content.
    """
    compatible = _pdf_compatible_text(text)
    if not clause_number:
        return compatible.strip()

    lines = compatible.splitlines()
    first_index = next((i for i, line in enumerate(lines) if line.strip()), None)
    if first_index is None:
        return compatible.strip()

    first_line = lines[first_index]
    number = re.escape(str(clause_number).strip())
    # Match heading prefixes like "18.", "Clause 18:", "Clause 18 -", "18 ", etc.
    prefix_match = re.match(
        rf"^\s*(?:clause\s+)?{number}(?:[.)\-:]|\s+)\s*(.*)$",
        first_line,
        re.IGNORECASE,
    )
    if not prefix_match:
        return compatible.strip()

    rest = prefix_match.group(1).strip()
    has_subsequent_content = any(line.strip() for line in lines[first_index + 1 :])

    # Check for an inline heading separator (e.g. "Termination at Discretion: Either party...")
    # Delimiters: colon, dash/em-dash, multiple spaces, or period followed by space
    sep_match = re.match(
        r"^(?:[A-Za-z0-9\s,'\"/()&–—\-]+?)(?::|\s+[-—–]\s+|\s{2,}|\.\s+)(.+)$",
        rest,
    )

    if sep_match:
        # Heading title and body are on the same line; keep the body portion
        body_part = sep_match.group(1).strip()
        lines[first_index] = body_part
    elif not has_subsequent_content:
        # Heading and body are on a single line without a distinct delimiter
        # e.g. "18. Either party may terminate this agreement upon 30 days notice"
        # Keep the rest of the line (or original line if rest is empty)
        lines[first_index] = rest if rest else first_line
    else:
        # First line is a standalone heading line (e.g. "18. Termination at Provider's Discretion")
        # and subsequent lines contain the body.
        # If rest is short / looks like a title, delete this standalone heading line.
        if len(rest.split()) <= 10 and not rest.endswith((",", ";")):
            del lines[first_index]
        else:
            lines[first_index] = rest

    result = "\n".join(lines).strip()
    if not result:
        # Safety fallback: never allow stripping to return an empty string
        result = rest if rest else compatible.strip()

    return result


def _pdf_compatible_text(value: str) -> str:
    """Normalize common Unicode punctuation unsupported by the built-in PDF font."""
    punctuation = str.maketrans({
        "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'",
        "\u201c": '"', "\u201d": '"', "\u201e": '"', "\u201f": '"',
        "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-",
        "\u2014": "-", "\u2212": "-", "\u00a0": " ", "\u2026": "...",
    })
    normalized = unicodedata.normalize("NFKD", str(value)).translate(punctuation)
    return normalized.encode("ascii", "replace").decode("ascii")


def _verify_replacements_in_pdf(
    pdf_stream: BytesIO, request: ProposedDraftExportRequest
) -> tuple[bool, str]:
    """Verify that every selected replacement appears in the exported PDF text.

    Extracts text from all pages and checks for distinctive substantive words
    from each replacement.
    """
    try:
        current_pos = pdf_stream.tell()
        pdf_stream.seek(0)
        doc = fitz.open(stream=pdf_stream.getvalue(), filetype="pdf")
        full_text = " ".join(page.get_text() for page in doc)
        doc.close()
        pdf_stream.seek(current_pos)
    except Exception as exc:
        return False, f"Could not inspect generated PDF text: {exc}"

    norm_full_text = _normalize_text(full_text)
    if not norm_full_text:
        return False, "Generated PDF text is empty."

    for rw in request.rewrites:
        text = rw.replacement_text
        words = re.findall(r"[a-zA-Z0-9]+", _normalize_text(text))
        if not words:
            continue
        key_words = [w for w in words if len(w) > 2]
        if not key_words:
            key_words = words

        found_count = sum(1 for w in key_words if w in norm_full_text)
        ratio = found_count / len(key_words)
        if ratio < 0.65:
            cid = rw.clause_number or rw.clause_id
            return (
                False,
                f"Clause {cid} replacement text was not found in the generated PDF ({found_count}/{len(key_words)} words matched).",
            )

    return True, "All replacements verified in PDF"


def build_proposed_draft_pdf(
    source_pdf: bytes,
    request: ProposedDraftExportRequest,
    return_mode: bool = False,
) -> BytesIO | tuple[BytesIO, str, str]:
    """Generates a separate proposed draft PDF.

    Places revisions in-place where clauses appear if layout allows,
    or falls back safely to appending an addendum if text overflows
    or if in-place reflow cannot preserve the replacement wording.
    """
    try:
        document = fitz.open(stream=source_pdf, filetype="pdf")
    except (fitz.FileDataError, ValueError) as exc:
        raise ValueError("The uploaded source file is not a readable PDF.") from exc
    if document.needs_pass:
        document.close()
        raise ValueError("Password-protected PDFs cannot be used for proposed-draft export.")
    if not document.page_count:
        document.close()
        raise ValueError("The uploaded PDF has no pages.")
    document.close()

    # Pre-export validation: every selected clause must have non-empty replacement text
    for rw in request.rewrites:
        if not rw.replacement_text or not rw.replacement_text.strip():
            raise ValueError(f"Selected clause {rw.clause_number or rw.clause_id} has empty replacement text.")
        norm_rep = _pdf_compatible_text(rw.replacement_text).strip()
        if not norm_rep:
            raise ValueError(
                f"Selected clause {rw.clause_number or rw.clause_id} replacement text is empty after normalization."
            )

    ok, in_place_output, note = _try_in_place_replacement(source_pdf, request)
    export_mode = "addendum"
    output = None

    if ok and in_place_output is not None:
        verified, v_note = _verify_replacements_in_pdf(in_place_output, request)
        if verified:
            export_mode = "in_place"
            output = in_place_output
        else:
            logger.warning(
                "In-place PDF replacement failed text verification: %s. Falling back to addendum.",
                v_note,
            )
            note = f"In-place text verification failed ({v_note}); fell back to addendum."

    if output is None:
        doc = fitz.open(stream=source_pdf, filetype="pdf")
        output = _build_proposed_draft_addendum_pdf(doc, request)
        export_mode = "addendum"

    # Post-generation verification: ensure output contains all selected replacements
    verified, v_note = _verify_replacements_in_pdf(output, request)
    if not verified:
        raise ValueError(f"Generated proposed draft PDF is missing replacement wording: {v_note}")

    output.seek(0)
    if return_mode:
        return output, export_mode, note
    return output


def _paragraph(text: str, *, bold: bool = False, size: int = 22) -> str:
    run_properties = f"<w:rPr>{'<w:b/>' if bold else ''}<w:sz w:val=\"{size}\"/></w:rPr>"
    pieces = str(text).splitlines() or [""]
    runs = []
    for line_index, line in enumerate(pieces):
        if line_index:
            runs.append("<w:r><w:br/></w:r>")
        runs.append(
            f'<w:r>{run_properties}<w:t xml:space="preserve">{escape(line)}</w:t></w:r>'
        )
    return f"<w:p>{''.join(runs)}</w:p>"


def proposed_draft_filename(source_filename: str | None) -> str:
    stem = Path(source_filename or "contract").stem
    safe_stem = sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")[:60] or "contract"
    return f"{safe_stem}_proposed_draft.docx"


def proposed_pdf_filename(source_filename: str | None) -> str:
    stem = Path(source_filename or "contract").stem
    safe_stem = sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_")[:60] or "contract"
    return f"{safe_stem}_proposed_draft.pdf"
