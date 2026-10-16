import asyncio
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree

import pytest
import fitz
from pydantic import ValidationError

from app.ai.exceptions import AIProviderError, AIResponseValidationError
from app.ai.prompt_builder import PromptBuilder
from app.schemas.ai import AITask
from app.schemas.clause_rewrite import (
    ClauseRewriteAIResponse,
    ClauseRewriteItem,
    ClauseRewriteRequest,
    ProposedDraftExportRequest,
)
from app.schemas.document import ClauseSegment
from app.services.clause_rewrite import (
    ClauseRewriteService,
    _find_unrequested_material_terms,
    _strip_repeated_clause_heading,
    build_proposed_draft_docx,
    build_proposed_draft_pdf,
    proposed_draft_filename,
)


def test_in_place_replacement_strips_repeated_heading_and_normalizes_punctuation():
    replacement = "7. Liability\n(a) Provider’s total liability is limited to the fees paid."
    assert _strip_repeated_clause_heading(replacement, "7") == (
        "(a) Provider's total liability is limited to the fees paid."
    )


def _clause(clause_id: str, text: str = "Original clause text") -> ClauseSegment:
    return ClauseSegment(clause_id=clause_id, clause_number=clause_id, text=text)


def test_rewrite_request_requires_explicit_consent_and_valid_selection():
    base = {
        "clauses": [_clause("1")],
        "selected_clause_ids": ["1"],
    }
    with pytest.raises(ValidationError):
        ClauseRewriteRequest(**base, ai_processing_consent=False)

    request = ClauseRewriteRequest(**base, ai_processing_consent=True)
    assert request.selected_clause_ids == ["1"]

    with pytest.raises(ValidationError):
        ClauseRewriteRequest(
            **{**base, "selected_clause_ids": ["missing"]},
            ai_processing_consent=True,
        )


def test_rewrite_prompt_uses_customer_view_and_only_selected_clause_data():
    prompt = PromptBuilder.build_prompt(
        AITask.CLAUSE_REWRITE,
        {
            "clauses_json": '[{"clause_id":"1","text":"selected"}]',
        },
    )
    assert "customer/client/service recipient" in prompt
    assert '"text":"selected"' in prompt
    assert "untrusted source material" in prompt
    assert "more protective of the customer/client" in prompt
    assert "strictly preserving the clause's original core commercial purpose, scope, and structure" in prompt
    assert "refunds, repayment obligations, survival clauses" in prompt
    assert "termination rights" in prompt.lower()
    assert '"estimated_customer_risk"' in prompt
    assert "negotiation priorities" not in prompt.lower()
    assert "{{negotiation_goals}}" not in prompt


def test_rewrite_prompt_includes_corrective_retry_instruction_when_provided():
    prompt = PromptBuilder.build_prompt(
        AITask.CLAUSE_REWRITE,
        {
            "clauses_json": '[{"clause_id":"1","text":"selected"}]',
            "retry_instruction": "The previous draft was rejected because it introduced unrequested material terms: refund or repayment obligation.",
        },
    )
    assert "CRITICAL RETRY INSTRUCTION (PREVIOUS DRAFT REJECTED):" in prompt
    assert "refund or repayment obligation" in prompt


class _FakeAIService:
    async def generate(self, task_type, payload, response_schema):
        assert task_type == AITask.CLAUSE_REWRITE
        assert "not selected" not in payload["clauses_json"]
        return response_schema.model_validate(
            {
                "rewrites": [
                    {
                        "clause_id": "1",
                        "clause_number": "1",
                        "replacement_text": "Proposed replacement",
                        "changes_summary": "Adds a cap",
                        "client_tradeoff": "May require negotiation",
                        "review_note": "Check defined terms",
                        "estimated_customer_risk": "MEDIUM",
                        "risk_estimate_note": "Payment timing remains uncertain.",
                    }
                ]
            }
        )


