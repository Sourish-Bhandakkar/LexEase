import { useEffect, useMemo, useState } from 'react'
import { downloadProposedPdf, getErrorMessage, rewriteSelectedClauses } from '../api/client'

function ClauseDrafting({ clauses = [], analysisData, filename = 'contract.pdf', sourceFile }) {
  const [selectedIds, setSelectedIds] = useState([])
  const [consent, setConsent] = useState(false)
  const [rewrites, setRewrites] = useState([])
  const [includedIds, setIncludedIds] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const riskById = useMemo(
    () => new Map((analysisData?.results || []).map((item) => [item.clause_id, item])),
    [analysisData],
  )
  const candidates = clauses.filter((clause) => ['high', 'medium'].includes(riskById.get(clause.clause_id)?.risk_level?.toLowerCase()))

  useEffect(() => {
    setSelectedIds([])
    setRewrites([])
    setIncludedIds([])
    setConsent(false)
  }, [analysisData, clauses])

  const toggleSelection = (id) => {
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < 8 ? [...current, id] : current)
    setRewrites([])
  }

  const generateRewrites = async (event) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const response = await rewriteSelectedClauses({
        clauses,
        selected_clause_ids: selectedIds,
        negotiation_goals: null,
        ai_processing_consent: consent,
      })
      setRewrites(response.rewrites.map((item) => ({ ...item })))
      setIncludedIds(response.rewrites.map((item) => item.clause_id))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  const [downloadNotice, setDownloadNotice] = useState(null)

  const downloadDraft = async () => {
    const accepted = rewrites.filter((item) => includedIds.includes(item.clause_id))
    if (!accepted.length) return
    if (!sourceFile) {
      setError('The original PDF is no longer available. Return to the document workspace and upload it again before exporting.')
      return
    }
    setBusy(true)
    setError(null)
    setDownloadNotice(null)
    try {
      const response = await downloadProposedPdf(sourceFile, {
        clauses,
        rewrites: accepted,
        source_filename: filename,
      })
      const mode = response.headers?.['x-export-mode'] || 'in_place'
      if (mode === 'in_place') {
        setDownloadNotice('Proposed draft exported with in-place revisions directly in the contract layout.')
      } else {
        setDownloadNotice('Proposed draft exported with addendum fallback (revised clauses exceeded page capacity or could not be safely reflowed in-place).')
      }
      const objectUrl = URL.createObjectURL(response.data)
      const anchor = document.createElement('a')
      const stem = filename.replace(/\.pdf$/i, '').replace(/[^a-z0-9_-]+/gi, '_') || 'contract'
      anchor.href = objectUrl
      anchor.download = `${stem}_proposed_draft.pdf`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-6 space-y-5 rounded-2xl border border-[#C8DECE] bg-white p-5 shadow-sm sm:p-6">
      <div>
        <h2 className="text-lg font-bold text-[#16221C]">Draft more balanced clauses</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#526058]">
          Select the clauses you want to improve. The exported draft places selected revisions in-place within the original document layout while leaving unselected clauses and pages intact. If text overflows or layout cannot be safely preserved, LexEase uses a clearly labeled addendum fallback to prevent clipping.
        </p>
      </div>

      <form onSubmit={generateRewrites} className="space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-[#26372E]">Choose clauses to revise</h3>
            <span className="text-xs text-[#526058]">Up to 8 clauses per request</span>
          </div>
          {candidates.length === 0 ? (
            <p className="rounded-lg border border-[#D6E1D9] bg-[#F8FAF8] p-3 text-sm text-[#526058]">No medium or high risk clauses are available to revise from this analysis.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {candidates.map((clause) => {
                const risk = riskById.get(clause.clause_id)
                const checked = selectedIds.includes(clause.clause_id)
                return (
                  <label key={clause.clause_id} className="flex items-start gap-2 rounded-lg border border-[#D6E1D9] bg-[#F8FAF8] p-3 text-sm text-[#26372E]">
                    <input type="checkbox" checked={checked} disabled={!checked && selectedIds.length >= 8} onChange={() => toggleSelection(clause.clause_id)} className="mt-1 accent-[#176B4D]" />
                    <span className="min-w-0">
                      <span className="font-semibold">{clause.clause_number ? `Clause ${clause.clause_number}` : clause.clause_id}</span>
                      <span className="ml-2 text-[10px] uppercase text-[#8A5B00]">{risk?.risk_level} risk</span>
                      <span className="mt-1 block line-clamp-2 text-xs text-[#526058]">{clause.text}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </div>

        <label className="flex items-start gap-2 text-xs leading-relaxed text-[#26372E]">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-[#176B4D]" />
          I consent to sending only the selected clause text to the configured AI provider. Drafting is always from the customer/service recipient's perspective.
        </label>
        <p className="text-xs leading-relaxed text-[#526058]">This creates draft wording only. It does not submit feedback or train the risk model.</p>
        <p className="text-xs leading-relaxed text-[#8A5B00]">Drafting assistance only, not legal advice. Revisions are placed in-place where space permits, or appended as an addendum if text exceeds page capacity. Compare each proposal with the source and seek appropriate legal review before adoption.</p>
        <button type="submit" disabled={!consent || selectedIds.length === 0 || busy} className="rounded-lg bg-[#176B4D] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#10563D] disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Drafting selected clauses…' : `Draft alternatives (${selectedIds.length})`}
        </button>
      </form>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {downloadNotice && <p role="status" className="rounded-lg border border-[#C8DECE] bg-[#F4F9F5] p-3 text-sm text-[#176B4D]">{downloadNotice}</p>}
      {rewrites.length > 0 && (
        <div className="space-y-4 border-t border-[#D6E1D9] pt-5">
          <div>
            <h3 className="font-bold text-[#16221C]">Review proposed replacements</h3>
            <p className="mt-1 text-xs text-[#526058]">Edit or exclude any proposal before downloading. The original uploaded PDF remains unchanged.</p>
          </div>
          {rewrites.map((item) => {
            const clause = clauses.find((entry) => entry.clause_id === item.clause_id)
            const originalRisk = riskById.get(item.clause_id)?.risk_level || 'NEEDS_REVIEW'
            const included = includedIds.includes(item.clause_id)
            return (
              <article key={item.clause_id} className="space-y-3 rounded-xl border border-[#D6E1D9] bg-[#F8FAF8] p-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-[#16221C]">
                  <input type="checkbox" checked={included} onChange={() => setIncludedIds((current) => included ? current.filter((id) => id !== item.clause_id) : [...current, item.clause_id])} className="accent-[#176B4D]" />
                  Include {item.clause_number ? `Clause ${item.clause_number}` : item.clause_id} in proposed draft
                </label>
                <div className="rounded-lg border border-[#D6E1D9] bg-white p-3 text-xs text-[#26372E]">
                  <p className="font-semibold">Risk comparison (AI estimate)</p>
                  <p className="mt-1">Original analysis: <strong>{String(originalRisk).replaceAll('_', ' ')}</strong> → Generated replacement: <strong>{String(item.estimated_customer_risk || 'NEEDS_REVIEW').replaceAll('_', ' ')}</strong></p>
                  <p className="mt-1 text-[#526058]">{item.risk_estimate_note || 'No estimate explanation was returned.'} This estimate describes the generated wording; editing the replacement below does not recalculate it.</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#526058]">Original</p><p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-xs leading-relaxed text-[#526058]">{clause?.text}</p></div>
                  <label className="block"><span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-[#176B4D]">Proposed replacement — editable</span><textarea rows={7} maxLength={12000} value={item.replacement_text} onChange={(event) => setRewrites((current) => current.map((entry) => entry.clause_id === item.clause_id ? { ...entry, replacement_text: event.target.value } : entry))} className="w-full rounded-lg border border-[#D6E1D9] bg-white p-3 text-xs leading-relaxed text-[#16221C]" /></label>
                </div>
                <p className="text-xs text-[#26372E]"><strong>Changes:</strong> {item.changes_summary}</p>
                <p className="text-xs text-[#26372E]"><strong>Trade-off:</strong> {item.client_tradeoff}</p>
                {item.review_note && <p className="text-xs text-[#8A5B00]"><strong>Review note:</strong> {item.review_note}</p>}
              </article>
            )
          })}
          <button type="button" onClick={downloadDraft} disabled={busy || includedIds.length === 0 || rewrites.some((item) => includedIds.includes(item.clause_id) && !item.replacement_text.trim())} className="rounded-lg border border-[#176B4D]/30 bg-[#176B4D] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#10563D] disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Preparing proposed draft…' : 'Download proposed draft PDF'}
          </button>
        </div>
      )}
    </section>
  )
}

export default ClauseDrafting
