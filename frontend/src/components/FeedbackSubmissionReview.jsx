import { useState } from 'react'
import { getErrorMessage, reviewClauseFeedbackSubmission } from '../api/client'

function FeedbackSubmissionReview({ submission, adminToken, onReviewed }) {
  const [labels, setLabels] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submitReview = async (decision) => {
    const annotations = submission.clauses
      .filter((clause) => labels[clause.clause_id])
      .map((clause) => ({ clause_id: clause.clause_id, corrected_risk_level: labels[clause.clause_id] }))
    if (decision === 'annotate' && annotations.length === 0) return
    setBusy(true)
    setError('')
    try {
      await reviewClauseFeedbackSubmission(submission.id, {
        decision,
        annotations: decision === 'annotate' ? annotations : [],
        review_note: null,
      }, adminToken)
      onReviewed(submission.id)
    } catch (reviewError) {
      setError(getErrorMessage(reviewError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="space-y-4 rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Document submission · {submission.clauses.length} clauses</p>
          <p className="text-xs text-[#8C9A92]">Received {new Date(submission.created_at).toLocaleString()}</p>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold uppercase text-[#66736C]">Pending annotation</span>
      </header>
      <div className="space-y-3">
        {submission.clauses.map((clause) => (
          <div key={clause.clause_id} className="grid gap-2 rounded-lg border border-[#DCE6E0] bg-white p-3 md:grid-cols-[1fr_150px]">
            <div>
              <p className="text-[10px] font-bold uppercase text-[#66736C]">{clause.clause_number || clause.clause_id} · system predicted {clause.predicted_risk_level} risk{clause.confidence !== null ? ` · ${Math.round(clause.confidence * 100)}% confidence` : ''}</p>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[#26372E]">{clause.clause_text}</p>
            </div>
            <label className="text-xs font-semibold text-[#26372E]">
              Verified label
              <select value={labels[clause.clause_id] || ''} onChange={(event) => setLabels((current) => ({ ...current, [clause.clause_id]: event.target.value }))} className="mt-1 w-full rounded-lg border border-[#DCE6E0] bg-white px-2 py-2 font-normal">
                <option value="">Leave unlabelled</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-[#66736C]">Only clauses given a verified label below are saved as reviewed examples for future offline analysis or model evaluation. The system prediction alone is never treated as ground truth, and approval does not change the live model.</p>
      {error && <p role="alert" className="text-xs text-[#C94A4A]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !Object.values(labels).some(Boolean)} onClick={() => submitReview('annotate')} className="rounded-lg bg-[#176B4D] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save verified labels'}</button>
        <button type="button" disabled={busy} onClick={() => submitReview('reject')} className="rounded-lg border border-[#DCE6E0] bg-white px-3 py-1.5 text-xs font-bold text-[#66736C] disabled:opacity-50">Reject submission</button>
      </div>
    </article>
  )
}

export default FeedbackSubmissionReview
