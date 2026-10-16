import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  IconAlertTriangle,
  IconAlertCircle,
  IconCheckCircle,
  IconInfo,
  IconSearch,
  IconLightbulb,
  IconDocument,
} from './Icons'
import { submitClauseFeedback, getErrorMessage } from '../api/client'

function ClauseFeedbackInline({ clauseText, predictedRisk, clauseId, onClose }) {
  const [correctedRisk, setCorrectedRisk] = useState(
    predictedRisk === 'high' ? 'medium' : predictedRisk === 'medium' ? 'low' : 'medium'
  )
  const [explanation, setExplanation] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!consent) {
      setErrorMsg('Please give consent to store the clause text for review.')
      return
    }
    if (!clauseText || clauseText.trim().length < 5) {
      setErrorMsg('Clause text is too short to submit for review.')
      return
    }
    setSubmitting(true)
    setErrorMsg('')
    try {
      await submitClauseFeedback({
        clause_text: clauseText.trim(),
        predicted_risk_level: predictedRisk.toLowerCase(),
        corrected_risk_level: correctedRisk.toLowerCase(),
        consent: true,
        explanation: explanation.trim() || undefined,
        source_group_id: clauseId ? `clause-${clauseId}` : undefined,
      })
      setSubmitted(true)
    } catch (err) {
      setErrorMsg(getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="p-3.5 bg-[#E8F5E9] border border-[#A5D6A7] rounded-lg text-xs text-[#1B5E20] space-y-1">
        <p className="font-semibold">Feedback submitted for review!</p>
        <p>
          This clause has been queued for human reviewer evaluation and will be retained as a reviewed example for future offline analysis. The active model is not changed.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-1 text-xs text-[#2E7D32] underline hover:no-underline font-medium cursor-pointer"
        >
          Close
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="p-3.5 bg-white border border-[#DCE6E0] rounded-lg text-xs space-y-3 shadow-2xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-[#12372A]">Suggest Risk Label Correction</span>
        <button
          type="button"
          onClick={onClose}
          className="text-[#66736C] hover:text-[#16221C] text-xs cursor-pointer"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-[#66736C]">
        Submissions are reviewed by human reviewers before being added to a dataset of reviewed examples for future evaluation. Approval does not retrain or modify the live model.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[#526058] mb-1">
            Current Predicted Risk
          </label>
          <div className="px-2.5 py-1.5 bg-[#F8FAF8] border border-[#DCE6E0] rounded text-xs font-medium capitalize text-[#526058]">
            {predictedRisk}
          </div>
        </div>
        <div>
          <label htmlFor={`suggested-risk-${clauseId}`} className="block text-[10px] font-bold uppercase tracking-wider text-[#526058] mb-1">
            Suggested Risk Label
          </label>
          <select
            id={`suggested-risk-${clauseId}`}
            value={correctedRisk}
            onChange={(e) => setCorrectedRisk(e.target.value)}
            className="w-full px-2.5 py-1.5 bg-white border border-[#DCE6E0] rounded text-xs focus:ring-1 focus:ring-[#176B4D] focus:border-[#176B4D]"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor={`explanation-${clauseId}`} className="block text-[10px] font-bold uppercase tracking-wider text-[#526058] mb-1">
          Explanation / Reason (optional)
        </label>
        <textarea
          id={`explanation-${clauseId}`}
          rows={2}
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          placeholder="Why should this clause have a different risk level?"
          className="w-full p-2 bg-white border border-[#DCE6E0] rounded text-xs focus:ring-1 focus:ring-[#176B4D] focus:border-[#176B4D]"
          maxLength={1000}
        />
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 rounded border-[#DCE6E0] text-[#176B4D] focus:ring-[#176B4D]"
        />
        <span className="text-[11px] text-[#526058] leading-tight">
          I agree that this clause text and suggested label may be stored and reviewed for dataset collection.
        </span>
      </label>

      {errorMsg && (
        <div className="p-2 bg-[#FFF2F2] border border-[#F5C2C2] text-[#C94A4A] rounded text-[11px]">
          {errorMsg}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting || !consent}
          className="px-3 py-1.5 bg-[#176B4D] hover:bg-[#12543C] disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer shadow-2xs"
        >
          {submitting ? 'Submitting...' : 'Submit for Review'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 bg-white border border-[#DCE6E0] text-[#526058] hover:bg-[#F8FAF8] rounded text-xs cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// Lightweight Animated Counter Hook for smooth metrics count-up (0 -> target)
function useCountUp(target, duration = 850) {
  const [count, setCount] = useState(0)
  const prevTargetRef = useRef(0)
  const hasAnimatedRef = useRef(false)

  useEffect(() => {
    if (target === undefined || target === null) return
    const endVal = Number(target)
    if (isNaN(endVal)) return

    // Respect user's motion preferences
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(endVal)
      prevTargetRef.current = endVal
      return
    }

    const startVal = hasAnimatedRef.current ? prevTargetRef.current : 0
    if (hasAnimatedRef.current && startVal === endVal) {
      return // Do not re-animate if the value hasn't changed (e.g. filter toggle)
    }

    hasAnimatedRef.current = true
    let start = null
    let rafId = null

    const step = (timestamp) => {
      if (!start) start = timestamp
      const elapsed = timestamp - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease out: smooth deceleration into the target
      const easeOut = 1 - Math.pow(1 - progress, 2.5)
      const current = Math.round(startVal + (endVal - startVal) * easeOut)
      setCount(current)

      if (progress < 1) {
        rafId = requestAnimationFrame(step)
      } else {
        prevTargetRef.current = endVal
      }
    }

    rafId = requestAnimationFrame(step)
    return () => {
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [target, duration])

  return count
}

function ClauseRiskAnalysis({ analysisData, originalClauses = [], isLoading, error, onRetry }) {
  const [filterRisk, setFilterRisk] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedClauses, setExpandedClauses] = useState({})
  const [flaggingClauseId, setFlaggingClauseId] = useState(null)
  // Map original clause text by clause_id for rapid lookup
  const clauseTextMap = useMemo(() => {
    const map = new Map()
    if (Array.isArray(originalClauses)) {
      originalClauses.forEach((c) => {
        map.set(c.clause_id, c.text)
      })
    }
    return map
  }, [originalClauses])

  // Count risk levels
  const stats = useMemo(() => {
    const results = analysisData?.results || []
    return {
      total: results.length,
      high: results.filter((r) => r.risk_level === 'high').length,
      medium: results.filter((r) => r.risk_level === 'medium').length,
      low: results.filter((r) => r.risk_level === 'low').length,
    }
  }, [analysisData])

  // Overall liability score (0-100) and exposure rating
  const { riskScore, riskRating, gaugeColor } = useMemo(() => {
    const total = stats.total
    if (total === 0) {
      return { riskScore: 0, riskRating: 'Low', gaugeColor: '#3E8E63' }
    }
    const score = Math.min(
      100,
      Math.round((stats.high * 90 + stats.medium * 50 + stats.low * 15) / total)
    )
    let rating = 'Low'
    let color = '#3E8E63'
    if (stats.high > 0 || score >= 70) {
      rating = 'High'
      color = '#C94A4A'
    } else if (stats.medium > 0 || score >= 40) {
      rating = 'Medium'
      color = '#D18A24'
    }
    return { riskScore: score, riskRating: rating, gaugeColor: color }
  }, [stats])

  // Animated metric counters
  const animatedScore = useCountUp(riskScore, 1000)
  const animatedTotal = useCountUp(stats.total, 800)
  const animatedHigh = useCountUp(stats.high, 800)
  const animatedMedium = useCountUp(stats.medium, 800)
  const animatedLow = useCountUp(stats.low, 800)

  // Filtered clause list
  const filteredResults = useMemo(() => {
    const results = analysisData?.results || []
    return results.filter((item) => {
      // Risk filter
      if (filterRisk !== 'all' && item.risk_level !== filterRisk) {
        return false
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const text = clauseTextMap.get(item.clause_id) || ''
        const matchesId = item.clause_id.toLowerCase().includes(q)
        const matchesNum = (item.clause_number || '').toLowerCase().includes(q)
        const matchesText = text.toLowerCase().includes(q)
        const matchesExp = item.explanation.toLowerCase().includes(q)
        const matchesRec = item.recommendation.toLowerCase().includes(q)
        return matchesId || matchesNum || matchesText || matchesExp || matchesRec
      }
      return true
    })
  }, [analysisData, filterRisk, searchQuery, clauseTextMap])

  const toggleExpand = (clauseId) => {
    setExpandedClauses((prev) => ({
      ...prev,
      [clauseId]: !prev[clauseId],
    }))
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="p-6 rounded-2xl bg-white border border-[#DCE6E0] space-y-4">
          <div className="h-24 bg-[#F3F7F5] rounded-xl"></div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-[#F3F7F5] rounded-xl"></div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-44 bg-white rounded-2xl border border-[#DCE6E0]"></div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 sm:p-8 rounded-2xl bg-white border border-[#F5C2C2] space-y-4 text-center shadow-sm">
        <div className="w-12 h-12 rounded-full bg-[#FFF2F2] border border-[#F5C2C2] text-[#C94A4A] flex items-center justify-center mx-auto">
          <IconAlertTriangle className="w-6 h-6 text-[#C94A4A]" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-[#C94A4A]">
            Clause Risk Analysis Failed
          </h3>
          <p className="text-xs text-[#66736C] max-w-md mx-auto">{error}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-white hover:bg-[#F3F7F5] text-[#16221C] border border-[#DCE6E0] transition-colors shadow-2xs"
          >
            Retry Analysis
          </button>
        )}
      </div>
    )
  }

  if (!analysisData || !analysisData.results || analysisData.results.length === 0) {
    return (
      <div className="p-8 rounded-2xl bg-white border border-[#DCE6E0] text-center text-[#8C9A92] shadow-sm">
        No clause analysis available.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Integrated Overall Liability & Risk Summary Bar */}
      <div className="p-4 sm:p-5 rounded-xl bg-white border border-[#D4DFD9] shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-5">
          {/* Primary Analytical Instrument: Contract Risk Index Gauge */}
          <div
            className={`flex items-center gap-4.5 p-4 rounded-xl border shrink-0 shadow-2xs ${
              riskRating === 'High'
                ? 'bg-[#FFF5F5] border-[#F5C2C2] border-l-[3.5px] border-l-[#C94A4A]'
                : riskRating === 'Medium'
                ? 'bg-[#FFF8EE] border-[#F8DEC0] border-l-[3.5px] border-l-[#D18A24]'
                : 'bg-[#F3F8F5] border-[#C8DECE] border-l-[3.5px] border-l-[#3E8E63]'
            }`}
          >
            <div className="relative flex items-center justify-center w-20 h-20 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                {/* Background Ring */}
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  stroke="#E8F1EC"
                  strokeWidth="10"
                  fill="transparent"
                />
                {/* Dynamic Active Arc */}
                <circle
                  cx="60"
                  cy="60"
                  r="48"
                  stroke={gaugeColor}
                  strokeWidth="10"
                  fill="transparent"
                  strokeDasharray="301.6"
                  strokeDashoffset={301.6 - (301.6 * riskScore) / 100}
                  strokeLinecap="round"
                  className="transition-all duration-700 ease-out"
                />
              </svg>
              <div className="absolute text-center flex flex-col items-center justify-center">
                <span className="text-xl font-extrabold text-[#16221C] tracking-tight font-mono">
                  {animatedScore}
                </span>
                <span className="text-[9px] text-[#526058] font-mono uppercase">
                  / 100
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#526058] block font-mono">
                Contract Risk Index
              </span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wide border ${
                  riskRating === 'High'
                    ? 'bg-[#FFF2F2] text-[#C94A4A] border-[#F5C2C2]'
                    : riskRating === 'Medium'
                    ? 'bg-[#FEF3E2] text-[#D18A24] border-[#F8DEC0]'
                    : 'bg-[#E8F1EC] text-[#3E8E63] border-[#C8DECE]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    riskRating === 'High'
                      ? 'bg-[#C94A4A]'
                      : riskRating === 'Medium'
                      ? 'bg-[#D18A24]'
                      : 'bg-[#3E8E63]'
                  }`}
                />
                {riskRating} Exposure
              </span>
              <p className="text-[11px] text-[#526058] leading-tight">
                Severity weighted risk score
              </p>
            </div>
          </div>

          {/* Subordinate Metric Counters Panel */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 flex-1">
            {/* Total Clauses */}
            <div
              role="button"
              tabIndex={0}
              aria-pressed={filterRisk === 'all'}
              aria-label="Filter by all clauses"
              onClick={() => setFilterRisk('all')}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setFilterRisk('all')}
              className={`p-3 rounded-lg border transition-all duration-200 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#176B4D]/30 ${
                filterRisk === 'all'
                  ? 'bg-[#E8F1EC] border-[#176B4D] shadow-2xs ring-2 ring-[#176B4D]/25 border-l-[3.5px] border-l-[#176B4D]'
                  : 'bg-[#F8FAF8] border-[#DCE6E0] border-l-[3.5px] border-l-[#176B4D] hover:border-[#176B4D]/60 hover:bg-white'
              }`}
            >
              <span className="text-[10px] font-bold text-[#526058] uppercase tracking-wider block font-mono">
                Total Clauses
              </span>
              <div
                className={`text-xl font-extrabold mt-0.5 font-mono ${
                  filterRisk === 'all' ? 'text-[#12372A]' : 'text-[#16221C]'
                }`}
              >
                {animatedTotal}
              </div>
              <span className="text-[10px] text-[#526058]">All provisions</span>
            </div>

            {/* High Risk */}
            <div
              role="button"
              tabIndex={0}
              aria-pressed={filterRisk === 'high'}
              aria-label="Filter by high risk clauses"
              onClick={() => setFilterRisk(filterRisk === 'high' ? 'all' : 'high')}
              onKeyDown={(e) =>
                (e.key === 'Enter' || e.key === ' ') &&
                setFilterRisk(filterRisk === 'high' ? 'all' : 'high')
              }
              className={`p-3 rounded-lg border transition-all duration-200 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#C94A4A]/30 ${
                filterRisk === 'high'
                  ? 'bg-[#FFF0F0] border-[#C94A4A] shadow-2xs ring-2 ring-[#C94A4A]/30 border-l-[3.5px] border-l-[#C94A4A]'
                  : 'bg-[#FFF5F5] border-[#F5C2C2] border-l-[3.5px] border-l-[#C94A4A] hover:border-[#C94A4A] hover:bg-[#FFF0F0]'
              }`}
            >
              <span className="text-[10px] font-bold text-[#B43838] uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-[#C94A4A]"></span> High Risk
              </span>
              <div
                className={`text-xl font-extrabold mt-0.5 font-mono ${
                  filterRisk === 'high' ? 'text-[#962828]' : 'text-[#B43838]'
                }`}
              >
                {animatedHigh}
              </div>
              <span className="text-[10px] text-[#8A3B3B]">Action required</span>
            </div>

            {/* Medium Risk */}
            <div
              role="button"
              tabIndex={0}
              aria-pressed={filterRisk === 'medium'}
              aria-label="Filter by medium risk clauses"
              onClick={() => setFilterRisk(filterRisk === 'medium' ? 'all' : 'medium')}
              onKeyDown={(e) =>
                (e.key === 'Enter' || e.key === ' ') &&
                setFilterRisk(filterRisk === 'medium' ? 'all' : 'medium')
              }
              className={`p-3 rounded-lg border transition-all duration-200 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#D18A24]/30 ${
                filterRisk === 'medium'
                  ? 'bg-[#FEF1DC] border-[#D18A24] shadow-2xs ring-2 ring-[#D18A24]/30 border-l-[3.5px] border-l-[#D18A24]'
                  : 'bg-[#FEF9F2] border-[#F8DEC0] border-l-[3.5px] border-l-[#D18A24] hover:border-[#D18A24] hover:bg-[#FEF3E2]'
              }`}
            >
              <span className="text-[10px] font-bold text-[#A35E05] uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-[#D18A24]"></span> Medium Risk
              </span>
              <div
                className={`text-xl font-extrabold mt-0.5 font-mono ${
                  filterRisk === 'medium' ? 'text-[#874900]' : 'text-[#A35E05]'
                }`}
              >
                {animatedMedium}
              </div>
              <span className="text-[10px] text-[#8C5D18]">Caution advised</span>
            </div>

            {/* Low Risk */}
            <div
              role="button"
              tabIndex={0}
              aria-pressed={filterRisk === 'low'}
              aria-label="Filter by low risk clauses"
              onClick={() => setFilterRisk(filterRisk === 'low' ? 'all' : 'low')}
              onKeyDown={(e) =>
                (e.key === 'Enter' || e.key === ' ') &&
                setFilterRisk(filterRisk === 'low' ? 'all' : 'low')
              }
              className={`p-3 rounded-lg border transition-all duration-200 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#3E8E63]/30 ${
                filterRisk === 'low'
                  ? 'bg-[#E4ECE7] border-[#3E8E63] shadow-2xs ring-2 ring-[#3E8E63]/30 border-l-[3.5px] border-l-[#3E8E63]'
                  : 'bg-[#F4F8F5] border-[#C8DECE] border-l-[3.5px] border-l-[#3E8E63] hover:border-[#3E8E63] hover:bg-[#E8F1EC]'
              }`}
            >
              <span className="text-[10px] font-bold text-[#236E46] uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3E8E63]"></span> Low Risk
              </span>
              <div
                className={`text-xl font-extrabold mt-0.5 font-mono ${
                  filterRisk === 'low' ? 'text-[#1E5C3A]' : 'text-[#236E46]'
                }`}
              >
                {animatedLow}
              </div>
              <span className="text-[10px] text-[#2E4E3B]">Standard terms</span>
            </div>
          </div>
        </div>

        {/* Filter Toolbar & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3.5 border-t border-[#DCE6E0]">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'All Clauses', count: stats.total, activeClass: 'border-[#12372A] bg-[#12372A] text-white' },
              { id: 'high', label: 'High Risk', count: stats.high, activeClass: 'border-[#C94A4A] bg-[#C94A4A] text-white' },
              { id: 'medium', label: 'Medium Risk', count: stats.medium, activeClass: 'border-[#D18A24] bg-[#D18A24] text-white' },
              { id: 'low', label: 'Low Risk', count: stats.low, activeClass: 'border-[#3E8E63] bg-[#3E8E63] text-white' },
            ].map(({ id, label, count, activeClass }) => {
              const isActive = filterRisk === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilterRisk(id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all duration-200 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? `${activeClass} shadow-2xs ring-1 ring-black/10`
                      : 'border-[#DCE6E0] bg-[#F8FAF8] text-[#526058] hover:text-[#16221C] hover:bg-[#E8F1EC]'
                  }`}
                >
                  <span>{label}</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-[#E8F1EC] text-[#526058]'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Search Bar */}
          <div className="relative flex-1 sm:max-w-xs">
            <input
              type="text"
              placeholder="Search clause provisions, topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-7 py-2 text-xs rounded-lg bg-[#F8FAF8] border border-[#DCE6E0] text-[#16221C] placeholder-[#526058] focus:outline-none focus:border-[#176B4D] focus:bg-white focus:ring-1 focus:ring-[#176B4D]/30 transition-all shadow-2xs"
            />
            <span className="absolute left-2.5 top-2.5 text-[#526058]">
              <IconSearch className="w-3.5 h-3.5" />
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search input"
                className="absolute right-2.5 top-2 text-[#526058] hover:text-[#16221C] text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Clause Cards List */}
      {filteredResults.length === 0 ? (
        <div className="p-8 rounded-xl bg-white border border-[#DCE6E0] text-center text-[#526058] space-y-2 shadow-xs">
          <p className="text-sm font-medium">No clauses match your active filters.</p>
          <button
            type="button"
            onClick={() => {
              setFilterRisk('all')
              setSearchQuery('')
            }}
            className="text-xs text-[#176B4D] hover:underline font-bold cursor-pointer"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredResults.map((result, idx) => {
            const rawText = clauseTextMap.get(result.clause_id)
            const isExpanded = expandedClauses[result.clause_id]
            const confidencePercent = Math.round((result.confidence ?? 0) * 100)

            // Derive clean single clause identifier without duplication
            // If clause_number exists (e.g. "1" or "4.2"), format as "CLAUSE 1" / "CLAUSE 4.2"
            // If cleanIdLabel exists and is not just a duplicate of "Clause X", preserve it as contextual title
            const rawNum = result.clause_number
              ? String(result.clause_number).trim()
              : result.clause_id
              ? result.clause_id.replace(/^clause_?/i, '').trim()
              : String(idx + 1)

            const formattedClauseTitle = rawNum.toLowerCase().startsWith('clause')
              ? rawNum.toUpperCase()
              : `CLAUSE ${rawNum}`

            const cleanIdLabel = result.clause_id
              ? result.clause_id.replace(/_/g, ' ').trim()
              : ''

            // Check if cleanIdLabel is redundant (e.g. "Clause 1", "Clause 01", "Clause")
            const isRedundantId =
              !cleanIdLabel ||
              /^clause\s*\d*$/i.test(cleanIdLabel) ||
              cleanIdLabel.toLowerCase() === rawNum.toLowerCase() ||
              `clause ${cleanIdLabel}`.toLowerCase() === formattedClauseTitle.toLowerCase()

            const riskTheme = {
              high: {
                cardBg: 'bg-[#FFF5F5]',
                cardBorder: 'border-[#F5C2C2] hover:border-[#C94A4A]/50',
                badge: 'bg-[#FFF2F2] text-[#C94A4A] border-[#F5C2C2]',
                borderLeft: 'border-l-[3.5px] border-l-[#C94A4A]',
                label: 'High Risk',
                icon: <IconAlertTriangle className="w-3.5 h-3.5 text-[#C94A4A]" />,
              },
              medium: {
                cardBg: 'bg-[#FFF8EE]',
                cardBorder: 'border-[#F8DEC0] hover:border-[#D18A24]/50',
                badge: 'bg-[#FEF3E2] text-[#D18A24] border-[#F8DEC0]',
                borderLeft: 'border-l-[3.5px] border-l-[#D18A24]',
                label: 'Medium Risk',
                icon: <IconAlertCircle className="w-3.5 h-3.5 text-[#D18A24]" />,
              },
              low: {
                cardBg: 'bg-[#F3F8F5]',
                cardBorder: 'border-[#C8DECE] hover:border-[#3E8E63]/50',
                badge: 'bg-[#E8F1EC] text-[#3E8E63] border-[#C8DECE]',
                borderLeft: 'border-l-[3.5px] border-l-[#3E8E63]',
                label: 'Low Risk',
                icon: <IconCheckCircle className="w-3.5 h-3.5 text-[#3E8E63]" />,
              },
            }[result.risk_level] || {
              cardBg: 'bg-white',
              cardBorder: 'border-[#D4DFD9] hover:border-[#176B4D]/40',
              badge: 'bg-[#F3F7F5] text-[#526058] border-[#DCE6E0]',
              borderLeft: 'border-l-[3.5px] border-l-[#DCE6E0]',
              label: result.risk_level,
              icon: <IconInfo className="w-3.5 h-3.5 text-[#526058]" />,
            }

            return (
              <div
                key={result.clause_id}
                id={`clause-${result.clause_id}`}
                className={`p-4 sm:p-5 rounded-xl ${riskTheme.cardBg} border ${riskTheme.cardBorder} shadow-xs hover:shadow-sm transition-all duration-200 ease-out space-y-4 ${riskTheme.borderLeft}`}
                style={{ animationDelay: `${Math.min(idx * 30, 250)}ms` }}
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-[#DCE6E0] pb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono font-bold px-2.5 py-1 rounded bg-white border border-[#DCE6E0] text-[#16221C] shadow-2xs">
                      {formattedClauseTitle}
                    </span>
                    {!isRedundantId && (
                      <span className="text-sm font-bold text-[#16221C] tracking-tight">
                        {cleanIdLabel}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Confidence */}
                    <span className="text-[11px] font-mono text-[#526058] bg-white px-2 py-0.5 rounded border border-[#DCE6E0] shadow-2xs">
                      {confidencePercent}% confidence
                    </span>
                    {/* Risk Badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border shadow-2xs ${riskTheme.badge}`}
                    >
                      <span>{riskTheme.icon}</span>
                      {riskTheme.label}
                    </span>
                    {/* Flag Label Button */}
                    <button
                      type="button"
                      onClick={() => setFlaggingClauseId(flaggingClauseId === result.clause_id ? null : result.clause_id)}
                      className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[11px] font-medium text-[#526058] hover:text-[#176B4D] bg-white hover:bg-[#F2F8F5] border border-[#DCE6E0] shadow-2xs transition-colors cursor-pointer"
                      title="Flag risk label or suggest a correction for this clause"
                    >
                      <span>🚩</span>
                      <span>{flaggingClauseId === result.clause_id ? 'Cancel' : 'Flag label'}</span>
                    </button>
                  </div>
                </div>

                {/* Inline Feedback / Suggestion Form */}
                {flaggingClauseId === result.clause_id && (
                  <ClauseFeedbackInline
                    clauseText={rawText}
                    predictedRisk={result.risk_level}
                    clauseId={result.clause_id}
                    onClose={() => setFlaggingClauseId(null)}
                  />
                )}

                {/* Section 1: Original Clause Text */}
                {rawText && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-[#526058] uppercase tracking-wider font-mono flex items-center gap-1.5">
                        <IconDocument className="w-3.5 h-3.5 text-[#526058]" />
                        <span>Original Clause Text</span>
                      </span>
                      {rawText.length > 280 && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(result.clause_id)}
                          aria-expanded={Boolean(isExpanded)}
                          aria-controls={`clause-text-${result.clause_id}`}
                          className="text-xs text-[#176B4D] hover:underline font-semibold transition-colors cursor-pointer"
                        >
                          {isExpanded ? 'Show less' : 'Show full text'}
                        </button>
                      )}
                    </div>
                    <div className="p-3.5 sm:p-4 bg-[#F8FAF8] border border-[#D2DDD6] border-l-[3px] border-l-[#72877B] rounded-lg shadow-2xs">
                      <p
                        id={`clause-text-${result.clause_id}`}
                        className={`text-xs sm:text-[13px] text-[#16221C] leading-relaxed font-serif italic ${
                          rawText.length > 280 && !isExpanded ? 'line-clamp-3' : ''
                        }`}
                      >
                        &ldquo;{rawText}&rdquo;
                      </p>
                    </div>
                  </div>
                )}

                {/* Section 2: Plain-English Legal Interpretation */}
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-[#176B4D] uppercase tracking-wider flex items-center gap-1.5 font-mono">
                    <IconSearch className="w-3.5 h-3.5 text-[#176B4D]" />
                    <span>Plain-English Legal Interpretation</span>
                  </span>
                  <div className="p-3.5 sm:p-4 rounded-lg bg-[#F2F8F5] border border-[#C8DECE] border-l-[3px] border-l-[#176B4D] text-xs sm:text-sm text-[#16221C] leading-relaxed font-normal shadow-2xs">
                    {result.explanation}
                  </div>
                </div>

                {/* Recommendation heading stays separate from its text; the API omits the duplicate prefix. */}
                {result.recommendation && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-[#D18A24] uppercase tracking-wider flex items-center gap-1.5 font-mono">
                      <IconLightbulb className="w-3.5 h-3.5 text-[#D18A24]" />
                      <span>Recommendation Before Signing</span>
                    </span>
                    <div className="p-3.5 sm:p-4 rounded-lg bg-[#FFF8EC] border border-[#F8DEC0] border-l-[3.5px] border-l-[#D18A24] text-xs sm:text-sm text-[#16221C] flex items-start gap-2.5 shadow-2xs">
                      <span className="text-xs sm:text-sm text-[#16221C] leading-relaxed flex-1">
                        {result.recommendation}
                      </span>
                    </div>
                  </div>
                )}

              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ClauseRiskAnalysis
