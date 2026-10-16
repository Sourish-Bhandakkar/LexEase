import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import FeedbackSubmissionReview from '../components/FeedbackSubmissionReview'
import {
  checkHealth,
  getAdaptiveLearningDashboard,
  getErrorMessage,
  getPendingClauseFeedback,
  getPendingClauseFeedbackSubmissions,
  reviewClauseFeedback,
} from '../api/client'

const SESSION_TOKEN_KEY = 'lexease_adaptive_admin_token'

function AdaptiveLearningAdmin() {
  const [healthStatus, setHealthStatus] = useState(null)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [dashboardError, setDashboardError] = useState('')

  const [adminToken, setAdminToken] = useState('')
  const [authenticated, setAuthenticated] = useState(false)
  const [tokenInput, setTokenInput] = useState(() => {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || ''
  })

  const [pending, setPending] = useState(null)
  const [pendingSubmissions, setPendingSubmissions] = useState(null)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [reviewingId, setReviewingId] = useState('')

  const verifyHealth = useCallback(async () => {
    setCheckingHealth(true)
    try {
      setHealthStatus(await checkHealth())
    } catch (healthError) {
      setHealthStatus({ status: 'unreachable', error: getErrorMessage(healthError) })
    } finally {
      setCheckingHealth(false)
    }
  }, [])

  const refreshDashboard = useCallback(async (token) => {
    if (!token) return
    setLoadingDashboard(true)
    setDashboardError('')
    try {
      setDashboard(await getAdaptiveLearningDashboard(token))
    } catch (loadError) {
      setDashboardError(getErrorMessage(loadError))
    } finally {
      setLoadingDashboard(false)
    }
  }, [])

  const loadPendingQueue = useCallback(async (token) => {
    if (!token) {
      setPending(null)
      setPendingSubmissions(null)
      return
    }
    setQueueLoading(true)
    setQueueError('')
    try {
      const [pendingClauses, submissions] = await Promise.all([
        getPendingClauseFeedback(token),
        getPendingClauseFeedbackSubmissions(token),
      ])
      setPending(pendingClauses)
      setPendingSubmissions(submissions)
      return true
    } catch (err) {
      setQueueError(getErrorMessage(err))
      setPending(null)
      setPendingSubmissions(null)
      return false
    } finally {
      setQueueLoading(false)
    }
  }, [])

  useEffect(() => {
    verifyHealth()
    const savedToken = sessionStorage.getItem(SESSION_TOKEN_KEY) || ''
    if (savedToken) {
      void (async () => {
        const valid = await loadPendingQueue(savedToken)
        if (valid) {
          setAdminToken(savedToken)
          setAuthenticated(true)
          await refreshDashboard(savedToken)
        } else {
          sessionStorage.removeItem(SESSION_TOKEN_KEY)
        }
      })()
    }
  }, [verifyHealth, refreshDashboard, loadPendingQueue])

  const handleAuthenticate = async (event) => {
    event.preventDefault()
    const trimmed = tokenInput.trim()
    const valid = await loadPendingQueue(trimmed)
    if (!valid) return
    setAdminToken(trimmed)
    setAuthenticated(true)
    sessionStorage.setItem(SESSION_TOKEN_KEY, trimmed)
    await refreshDashboard(trimmed)
  }

  const handleLogout = () => {
    setAdminToken('')
    setAuthenticated(false)
    setTokenInput('')
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    setPending(null)
    setPendingSubmissions(null)
    setQueueError('')
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#F8FAF8] text-[#16221C] font-sans">
        <Navbar healthStatus={healthStatus} checkingHealth={checkingHealth} onCheckHealth={verifyHealth} hasDocument={false} />
        <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-16 sm:px-6">
          <section className="rounded-2xl border border-[#DCE6E0] bg-white p-6 shadow-sm sm:p-8">
            <span className="text-xs font-bold uppercase tracking-wider text-[#176B4D]">Private reviewer area</span>
            <h1 className="mt-2 text-2xl font-extrabold text-[#12372A]">Clause Feedback Review</h1>
            <p className="mt-2 text-sm leading-relaxed text-[#66736C]">
              Enter the reviewer access token to review flagged clauses and view the retained reference collection.
            </p>
            <form onSubmit={handleAuthenticate} className="mt-6 flex flex-col gap-3">
              <label className="sr-only" htmlFor="admin-token-input">Reviewer access token</label>
              <input
                id="admin-token-input"
                type="password"
                autoComplete="current-password"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Reviewer access token"
                className="w-full rounded-xl border border-[#DCE6E0] px-3.5 py-2.5 text-sm focus:border-[#176B4D] focus:outline-none"
                required
              />
              <button type="submit" disabled={queueLoading} className="rounded-xl bg-[#176B4D] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#124F38] disabled:opacity-60">
                {queueLoading ? 'Checking access…' : 'Unlock reviewer area'}
              </button>
            </form>
            {queueError && <p role="alert" className="mt-3 rounded-xl border border-[#F5C2C2] bg-white p-3 text-sm text-[#C94A4A]">{queueError}</p>}
          </section>
        </main>
      </div>
    )
  }

  const reviewSingleClause = async (id, decision) => {
    setReviewingId(id)
    setQueueError('')
    try {
      await reviewClauseFeedback(id, decision, adminToken)
      setPending((current) => (current ? current.filter((item) => item.id !== id) : []))
      await refreshDashboard(adminToken)
    } catch (err) {
      setQueueError(getErrorMessage(err))
    } finally {
      setReviewingId('')
    }
  }

  const removeReviewedSubmission = async (id) => {
    setPendingSubmissions((current) => (current ? current.filter((item) => item.id !== id) : []))
    await refreshDashboard(adminToken)
  }

  return (
    <div className="min-h-screen bg-[#F8FAF8] text-[#16221C] font-sans">
      <Navbar
        healthStatus={healthStatus}
        checkingHealth={checkingHealth}
        onCheckHealth={verifyHealth}
        hasDocument={false}
      />
      <main className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-[#DCE6E0] pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#176B4D]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#176B4D]">
                Reviewer Portal
              </span>
              <span className="text-xs text-[#8C9A92]">Authorized Reviewers Only</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-[#12372A]">
              Flag Review & Reviewed Clause Library
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-[#66736C]">
              Review clause-label flags, verify suggested corrections, and maintain approved examples for possible future offline analysis. Reviews do not update the live model.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                refreshDashboard(adminToken)
                if (adminToken) loadPendingQueue(adminToken)
              }}
              className="rounded-xl bg-[#176B4D] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#124F38]"
            >
              Refresh Data
            </button>
          </div>
        </header>

        <nav aria-label="Reviewer sections" className="flex flex-wrap gap-3">
          <a
            href="#review-clause-flags"
            className="rounded-xl bg-[#176B4D] px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#124F38]"
          >
            Review flagged clauses <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5">{pending?.length ?? dashboard?.pending_feedback_count ?? 0}</span>
          </a>
          <Link
            to="/model-management"
            className="rounded-xl border border-[#DCE6E0] bg-white px-4 py-2.5 text-sm font-semibold text-[#66736C] shadow-sm hover:bg-[#F3F7F5]"
          >
            Open separate model page
          </Link>
          <a
            href="#review-document-submissions"
            className="rounded-xl border border-[#DCE6E0] bg-white px-4 py-2.5 text-sm font-semibold text-[#176B4D] shadow-sm hover:bg-[#F3F7F5]"
          >
            Review submitted documents <span className="ml-1 rounded-full bg-[#E8F1EC] px-2 py-0.5">{pendingSubmissions?.length ?? dashboard?.pending_feedback_submission_count ?? 0}</span>
          </a>
        </nav>

        {dashboardError && (
          <p role="alert" className="rounded-xl border border-[#F5C2C2] bg-white p-4 text-sm text-[#C94A4A]">
            {dashboardError}
          </p>
        )}

        {/* Reviewer Authentication Bar */}
        <section className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#12372A]">Reviewer Access</h2>
              <p className="text-xs text-[#66736C]">
                {adminToken
                  ? 'Access verified. The review queue and retained examples are unlocked.'
                  : 'Enter your reviewer access token to unlock this private area.'}
              </p>
            </div>
            {adminToken ? (
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[#176B4D]">
                  <span className="h-2 w-2 rounded-full bg-[#176B4D]" />
                  Token Active
                </span>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-lg border border-[#DCE6E0] bg-white px-3 py-1.5 text-xs font-semibold text-[#66736C] hover:bg-[#F8FAF8]"
                >
                  Disconnect
                </button>
              </div>
            ) : null}
          </div>

          {!adminToken && (
            <form onSubmit={handleAuthenticate} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <label className="sr-only" htmlFor="admin-token-input">
                Admin Review Token
              </label>
              <input
                id="admin-token-input"
                type="password"
                autoComplete="off"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Enter reviewer admin token"
                className="min-w-0 flex-1 rounded-xl border border-[#DCE6E0] px-3.5 py-2 text-sm focus:border-[#176B4D] focus:outline-none"
                required
              />
              <button
                type="submit"
                className="rounded-xl bg-[#176B4D] px-5 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#124F38]"
              >
                Authenticate & Unlock
              </button>
            </form>
          )}

          {queueError && (
            <div role="alert" className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#991B1B]">
              <strong>Authorization Error:</strong> {queueError}
            </div>
          )}
        </section>

        {/* Reviewed Dataset Collection */}
        <section id="reviewed-dataset" className="scroll-mt-24 space-y-4 rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#66736C]">
                Offline Analysis Dataset
              </p>
              <h2 className="text-lg font-bold text-[#12372A]">Reviewed Clause Dataset</h2>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                dashboard?.approved_feedback_count
                  ? 'bg-[#E8F1EC] text-[#176B4D]'
                  : 'bg-[#FFF8E6] text-[#B45309]'
              }`}
            >
              {dashboard?.approved_feedback_count ?? 0} Approved & Stored
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">Approved & Stored Clauses</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_feedback_count ?? 0}{' '}
                <span className="text-xs font-normal text-[#8C9A92]">clauses</span>
              </p>
            </div>
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">Low Risk</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_class_counts?.LOW ?? dashboard?.approved_class_counts?.low ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">Medium Risk</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_class_counts?.MEDIUM ?? dashboard?.approved_class_counts?.medium ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">High Risk</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_class_counts?.HIGH ?? dashboard?.approved_class_counts?.high ?? 0}
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[#F0F4F2] p-3 text-xs leading-relaxed text-[#526058]">
            <strong>Reviewed dataset safeguard:</strong> Approved clauses are saved in the database as verified reference examples for offline evaluation and future analysis. Approval does not retrain the live model or start online cycles.
          </div>

        </section>

        {/* Review Queue: Document Batches */}
        <section id="review-document-submissions" className="scroll-mt-24 space-y-4 rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8F1EC] pb-3">
            <div>
              <h2 className="text-base font-bold text-[#12372A]">Document Batch Submissions</h2>
              <p className="text-xs text-[#66736C]">
                Batches submitted from full document analysis. Review clause labels together to preserve context.
              </p>
            </div>
            <span className="rounded-full border border-[#DCE6E0] bg-[#F8FAF8] px-3 py-1 text-xs text-[#66736C]">
              {pendingSubmissions?.length ?? dashboard?.pending_feedback_submission_count ?? 0} batches pending
            </span>
          </div>

          {!adminToken ? (
            <p className="text-xs text-[#8C9A92]">Authenticate with reviewer token above to view and review document batches.</p>
          ) : queueLoading ? (
            <p className="text-xs text-[#66736C]">Loading pending submissions…</p>
          ) : pendingSubmissions && pendingSubmissions.length > 0 ? (
            <div className="space-y-4">
              {pendingSubmissions.map((submission) => (
                <FeedbackSubmissionReview
                  key={submission.id}
                  submission={submission}
                  adminToken={adminToken}
                  onReviewed={removeReviewedSubmission}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#66736C]">No pending document batches to review.</p>
          )}
        </section>

        {/* Review Queue: Individual Clauses */}
        <section id="review-clause-flags" className="scroll-mt-24 space-y-4 rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E8F1EC] pb-3">
            <div>
              <h2 className="text-base font-bold text-[#12372A]">Individual Clause Feedback Queue</h2>
              <p className="text-xs text-[#66736C]">
                Individual consented clause corrections. Approve or reject each item.
              </p>
            </div>
            <span className="rounded-full border border-[#DCE6E0] bg-[#F8FAF8] px-3 py-1 text-xs text-[#66736C]">
              {pending?.length ?? dashboard?.pending_feedback_count ?? 0} clauses pending
            </span>
          </div>

          {!adminToken ? (
            <p className="text-xs text-[#8C9A92]">Authenticate with reviewer token above to inspect pending clauses.</p>
          ) : queueLoading ? (
            <p className="text-xs text-[#66736C]">Loading pending clauses…</p>
          ) : pending && pending.length > 0 ? (
            <div className="space-y-3">
              {pending.map((item) => (
                <article
                  key={item.id}
                  className="space-y-3 rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-4 transition-colors hover:border-[#C8DECE]"
                >
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[#16221C]">{item.clause_text}</p>
                  {item.review_note && (
                    <div className="rounded-lg bg-[#EAEFEA] px-3 py-1.5 text-xs text-[#2D4537] italic">
                      {item.review_note}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-[#66736C]">
                      System predicted: <strong className="uppercase text-[#12372A]">{item.predicted_risk_level}</strong> · User suggested: <strong className="uppercase text-[#176B4D]">{item.corrected_risk_level}</strong>
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={Boolean(reviewingId)}
                        onClick={() => reviewSingleClause(item.id, 'approve')}
                        className="rounded-lg bg-[#176B4D] px-3 py-1.5 text-xs font-bold text-white transition hover:bg-[#124F38] disabled:opacity-50"
                      >
                        Approve Example
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(reviewingId)}
                        onClick={() => reviewSingleClause(item.id, 'reject')}
                        className="rounded-lg border border-[#DCE6E0] bg-white px-3 py-1.5 text-xs font-bold text-[#66736C] transition hover:bg-[#FFF2F2] hover:text-[#C94A4A] disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#66736C]">No pending clauses to review.</p>
          )}
        </section>
      </main>
    </div>
  )
}

export default AdaptiveLearningAdmin
