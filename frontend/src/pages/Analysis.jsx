import React, { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Card from '../components/Card'
import { summarizeDocument, analyzeClauses } from '../api/client'

function Analysis() {
  const location = useLocation()
  const navigate = useNavigate()
  const passedState = location.state

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [summaryData, setSummaryData] = useState(null)
  const [analysisData, setAnalysisData] = useState(null)

  // Document metadata from React Router location state
  const docName = passedState?.fileName || 'Document.pdf'
  const docSize = passedState?.fileSize || 'N/A'
  const docType = passedState?.fileType || 'application/pdf'
  const docUploadedAt = passedState?.uploadedAt || 'Just now'
  const clauses = passedState?.clauses || []
  const docPageCount = passedState?.pageCount ?? (clauses.length > 0 ? `${clauses.length} clauses` : 'N/A')

  const fetchAnalysis = useCallback(async () => {
    if (!passedState || clauses.length === 0) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Execute both summary and clause risk analysis in parallel
      const docId = passedState?.document_id
      const [summaryRes, analysisRes] = await Promise.all([
        summarizeDocument(clauses, docId),
        analyzeClauses(clauses, docId),
      ])

      setSummaryData(summaryRes)
      setAnalysisData(analysisRes)
    } catch (err) {
      const message =
        err?.response?.data?.detail ??
        err?.response?.data?.message ??
        err?.message ??
        'Failed to analyze document. Please check your backend connection and try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [passedState, clauses])

  useEffect(() => {
    fetchAnalysis()
  }, [fetchAnalysis])

  // Helper to resolve severity badge colors
  const getSeverityStyle = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high':
        return 'bg-red-500/10 text-red-400 border-red-500/20'
      case 'medium':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      case 'low':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20'
    }
  }

  // Helper to resolve gauge circle stroke color
  const getGaugeColor = (rating) => {
    switch (rating?.toLowerCase()) {
      case 'high':
        return '#EF4444'
      case 'medium':
        return '#F59E0B'
      case 'low':
        return '#10B981'
      default:
        return '#D4AF37'
    }
  }

  // If no document has been uploaded, display empty-state
  if (!passedState) {
    return (
      <div className="max-w-md mx-auto py-12 sm:py-20 text-center">
        <div className="bg-[#1E293B] border border-slate-800 rounded-2xl p-8 sm:p-10 shadow-xl space-y-6 flex flex-col items-center">
          {/* Custom Empty State Icon */}
          <div className="w-16 h-16 rounded-full bg-slate-800/80 border border-slate-700/50 flex items-center justify-center text-[#D4AF37]">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <div className="space-y-2">
            <h1 className="text-xl sm:text-2xl font-extrabold text-[#F8FAFC]">
              No Document Analyzed
            </h1>
            <p className="text-[#94A3B8] text-sm leading-relaxed max-w-sm">
              Upload a legal document to begin analysis.
            </p>
          </div>

          <button
            onClick={() => navigate('/upload')}
            className="w-full py-3 rounded-lg font-semibold tracking-wide text-white bg-[#2563EB] hover:bg-[#2563EB]/90 transition-all duration-300 border border-[#2563EB] active:scale-95 shadow-lg shadow-[#2563EB]/10"
          >
            Go to Upload
          </button>
        </div>
      </div>
    )
  }

  // Calculate overall risk score and rating from real clause analysis results
  const results = analysisData?.results || []
  const totalResults = results.length

  let riskScore = 0
  let riskRating = 'Low'

  if (totalResults > 0) {
    const highCount = results.filter((r) => r.risk_level?.toLowerCase() === 'high').length
    const mediumCount = results.filter((r) => r.risk_level?.toLowerCase() === 'medium').length
    const lowCount = results.filter((r) => r.risk_level?.toLowerCase() === 'low').length

    riskScore = Math.min(100, Math.round((highCount * 90 + mediumCount * 50 + lowCount * 15) / totalResults))

    if (highCount > 0 || riskScore >= 70) {
      riskRating = 'High'
    } else if (mediumCount > 0 || riskScore >= 40) {
      riskRating = 'Medium'
    } else {
      riskRating = 'Low'
    }
  }

  // Map clause results by clause_id for rapid O(1) lookup
  const analysisMap = new Map(results.map((r) => [r.clause_id, r]))

  // Sort risks for the Identified Risks list (High -> Medium -> Low)
  const sortedRisks = [...results].sort((a, b) => {
    const order = { high: 1, medium: 2, low: 3 }
    return (order[a.risk_level?.toLowerCase()] || 4) - (order[b.risk_level?.toLowerCase()] || 4)
  })

  return (
    <div className="space-y-8 py-4 sm:py-6">
      {/* Top Document Header Section */}
      <div className="bg-[#1E293B] border border-slate-800 rounded-2xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-lg">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-[#2563EB]/10 border border-[#2563EB]/20 flex items-center justify-center text-2xl text-[#2563EB]">
            📄
          </div>
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-bold text-[#F8FAFC] tracking-tight break-all">
              {docName}
            </h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#94A3B8]">
              <span>Uploaded: {docUploadedAt}</span>
              <span className="hidden sm:inline text-slate-700">•</span>
              <span>Size: {docSize}</span>
              <span className="hidden sm:inline text-slate-700">•</span>
              <span>Type: {docType}</span>
              <span className="hidden sm:inline text-slate-700">•</span>
              <span>Pages / Segments: {docPageCount}</span>
            </div>
          </div>
        </div>

        <div>
          {loading ? (
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <svg className="animate-spin h-3.5 w-3.5 text-blue-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Analyzing Document...
            </span>
          ) : error ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
              Analysis Failed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Analyzed
            </span>
          )}
        </div>
      </div>

      {/* Error Banner with Retry */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <svg className="mt-0.5 h-5 w-5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="space-y-1 flex-1">
              <h3 className="text-sm font-bold text-red-300">Analysis Error</h3>
              <p className="text-sm text-red-400 leading-relaxed">{error}</p>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2 border-t border-red-500/20">
            <button
              onClick={fetchAnalysis}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 transition-colors"
            >
              Retry Analysis
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons Section */}
      <div className="flex flex-col sm:flex-row items-center justify-start gap-4">
        <button
          onClick={() => navigate('/upload')}
          className="w-full sm:w-auto px-6 py-3 rounded-lg font-semibold tracking-wide text-white bg-[#2563EB] hover:bg-[#2563EB]/90 active:scale-95 transition-all duration-300 border border-[#2563EB] shadow-md shadow-[#2563EB]/10 inline-flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Analyze Another Document
        </button>
        <button
          onClick={() => navigate('/')}
          className="w-full sm:w-auto px-6 py-3 rounded-lg font-semibold tracking-wide text-[#94A3B8] hover:text-[#F8FAFC] border border-slate-700 hover:border-slate-600 hover:bg-slate-800/40 active:scale-95 transition-all duration-300 inline-flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
          Back to Home
        </button>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Summary and Clauses (2/3 width on desktop) */}
        <div className="lg:col-span-2 space-y-8">
          {/* Card 1: Document Summary */}
          <Card
            title={
              summaryData?.document_type
                ? `Document Summary • ${summaryData.document_type}`
                : 'Document Summary'
            }
            subtitle="High-level overview generated by AI"
          >
            {loading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 bg-slate-800 rounded w-full"></div>
                <div className="h-4 bg-slate-800 rounded w-5/6"></div>
                <div className="h-4 bg-slate-800 rounded w-4/6"></div>
              </div>
            ) : summaryData ? (
              <div className="space-y-4">
                <p className="text-base text-[#F8FAFC] leading-relaxed">
                  {summaryData.summary}
                </p>

                {summaryData.key_points && summaryData.key_points.length > 0 && (
                  <div className="pt-3 border-t border-slate-800/80 space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#94A3B8]">
                      Key Highlights
                    </h4>
                    <ul className="space-y-2">
                      {summaryData.key_points.map((point, idx) => (
                        <li key={idx} className="text-sm text-[#94A3B8] flex items-start gap-2">
                          <span className="text-[#2563EB] font-bold mt-0.5">•</span>
                          <span className="leading-relaxed">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-[#94A3B8]">Summary unavailable.</p>
            )}
          </Card>

          {/* Card 2: Simplified Clauses */}
          <div>
            <div className="flex items-center justify-between mb-4 px-1">
              <div>
                <h2 className="text-xl font-bold text-[#F8FAFC]">Simplified Clauses</h2>
                <p className="text-xs text-[#94A3B8]">Breakdown of critical contractual terms</p>
              </div>
              <span className="text-xs font-medium px-2 py-1 bg-slate-800 text-slate-400 rounded-md border border-slate-700/50">
                {clauses.length} clauses detected
              </span>
            </div>

            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="bg-[#1E293B] border border-slate-800 rounded-xl p-6 space-y-4 animate-pulse">
                    <div className="h-4 bg-slate-800 rounded w-1/4"></div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="h-20 bg-slate-800/60 rounded"></div>
                      <div className="h-20 bg-slate-800/60 rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : clauses.length === 0 ? (
              <div className="p-8 text-center bg-[#1E293B] border border-slate-800 rounded-xl text-[#94A3B8] text-sm">
                No clauses detected in this document.
              </div>
            ) : (
              <div className="space-y-6">
                {clauses.map((clause, idx) => {
                  const analysis = analysisMap.get(clause.clause_id) || results[idx]
                  const clauseTitle = clause.clause_number
                    ? `Clause ${clause.clause_number}`
                    : `Clause ${idx + 1}`

                  return (
                    <div
                      key={clause.clause_id || idx}
                      className="bg-[#1E293B] border border-slate-800 rounded-xl overflow-hidden shadow"
                    >
                      {/* Clause Card Header */}
                      <div className="bg-[#1E293B]/40 px-5 py-3 border-b border-slate-800/80 flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-xs font-bold uppercase tracking-wider text-[#D4AF37]">
                          {clauseTitle}
                        </span>

                        {analysis && (
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getSeverityStyle(
                                analysis.risk_level
                              )}`}
                            >
                              {analysis.risk_level} Risk
                            </span>
                            {analysis.confidence !== undefined && (
                              <span className="text-[10px] text-[#94A3B8] font-mono bg-slate-800 px-2 py-0.5 rounded border border-slate-700/50">
                                {Math.round(analysis.confidence * 100)}% confidence
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Clause Card Body */}
                      <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Original Clause */}
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-[#94A3B8]">
                            Original text
                          </span>
                          <blockquote className="text-sm text-[#94A3B8]/95 leading-relaxed bg-[#0F172A]/40 p-3.5 rounded-lg border border-slate-800/50 italic">
                            "{clause.text}"
                          </blockquote>
                        </div>

                        {/* Simplified explanation & recommendation */}
                        <div className="space-y-3 flex flex-col justify-between">
                          {analysis ? (
                            <>
                              <div className="space-y-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-widest text-[#2563EB]">
                                  Plain-English Explanation
                                </span>
                                <p className="text-sm text-[#F8FAFC] leading-relaxed bg-[#2563EB]/5 p-3.5 rounded-lg border border-[#2563EB]/10 font-medium">
                                  {analysis.explanation}
                                </p>
                              </div>

                              {analysis.recommendation && (
                                <div className="space-y-1">
                                  <span className="text-[10px] font-bold uppercase tracking-widest text-[#D4AF37]">
                                    Recommendation
                                  </span>
                                  <p className="text-xs text-[#94A3B8] leading-relaxed bg-[#0F172A]/30 p-2.5 rounded-lg border border-slate-800/40">
                                    {analysis.recommendation}
                                  </p>
                                </div>
                              )}

                            </>
                          ) : (
                            <div className="text-xs text-[#94A3B8] italic p-3">
                              Analysis in progress or pending...
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Risk Analysis (1/3 width on desktop) */}
        <div className="space-y-8">
          {/* Card 3: Risk Analysis Card */}
          <Card title="Risk Analysis" subtitle="Overall liability assessment">
            {loading ? (
              <div className="space-y-6 animate-pulse">
                <div className="w-36 h-36 bg-slate-800 rounded-full mx-auto"></div>
                <div className="h-4 bg-slate-800 rounded w-1/2 mx-auto"></div>
                <div className="space-y-3">
                  <div className="h-16 bg-slate-800/60 rounded"></div>
                  <div className="h-16 bg-slate-800/60 rounded"></div>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Circular Gauge Score */}
                <div className="flex flex-col items-center justify-center p-4 bg-[#0F172A]/50 rounded-xl border border-slate-800/50">
                  <div className="relative flex items-center justify-center w-36 h-36">
                    {/* Gauge Background Circle */}
                    <svg className="absolute w-full h-full -rotate-90">
                      <circle
                        cx="72"
                        cy="72"
                        r="60"
                        stroke="#1e293b"
                        strokeWidth="10"
                        fill="transparent"
                      />
                      {/* Active Gauge Arc */}
                      <circle
                        cx="72"
                        cy="72"
                        r="60"
                        stroke={getGaugeColor(riskRating)}
                        strokeWidth="10"
                        fill="transparent"
                        strokeDasharray="377"
                        strokeDashoffset={377 - (377 * riskScore) / 100}
                        strokeLinecap="round"
                        className="transition-all duration-1000 ease-out"
                      />
                    </svg>
                    <div className="text-center z-10">
                      <span className="text-4xl font-extrabold text-[#F8FAFC]">{riskScore}</span>
                      <span className="text-xs text-[#94A3B8] block font-mono">/ 100</span>
                    </div>
                  </div>
                  <div className="text-center mt-4">
                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${getSeverityStyle(
                        riskRating
                      )}`}
                    >
                      {riskRating} Exposure
                    </span>
                  </div>
                </div>

                {/* Specific Risks List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-[#F8FAFC] uppercase tracking-wider">
                      Identified Risks
                    </h4>
                    <span className="text-xs text-[#94A3B8]">
                      {sortedRisks.length} analyzed
                    </span>
                  </div>

                  {sortedRisks.length === 0 ? (
                    <p className="text-xs text-[#94A3B8] italic">No clause risks found.</p>
                  ) : (
                    <div className="space-y-3">
                      {sortedRisks.map((risk, idx) => {
                        const title = risk.clause_number
                          ? `Clause ${risk.clause_number}`
                          : `Clause ${idx + 1}`

                        return (
                          <div
                            key={risk.clause_id || idx}
                            className="p-4 rounded-xl bg-[#0F172A]/30 border border-slate-850 hover:border-slate-800 transition-colors space-y-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-bold text-[#F8FAFC]">
                                {title}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getSeverityStyle(
                                    risk.risk_level
                                  )}`}
                                >
                                  {risk.risk_level}
                                </span>
                                {risk.confidence !== undefined && (
                                  <span className="text-[10px] text-[#94A3B8] font-mono">
                                    {Math.round(risk.confidence * 100)}%
                                  </span>
                                )}
                              </div>
                            </div>

                            <p className="text-xs text-[#94A3B8] leading-relaxed">
                              {risk.explanation}
                            </p>

                            {risk.recommendation && (
                              <div className="pt-2 border-t border-slate-800/40 text-[11px]">
                                <span className="font-semibold text-[#D4AF37]">Recommendation:</span>{' '}
                                <span className="text-[#94A3B8]">{risk.recommendation}</span>
                              </div>
                            )}

                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default Analysis
