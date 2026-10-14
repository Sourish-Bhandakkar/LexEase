import React, { useState, useRef, useEffect, useCallback } from 'react'
import { IconScales } from './Icons'

// Mathematical constants for the semicircular gauge geometry (ONE unified coordinate system)
const GAUGE_CENTER_X = 100
const GAUGE_CENTER_Y = 95
const GAUGE_RADIUS = 75
const GAUGE_ARC_LENGTH = Math.PI * GAUGE_RADIUS // 235.619449

// Strict risk details based strictly on integer/rounded gauge value
function getHeroRiskDetails(value) {
  const rounded = Math.round(value)
  if (rounded < 40) {
    return {
      level: 'low',
      color: '#3E8E63',
      label: 'LOW RISK',
      text: 'Liability appears limited in this clause.',
      badgeBg: '#E8F1EC',
      badgeBorder: '#C8DECE',
      panelBg: '#EAF3ED',
      panelBorder: '#C2D9C9',
      clauseBg: '#EFF6F1',
      clauseBorder: '#C2D9C9',
    }
  }
  if (rounded < 70) {
    return {
      level: 'medium',
      color: '#D18A24',
      label: 'MEDIUM RISK',
      text: 'Some obligations may require closer review.',
      badgeBg: '#FEF3E2',
      badgeBorder: '#F8DEC0',
      panelBg: '#FDF3E5',
      panelBorder: '#F5D8B0',
      clauseBg: '#FDF6EC',
      clauseBorder: '#F5D8B0',
    }
  }
  return {
    level: 'high',
    color: '#C94A4A',
    label: 'HIGH RISK',
    text: 'Liability appears potentially uncapped in this clause.',
    badgeBg: '#FFF2F2',
    badgeBorder: '#F5C2C2',
    panelBg: '#FDF0F0',
    panelBorder: '#F5C2C2',
    clauseBg: '#FDF3F3',
    clauseBorder: '#F5C2C2',
  }
}