class _RetryRecordingAIService:
    def __init__(self, responses: list[dict | Exception]):
        self.responses = list(responses)
        self.call_count = 0
        self.captured_payloads = []

    async def generate(self, task_type, payload, response_schema):
        assert task_type == AITask.CLAUSE_REWRITE
        self.captured_payloads.append(payload)
        resp = self.responses[self.call_count]
        self.call_count += 1
        if isinstance(resp, Exception):
            raise resp
        return response_schema.model_validate(resp)


def test_service_sends_only_selected_clauses_and_validates_exact_ids():
    async def run():
        request = ClauseRewriteRequest(
            clauses=[_clause("1", "selected text"), _clause("2", "not selected")],
            selected_clause_ids=["1"],
            ai_processing_consent=True,
        )
        return await ClauseRewriteService(_FakeAIService()).propose_rewrites(request)

    result = asyncio.run(run())
    assert [item.clause_id for item in result] == ["1"]


def test_corrective_retry_accepted_after_first_response_rejected():
    first_resp = {
        "rewrites": [
            {
                "clause_id": "1",
                "clause_number": "1",
                "replacement_text": "Provider will deliver services. In addition, Provider shall refund prepaid fees upon dispute.",
                "changes_summary": "Adds refund right",
                "client_tradeoff": "Provider pushback",
                "review_note": "Check accounting",
                "estimated_customer_risk": "LOW",
                "risk_estimate_note": "Favorable to customer.",
            }
        ]
    }
    second_resp = {
        "rewrites": [
            {
                "clause_id": "1",
                "clause_number": "1",
                "replacement_text": "Provider will deliver services with commercially reasonable diligence.",
                "changes_summary": "Standardizes standard of care",
                "client_tradeoff": "Narrower remedy",
                "review_note": "Review service level agreements",
                "estimated_customer_risk": "LOW",
                "risk_estimate_note": "Maintains original scope without new remedies.",
            }
        ]
    }
    ai_service = _RetryRecordingAIService([first_resp, second_resp])
    service = ClauseRewriteService(ai_service)
    request = ClauseRewriteRequest(
        clauses=[_clause("1", "Provider will deliver services.")],
        selected_clause_ids=["1"],
        ai_processing_consent=True,
    )

    result = asyncio.run(service.propose_rewrites(request))

    assert ai_service.call_count == 2
    assert "retry_instruction" not in ai_service.captured_payloads[0]
    assert "retry_instruction" in ai_service.captured_payloads[1]
    assert "refund or repayment obligation" in ai_service.captured_payloads[1]["retry_instruction"]
    assert result[0].replacement_text == "Provider will deliver services with commercially reasonable diligence."


def test_second_rejected_response_remains_blocked():
    first_resp = {
        "rewrites": [
            {
                "clause_id": "1",
                "clause_number": "1",
                "replacement_text": "Customer may terminate for convenience on 30 days notice.",
                "changes_summary": "Adds termination for convenience",
                "client_tradeoff": "Notice period required",
                "review_note": "Check transition",
                "estimated_customer_risk": "LOW",
                "risk_estimate_note": "Provides customer exit right.",
            }
        ]
    }
    second_resp = {
        "rewrites": [
            {
                "clause_id": "1",
                "clause_number": "1",
                "replacement_text": "Confidentiality obligations shall survive termination indefinitely.",
                "changes_summary": "Adds survival clause",
                "client_tradeoff": "Longer exposure",
                "review_note": "Check trade secrets",
                "estimated_customer_risk": "MEDIUM",
                "risk_estimate_note": "Perpetual survival.",
            }
        ]
    }
    ai_service = _RetryRecordingAIService([first_resp, second_resp])
    service = ClauseRewriteService(ai_service)
    request = ClauseRewriteRequest(
        clauses=[_clause("1", "Each party will keep the other party's data confidential.")],
        selected_clause_ids=["1"],
        ai_processing_consent=True,
    )

    with pytest.raises(AIResponseValidationError) as exc_info:
        asyncio.run(service.propose_rewrites(request))

    assert ai_service.call_count == 2
    err_msg = str(exc_info.value)
    assert "survival obligation" in err_msg
    assert "The draft was rejected to preserve the original contract scope." in err_msg
    assert "or your priorities" not in err_msg


