import { useMemo, useState } from 'react'
import { getErrorMessage, submitClauseFeedbackBatch } from '../api/client'

function DocumentLearningSubmission({ clauses = [], analysisData, onDraftSafer }) {
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submissionClauses = useMemo(() => {
    const results = new Map((analysisData?.results || []).map((result) => [result.clause_id, result]))
    return clauses.flatMap((clause) => {
      const result = results.get(clause.clause_id)
      if (!result || !['low', 'medium', 'high'].includes(result.risk_level?.toLowerCase())) return []
      return [{
        clause_id: clause.clause_id,
        clause_number: clause.clause_number,
        clause_text: clause.text,
        predicted_risk_level: result.risk_level.toLowerCase(),
        confidence: result.confidence ?? null,
      }]
    })
  }, [clauses, analysisData])

  const submitForImprovement = async (event) => {
    event.preventDefault()
    if (!consent || !submissionClauses.length) return
    setSending(true)
    setError('')
    setMessage('')
    try {
      const response = await submitClauseFeedbackBatch({ clauses: submissionClauses, consent: true })
      setMessage(`Thanks. ${response.clause_count} clauses were submitted for reviewer evaluation. They are retained as candidate examples for offline analysis.`)
      setConsent(false)
    } catch (submitError) {
      setError(getErrorMessage(submitError))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="mt-6 grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-[#C8DECE] bg-white p-5 shadow-sm sm:p-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#176B4D]">Next step</p>
          <h2 className="mt-1 text-lg font-bold text-[#16221C]">Make this document safer</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#526058]">Choose clauses to renegotiate and get suggested wording on a separate page.</p>
        </div>
        <button type="button" onClick={onDraftSafer} disabled={!analysisData?.results?.length} className="rounded-lg bg-[#176B4D] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#10563D] disabled:cursor-not-allowed disabled:opacity-50">
          Choose clauses to improve
        </button>
      </div>

      <form onSubmit={submitForImprovement} className="space-y-3 rounded-2xl border border-[#D6E1D9] bg-white p-5 shadow-sm sm:p-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#176B4D]">Optional contribution</p>
          <h2 className="mt-1 text-lg font-bold text-[#16221C]">Contribute to Reviewed Dataset</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#526058]">Send all analyzed clauses and their current risk predictions together for human reviewer inspection.</p>
        </div>
        <label className="flex items-start gap-2 text-xs leading-relaxed text-[#526058]">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-[#176B4D]" />
          I consent to sharing these clause texts and risk predictions with LexEase for reviewer evaluation and dataset collection. The filename and uploaded PDF are not included.
        </label>
        <p className="text-xs leading-relaxed text-[#66736C]">The clauses are PII-masked and queued together. They are not treated as verified labels or used to train the model automatically; verified labels are retained as reviewed examples for future offline analysis.</p>
        <button type="submit" disabled={!consent || !submissionClauses.length || sending} className="rounded-lg border border-[#D6E1D9] bg-[#F3F7F5] px-4 py-2.5 text-sm font-bold text-[#176B4D] transition hover:bg-[#E8F1EC] disabled:cursor-not-allowed disabled:opacity-50">
          {sending ? 'Submitting clauses…' : `Submit ${submissionClauses.length} clauses together`}
        </button>
        {message && <p role="status" className="text-xs text-[#176B4D]">{message}</p>}
        {error && <p role="alert" className="text-xs text-[#C94A4A]">{error}</p>}
      </form>
    </section>
  )
}

export default DocumentLearningSubmission
