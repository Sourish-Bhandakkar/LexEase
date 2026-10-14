import React from 'react'
import {
  IconAlertTriangle,
  IconSummary,
  IconDocument,
  IconPin,
} from './Icons'

// Risk Theme Helper for Key Provision Finding Cards
function getProvisionRisk(point, index, clauseAnalysisData) {
  // 1. Direct match with analyzed clause results if available
  if (clauseAnalysisData?.results?.[index]?.risk_level) {
    return String(clauseAnalysisData.results[index].risk_level).toLowerCase()
  }
  // 2. Check if point is an object with risk property
  if (typeof point === 'object' && point !== null) {
    if (point.risk_level) return String(point.risk_level).toLowerCase()
    if (point.risk) return String(point.risk).toLowerCase()
  }
  // 3. Fallback semantic heuristics for common legal risk terms
  const text = (typeof point === 'string' ? point : point?.text || '').toLowerCase()
  if (
    /uncapped|indemnif|penalty|forfeit|breach|terminat.*immediate|liquidated damages|dispute|arbitrat|unlimited liab/i.test(
      text
    )
  ) {
    return 'high'
  }
  if (
    /terminat|notice period|deposit|delay|interest|obligat|restrict|repair|deduct|condition|subject to/i.test(
      text
    )
  ) {
    return 'medium'
  }
  return 'low'
}

const provisionThemes = {
  high: {
    cardBg: 'bg-[#FFF2F2]',
    cardBorder: 'border-[#F5C2C2] hover:border-[#C94A4A]/60',
    borderLeft: 'border-l-[3.5px] border-l-[#C94A4A]',
    badgeBg: 'bg-white text-[#9B2C2C] border-[#F5C2C2]',
    statusPill: 'bg-[#FFF0F0] text-[#C94A4A] border-[#F5C2C2]',
    statusLabel: 'High Risk',
    dotColor: 'bg-[#C94A4A]',
  },
  medium: {
    cardBg: 'bg-[#FFF8EC]',
    cardBorder: 'border-[#F8DEC0] hover:border-[#D18A24]/60',
    borderLeft: 'border-l-[3.5px] border-l-[#D18A24]',
    badgeBg: 'bg-white text-[#8F5B10] border-[#F8DEC0]',
    statusPill: 'bg-[#FEF3E2] text-[#D18A24] border-[#F8DEC0]',
    statusLabel: 'Medium Risk',
    dotColor: 'bg-[#D18A24]',
  },
  low: {
    cardBg: 'bg-[#F1F8F4]',
    cardBorder: 'border-[#C8DECE] hover:border-[#3E8E63]/60',
    borderLeft: 'border-l-[3.5px] border-l-[#3E8E63]',
    badgeBg: 'bg-white text-[#1E5C3D] border-[#C8DECE]',
    statusPill: 'bg-[#E8F1EC] text-[#3E8E63] border-[#C8DECE]',
    statusLabel: 'Low Risk',
    dotColor: 'bg-[#3E8E63]',
  },
}