def test_no_retry_for_structural_or_unrelated_validation_error():
    # Model alters the clause number
    bad_structure_resp = {
        "rewrites": [
            {
                "clause_id": "1",
                "clause_number": "99",
                "replacement_text": "Provider will deliver services.",
                "changes_summary": "Changed number",
                "client_tradeoff": "None",
                "review_note": "None",
                "estimated_customer_risk": "LOW",
                "risk_estimate_note": "None",
            }
        ]
    }
    ai_service = _RetryRecordingAIService([bad_structure_resp])
    service = ClauseRewriteService(ai_service)
    request = ClauseRewriteRequest(
        clauses=[_clause("1", "Provider will deliver services.")],
        selected_clause_ids=["1"],
        ai_processing_consent=True,
    )

    with pytest.raises(AIResponseValidationError) as exc_info:
        asyncio.run(service.propose_rewrites(request))

    assert ai_service.call_count == 1
    assert "changed a clause number" in str(exc_info.value)


def test_no_retry_for_provider_errors():
    ai_service = _RetryRecordingAIService([AIProviderError("Groq upstream timeout")])
    service = ClauseRewriteService(ai_service)
    request = ClauseRewriteRequest(
        clauses=[_clause("1", "Provider will deliver services.")],
        selected_clause_ids=["1"],
        ai_processing_consent=True,
    )

    with pytest.raises(AIProviderError) as exc_info:
        asyncio.run(service.propose_rewrites(request))

    assert ai_service.call_count == 1
    assert "Groq upstream timeout" in str(exc_info.value)


def test_successful_draft_makes_no_retry():
    clean_resp = {
        "rewrites": [
            {
                "clause_id": "1",
                "clause_number": "1",
                "replacement_text": "Provider will deliver services in a professional manner.",
                "changes_summary": "Professional standard",
                "client_tradeoff": "None",
                "review_note": "Standard wording",
                "estimated_customer_risk": "LOW",
                "risk_estimate_note": "Safe revision",
            }
        ]
    }
    ai_service = _RetryRecordingAIService([clean_resp])
    service = ClauseRewriteService(ai_service)
    request = ClauseRewriteRequest(
        clauses=[_clause("1", "Provider will deliver services.")],
        selected_clause_ids=["1"],
        ai_processing_consent=True,
    )

    result = asyncio.run(service.propose_rewrites(request))

    assert ai_service.call_count == 1
    assert "retry_instruction" not in ai_service.captured_payloads[0]
    assert len(result) == 1


def test_rewrite_guard_detects_unrequested_arbitration_and_allows_requested_term():
    source = "Governing law is California. Parties will first discuss disputes in good faith."
    replacement = "Disputes must be resolved by binding arbitration in California."
    assert _find_unrequested_material_terms(source, replacement, None) == ["arbitration or mediation"]
    assert _find_unrequested_material_terms(source, replacement, "Use binding arbitration") == []


def test_rewrite_guard_rejects_new_termination_refund_transition_and_subclauses():
    source = "Provider may suspend services if an invoice remains unpaid."
    replacement = (
        "(a) Customer may terminate this Agreement for convenience. (b) Provider shall refund prepaid fees. "
        "(c) Provider shall provide transition assistance. (d) Confidentiality shall survive termination."
    )
    assert _find_unrequested_material_terms(source, replacement, None) == [
        "termination for convenience",
        "refund or repayment obligation",
        "transition or handover obligation",
        "survival obligation",
        "new lettered subclauses",
    ]
    expanded = "(a) The Provider will provide services.\n(b) Customer may terminate for convenience."
    assert _find_unrequested_material_terms("(a) Provider will provide services.", expanded, None) == [
        "termination for convenience",
        "new lettered subclauses",
    ]


