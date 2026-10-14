import React from 'react'
import { IconCheck, IconAlertTriangle } from './Icons'

function DocumentProcessor({ file, stage, error, onRetry, onCancel }) {
  // Map internal stages into the 3 visual pipeline steps
  const getStepStatus = (stepIndex) => {
    if (stage === 'error') return 'future'
    if (stage === 'ready') return 'completed'

    // Visual step 1: Reading (covers uploading & reading)
    if (stepIndex === 1) {
      if (['identifying', 'preparing', 'ready'].includes(stage)) return 'completed'
      if (['uploading', 'reading'].includes(stage)) return 'active'
      return 'future'
    }

    // Visual step 2: Analyzing (covers identifying)
    if (stepIndex === 2) {
      if (['preparing', 'ready'].includes(stage)) return 'completed'
      if (stage === 'identifying') return 'active'
      return 'future'
    }

    // Visual step 3: Preparing (covers preparing)
    if (stepIndex === 3) {
      if (stage === 'ready') return 'completed'
      if (stage === 'preparing') return 'active'
      return 'future'
    }

    return 'future'
  }

  // Progress bar percentage mapping to reflect actual discrete backend stages
  const getProgressWidth = () => {
    switch (stage) {
      case 'uploading':
        return 22
      case 'reading':
        return 42
      case 'identifying':
        return 70
      case 'preparing':
        return 90
      case 'ready':
        return 100
      case 'error':
        return 100
      default:
        return 15
    }
  }

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const step1Status = getStepStatus(1)
  const step2Status = getStepStatus(2)
  const step3Status = getStepStatus(3)
  const progressWidth = getProgressWidth()

  // Status mapping for the 4 items in "What LexEase is checking"
  const getItemStatus = (itemIndex) => {
    if (stage === 'error') return 'future'
    if (stage === 'ready') return 'completed'

    if (itemIndex === 1) {
      // Reading the agreement
      if (['identifying', 'preparing', 'ready'].includes(stage)) return 'completed'
      return 'active'
    }
    if (itemIndex === 2) {
      // Identifying important clauses
      if (['preparing', 'ready'].includes(stage)) return 'completed'
      if (stage === 'identifying') return 'active'
      return 'future'
    }
    if (itemIndex === 3) {
      // Assessing potential risks
      if (['preparing', 'ready'].includes(stage)) return 'completed'
      if (stage === 'identifying') return 'active'
      return 'future'
    }
    if (itemIndex === 4) {
      // Preparing your plain-English summary
      if (stage === 'ready') return 'completed'
      if (stage === 'preparing') return 'active'
      return 'future'
    }
    return 'future'
  }

  return (
    <div
      className="w-full max-w-[1140px] mx-auto relative animate-entrance-intake py-4 sm:py-6"
      role="status"
      aria-live="polite"
    >
      {/* Subtle Ambient Radial Glow */}
      <div
        className="absolute -inset-10 bg-radial from-[#176B4D]/5 via-transparent to-transparent rounded-3xl blur-3xl pointer-events-none -z-10"
        aria-hidden="true"
      />

      {/* Two-Column Balanced Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-8 items-start">
        {/* ================= LEFT COLUMN: PRIMARY PROCESSING AREA (~62%) ================= */}
        <div className="lg:col-span-7 xl:col-span-8 p-6 sm:p-8 lg:p-9 rounded-2xl bg-white border border-[#DCE6E0] shadow-xs space-y-7 text-left">
          {/* Header & Badging */}
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-mono font-bold uppercase tracking-[0.16em] bg-[#E8F1EC] text-[#176B4D] border border-[#DCE6E0]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#176B4D] animate-pulse" />
              <span>AI Contract Review</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#12372A] tracking-tight leading-tight">
              {stage === 'error'
                ? 'Processing Interrupted'
                : stage === 'ready'
                ? 'Agreement Verified & Ready'
                : 'Reviewing your agreement'}
            </h2>
            <p className="text-xs sm:text-sm text-[#526058] max-w-xl leading-relaxed">
              {stage === 'error'
                ? 'Document processing could not be completed.'
                : stage === 'ready'
                ? 'All clauses identified, risks classified, and plain-English summary prepared.'
                : 'Extracting clauses, assessing risks, and preparing your plain-English summary.'}
            </p>
          </div>

          {/* Uploaded Document Info Card */}
          {file && (
            <div className="flex items-center gap-3.5 p-3.5 sm:p-4 rounded-xl bg-[#F8FAF8] border border-[#DCE6E0] text-left shadow-2xs">
              <div className="w-10 h-10 rounded-xl bg-white border border-[#DCE6E0] flex items-center justify-center text-[#176B4D] shrink-0 shadow-2xs">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <span
                  className="text-sm font-bold text-[#16221C] truncate block"
                  title={file.name}
                >
                  {file.name}
                </span>
                <span className="text-xs text-[#526058] block mt-0.5 font-mono">
                  PDF Agreement &bull; {formatFileSize(file.size)}
                </span>
              </div>
            </div>
          )}

          {/* Progress Bar & Stage System */}
          {stage !== 'error' && (
            <div className="space-y-4 pt-1">
              {/* Single Smooth Progress Bar */}
              <div className="h-2 w-full bg-[#E8F1EC] rounded-full overflow-hidden relative">
                <div
                  className="h-full bg-[#176B4D] rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${progressWidth}%` }}
                />
              </div>

              {/* 3 Compact Horizontally Aligned Stages */}
              <div className="grid grid-cols-3 gap-2 text-center pt-2">
                {/* Stage 1: Reading */}
                <div className="flex flex-col items-center space-y-1.5">
                  <span
                    className={`text-xs sm:text-sm font-semibold transition-colors duration-200 ${
                      step1Status === 'active'
                        ? 'text-[#176B4D] font-bold'
                        : step1Status === 'completed'
                        ? 'text-[#12372A]'
                        : 'text-[#526058]'
                    }`}
                  >
                    Reading
                  </span>
                  {step1Status === 'completed' ? (
                    <span className="w-5 h-5 rounded-full bg-[#E8F1EC] text-[#176B4D] border border-[#DCE6E0] flex items-center justify-center">
                      <IconCheck className="w-3 h-3 text-[#176B4D]" />
                    </span>
                  ) : step1Status === 'active' ? (
                    <span className="relative flex h-5 w-5 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-3.5 w-3.5 rounded-full bg-[#176B4D]/30 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#176B4D]" />
                    </span>
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full bg-[#DCE6E0] my-1" />
                  )}
                </div>

                {/* Stage 2: Analyzing */}
                <div className="flex flex-col items-center space-y-1.5">
                  <span
                    className={`text-xs sm:text-sm font-semibold transition-colors duration-200 ${
                      step2Status === 'active'
                        ? 'text-[#176B4D] font-bold'
                        : step2Status === 'completed'
                        ? 'text-[#12372A]'
                        : 'text-[#526058]'
                    }`}
                  >
                    Analyzing
                  </span>
                  {step2Status === 'completed' ? (
                    <span className="w-5 h-5 rounded-full bg-[#E8F1EC] text-[#176B4D] border border-[#DCE6E0] flex items-center justify-center">
                      <IconCheck className="w-3 h-3 text-[#176B4D]" />
                    </span>
                  ) : step2Status === 'active' ? (
                    <span className="relative flex h-5 w-5 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-3.5 w-3.5 rounded-full bg-[#176B4D]/30 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#176B4D]" />
                    </span>
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full bg-[#DCE6E0] my-1" />
                  )}
                </div>

                {/* Stage 3: Preparing */}
                <div className="flex flex-col items-center space-y-1.5">
                  <span
                    className={`text-xs sm:text-sm font-semibold transition-colors duration-200 ${
                      step3Status === 'active'
                        ? 'text-[#176B4D] font-bold'
                        : step3Status === 'completed'
                        ? 'text-[#12372A]'
                        : 'text-[#526058]'
                    }`}
                  >
                    Preparing
                  </span>
                  {step3Status === 'completed' ? (
                    <span className="w-5 h-5 rounded-full bg-[#E8F1EC] text-[#176B4D] border border-[#DCE6E0] flex items-center justify-center">
                      <IconCheck className="w-3 h-3 text-[#176B4D]" />
                    </span>
                  ) : step3Status === 'active' ? (
                    <span className="relative flex h-5 w-5 items-center justify-center">
                      <span className="animate-ping absolute inline-flex h-3.5 w-3.5 rounded-full bg-[#176B4D]/30 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#176B4D]" />
                    </span>
                  ) : (
                    <span className="w-2.5 h-2.5 rounded-full bg-[#DCE6E0] my-1" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Error State View */}
          {stage === 'error' && (
            <div className="p-4 rounded-xl bg-[#FFF2F2] border border-[#F5C2C2] text-left space-y-3">
              <div className="flex items-start gap-2.5">
                <IconAlertTriangle className="w-5 h-5 text-[#C94A4A] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h4 className="text-xs sm:text-sm font-bold text-[#C94A4A]">
                    Processing Failed
                  </h4>
                  <p className="text-xs text-[#526058] mt-1 break-words leading-relaxed">
                    {error}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#C94A4A] hover:bg-[#B33E3E] text-white transition-all shadow-xs cursor-pointer"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-[#F3F7F5] border border-[#DCE6E0] text-[#526058] hover:text-[#16221C] transition-all cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ================= RIGHT COLUMN: WHAT LEXEASE IS CHECKING (~38%) ================= */}
        <div className="lg:col-span-5 xl:col-span-4 p-6 sm:p-7 rounded-2xl bg-white border border-[#DCE6E0] shadow-xs space-y-5 text-left">
          {/* Panel Title */}
          <div className="border-b border-[#F0F4F2] pb-3">
            <h3 className="text-sm sm:text-base font-bold text-[#12372A] tracking-tight">
              What LexEase is checking
            </h3>
            <p className="text-[11px] text-[#66736C] mt-0.5">
              Live legal verification pipeline
            </p>
          </div>

          {/* 4 Concise Status Items */}
          <div className="space-y-3.5">
            {[
              { idx: 1, label: 'Reading the agreement' },
              { idx: 2, label: 'Identifying important clauses' },
              { idx: 3, label: 'Assessing potential risks' },
              { idx: 4, label: 'Preparing your plain-English summary' },
            ].map(({ idx, label }) => {
              const status = getItemStatus(idx)
              return (
                <div key={idx} className="flex items-center gap-3">
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    {status === 'completed' ? (
                      <IconCheck className="w-3.5 h-3.5 text-[#176B4D]" />
                    ) : status === 'active' ? (
                      <span className="relative flex h-3 w-3 items-center justify-center">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#176B4D]/40 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#176B4D]" />
                      </span>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-[#DCE6E0]" />
                    )}
                  </div>
                  <span
                    className={`text-xs sm:text-[13px] transition-colors duration-200 ${
                      status === 'active'
                        ? 'font-bold text-[#12372A]'
                        : status === 'completed'
                        ? 'text-[#16221C] font-medium'
                        : 'text-[#526058]'
                    }`}
                  >
                    {label}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Abstract Legal Document Structure Visual (Subtle, low-contrast) */}
          <div className="pt-3 border-t border-[#F0F4F2] space-y-2">
            <div className="flex items-center justify-between text-[10px] font-mono font-semibold tracking-wider text-[#8C9A92] uppercase">
              <span>Clause Structure</span>
              <span>Scanning</span>
            </div>
            <div className="space-y-2 p-3 rounded-xl bg-[#F8FAF8] border border-[#E8F1EC] select-none" aria-hidden="true">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold text-[#176B4D]">§ 01</span>
                <div className="h-1.5 bg-[#DCE6E0] rounded-full w-4/5 animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold text-[#176B4D]">§ 02</span>
                <div className="h-1.5 bg-[#DCE6E0] rounded-full w-3/5" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold text-[#D18A24]">§ 03</span>
                <div className="h-1.5 bg-[#F8DEC0] rounded-full w-5/6" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] font-bold text-[#3E8E63]">§ 04</span>
                <div className="h-1.5 bg-[#DCE6E0] rounded-full w-2/3" />
              </div>
            </div>
          </div>

          {/* Privacy & Security Reassurance */}
          <div className="pt-2 border-t border-[#F0F4F2] flex items-center gap-2 text-[11px] text-[#66736C]">
            <svg
              className="w-4 h-4 text-[#176B4D] shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            <span>Your document stays private &bull; Never shared</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DocumentProcessor
