import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { ConfusionMatrix, ModelHistoryGraph, getVersionStatusLabel } from '../components/ModelMetricsVisuals'
import {
  checkHealth,
  getAdaptiveLearningDashboard,
  getErrorMessage,
  submitClauseFeedback,
} from '../api/client'

function formatMetric(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Not measured'
}

function MetricCard({ label, value, detail, badge }) {
  return (
    <div className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#66736C]">{label}</p>
        {badge && (
          <span className="rounded-md bg-[#E8F1EC] px-2 py-0.5 text-[10px] font-bold text-[#176B4D]">
            {badge}
          </span>
        )}
      </div>
      <p className="mt-2 text-3xl font-extrabold tracking-tight text-[#12372A]">{value}</p>
      <p className="mt-1 text-xs text-[#8C9A92]">{detail}</p>
    </div>
  )
}

function AdaptiveLearning() {
  const [healthStatus, setHealthStatus] = useState(null)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Customer clause suggestion form state
  const [clauseText, setClauseText] = useState('')
  const [predictedRisk, setPredictedRisk] = useState('medium')
  const [suggestedRisk, setSuggestedRisk] = useState('low')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState('')
  const [submitError, setSubmitError] = useState('')

  const refreshDashboard = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setDashboard(await getAdaptiveLearningDashboard())
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

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

  useEffect(() => {
    refreshDashboard()
    verifyHealth()
  }, [refreshDashboard, verifyHealth])

  const handleSubmitSuggestion = async (e) => {
    e.preventDefault()
    if (!consent) {
      setSubmitError('Explicit consent is required to submit clause feedback for review.')
      return
    }
    if (!clauseText.trim()) {
      setSubmitError('Please enter clause text.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    setSubmitSuccess('')

    try {
      await submitClauseFeedback({
        clause_text: clauseText.trim(),
        predicted_risk_level: predictedRisk,
        corrected_risk_level: suggestedRisk,
        consent: true,
      })
      setSubmitSuccess(
        'Thank you! Your clause feedback has been queued for review by an authorized reviewer. Unreviewed submissions are never used to train the model.'
      )
      setClauseText('')
      setConsent(false)
    } catch (err) {
      setSubmitError(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const metrics = dashboard?.active_metrics?.candidate || dashboard?.active_metrics
  const testSampleCount = Number.isFinite(metrics?.test_samples) ? metrics.test_samples : null

  return (
    <div className="min-h-screen bg-[#F8FAF8] text-[#16221C] font-sans">
      <Navbar
        healthStatus={healthStatus}
        checkingHealth={checkingHealth}
        onCheckHealth={verifyHealth}
        hasDocument={false}
      />

      <main className="mx-auto w-full max-w-6xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
        {/* Header */}
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end border-b border-[#DCE6E0] pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#176B4D]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#176B4D]">
                Model Quality & Governance
              </span>
              <span className="text-xs text-[#8C9A92]">Transparency Report</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-[#12372A]">
              Adaptive Learning & Evaluation
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-[#66736C]">
              LexEase evaluates model updates using authorized human review and verified benchmark evaluations on held-out validation clauses. Uploaded documents and extracted clauses do not automatically train the model.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={refreshDashboard}
              className="rounded-xl border border-[#DCE6E0] bg-white px-4 py-2 text-xs font-semibold text-[#176B4D] shadow-sm hover:bg-[#F3F7F5]"
            >
              Refresh Metrics
            </button>
            <Link
              to="/adaptive-learning/admin"
              className="rounded-xl bg-[#176B4D] px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-[#124F38]"
            >
              Reviewer Portal →
            </Link>
          </div>
        </header>

        {error && (
          <p role="alert" className="rounded-xl border border-[#F5C2C2] bg-white p-4 text-sm text-[#C94A4A]">
            {error}
          </p>
        )}

        {/* Educational Cards: How LexEase Ensures Safe Learning */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#12372A]">How LexEase Handles Data & Updates</h2>
            <span className="text-xs text-[#8C9A92]">Accurate lifecycle safeguards</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F1EC] text-sm font-bold text-[#176B4D]">
                1
              </div>
              <h3 className="mt-3 text-sm font-bold text-[#12372A]">Consented Storage & Best-Effort Masking</h3>
              <p className="mt-1 text-xs leading-relaxed text-[#66736C]">
                Uploaded documents and extracted clauses are stored to support your analysis, summarization, and drafting sessions, but they never automatically train or update the model. Only clauses submitted through explicit feedback actions are stored for model review. PII masking performs best-effort detection for supported patterns (e.g., email addresses and phone numbers) but does not guarantee the removal of all personal or confidential details. Do not submit sensitive text unless you consent to its review and storage.
              </p>
            </div>

            <div className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F1EC] text-sm font-bold text-[#176B4D]">
                2
              </div>
              <h3 className="mt-3 text-sm font-bold text-[#12372A]">Authorized Human Review</h3>
              <p className="mt-1 text-xs leading-relaxed text-[#66736C]">
                Predictions and user suggestions are never treated as ground truth automatically. Every submitted clause is held in a private review queue where authorized reviewers inspect and verify labels before any data becomes eligible for candidate training.
              </p>
            </div>

            <div className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F1EC] text-sm font-bold text-[#176B4D]">
                3
              </div>
              <h3 className="mt-3 text-sm font-bold text-[#12372A]">Guarded Promotion on Validation Split</h3>
              <p className="mt-1 text-xs leading-relaxed text-[#66736C]">
                Candidate models must pass strict benchmark evaluations against fixed held-out validation clauses. A model is promoted only if Accuracy and Macro F1 improve or match baseline, and high-risk clause recall stays at or above 80%.
              </p>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-2xl border border-[#DCE6E0] bg-white p-8 text-center text-sm text-[#66736C]">
            Loading measured model results…
          </div>
        ) : (
          <>
            {/* Active Model Performance */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xl font-bold text-[#12372A]">
                    Active Model: <span className="text-[#176B4D]">{dashboard?.active_version || 'Baseline'}</span>
                  </h2>
                  <p className="text-xs text-[#66736C]">
                    Current live model serving risk classifications across contract clauses.
                  </p>
                </div>
                <div className="rounded-full border border-[#DCE6E0] bg-white px-3 py-1 text-xs font-semibold text-[#526058]">
                  Evaluation Benchmark: Held-Out Validation Split
                </div>
              </div>

              {metrics ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <MetricCard
                    label="Accuracy"
                    value={formatMetric(metrics.accuracy)}
                    detail={
                      testSampleCount
                        ? `Measured across ${testSampleCount} validation clauses`
                        : 'Validation sample count not recorded'
                    }
                    badge="Benchmark"
                  />
                  <MetricCard
                    label="Macro F1 Score"
                    value={formatMetric(metrics.macro_f1)}
                    detail="Balanced average across Low, Medium, and High risk"
                    badge="Multi-class"
                  />
                  <MetricCard
                    label="High-Risk Recall"
                    value={formatMetric(metrics.high_risk_recall)}
                    detail="Safety floor: ≥80% required to prevent missed risks"
                    badge="Safety Floor"
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-[#DCE6E0] bg-white p-6 text-sm leading-relaxed text-[#66736C] shadow-sm">
                  <p className="font-semibold text-[#12372A]">No Validation Measurement Recorded</p>
                  <p className="mt-1 text-xs text-[#8C9A92]">
                    No validation measurements have been recorded for the active baseline checkpoint yet. Scores are only displayed after explicit benchmark evaluation; LexEase never fabricates or estimates model metrics.
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-[#DCE6E0] bg-[#F8FAF8] p-4 text-xs leading-relaxed text-[#66736C]">
                <strong>Governance note:</strong> All reported evaluation metrics are computed on a standardized held-out validation dataset. Demonstration-only candidate thresholds (e.g. 15 approved feedback clauses) are instructional gates and do not imply statistically guaranteed model generalization.
              </div>
            </section>

            {/* Confusion Matrix */}
            <section className="space-y-3">
              <ConfusionMatrix
                matrix={metrics?.confusion_matrix}
                classes={metrics?.classes || ['low', 'medium', 'high']}
                sampleCount={testSampleCount}
              />
            </section>

            {/* Historical Performance Trend */}
            <section className="space-y-3">
              <ModelHistoryGraph
                history={dashboard?.history}
                activeVersion={dashboard?.active_version}
              />
            </section>

            {/* Version History Table */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-[#12372A]">Model Version & Cycle History</h2>
                {(() => {
                  const totalCycles = dashboard?.history?.length ?? 0
                  const evaluatedCycles = (dashboard?.history || []).filter((c) => {
                    const m = c.metrics?.candidate || c.metrics?.baseline || (c.metrics?.accuracy !== undefined ? c.metrics : null)
                    return Boolean(m)
                  }).length
                  return (
                    <span className="text-xs text-[#8C9A92]">
                      {totalCycles} {totalCycles === 1 ? 'cycle' : 'cycles'} recorded · {evaluatedCycles} evaluated
                    </span>
                  )
                })()}
              </div>

              {dashboard?.history?.length ? (
                <div className="overflow-hidden rounded-2xl border border-[#DCE6E0] bg-white shadow-sm">
                  <div className="divide-y divide-[#E8F1EC]">
                    {dashboard.history.map((cycle) => {
                      const cycleMetrics =
                        cycle.metrics?.candidate ||
                        cycle.metrics?.baseline ||
                        (cycle.metrics?.accuracy !== undefined ? cycle.metrics : null)
                      const baselineMetrics = cycle.metrics?.baseline
                      const candidateMetrics = cycle.metrics?.candidate

                      const statusLabel = getVersionStatusLabel(
                        cycle.version,
                        cycle.status,
                        dashboard?.active_version
                      )
                      const isActive = statusLabel === 'Active'
                      const isRejected = statusLabel === 'Rejected'
                      const isFailed = statusLabel === 'Failed'
                      const isPrevPromoted = statusLabel === 'Previously promoted'
                      const isQueued = statusLabel === 'Queued'
                      const isRunning = statusLabel === 'Running'

                      let badgeStyle = 'bg-[#F3F7F5] text-[#66736C]'
                      if (isActive) {
                        badgeStyle = 'bg-[#E8F1EC] text-[#176B4D]'
                      } else if (isRejected || isFailed) {
                        badgeStyle = 'bg-[#FEE2E2] text-[#991B1B]'
                      } else if (isPrevPromoted) {
                        badgeStyle = 'bg-[#EFF6FF] text-[#1D4ED8]'
                      } else if (isQueued) {
                        badgeStyle = 'bg-[#FEF3C7] text-[#92400E]'
                      } else if (isRunning) {
                        badgeStyle = 'bg-[#E0F2FE] text-[#0369A1] animate-pulse'
                      }

                      return (
                        <article key={cycle.version} className="grid gap-3 p-5 sm:grid-cols-[1.5fr_1fr_2.5fr] sm:items-center">
                          <div>
                            <p className="font-bold text-[#12372A]">{cycle.version}</p>
                            <p className="text-xs text-[#8C9A92]">
                              {cycle.created_at ? new Date(cycle.created_at).toLocaleDateString() : 'Date unrecorded'} ·{' '}
                              {cycle.approved_feedback_count} approved training clauses
                            </p>
                          </div>

                          <div>
                            <span
                              className={`inline-block rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${badgeStyle}`}
                            >
                              {statusLabel}
                            </span>
                          </div>

                          <div>
                            {cycleMetrics ? (
                              <div className="space-y-1 text-xs text-[#526058]">
                                <p>
                                  {baselineMetrics && candidateMetrics
                                    ? `Accuracy: ${(baselineMetrics.accuracy * 100).toFixed(1)}% → ${(candidateMetrics.accuracy * 100).toFixed(1)}% | F1: ${(baselineMetrics.macro_f1 * 100).toFixed(1)}% → ${(candidateMetrics.macro_f1 * 100).toFixed(1)}% | Recall: ${(baselineMetrics.high_risk_recall * 100).toFixed(1)}% → ${(candidateMetrics.high_risk_recall * 100).toFixed(1)}%`
                                    : `Accuracy: ${(cycleMetrics.accuracy * 100).toFixed(1)}% | Macro F1: ${(cycleMetrics.macro_f1 * 100).toFixed(1)}% | High-Risk Recall: ${(cycleMetrics.high_risk_recall * 100).toFixed(1)}%`}
                                </p>
                                <p className="text-[11px] text-[#8C9A92]">
                                  {Number.isFinite(cycle.test_sample_count)
                                    ? `Evaluated on ${cycle.test_sample_count} validation clauses`
                                    : 'Sample count not recorded'}
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-1 text-xs">
                                {cycle.error_message ? (
                                  <p className="font-medium text-[#991B1B]">{cycle.error_message}</p>
                                ) : null}
                                <p className="text-[#8C9A92]">No completed evaluation metrics</p>
                              </div>
                            )}

                            {cycle.acceptance?.checks && (
                              <p className="mt-1 text-[11px] text-[#66736C]">
                                Checks:{' '}
                                {Object.entries(cycle.acceptance.checks)
                                  .map(([k, v]) => `${k.replaceAll('_', ' ')} ${v ? '✓' : '✗'}`)
                                  .join(' · ')}
                              </p>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-[#DCE6E0] bg-white p-6 text-sm text-[#66736C]">
                  No training cycles recorded yet.
                </div>
              )}
            </section>

            {/* Customer Clause Suggestion Form */}
            <section className="rounded-2xl border border-[#DCE6E0] bg-white p-6 shadow-sm sm:p-8">
              <div className="max-w-2xl space-y-2">
                <span className="rounded bg-[#176B4D]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#176B4D]">
                  Community Feedback
                </span>
                <h2 className="text-xl font-bold text-[#12372A]">Suggest a Clause Correction</h2>
                <p className="text-xs leading-relaxed text-[#66736C]">
                  Notice a clause that was categorized incorrectly? Submit suggested corrections for inspection by an authorized reviewer.
                  Submitted clauses undergo best-effort PII masking for supported patterns, but complete removal of personal details cannot be guaranteed. Do not submit sensitive or confidential text unless you consent to its review and storage. Unreviewed submissions are never used to train the model.
                </p>
              </div>

              <form onSubmit={handleSubmitSuggestion} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="clause-text-input" className="block text-xs font-bold uppercase tracking-wider text-[#526058]">
                    Clause Text
                  </label>
                  <textarea
                    id="clause-text-input"
                    rows={4}
                    value={clauseText}
                    onChange={(e) => setClauseText(e.target.value)}
                    placeholder="Paste the contract clause here..."
                    className="mt-1.5 w-full rounded-xl border border-[#DCE6E0] p-3 text-sm focus:border-[#176B4D] focus:outline-none"
                    required
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="predicted-risk-select" className="block text-xs font-bold uppercase tracking-wider text-[#526058]">
                      System Risk Assessment
                    </label>
                    <select
                      id="predicted-risk-select"
                      value={predictedRisk}
                      onChange={(e) => setPredictedRisk(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-[#DCE6E0] bg-white p-2.5 text-sm focus:border-[#176B4D] focus:outline-none"
                    >
                      <option value="low">Low Risk</option>
                      <option value="medium">Medium Risk</option>
                      <option value="high">High Risk</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="suggested-risk-select" className="block text-xs font-bold uppercase tracking-wider text-[#526058]">
                      Your Suggested Assessment
                    </label>
                    <select
                      id="suggested-risk-select"
                      value={suggestedRisk}
                      onChange={(e) => setSuggestedRisk(e.target.value)}
                      className="mt-1.5 w-full rounded-xl border border-[#DCE6E0] bg-white p-2.5 text-sm focus:border-[#176B4D] focus:outline-none"
                    >
                      <option value="low">Low Risk</option>
                      <option value="medium">Medium Risk</option>
                      <option value="high">High Risk</option>
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-[#DCE6E0] bg-[#F8FAF8] p-4">
                  <label className="flex items-start gap-2.5 text-xs leading-relaxed text-[#526058]">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      className="mt-0.5 accent-[#176B4D]"
                      required
                    />
                    <span>
                      <strong>Explicit Consent:</strong> I consent to sharing this clause text for storage and inspection by authorized reviewers. I understand that PII masking is best-effort and does not guarantee the removal of all sensitive details, and that this submission will not immediately update the model.
                    </span>
                  </label>
                </div>

                {submitSuccess && (
                  <div role="status" className="rounded-xl border border-[#A7F3D0] bg-[#ECFDF5] p-3 text-xs font-semibold text-[#065F46]">
                    {submitSuccess}
                  </div>
                )}
                {submitError && (
                  <div role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-semibold text-[#991B1B]">
                    {submitError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!consent || submitting || !clauseText.trim()}
                  className="rounded-xl bg-[#176B4D] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#124F38] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? 'Submitting for Review…' : 'Submit for Review'}
                </button>
              </form>
            </section>
          </>
        )}

        {/* Footer / Discrete Reviewer Console Link */}
        <footer className="border-t border-[#DCE6E0] pt-6 text-center text-xs text-[#8C9A92]">
          Authorized reviewer or system administrator?{' '}
          <Link to="/adaptive-learning/admin" className="font-semibold text-[#176B4D] hover:underline">
            Access Reviewer Console
          </Link>
        </footer>
      </main>
    </div>
  )
}

export default AdaptiveLearning