def test_ai_rewrite_schema_requires_risk_estimate():
    with pytest.raises(ValidationError):
        ClauseRewriteAIResponse.model_validate({
            "rewrites": [{
                "clause_id": "1",
                "clause_number": "1",
                "replacement_text": "Replacement",
                "changes_summary": "Narrower wording",
                "client_tradeoff": "Could limit recovery",
                "review_note": "Check defined terms",
            }]
        })


def test_proposed_docx_is_valid_zip_and_preserves_unselected_clause_text():
    request = ProposedDraftExportRequest(
        clauses=[_clause("1", "Original one"), _clause("2", "Original two")],
        rewrites=[
            ClauseRewriteItem(
                clause_id="1",
                clause_number="1",
                replacement_text="Replacement one",
                changes_summary="Balances the obligation",
                client_tradeoff="Negotiation may take longer",
                review_note="Review related clauses",
            )
        ],
        source_filename="sample.pdf",
    )
    output = build_proposed_draft_docx(request)
    with ZipFile(BytesIO(output.getvalue())) as archive:
        xml = archive.read("word/document.xml")
        ElementTree.fromstring(xml)
    text = xml.decode("utf-8")
    assert "Replacement one" in text
    assert "Original two" in text
    assert "Original one" not in text
    assert "not legal advice" in text


def test_proposed_filename_is_sanitized():
    assert proposed_draft_filename("../private contract.pdf") == "private_contract_proposed_draft.docx"


def test_proposed_pdf_keeps_source_pages_unchanged_and_appends_addendum():
    source = fitz.open()
    page = source.new_page(width=612, height=792)
    page.insert_text((72, 90), "Original layout and contract page", fontname="helv", fontsize=14)
    source_bytes = source.tobytes()
    source_page_pixels = source[0].get_pixmap(alpha=False).samples
    request = ProposedDraftExportRequest(
        clauses=[_clause("1", "Original clause wording")],
        rewrites=[ClauseRewriteItem(
            clause_id="1",
            clause_number="1",
            replacement_text="Safer replacement wording",
            changes_summary="Adds mutual obligations",
            client_tradeoff="May need negotiation",
            review_note="Check related definitions",
        )],
        source_filename="sample.pdf",
    )

    output = build_proposed_draft_pdf(source_bytes, request)
    proposed = fitz.open(stream=output.getvalue(), filetype="pdf")
    assert proposed.page_count == 2
    assert proposed[0].get_pixmap(alpha=False).samples == source_page_pixels
    assert "Original layout and contract page" in proposed[0].get_text()
    assert "Safer replacement wording" in proposed[1].get_text()
    assert "does not amend or replace" in proposed[1].get_text()