// Semicircular risk gauge hook:
// - One single source of truth for value (0 -> 100)
// - Explicit staged state machine with visible holds:
//   Stage 1: Animate 0 -> 39 (~2.5s), LOW RISK, GREEN (#3E8E63)
//   Stage 2: HOLD at 39 (~1.0s), GREEN (#3E8E63)
//   Stage 3: Animate 40 -> 69 (~2.0s), MEDIUM RISK, AMBER (#D18A24)
//   Stage 4: HOLD at 69 (~1.0s), AMBER (#D18A24)
//   Stage 5: Animate 70 -> 82 (~1.0s), HIGH RISK, RED (#C94A4A)
//   Stage 6: HOLD at 82 (~2.0s), RED (#C94A4A)
//   Stage 7: INSTANT RESET: 82 -> 0 (instant state jump, ZERO backward travel, no CSS transitions)
//   Stage 8: Restart forward 0 -> 39
// - While user drags, auto animation is paused and gaugeValue tracks pointer angle directly
// - When user releases drag, holds value for 2.0s, then resumes staged animation towards 82 (or resets to 0 if >= 82)
// - Respects prefers-reduced-motion
function useHeroRiskGauge() {
  const [gaugeValue, setGaugeValue] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  const valueRef = useRef(0)
  const isDraggingRef = useRef(false)
  const stateRef = useRef({
    status: 'stage1_rise_low',
    stageStartTime: 0,
    heldValue: 0,
  })
  const rafRef = useRef(null)
  const svgRef = useRef(null)

  useEffect(() => {
    valueRef.current = gaugeValue
  }, [gaugeValue])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setGaugeValue(82)
      return
    }

    stateRef.current.stageStartTime = performance.now()
    stateRef.current.status = 'stage1_rise_low'

    let isVisible = true
    let observer = null

    if (typeof IntersectionObserver !== 'undefined' && svgRef.current) {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0]
          const wasVisible = isVisible
          isVisible = entry.isIntersecting
          if (isVisible && !wasVisible && !rafRef.current) {
            // Re-arm RAF loop when scrolled back into view
            rafRef.current = requestAnimationFrame(tick)
          }
        },
        { threshold: 0.05 }
      )
      observer.observe(svgRef.current)
    }

    const tick = (now) => {
      // Pause animation computations if element is scrolled off-screen
      if (!isVisible) {
        rafRef.current = null
        return
      }

      const s = stateRef.current

      if (s.status === 'stage1_rise_low') {
        const elapsed = now - s.stageStartTime
        if (elapsed < 2200) {
          setGaugeValue(39 * (elapsed / 2200))
        } else {
          setGaugeValue(39)
          s.status = 'stage2_hold_39'
          s.stageStartTime = now
        }
      } else if (s.status === 'stage2_hold_39') {
        if (now - s.stageStartTime >= 1000) {
          setGaugeValue(40)
          s.status = 'stage3_rise_med'
          s.stageStartTime = now
        }
      } else if (s.status === 'stage3_rise_med') {
        const elapsed = now - s.stageStartTime
        if (elapsed < 1800) {
          setGaugeValue(40 + 29 * (elapsed / 1800))
        } else {
          setGaugeValue(69)
          s.status = 'stage4_hold_69'
          s.stageStartTime = now
        }
      } else if (s.status === 'stage4_hold_69') {
        if (now - s.stageStartTime >= 1000) {
          setGaugeValue(70)
          s.status = 'stage5_rise_high'
          s.stageStartTime = now
        }
      } else if (s.status === 'stage5_rise_high') {
        const elapsed = now - s.stageStartTime
        if (elapsed < 1000) {
          const p = elapsed / 1000
          setGaugeValue(70 + 12 * p)
        } else {
          setGaugeValue(82)
          s.status = 'stage6_hold_82'
          s.stageStartTime = now
        }
      } else if (s.status === 'stage6_hold_82') {
        if (now - s.stageStartTime >= 2000) {
          // Instant reset: 82 -> 0 with zero backward travel
          setGaugeValue(0)
          s.status = 'stage1_rise_low'
          s.stageStartTime = now
        }
      } else if (s.status === 'manual_hold') {
        if (now - s.stageStartTime >= 2000) {
          const val = s.heldValue
          if (val < 39) {
            s.status = 'stage1_rise_low'
            s.stageStartTime = now - (val / 39) * 2200
          } else if (val < 40) {
            setGaugeValue(39)
            s.status = 'stage2_hold_39'
            s.stageStartTime = now
          } else if (val < 69) {
            s.status = 'stage3_rise_med'
            s.stageStartTime = now - ((val - 40) / 29) * 1800
          } else if (val < 70) {
            setGaugeValue(69)
            s.status = 'stage4_hold_69'
            s.stageStartTime = now
          } else if (val < 82) {
            s.status = 'stage5_rise_high'
            s.stageStartTime = now - ((val - 70) / 12) * 1000
          } else {
            setGaugeValue(0)
            s.status = 'stage1_rise_low'
            s.stageStartTime = now
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (observer) observer.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const calculateScoreFromPointer = useCallback((clientX, clientY) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null

    const svgX = ((clientX - rect.left) / rect.width) * 200
    const svgY = ((clientY - rect.top) / rect.height) * 110

    const dx = svgX - GAUGE_CENTER_X
    const mathY = GAUGE_CENTER_Y - svgY
    const mathX = dx

    let angle = Math.atan2(mathY, mathX)
    if (angle < 0) {
      angle = dx < 0 ? Math.PI : 0
    }

    const fraction = (Math.PI - angle) / Math.PI
    const clampedFraction = Math.max(0, Math.min(1, fraction))
    return Math.round(clampedFraction * 100)
  }, [])

  const handlePointerDown = useCallback((e) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch (_) {}

    isDraggingRef.current = true
    setIsDragging(true)
    stateRef.current.status = 'dragging'

    const score = calculateScoreFromPointer(e.clientX, e.clientY)
    if (score !== null) {
      setGaugeValue(score)
    }
  }, [calculateScoreFromPointer])

  const handlePointerMove = useCallback((e) => {
    if (!isDraggingRef.current) return
    const score = calculateScoreFromPointer(e.clientX, e.clientY)
    if (score !== null) {
      setGaugeValue(score)
    }
  }, [calculateScoreFromPointer])

  const handlePointerUp = useCallback((e) => {
    if (!isDraggingRef.current) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch (_) {}

    isDraggingRef.current = false
    setIsDragging(false)

    const currentVal = valueRef.current
    stateRef.current.status = 'manual_hold'
    stateRef.current.heldValue = currentVal
    stateRef.current.stageStartTime = performance.now()
  }, [])

  const handleKeyDown = useCallback((e) => {
    let step = 0
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      step = e.shiftKey ? -5 : -1
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      step = e.shiftKey ? 5 : 1
    } else if (e.key === 'Home') {
      step = -100
    } else if (e.key === 'End') {
      step = 100
    }

    if (step !== 0) {
      e.preventDefault()
      const nextVal = Math.max(0, Math.min(100, Math.round(valueRef.current + step)))
      setGaugeValue(nextVal)
      stateRef.current.status = 'manual_hold'
      stateRef.current.heldValue = nextVal
      stateRef.current.stageStartTime = performance.now()
    }
  }, [])

  return {
    gaugeValue,
    isDragging,
    svgRef,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleKeyDown,
  }
}

// Genuinely recognizable commercial legal jargon phrases for hero transformation
// Genuinely recognizable commercial legal jargon phrases for hero transformation
const LEGAL_TRANSFORMATION_PHRASES = [
  'notwithstanding the foregoing',
  'without prejudice to',
  'hereinafter referred to as',
  'mutatis mutandis',
]
const PLAIN_ENGLISH_PHRASE = 'easier to understand.'

