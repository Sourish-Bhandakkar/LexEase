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
  reloadActiveModel,
  reviewClauseFeedback,
  rollbackActiveModel,
  runCandidateCycle,
} from '../api/client'

const SESSION_TOKEN_KEY = 'lexease_adaptive_admin_token'

function AdaptiveLearningAdmin() {
  const [healthStatus, setHealthStatus] = useState(null)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [dashboardError, setDashboardError] = useState('')

  const [adminToken, setAdminToken] = useState(() => {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || ''
  })
  const [tokenInput, setTokenInput] = useState(() => {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || ''
  })

  const [pending, setPending] = useState(null)
  const [pendingSubmissions, setPendingSubmissions] = useState(null)
  const [queueLoading, setQueueLoading] = useState(false)
  const [queueError, setQueueError] = useState('')
  const [reviewingId, setReviewingId] = useState('')

  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)

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

  const refreshDashboard = useCallback(async () => {
    setLoadingDashboard(true)
    setDashboardError('')
    try {
      setDashboard(await getAdaptiveLearningDashboard())
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
    } catch (err) {
      setQueueError(getErrorMessage(err))
      setPending(null)
      setPendingSubmissions(null)
    } finally {
      setQueueLoading(false)
    }
  }, [])

  useEffect(() => {
    verifyHealth()
    refreshDashboard()
    if (adminToken) {
      loadPendingQueue(adminToken)
    }
  }, [verifyHealth, refreshDashboard, adminToken, loadPendingQueue])

  const handleAuthenticate = (event) => {
    event.preventDefault()
    const trimmed = tokenInput.trim()
    setAdminToken(trimmed)
    sessionStorage.setItem(SESSION_TOKEN_KEY, trimmed)
    setActionError('')
    setActionMessage('')
    loadPendingQueue(trimmed)
  }

  const handleLogout = () => {
    setAdminToken('')
    setTokenInput('')
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
    setPending(null)
    setPendingSubmissions(null)
    setQueueError('')
    setActionMessage('')
    setActionError('')
  }

  const reviewSingleClause = async (id, decision) => {
    setReviewingId(id)
    setQueueError('')
    try {
      await reviewClauseFeedback(id, decision, adminToken)
      setPending((current) => (current ? current.filter((item) => item.id !== id) : []))
      await refreshDashboard()
    } catch (err) {
      setQueueError(getErrorMessage(err))
    } finally {
      setReviewingId('')
    }
  }

  const removeReviewedSubmission = async (id) => {
    setPendingSubmissions((current) => (current ? current.filter((item) => item.id !== id) : []))
    await refreshDashboard()
  }

  const handleReload = async () => {
    if (!adminToken) {
      setActionError('Authenticate with your reviewer token first.')
      return
    }
    setActionLoading(true)
    setActionError('')
    setActionMessage('')
    try {
      const res = await reloadActiveModel(adminToken)
      setActionMessage(res.message || `Live service reloaded successfully: active version is now "${res.active_version || 'baseline'}".`)
      await refreshDashboard()
    } catch (err) {
      if (err.code === 'ERR_NETWORK' || (err.request && !err.response)) {
        setActionError('The LexEase backend is currently unavailable. Reload did not occur. Please verify that the backend is running and try again.')
      } else {
        setActionError(getErrorMessage(err))
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleRollback = async () => {
    if (!adminToken) {
      setActionError('Authenticate with your reviewer token first.')
      return
    }
    if (!window.confirm('Rollback to previous active model version?')) return
    setActionLoading(true)
    setActionError('')
    setActionMessage('')
    try {
      const res = await rollbackActiveModel(adminToken)
      setActionMessage(res.message || `Active model successfully rolled back to "${res.active_version || 'baseline'}".`)
      await refreshDashboard()
    } catch (err) {
      if (err.code === 'ERR_NETWORK' || (err.request && !err.response)) {
        setActionError('The LexEase backend is currently unavailable. Rollback did not occur. Please verify that the backend is running and try again.')
      } else {
        setActionError(getErrorMessage(err))
      }
    } finally {
      setActionLoading(false)
    }
  }

  const handleRunCycle = async () => {
    if (!adminToken) {
      setActionError('Authenticate with your reviewer token first.')
      return
    }
    setActionLoading(true)
    setActionError('')
    setActionMessage('')
    try {
      const res = await runCandidateCycle(adminToken)
      setActionMessage(res.message || 'Candidate training cycle queued successfully. The worker will process it.')
      await refreshDashboard()
    } catch (err) {
      if (err.code === 'ERR_NETWORK' || (err.request && !err.response)) {
        setActionError('The LexEase backend is currently unavailable. Candidate cycle was not queued. Please verify that the backend is running and try again.')
      } else {
        setActionError(getErrorMessage(err))
      }
    } finally {
      setActionLoading(false)
    }
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
              Adaptive Learning Review Console
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-[#66736C]">
              Review submitted clause corrections, verify risk categories, and oversee candidate model evaluations. All model updates require human approval and rigorous benchmark checks.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/adaptive-learning"
              className="rounded-xl border border-[#DCE6E0] bg-white px-4 py-2 text-xs font-semibold text-[#176B4D] shadow-sm hover:bg-[#F3F7F5]"
            >
              ← Public Metrics
            </Link>
            <button
              type="button"
              onClick={() => {
                refreshDashboard()
                if (adminToken) loadPendingQueue(adminToken)
              }}
              className="rounded-xl bg-[#176B4D] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#124F38]"
            >
              Refresh Data
            </button>
          </div>
        </header>

        {dashboardError && (
          <p role="alert" className="rounded-xl border border-[#F5C2C2] bg-white p-4 text-sm text-[#C94A4A]">
            {dashboardError}
          </p>
        )}

        {/* Reviewer Authentication Bar */}
        <section className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#12372A]">Reviewer Authentication</h2>
              <p className="text-xs text-[#66736C]">
                {adminToken
                  ? 'Authenticated. Admin actions and review queue are unlocked.'
                  : 'Enter your administrator token to review submissions and manage model cycles.'}
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

        {/* Model Readiness and Controls */}
        <section className="space-y-4 rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#66736C]">
                Demonstration Eligibility Gate
              </p>
              <h2 className="text-lg font-bold text-[#12372A]">Candidate Training Readiness</h2>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                dashboard?.gate_met
                  ? 'bg-[#E8F1EC] text-[#176B4D]'
                  : 'bg-[#FFF8E6] text-[#B45309]'
              }`}
            >
              {dashboard?.gate_met ? '✓ Demonstration Gate Met' : '⚠ Demonstration Gate Unmet'}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">Approved Clauses</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_feedback_count ?? 0}{' '}
                <span className="text-xs font-normal text-[#8C9A92]">/ 15 min</span>
              </p>
            </div>
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">Low Risk</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_class_counts?.LOW ?? dashboard?.approved_class_counts?.low ?? 0}{' '}
                <span className="text-xs font-normal text-[#8C9A92]">/ 5 min</span>
              </p>
            </div>
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">Medium Risk</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_class_counts?.MEDIUM ?? dashboard?.approved_class_counts?.medium ?? 0}{' '}
                <span className="text-xs font-normal text-[#8C9A92]">/ 5 min</span>
              </p>
            </div>
            <div className="rounded-xl border border-[#E8F1EC] bg-[#F8FAF8] p-3 text-center">
              <p className="text-xs text-[#66736C]">High Risk</p>
              <p className="mt-1 text-xl font-extrabold text-[#12372A]">
                {dashboard?.approved_class_counts?.HIGH ?? dashboard?.approved_class_counts?.high ?? 0}{' '}
                <span className="text-xs font-normal text-[#8C9A92]">/ 5 min</span>
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[#F0F4F2] p-3 text-xs leading-relaxed text-[#526058]">
            <strong>Demonstration-only safeguard:</strong> The threshold of 15 approved training clauses (≥5 per class) is a temporary setting designed to demonstrate the candidate evaluation and promotion workflow. Small sample sizes are not statistical evidence that a candidate will improve or generalize.
          </div>

          {dashboard?.needs_reload && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-xs text-[#92400E]">
              <div>
                <strong>Live service reload pending:</strong> Active manifest points to{' '}
                <code className="rounded bg-white/70 px-1 py-0.5">{dashboard.active_version}</code>, but in-memory service is running{' '}
                <code className="rounded bg-white/70 px-1 py-0.5">{dashboard.live_loaded_version || 'baseline'}</code>.
              </div>
              <button
                type="button"
                onClick={handleReload}
                disabled={actionLoading || !adminToken}
                className="rounded-lg bg-[#B45309] px-3 py-1.5 font-bold text-white hover:bg-[#92400E] disabled:opacity-50"
              >
                {actionLoading ? 'Reloading…' : 'Reload Live Service'}
              </button>
            </div>
          )}

          {actionMessage && (
            <div className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs font-semibold text-[#065F46]">
              {actionMessage}
            </div>
          )}
          {actionError && (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-semibold text-[#991B1B]">
              {actionError}
            </div>
          )}

          <div className="flex flex-wrap gap-2.5 pt-1">
            <button
              type="button"
              disabled={!dashboard?.gate_met || actionLoading || !adminToken}
              onClick={handleRunCycle}
              className="rounded-xl bg-[#176B4D] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#124F38] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading ? 'Working…' : 'Run Candidate Cycle'}
            </button>
            <button
              type="button"
              disabled={actionLoading || !adminToken}
              onClick={handleReload}
              className="rounded-xl border border-[#DCE6E0] bg-white px-3.5 py-2 text-xs font-semibold text-[#176B4D] hover:bg-[#F3F7F5] disabled:opacity-50"
            >
              Reload Active Model
            </button>
            <button
              type="button"
              disabled={actionLoading || !adminToken}
              onClick={handleRollback}
              className="rounded-xl border border-[#F5C2C2] bg-white px-3.5 py-2 text-xs font-semibold text-[#C94A4A] hover:bg-[#FFF5F5] disabled:opacity-50"
            >
              Rollback Model
            </button>
          </div>
        </section>

        {/* Review Queue: Document Batches */}
        <section className="space-y-4 rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
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
        <section className="space-y-4 rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
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
                        Approve for Training
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