def _load_sample_pdf() -> bytes:
    candidates = [
        Path("output/pdf/lexease_test_services_agreement.pdf"),
        Path(__file__).resolve().parents[2] / "output" / "pdf" / "lexease_test_services_agreement.pdf",
        Path(__file__).resolve().parents[4] / "output" / "pdf" / "lexease_test_services_agreement.pdf",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate.read_bytes()
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    sample_text = (
        "SERVICES AGREEMENT\n\n"
        "7. Client Materials and Work Product\n"
        "Client retains ownership of materials it provides. After Client pays all amounts due, "
        "Client owns the final reports specifically created for Client under a project statement.\n\n"
        "8. Indemnification\n"
        "Client will defend, indemnify, and hold harmless Provider and its affiliates from any "
        "and all claims, losses, damages, liabilities, and expenses arising out of or relating to the services.\n\n"
        "9. Limitation of Liability\n"
        "To the maximum extent permitted by law, Provider's liability will not exceed the fees paid by Client.\n"
    )
    page.insert_textbox(fitz.Rect(54, 54, 541, 788), sample_text, fontsize=10)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


def test_proposed_pdf_in_place_replacement_clauses_7_and_8():
    source_bytes = _load_sample_pdf()

    original_doc = fitz.open(stream=source_bytes, filetype="pdf")
    p0_original_samples = original_doc[0].get_pixmap(alpha=False).samples
    original_doc.close()

    request = ProposedDraftExportRequest(
        clauses=[
            _clause("clause_8", "7. Client Materials and Work Product\nClient retains ownership of materials it provides. After Client pays all amounts due, Client owns the final reports specifically created for Client under a project statement."),
            _clause("clause_9", "8. Indemnification\nClient will defend, indemnify, and hold harmless Provider and its affiliates from any and all claims, losses, damages, liabilities, and expenses arising out of or relating to the services."),
            _clause("clause_10", "9. Limitation of Liability\nTo the maximum extent permitted by law, Provider's liability will not exceed the fees paid by Client."),
        ],
        rewrites=[
            ClauseRewriteItem(
                clause_id="clause_8",
                clause_number="7",
                replacement_text="Client retains all ownership of materials it provides. Upon payment in full of amounts due, Client owns final reports and deliverables created specifically for Client. Provider retains pre-existing tools and know-how, and grants Client a perpetual, worldwide, royalty-free, irrevocable license to use and exploit any Provider materials incorporated into the deliverables.",
                changes_summary="Ensures Client owns deliverables while granting broad license",
                client_tradeoff="None",
                review_note="Check defined terms.",
            ),
            ClauseRewriteItem(
                clause_id="clause_9",
                clause_number="8",
                replacement_text="Each Party shall defend, indemnify, and hold harmless the other Party and its affiliates from and against third-party claims, damages, liabilities, and reasonable expenses arising out of the indemnifying Party's gross negligence, willful misconduct, or material breach of this Agreement. Neither Party shall be liable to indemnify the other for claims caused by the other Party's own negligence or breach.",
                changes_summary="Makes indemnification mutual with fault carveout",
                client_tradeoff="Requires Client to indemnify for its own gross negligence",
                review_note="Check defined terms.",
            ),
        ],
        source_filename="lexease_test_services_agreement.pdf",
    )

    output, mode, note = build_proposed_draft_pdf(source_bytes, request, return_mode=True)
    assert mode == "in_place"
    assert "In-place replacement succeeded" in note

    proposed = fitz.open(stream=output.getvalue(), filetype="pdf")
    assert proposed.page_count == 2

    # Page 0 should be 100% identical byte-for-byte to the original
    assert proposed[0].get_pixmap(alpha=False).samples == p0_original_samples
    assert "CONSULTING SERVICES AGREEMENT" in proposed[0].get_text()

    # Page 1 contains in-place replacements and intact surrounding clauses
    p1_text = proposed[1].get_text()
    assert "7. Client Materials and Work Product" in p1_text
    assert "royalty-free, irrevocable license to use and exploit" in p1_text
    assert "8. Indemnification" in p1_text
    assert "indemnifying Party's gross negligence" in p1_text
    assert "9. Limitation of Liability" in p1_text
    assert "To the maximum extent permitted by law" in p1_text
    assert "SIGNATURES (INTENTIONALLY OMITTED" in p1_text
    assert "Page 2" in p1_text


def test_proposed_pdf_falls_back_to_addendum_when_overflowing():
    source_bytes = _load_sample_pdf()

    # Create an excessively long replacement that cannot fit within Page 2 margin
    huge_text = "This is an excessively long replacement clause designed to test layout overflow protection. " * 80
    request = ProposedDraftExportRequest(
        clauses=[
            _clause("clause_8", "7. Client Materials and Work Product\nClient retains ownership of materials it provides."),
        ],
        rewrites=[
            ClauseRewriteItem(
                clause_id="clause_8",
                clause_number="7",
                replacement_text=huge_text,
                changes_summary="Too long to fit",
                client_tradeoff="Overflow",
                review_note="Check defined terms.",
            ),
        ],
        source_filename="lexease_test_services_agreement.pdf",
    )

    output, mode, note = build_proposed_draft_pdf(source_bytes, request, return_mode=True)
    assert mode == "addendum"
    assert "exceeds page layout bounds" in note

    proposed = fitz.open(stream=output.getvalue(), filetype="pdf")
    # Falls back safely to appending an addendum page (total pages > 2)
    assert proposed.page_count > 2
    assert "PROPOSED CLAUSE ADDENDUM" in proposed[2].get_text()


def test_strip_repeated_clause_heading_preserves_inline_body():
    """Ensure stripping a repeated heading never empties a single-line rewrite."""
    from app.services.clause_rewrite import _strip_repeated_clause_heading

    # 1. Heading and body on the same line with colon
    text1 = "18. Termination at Provider's Discretion: Either party may terminate with 30 days notice."
    result1 = _strip_repeated_clause_heading(text1, "18")
    assert result1 == "Either party may terminate with 30 days notice."

    # 2. Heading and body on the same line with dash
    text2 = "20. Indemnification - Each Party shall defend, indemnify, and hold harmless the other."
    result2 = _strip_repeated_clause_heading(text2, "20")
    assert result2 == "Each Party shall defend, indemnify, and hold harmless the other."

    # 3. Heading and body on the same line with 'Clause' prefix and colon
    text3 = "Clause 22: Governing Law: This Agreement shall be governed by Delaware law."
    result3 = _strip_repeated_clause_heading(text3, "22")
    assert "Delaware law" in result3
    assert len(result3) > 10

    # 4. Heading number directly followed by body without title
    text4 = "18. Either party may terminate upon thirty (30) days prior written notice."
    result4 = _strip_repeated_clause_heading(text4, "18")
    assert result4 == "Either party may terminate upon thirty (30) days prior written notice."

    # 5. Multi-line with standalone heading on line 1
    text5 = "18. Termination\nEither party may terminate with 30 days notice."
    result5 = _strip_repeated_clause_heading(text5, "18")
    assert result5 == "Either party may terminate with 30 days notice."

    # 6. Stripping must NEVER return empty string if input had content
    text6 = "18. "
    result6 = _strip_repeated_clause_heading(text6, "18")
    assert len(result6) > 0


def test_proposed_pdf_in_place_with_inline_heading_preserves_text():
    """Verify that an inline heading rewrite renders the replacement body into the PDF."""
    source_bytes = _load_sample_pdf()
    request = ProposedDraftExportRequest(
        clauses=[
            _clause("clause_8", "7. Client Materials and Work Product\nClient retains ownership of materials it provides."),
        ],
        rewrites=[
            ClauseRewriteItem(
                clause_id="clause_8",
                clause_number="7",
                replacement_text="7. Client Materials and Work Product: Client exclusively owns all created work product upon payment.",
                changes_summary="Ensures Client exclusively owns created work product",
                client_tradeoff="None",
                review_note="Standard customer-protective clause.",
            ),
        ],
        source_filename="lexease_test_services_agreement.pdf",
    )

    output, mode, note = build_proposed_draft_pdf(source_bytes, request, return_mode=True)
    assert mode in ("in_place", "addendum")

    doc = fitz.open(stream=output.getvalue(), filetype="pdf")
    all_text = " ".join(page.get_text() for page in doc)
    assert "Client exclusively owns all created work product upon payment" in all_text


def test_proposed_pdf_rejects_empty_replacement_before_export():
    """Pre-export validation requires non-empty replacement text."""
    import pytest
    source_bytes = _load_sample_pdf()
    request = ProposedDraftExportRequest(
        clauses=[
            _clause("clause_8", "7. Client Materials\nClient retains ownership."),
        ],
        rewrites=[
            ClauseRewriteItem(
                clause_id="clause_8",
                clause_number="7",
                replacement_text="   ",
                changes_summary="Empty replacement test",
                client_tradeoff="None",
                review_note="None",
            ),
        ],
    )
    with pytest.raises(ValueError, match="empty replacement text"):
        build_proposed_draft_pdf(source_bytes, request)