function DocumentSummary({
  summaryData,
  clauseAnalysisData,
  isLoading,
  error,
  onRetry,
}) {
  if (isLoading) {
    return (
      <div className="p-6 sm:p-8 rounded-xl bg-white border border-[#DCE6E0] space-y-6 animate-pulse shadow-xs">
        <div className="flex items-center justify-between">
          <div className="h-6 w-44 bg-[#E8F1EC] rounded-md"></div>
          <div className="h-6 w-28 bg-[#E8F1EC] rounded-full"></div>
        </div>
        <div className="space-y-3">
          <div className="h-4 bg-[#F3F7F5] rounded w-full"></div>
          <div className="h-4 bg-[#F3F7F5] rounded w-11/12"></div>
          <div className="h-4 bg-[#F3F7F5] rounded w-4/5"></div>
        </div>
        <div className="space-y-3 pt-4 border-t border-[#DCE6E0]">
          <div className="h-5 w-36 bg-[#E8F1EC] rounded"></div>
          <div className="h-4 bg-[#F3F7F5] rounded w-full"></div>
          <div className="h-4 bg-[#F3F7F5] rounded w-5/6"></div>
          <div className="h-4 bg-[#F3F7F5] rounded w-3/4"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 sm:p-8 rounded-xl bg-white border border-[#F5C2C2] space-y-4 text-center shadow-xs">
        <div className="w-12 h-12 rounded-full bg-[#FFF2F2] border border-[#F5C2C2] text-[#C94A4A] flex items-center justify-center mx-auto">
          <IconAlertTriangle className="w-6 h-6 text-[#C94A4A]" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold text-[#C94A4A]">
            Summarization Failed
          </h3>
          <p className="text-xs text-[#526058] max-w-md mx-auto">{error}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-[#F3F7F5] text-[#16221C] border border-[#DCE6E0] transition-colors shadow-2xs cursor-pointer"
          >
            Retry Summarization
          </button>
        )}
      </div>
    )
  }

  if (!summaryData) {
    return (
      <div className="p-8 rounded-xl bg-white border border-[#DCE6E0] text-center text-[#526058] shadow-xs">
        No summary generated yet.
      </div>
    )
  }

  const { summary, key_points, document_type } = summaryData

  return (
    <div className="space-y-5">
      {/* Executive Summary Memorandum Card with Subtle Warm Ivory/Cream Tint */}
      <div className="p-5 sm:p-6 rounded-xl bg-[#FAF8F5] border border-[#DCE6E0] shadow-xs space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE6E0] pb-3.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#12372A] border border-[#176B4D]/30 flex items-center justify-center text-[#E8F1EC] shrink-0 shadow-2xs">
              <IconSummary className="w-5 h-5 text-[#E8F1EC]" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#16221C] tracking-tight">
                Executive Document Summary
              </h2>
              <p className="text-xs text-[#526058]">
                Synthesized agreement overview &amp; primary legal obligations
              </p>
            </div>
          </div>

          {document_type && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold bg-[#E8F1EC] text-[#12372A] border border-[#C8DECE] tracking-wide font-mono uppercase shadow-2xs">
              <IconDocument className="w-3.5 h-3.5 text-[#176B4D]" />
              <span>{document_type}</span>
            </span>
          )}
        </div>

        {/* Plain English Summary - Executive Legal Brief in Pale Mint */}
        <div className="space-y-2">
          <div className="flex items-center justify-between pb-0.5">
            <h3 className="text-[10px] font-bold text-[#176B4D] uppercase tracking-wider font-mono flex items-center gap-1.5">
              <IconDocument className="w-3.5 h-3.5 text-[#176B4D]" />
              <span>Executive Legal Brief</span>
            </h3>
            <span className="text-[10px] font-mono font-medium text-[#526058] uppercase tracking-wider">
              Synthesized Overview
            </span>
          </div>
          <div className="p-4 sm:p-5 rounded-lg bg-[#F1F8F4] border border-[#C8DECE] border-l-4 border-l-[#12372A] shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-[#DCE6E0]/80">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#176B4D]"></span>
                <span className="text-[11px] font-mono font-bold text-[#12372A] uppercase tracking-wider">
                  EXECUTIVE LEGAL BRIEF
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#526058] uppercase tracking-wider">
                PRIMARY PROVISIONS
              </span>
            </div>
            <p className="text-[#16221C] leading-relaxed text-xs sm:text-[13.5px] whitespace-pre-line font-sans font-normal max-w-4xl">
              {summary}
            </p>
          </div>
        </div>

        {/* Unified Legal Findings Docket */}
        {key_points && key_points.length > 0 && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between border-b border-[#DCE6E0] pb-2.5">
              <h3 className="text-[11px] font-bold text-[#176B4D] uppercase tracking-wider flex items-center gap-1.5 font-mono">
                <IconPin className="w-3.5 h-3.5 text-[#176B4D]" />
                <span>Key Highlights &amp; Contractual Obligations</span>
              </h3>
              <span className="text-[11px] text-[#12372A] font-mono font-bold bg-[#E8F1EC] px-2 py-0.5 rounded border border-[#C8DECE]">
                {key_points.length} {key_points.length === 1 ? 'FINDING' : 'FINDINGS'}
              </span>
            </div>

            {/* Distinct Status-Aware Legal Finding Cards */}
            <div className="space-y-2.5">
              {key_points.map((point, index) => {
                const risk = getProvisionRisk(point, index, clauseAnalysisData)
                const theme = provisionThemes[risk] || provisionThemes.low
                const pointText =
                  typeof point === 'string' ? point : point?.text || ''

                return (
                  <div
                    key={index}
                    className={`flex flex-col sm:flex-row sm:items-start justify-between gap-3 p-3.5 sm:p-4 rounded-lg ${theme.cardBg} border ${theme.cardBorder} ${theme.borderLeft} hover:shadow-xs transition-all duration-150 group`}
                  >
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <span
                        className={`inline-flex items-center justify-center px-2.5 py-1 rounded ${theme.badgeBg} text-[10px] font-bold font-mono shrink-0 mt-0.5 tracking-wider shadow-2xs`}
                      >
                        PROVISION {String(index + 1).padStart(2, '0')}
                      </span>
                      <p className="text-xs sm:text-[13px] text-[#16221C] leading-relaxed font-normal flex-1">
                        {pointText}
                      </p>
                    </div>

                    <div className="flex items-center self-end sm:self-start shrink-0 pt-0.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase tracking-wider border shadow-2xs ${theme.statusPill}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${theme.dotColor}`} />
                        <span>{theme.statusLabel}</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DocumentSummary