function HeroHeadline() {
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [animationState, setAnimationState] = useState('initial')
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  // Respect prefers-reduced-motion accessibility setting
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(mediaQuery.matches)

    const handler = (e) => setPrefersReducedMotion(e.matches)
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler)
      return () => mediaQuery.removeEventListener('change', handler)
    }
  }, [])

  // Animation Sequence:
  // 1. Initial/Legal Hold: 1.8s (within 1.5–2s)
  // 2. Single horizontal line glides left -> right: 700ms (within 600–800ms)
  // 3. Smooth reveal transition: 500ms (legal phrase fades out, "easier to understand." fades in)
  // 4. Hold "easier to understand." static for 6.5s (within 6–7s)
  // 5. Gentle 350ms dissolve out -> 350ms fade in of next legal phrase
  useEffect(() => {
    if (prefersReducedMotion) {
      return
    }

    let timer

    if (animationState === 'initial' || animationState === 'legal-hold') {
      timer = setTimeout(() => {
        setAnimationState('cutting')
      }, 1800)
    } else if (animationState === 'cutting') {
      timer = setTimeout(() => {
        setAnimationState('revealing')
      }, 700)
    } else if (animationState === 'revealing') {
      timer = setTimeout(() => {
        setAnimationState('plain-hold')
      }, 1000)
    } else if (animationState === 'plain-hold') {
      timer = setTimeout(() => {
        setAnimationState('cycling-out')
      }, 5000)
    } else if (animationState === 'cycling-out') {
      timer = setTimeout(() => {
        setPhraseIndex((prev) => (prev + 1) % LEGAL_TRANSFORMATION_PHRASES.length)
        setAnimationState('cycling-in')
      }, 350)
    } else if (animationState === 'cycling-in') {
      timer = setTimeout(() => {
        setAnimationState('legal-hold')
      }, 350)
    }

    return () => clearTimeout(timer)
  }, [animationState, prefersReducedMotion])

  if (prefersReducedMotion) {
    return (
      <h1
        aria-label="Make every contract easier to understand."
        className="tracking-tight text-[#16221C] leading-[1.12] text-3xl sm:text-4xl md:text-[45px] lg:text-[52px] xl:text-[56px] font-extrabold select-none mb-5 sm:mb-6 lg:mb-7"
      >
        <span className="block font-sans font-extrabold text-[#16221C]">
          Make every contract
        </span>
        <span
          aria-hidden="true"
          className="block font-serif italic font-normal text-[#176B4D] leading-[1.2] mt-3.5 sm:mt-4 lg:mt-5 min-h-[2.35em] sm:min-h-[1.22em]"
        >
          <span className="relative inline-block align-top">
            <span className="relative z-20 inline-block">
              {PLAIN_ENGLISH_PHRASE}
            </span>
          </span>
        </span>
        <span className="sr-only">easier to understand.</span>
      </h1>
    )
  }

  const isCutting = animationState === 'cutting'
  const isRevealing = animationState === 'revealing'
  const isPlainHold = animationState === 'plain-hold'
  const isCyclingOut = animationState === 'cycling-out'
  const isCyclingIn = animationState === 'cycling-in'

  const currentLegalText = LEGAL_TRANSFORMATION_PHRASES[phraseIndex]

  return (
    <h1
      aria-label="Make every contract easier to understand."
      className="tracking-tight text-[#16221C] leading-[1.12] text-3xl sm:text-4xl md:text-[45px] lg:text-[52px] xl:text-[56px] font-extrabold select-none mb-5 sm:mb-6 lg:mb-7"
    >
      <span className="block font-sans font-extrabold text-[#16221C] animate-entrance-headline">
        Make every contract
      </span>
      <span
        aria-hidden="true"
        className="block font-serif italic font-normal text-[#176B4D] leading-[1.2] mt-3.5 sm:mt-4 lg:mt-5 min-h-[2.35em] sm:min-h-[1.22em] animate-entrance-serif"
      >
        <span className="relative inline-grid grid-cols-1 grid-rows-1 align-top text-left max-w-full">
          {/* Layer 1: Commercial Legal Phrase + Cutting Line */}
          <span
            className={`col-start-1 row-start-1 relative inline-block align-top text-left max-w-full ${
              isRevealing
                ? 'animate-hero-legal-fade-out pointer-events-none'
                : isCyclingIn
                ? 'animate-hero-legal-fade-in'
                : animationState === 'initial' || animationState === 'legal-hold' || isCutting
                ? 'opacity-100'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            {/* Single horizontal cutting line:
                - Color: Solid LexEase brand green (#176B4D)
                - Thickness: 2px
                - Position: Exactly centered on visual midline of italic letterforms (top: 51%)
                - Stacking: lower z-index (z-10), text sits on top (z-20)
                - Travels LEFT -> RIGHT across the exact rendered phrase width */}
            {isCutting && (
              <span
                className="animate-hero-cut-line absolute left-0 h-[2px] pointer-events-none z-10 bg-[#176B4D]"
                style={{
                  top: '51%',
                  transform: 'translateY(-50%)',
                  maxWidth: '100%',
                  boxShadow: '0 0 2px rgba(23, 107, 77, 0.35)',
                }}
              />
            )}
            {isRevealing && (
              <span
                className="animate-hero-line-fade absolute left-0 h-[2px] pointer-events-none z-10 bg-[#176B4D]"
                style={{
                  top: '51%',
                  transform: 'translateY(-50%)',
                  width: '100%',
                  boxShadow: '0 0 2px rgba(23, 107, 77, 0.35)',
                }}
              />
            )}

            <span className="relative z-20 inline-block">
              {currentLegalText}
            </span>
          </span>

          {/* Layer 2: Plain-English phrase ("easier to understand.") */}
          <span
            className={`col-start-1 row-start-1 justify-self-start relative inline-block align-top text-left max-w-full ${
              isRevealing
                ? 'animate-hero-plain-fade-in'
                : isPlainHold
                ? 'opacity-100'
                : isCyclingOut
                ? 'animate-hero-plain-fade-out pointer-events-none'
                : 'opacity-0 pointer-events-none'
            }`}
          >
            <span className="relative z-20 inline-block">
              {PLAIN_ENGLISH_PHRASE}
            </span>
          </span>
        </span>
      </span>
      <span className="sr-only">easier to understand.</span>
    </h1>
  )
}

function FileUpload({ onFileUpload, isUploading, uploadError }) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [localError, setLocalError] = useState(null)
  const fileInputRef = useRef(null)

  // Animated and interactive risk gauge state for hero preview
  const {
    gaugeValue: heroGaugeValue,
    isDragging: isGaugeDragging,
    svgRef: gaugeSvgRef,
    handlePointerDown: onGaugePointerDown,
    handlePointerMove: onGaugePointerMove,
    handlePointerUp: onGaugePointerUp,
    handleKeyDown: onGaugeKeyDown,
  } = useHeroRiskGauge()

  const heroRiskInfo = getHeroRiskDetails(heroGaugeValue)

  // Single mathematical coordinate system for both arc and knob:
  // For value 0–100:
  // angle = PI - (value / 100) * PI
  // x = centerX + radius * cos(angle)
  // y = centerY - radius * sin(angle)
  const knobAngle = Math.PI - (heroGaugeValue / 100) * Math.PI
  const knobX = GAUGE_CENTER_X + GAUGE_RADIUS * Math.cos(knobAngle)
  const knobY = GAUGE_CENTER_Y - GAUGE_RADIUS * Math.sin(knobAngle)
  const strokeDashoffset = GAUGE_ARC_LENGTH * (1 - heroGaugeValue / 100)

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const validateAndProcessFile = (file) => {
    setLocalError(null)
    if (!file) return

    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      setLocalError('Please select a valid PDF document (.pdf).')
      return
    }

    if (file.size === 0) {
      setLocalError('The selected file is empty. Please select a valid PDF.')
      return
    }

    onFileUpload(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndProcessFile(e.dataTransfer.files[0])
    }
  }

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndProcessFile(e.target.files[0])
    }
  }

  const errorMessage = uploadError || localError

  return (
    <div className="w-full max-w-[1240px] mx-auto">
      {/* Hidden Native File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileInputChange}
        className="hidden"
        disabled={isUploading}
      />

      {/* ================= TWO-COLUMN HERO SECTION ================= */}
      <section className="pt-8 sm:pt-10 lg:pt-12 pb-10 sm:pb-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          {/* Left Column: Product Value Proposition & Intake */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            {/* Small Eyebrow Badge */}
            <div className="animate-entrance-badge inline-flex items-center gap-2 px-3.5 py-1 rounded-full text-xs font-semibold bg-[#E8F1EC] text-[#176B4D] border border-[#DCE6E0] shadow-2xs tracking-wide self-start mb-4 sm:mb-5 lg:mb-5.5">
              <span className="w-2 h-2 rounded-full bg-[#176B4D] animate-pulse"></span>
              <span>AI-Powered Contract Review &amp; Risk Intelligence</span>
            </div>

            {/* Intentional Two-Line Heading Typography with Dynamic Legal -> Plain English Transformation */}
            <HeroHeadline />

            {/* Supporting Text */}
            <p className="animate-entrance-desc text-base sm:text-[17.5px] lg:text-[18px] text-[#44534A] font-normal max-w-2xl lg:max-w-[620px] leading-[1.68] mb-6 sm:mb-7 lg:mb-8">
              Review complex legal agreements in plain language, uncover hidden liabilities and termination traps, and ask questions grounded directly in your document.
            </p>

            {/* Call to Action & Compact Intake */}
            <div className="w-full max-w-2xl lg:max-w-[620px]">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-3.5 mb-4 sm:mb-5">
                {/* Primary Call to Action */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="animate-entrance-cta inline-flex items-center justify-center gap-2.5 sm:gap-3 px-7 sm:px-8 py-3.5 sm:py-4 rounded-xl text-base font-bold text-white bg-[#176B4D] hover:bg-[#0F5139] active:scale-[0.98] transition-all duration-200 shadow-md hover:shadow-lg hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#176B4D]/25 cursor-pointer disabled:opacity-60"
                >
                  <svg
                    className="w-5 h-5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                  <span>Analyze a Contract</span>
                </button>

                {/* Compact Secondary Drag-and-Drop Intake */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => !isUploading && fileInputRef.current?.click()}
                  className={`animate-entrance-dropzone flex-1 group/drop relative border border-dashed rounded-xl px-4 py-3 sm:py-3.5 text-center transition-all duration-200 cursor-pointer flex items-center justify-center gap-2.5 ${
                    isDragOver
                      ? 'border-[#176B4D] bg-[#E8F1EC] scale-[1.01] shadow-xs'
                      : 'border-[#DCE6E0] bg-white hover:border-[#176B4D]/60 hover:bg-[#F8FAF8]'
                  } ${isUploading ? 'pointer-events-none opacity-70' : ''}`}
                >
                  <div className="w-6 h-6 rounded-lg bg-[#E8F1EC] text-[#176B4D] flex items-center justify-center text-xs shrink-0 group-hover/drop:bg-[#176B4D] group-hover/drop:text-white transition-colors duration-150">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                  </div>
                  <span className="text-xs text-[#526058] font-medium truncate">
                    {isDragOver ? (
                      <span className="text-[#176B4D] font-semibold">Drop PDF here</span>
                    ) : (
                      <span>
                        or drag &amp; drop your PDF here <span className="text-[#526058] font-normal">(up to 25MB)</span>
                      </span>
                    )}
                  </span>
                </div>
              </div>

              {/* Privacy & Trust Badge Row */}
              <div className="animate-entrance-trust flex flex-wrap items-center gap-x-4 sm:gap-x-5 gap-y-1.5 text-xs sm:text-[12.5px] text-[#526058] pt-1">
                <span className="inline-flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-[#3E8E63]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>Automatic Indian PII Redaction</span>
                </span>
                <span className="text-[#DCE6E0]">•</span>
                <span>PDF agreements &amp; NDAs</span>
                <span className="text-[#DCE6E0]">•</span>
                <span>Private &amp; Confidential</span>
              </div>

              {/* Error Message Box */}
              {errorMessage && (
                <div className="p-4 rounded-xl bg-[#FFF2F2] border border-[#F5C2C2] text-[#C94A4A] text-xs flex items-start gap-3 text-left">
                  <svg
                    className="w-4 h-4 shrink-0 mt-0.5 text-[#C94A4A]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-bold text-[#16221C]">Unable to process document</p>
                    <p className="text-[#C94A4A] mt-0.5 leading-relaxed">{errorMessage}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Decorative Legal Document Visualizer */}
          <div className="lg:col-span-5 relative lg:-mt-2">
            {/* Subtle Ambient Radial Glow behind the card */}
            <div className="absolute -inset-4 bg-radial from-[#176B4D]/8 to-transparent rounded-3xl blur-xl pointer-events-none -z-10" />

            {/* Stylized Document Sheet Card */}
            <div className="bg-white rounded-2xl border border-[#D0DFD6] shadow-xl p-3.5 sm:p-4 relative select-none animate-doc-card">
              {/* Document Header Bar */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#EAF2ED] border border-[#CFE0D5] mb-2.5 animate-doc-header">
                <div className="flex items-center space-x-2.5 sm:space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-white text-[#176B4D] border border-[#CFE0D5] flex items-center justify-center font-bold text-sm shadow-2xs">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#16221C] tracking-tight">
                      Master Services Agreement.pdf
                    </div>
                    <div className="text-[10px] text-[#55675F]">
                      Verified Legal Agreement &bull; 18 Clauses
                    </div>
                  </div>
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-white text-[#176B4D] border border-[#CFE0D5] shadow-2xs">
                  PDF &bull; 4 Pages
                </span>
              </div>

              {/* Document Body Skeleton Text Lines */}
              <div className="space-y-1 mb-2.5 px-1">
                <div className="h-1.5 bg-[#DCE8E1] rounded-full w-4/5" />
                <div className="h-1.5 bg-[#E8F0EA] rounded-full w-full" />
              </div>

              {/* Highlighted Clause 4.2 Callout with Dynamic Risk Surface & Border */}
              <div
                className="border border-l-4 rounded-r-xl p-2.5 sm:p-3 mb-2.5 shadow-2xs transition-colors duration-200 animate-doc-clause"
                style={{
                  backgroundColor: heroRiskInfo.clauseBg,
                  borderColor: heroRiskInfo.clauseBorder,
                  borderLeftColor: heroRiskInfo.color,
                }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className="text-[10px] font-mono font-bold uppercase tracking-wider transition-colors duration-200"
                    style={{ color: heroRiskInfo.color }}
                  >
                    Clause 4.2 &bull; Indemnification &amp; Liability
                  </span>
                  <span
                    key={heroRiskInfo.level}
                    className="text-[9px] font-bold px-2 py-0.5 rounded border transition-all duration-200 animate-risk-pop"
                    style={{
                      backgroundColor: heroRiskInfo.badgeBg,
                      color: heroRiskInfo.color,
                      borderColor: heroRiskInfo.badgeBorder,
                    }}
                  >
                    {heroRiskInfo.label}
                  </span>
                </div>
                <p className="text-[11px] text-[#33423A] leading-relaxed italic font-serif">
                  &ldquo;Contractor shall defend, indemnify, and hold harmless Company against all claims, liabilities, and damages arising hereunder...&rdquo;
                </p>
              </div>

              {/* Integrated Clause Risk Analysis Panel with Dynamic Tinted Surface */}
              <div
                className="rounded-xl p-3 mb-2.5 shadow-2xs animate-doc-panel border transition-colors duration-200"
                style={{
                  backgroundColor: heroRiskInfo.panelBg,
                  borderColor: heroRiskInfo.panelBorder,
                }}
              >
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-black/8">
                  <div className="flex items-center gap-1.5">
                    <IconScales className="w-3.5 h-3.5 text-[#176B4D]" />
                    <span className="text-[11px] font-bold text-[#16221C] tracking-tight uppercase font-mono">
                      Clause Risk Analysis
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#55675F]">
                    <span
                      className="w-2 h-2 rounded-full transition-colors duration-200"
                      style={{ backgroundColor: heroRiskInfo.color }}
                    />
                    <span>Risk assessment</span>
                  </div>
                </div>

                {/* Semicircular 0–100 Gauge Widget (Interactive + Animated) */}
                <div className="relative flex flex-col items-center pt-0.5">
                  <div
                    tabIndex={0}
                    role="slider"
                    aria-label="Contract Risk Score Gauge"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(heroGaugeValue)}
                    onPointerDown={onGaugePointerDown}
                    onPointerMove={onGaugePointerMove}
                    onPointerUp={onGaugePointerUp}
                    onPointerCancel={onGaugePointerUp}
                    onKeyDown={onGaugeKeyDown}
                    className={`relative w-48 h-27 flex items-center justify-center select-none touch-none rounded-xl focus:outline-none focus:ring-2 focus:ring-[#176B4D]/30 ${
                      isGaugeDragging ? 'cursor-grabbing' : 'cursor-grab'
                    }`}
                    title="Drag along arc to test risk score"
                  >
                    <svg
                      ref={gaugeSvgRef}
                      className="w-48 h-27 overflow-visible pointer-events-none select-none"
                      viewBox="0 0 200 110"
                    >
                      {/* Background Semicircular Track */}
                      <path
                        d={`M ${GAUGE_CENTER_X - GAUGE_RADIUS} ${GAUGE_CENTER_Y} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${GAUGE_CENTER_X + GAUGE_RADIUS} ${GAUGE_CENTER_Y}`}
                        fill="none"
                        stroke="rgba(0, 0, 0, 0.08)"
                        strokeWidth="10"
                        strokeLinecap="round"
                      />
                      {/* Active Animated/Interactive Semicircular Track - NO CSS TRANSITIONS ON DASH OFFSET */}
                      <path
                        d={`M ${GAUGE_CENTER_X - GAUGE_RADIUS} ${GAUGE_CENTER_Y} A ${GAUGE_RADIUS} ${GAUGE_RADIUS} 0 0 1 ${GAUGE_CENTER_X + GAUGE_RADIUS} ${GAUGE_CENTER_Y}`}
                        fill="none"
                        stroke={heroRiskInfo.color}
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={GAUGE_ARC_LENGTH}
                        strokeDashoffset={strokeDashoffset}
                        style={{ transition: 'stroke 180ms ease' }}
                      />
                      {/* Draggable Knob - Mathematically mounted on the arc stroke - NO CSS TRANSITIONS ON COORDINATES */}
                      <circle
                        cx={knobX}
                        cy={knobY}
                        r={isGaugeDragging ? 8.5 : 7.5}
                        fill="#FFFFFF"
                        stroke={heroRiskInfo.color}
                        strokeWidth="3.5"
                        className="drop-shadow-sm"
                        style={{ transition: 'stroke 180ms ease' }}
                      />
                      {/* Scale Endpoints */}
                      <text x={GAUGE_CENTER_X - GAUGE_RADIUS} y="108" textAnchor="middle" className="text-[9px] font-mono fill-[#55675F]">0</text>
                      <text x={GAUGE_CENTER_X + GAUGE_RADIUS} y="108" textAnchor="middle" className="text-[9px] font-mono fill-[#55675F]">100</text>
                    </svg>

                    {/* Centered Readout inside Semicircular Arc */}
                    <div className="absolute top-7 flex flex-col items-center justify-center text-center pointer-events-none select-none">
                      <div className="flex items-baseline gap-0.5">
                        <span className="text-2xl sm:text-3xl font-extrabold text-[#16221C] tracking-tight font-mono">
                          {Math.round(heroGaugeValue)}
                        </span>
                        <span className="text-[11px] font-semibold text-[#55675F] font-mono">
                          / 100
                        </span>
                      </div>
                      <span
                        key={heroRiskInfo.level}
                        className="inline-flex items-center px-2 py-0.5 mt-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border transition-all duration-200 animate-risk-pop"
                        style={{
                          backgroundColor: heroRiskInfo.badgeBg,
                          color: heroRiskInfo.color,
                          borderColor: heroRiskInfo.badgeBorder,
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full mr-1"
                          style={{ backgroundColor: heroRiskInfo.color }}
                        />
                        {heroRiskInfo.label}
                      </span>
                    </div>
                  </div>

                  {/* Dynamic Risk Text */}
                  <div className="w-full mt-1.5 px-3 py-1.5 rounded-lg bg-white/95 border border-black/8 text-center shadow-2xs">
                    <p className="text-[11px] sm:text-xs text-[#2A3831] font-medium leading-snug">
                      &ldquo;{heroRiskInfo.text}&rdquo;
                    </p>
                  </div>

                  {/* Range Threshold Legend with dynamic active highlight */}
                  <div className="w-full flex items-center justify-between text-[9px] text-[#55675F] font-mono pt-1.5 px-1">
                    <span className={`flex items-center gap-1 ${heroRiskInfo.level === 'low' ? 'text-[#3E8E63] font-bold' : ''}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3E8E63]" /> 0–39 Low
                    </span>
                    <span className={`flex items-center gap-1 ${heroRiskInfo.level === 'medium' ? 'text-[#D18A24] font-bold' : ''}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#D18A24]" /> 40–69 Med
                    </span>
                    <span className={`flex items-center gap-1 ${heroRiskInfo.level === 'high' ? 'text-[#C94A4A] font-bold' : ''}`}>
                      <span className="w-1.5 h-1.5 rounded-full bg-[#C94A4A]" /> 70–100 High
                    </span>
                  </div>
                </div>
              </div>

              {/* Subsequent Clause Skeleton Lines */}
              <div className="space-y-1 mb-2.5 px-1">
                <div className="h-1.5 bg-[#DCE8E1] rounded-full w-full" />
                <div className="h-1.5 bg-[#E8F0EA] rounded-full w-3/4" />
              </div>

              {/* Document Bottom Verification Stamp */}
              <div className="p-2 sm:p-2.5 rounded-xl bg-[#EAF2ED] border border-[#CFE0D5] flex items-center justify-between text-[10px] text-[#55675F]">
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#176B4D]">
                  <svg className="w-3.5 h-3.5 text-[#3E8E63]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  LexEase AI Analysis Ready
                </span>
                <span className="font-mono text-[#55675F]">Ready for review</span>
              </div>
            </div>

            {/* Floating Capability Badges */}
            {/* Badge 1: Top Right — Plain-English Summary (1st entrance, ~4.5s cycle) */}
            <div className="absolute -top-3 -right-2 sm:-right-4 z-20 animate-badge-entrance-1">
              <div className="animate-badge-float-1 bg-white/95 backdrop-blur-xs border border-[#DCE6E0] rounded-xl px-3 py-1.5 shadow-md hover:shadow-lg transition-shadow duration-200 flex items-center gap-2 text-xs font-bold text-[#176B4D] select-none cursor-default">
                <span className="w-2 h-2 rounded-full bg-[#176B4D]" />
                <span>Plain-English Summary</span>
              </div>
            </div>

            {/* Badge 2: Bottom Left — Grounded Clause 4.2 (2nd entrance, ~5.2s cycle) */}
            <div className="absolute -bottom-4 -left-2 sm:-left-4 z-20 animate-badge-entrance-2">
              <div className="animate-badge-float-2 bg-[#E8F1EC]/95 backdrop-blur-xs border border-[#C8DECE] rounded-xl px-3 py-1.5 shadow-md hover:shadow-lg transition-shadow duration-200 flex items-center gap-2 text-xs font-bold text-[#12372A] select-none cursor-default">
                <svg className="w-3.5 h-3.5 text-[#176B4D]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                <span>Grounded Clause 4.2</span>
              </div>
            </div>

            {/* Badge 3: Bottom Right — Risk: Uncapped Liability (3rd entrance, ~4.8s cycle) */}
            <div className="absolute -bottom-3 -right-2 sm:-right-4 z-20 animate-badge-entrance-3">
              <div className="animate-badge-float-3 bg-[#FFF2F2]/95 backdrop-blur-xs border border-[#F5C2C2] rounded-xl px-3 py-1.5 shadow-md hover:shadow-lg transition-shadow duration-200 flex items-center gap-2 text-xs font-bold text-[#C94A4A] select-none cursor-default">
                <svg className="w-3.5 h-3.5 text-[#C94A4A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>Risk: Uncapped Liability</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= HOW LEXEASE HELPS ================= */}
      <section
        id="how-it-works"
        className="w-full scroll-mt-20 pt-10 sm:pt-14 border-t border-[#DCE6E0]/60 space-y-8 sm:space-y-10"
      >
        {/* Section Header with Generous Clearance */}
        <div className="text-center space-y-3 max-w-xl mx-auto pb-1">
          <div className="inline-flex items-center gap-2 text-[11px] font-mono font-bold tracking-[0.18em] text-[#176B4D] uppercase bg-[#E8F1EC] px-3.5 py-1 rounded-full border border-[#DCE6E0]">
            <span>How LexEase Helps</span>
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-[32px] font-extrabold text-[#16221C] tracking-tight leading-tight">
            Everything you need to review contracts with confidence.
          </h2>
        </div>

        {/* 3 Distinct Editorial Legal Capability Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-7 text-left items-stretch">
          {/* CARD 01: UNDERSTAND (Contract / Plain-English Synthesis) */}
          <div className="animate-entrance-step-1 relative p-6 sm:p-7 lg:p-8 rounded-2xl bg-[#E8F1EC] border border-[#176B4D]/25 border-t-2 border-t-[#176B4D]/60 hover:border-[#176B4D]/50 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-200 group flex flex-col justify-between overflow-hidden">
            {/* Subtle Oversized Watermark "01" */}
            <span
              className="absolute -top-3 right-4 font-mono text-7xl sm:text-8xl font-extrabold text-[#176B4D]/[0.07] select-none pointer-events-none tracking-tighter"
              aria-hidden="true"
            >
              01
            </span>

            {/* Top Zone: Editorial Number & Category */}
            <div className="space-y-3 relative z-10">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-3xl sm:text-4xl font-extrabold text-[#176B4D] tracking-tight leading-none">
                    01
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.16em] text-[#176B4D]/80">
                    Summary &bull; Understand
                  </span>
                </div>
              </div>

              {/* Visual Motif: Faint Legal Document Clause Lines */}
              <div className="flex items-center gap-2 opacity-30 pt-0.5 pb-1" aria-hidden="true">
                <div className="h-[2px] bg-[#176B4D] rounded-full w-12" />
                <div className="h-[2px] bg-[#176B4D] rounded-full w-6" />
                <div className="h-[2px] bg-[#176B4D] rounded-full w-16" />
              </div>
            </div>

            {/* Middle Zone: Editorial Title & Plain-Language Copy */}
            <div className="space-y-2.5 my-6 relative z-10">
              <h3 className="text-xl sm:text-[22px] font-bold text-[#12372A] tracking-tight leading-snug group-hover:text-[#0F5139] transition-colors">
                Understand Your Contract
              </h3>
              <p className="text-xs sm:text-[13px] text-[#3E5247] leading-relaxed">
                Turn complex legal language into clear, plain-English explanations and executive obligation summaries.
              </p>
            </div>

            {/* Bottom Action: Intentional Callout */}
            <div className="pt-4 border-t border-[#176B4D]/20 flex items-center justify-between text-xs font-bold text-[#176B4D] group-hover:text-[#0F5139] relative z-10 transition-colors">
              <span>View contract summary</span>
              <span className="transition-transform duration-200 group-hover:translate-x-1">&rarr;</span>
            </div>
          </div>

          {/* CARD 02: SPOT THE RISKS (Risk Detection & Severity Margin) */}
          <div className="animate-entrance-step-2 relative p-6 sm:p-7 lg:p-8 rounded-2xl bg-[#FEF3E2] border border-[#D18A24]/30 border-l-4 border-l-[#D18A24]/80 hover:border-[#D18A24]/60 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-200 group flex flex-col justify-between overflow-hidden">
            {/* Subtle Oversized Watermark "02" */}
            <span
              className="absolute -top-3 right-4 font-mono text-7xl sm:text-8xl font-extrabold text-[#D18A24]/[0.08] select-none pointer-events-none tracking-tighter"
              aria-hidden="true"
            >
              02
            </span>

            {/* Top Zone: Editorial Number & Category */}
            <div className="space-y-3 relative z-10">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-3xl sm:text-4xl font-extrabold text-[#D18A24] tracking-tight leading-none">
                    02
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.16em] text-[#D18A24]/85">
                    Risk &bull; Identify
                  </span>
                </div>
              </div>

              {/* Visual Motif: Vertical Risk Indicator / Severity Marker */}
              <div className="flex items-center gap-1.5 opacity-35 pt-0.5 pb-1" aria-hidden="true">
                <span className="h-1.5 w-6 rounded-full bg-[#D18A24]/40" />
                <span className="h-1.5 w-4 rounded-full bg-[#D18A24]/70" />
                <span className="h-1.5 w-8 rounded-full bg-[#D18A24]" />
                <span className="text-[9px] font-mono font-bold text-[#D18A24] tracking-wider ml-1">RISK FLAG</span>
              </div>
            </div>

            {/* Middle Zone: Editorial Title & Risk Copy */}
            <div className="space-y-2.5 my-6 relative z-10">
              <h3 className="text-xl sm:text-[22px] font-bold text-[#12372A] tracking-tight leading-snug group-hover:text-[#B47218] transition-colors">
                Spot the Risks
              </h3>
              <p className="text-xs sm:text-[13px] text-[#5C4E3A] leading-relaxed">
                Find unusual obligations, liability exposure, termination traps, and other potentially concerning clauses.
              </p>
            </div>

            {/* Bottom Action: Intentional Callout */}
            <div className="pt-4 border-t border-[#D18A24]/20 flex items-center justify-between text-xs font-bold text-[#D18A24] group-hover:text-[#B47218] relative z-10 transition-colors">
              <span>Review clause risks</span>
              <span className="transition-transform duration-200 group-hover:translate-x-1">&rarr;</span>
            </div>
          </div>

          {/* CARD 03: ASK YOUR DOCUMENT (Grounded Q&A & Citation Intelligence) */}
          <div className="animate-entrance-step-3 relative p-6 sm:p-7 lg:p-8 rounded-2xl bg-[#EEF4F1] border border-[#3E8E63]/25 border-t-2 border-t-[#3E8E63]/60 hover:border-[#3E8E63]/55 shadow-xs hover:shadow-md hover:-translate-y-1 transition-all duration-200 group flex flex-col justify-between overflow-hidden">
            {/* Subtle Oversized Watermark "03" */}
            <span
              className="absolute -top-3 right-4 font-mono text-7xl sm:text-8xl font-extrabold text-[#3E8E63]/[0.07] select-none pointer-events-none tracking-tighter"
              aria-hidden="true"
            >
              03
            </span>

            {/* Top Zone: Editorial Number & Category */}
            <div className="space-y-3 relative z-10">
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2.5">
                  <span className="font-mono text-3xl sm:text-4xl font-extrabold text-[#3E8E63] tracking-tight leading-none">
                    03
                  </span>
                  <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.16em] text-[#3E8E63]/85">
                    Q&amp;A &bull; Verify
                  </span>
                </div>
              </div>

              {/* Visual Motif: Clause Grounding & Citation Node */}
              <div className="flex items-center gap-2 opacity-35 pt-0.5 pb-1" aria-hidden="true">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3E8E63]" />
                  <span className="text-[9px] font-mono font-bold text-[#3E8E63] tracking-wider">&sect; CITATION</span>
                </div>
                <div className="h-[2px] bg-[#3E8E63]/40 rounded-full w-14" />
              </div>
            </div>

            {/* Middle Zone: Editorial Title & Grounding Copy */}
            <div className="space-y-2.5 my-6 relative z-10">
              <h3 className="text-xl sm:text-[22px] font-bold text-[#12372A] tracking-tight leading-snug group-hover:text-[#2E704D] transition-colors">
                Ask Your Document
              </h3>
              <p className="text-xs sm:text-[13px] text-[#374C40] leading-relaxed">
                Ask specific questions and receive verified answers cited directly to the relevant clauses in your agreement.
              </p>
            </div>

            {/* Bottom Action: Intentional Callout */}
            <div className="pt-4 border-t border-[#3E8E63]/20 flex items-center justify-between text-xs font-bold text-[#3E8E63] group-hover:text-[#2E704D] relative z-10 transition-colors">
              <span>Ask document questions</span>
              <span className="transition-transform duration-200 group-hover:translate-x-1">&rarr;</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= DISCLAIMER FOOTER ================= */}
      <div className="pt-2 pb-4 text-center">
        <p className="text-xs text-[#8C9A92] leading-relaxed max-w-xl mx-auto">
          LexEase provides automated analysis for informational purposes only and is not a substitute for professional legal advice.
        </p>
      </div>
    </div>
  )
}

export default FileUpload
