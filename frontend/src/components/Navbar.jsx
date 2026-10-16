import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

function Navbar({ healthStatus, checkingHealth, onCheckHealth, hasDocument, onResetDocument }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const isHealthy = healthStatus?.status === 'healthy'

  const handleBrandClick = () => {
    if (hasDocument && onResetDocument) {
      onResetDocument()
    }
    navigate('/')
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleNavClick = (path) => {
    if (path === '/') {
      if (hasDocument && onResetDocument) {
        onResetDocument()
      }
      navigate('/')
    } else {
      if (hasDocument && onResetDocument && path !== location.pathname) {
        onResetDocument()
      }
      navigate(path)
    }
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleUploadClick = () => {
    setMobileMenuOpen(false)
    if (location.pathname !== '/') {
      navigate('/', { state: { triggerUpload: true } })
    } else if (hasDocument) {
      if (onResetDocument) onResetDocument()
    } else {
      const fileInput = document.querySelector('input[type="file"]')
      if (fileInput) {
        fileInput.click()
      }
    }
  }

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-[#DCE6E0] transition-all duration-200 animate-entrance-navbar">
      {/* Subtle LexEase Deep-Green Edge Accent Line */}
      <div className="absolute bottom-0 left-0 right-0 h-[1.5px] bg-gradient-to-r from-transparent via-[#176B4D]/30 to-transparent pointer-events-none" />

      <div className="w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 h-18 sm:h-20 flex items-center justify-between">
        {/* LEFT ZONE: Prominent LexEase Branding (~20–25%) */}
        <div className="flex items-center flex-shrink-0 lg:w-1/4">
          <button
            type="button"
            onClick={handleBrandClick}
            className="flex items-center space-x-3 hover:opacity-95 transition-all focus:outline-none focus:ring-2 focus:ring-[#176B4D]/30 rounded-xl p-1 group text-left cursor-pointer"
            title="Return to LexEase Home"
          >
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#12372A] text-white shadow-xs group-hover:bg-[#176B4D] transition-colors duration-200">
              <svg
                className="w-5 h-5 text-[#E8F1EC]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
                <path d="M7 21h10" />
                <path d="M12 3v18" />
                <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
              </svg>
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[23px] font-extrabold tracking-tight text-[#12372A] select-none leading-none">
                LexEase
              </span>
              <span className="text-[10px] text-[#66736C] tracking-[0.14em] uppercase font-bold mt-1 select-none">
                Legal Intelligence
              </span>
            </div>
          </button>
        </div>

        {/* CENTER ZONE: Intentional Navigation (~35–40%) */}
        <nav className="hidden md:flex items-center justify-center flex-1 space-x-1 lg:space-x-2 text-sm font-medium">
          <button
            type="button"
            onClick={() => handleNavClick('/')}
            className={`px-4 py-2 rounded-lg text-sm transition-all duration-150 cursor-pointer ${
              location.pathname === '/'
                ? 'text-[#12372A] bg-[#E8F1EC] font-bold shadow-2xs'
                : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'
            }`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('/why-lexease')}
            className={`px-4 py-2 rounded-lg text-sm transition-all duration-150 cursor-pointer ${
              location.pathname === '/why-lexease'
                ? 'text-[#12372A] bg-[#E8F1EC] font-bold shadow-2xs'
                : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'
            }`}
          >
            Why LexEase
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('/about')}
            className={`px-4 py-2 rounded-lg text-sm transition-all duration-150 cursor-pointer ${
              location.pathname === '/about'
                ? 'text-[#12372A] bg-[#E8F1EC] font-bold shadow-2xs'
                : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'
            }`}
          >
            About
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('/adaptive-learning')}
            className={`px-4 py-2 rounded-lg text-sm transition-all duration-150 cursor-pointer ${location.pathname.startsWith('/adaptive-learning') ? 'text-[#12372A] bg-[#E8F1EC] font-bold shadow-2xs' : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'}`}
          >
            Clause Feedback
          </button>
        </nav>

        {/* RIGHT ZONE: Actions (~25–30%) */}
        <div className="flex items-center justify-end flex-shrink-0 space-x-2 sm:space-x-3 lg:w-1/4">
          {/* Backend Status Indicator (Secondary) */}
          <button
            type="button"
            onClick={onCheckHealth}
            title="Click to check backend connection status"
            className="flex items-center space-x-2 px-3 py-1.5 rounded-xl text-xs font-medium bg-white border border-[#DCE6E0] hover:bg-[#F8FAF8] text-[#66736C] transition-all focus:outline-none focus:ring-2 focus:ring-[#176B4D]/20 shadow-2xs cursor-pointer"
          >
            <span className="relative flex h-2 w-2">
              {isHealthy && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3E8E63] opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  checkingHealth
                    ? 'bg-[#D18A24] animate-pulse'
                    : isHealthy
                    ? 'bg-[#3E8E63]'
                    : 'bg-[#C94A4A]'
                }`}
              />
            </span>
            <span className="text-[#66736C] text-[11px] font-medium hidden sm:inline">
              {checkingHealth
                ? 'Connecting...'
                : isHealthy
                ? 'System Online'
                : 'System Offline'}
            </span>
          </button>

          {/* Upload Document Button (Primary Strongest Action) */}
          <button
            type="button"
            onClick={handleUploadClick}
            className="inline-flex items-center px-4 py-2 sm:py-2.5 text-xs sm:text-sm font-bold rounded-xl text-white bg-[#176B4D] hover:bg-[#0F5139] active:scale-[0.98] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#176B4D]/30 shadow-xs hover:shadow-sm cursor-pointer"
          >
            {hasDocument && location.pathname === '/' ? (
              <>
                <svg
                  className="w-3.5 h-3.5 mr-1.5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Upload New
              </>
            ) : (
              <>
                <svg
                  className="w-3.5 h-3.5 mr-1.5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                Upload Document
              </>
            )}
          </button>

          {/* Mobile Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5] focus:outline-none cursor-pointer"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* MOBILE NAVIGATION DRAWER */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#DCE6E0] bg-white px-4 py-3 space-y-1 shadow-lg">
          <button
            type="button"
            onClick={() => handleNavClick('/')}
            className={`w-full text-left px-3.5 py-2 rounded-lg text-sm transition-all ${
              location.pathname === '/'
                ? 'text-[#12372A] bg-[#E8F1EC] font-bold'
                : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'
            }`}
          >
            Home
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('/why-lexease')}
            className={`w-full text-left px-3.5 py-2 rounded-lg text-sm transition-all ${
              location.pathname === '/why-lexease'
                ? 'text-[#12372A] bg-[#E8F1EC] font-bold'
                : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'
            }`}
          >
            Why LexEase
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('/about')}
            className={`w-full text-left px-3.5 py-2 rounded-lg text-sm transition-all ${
              location.pathname === '/about'
                ? 'text-[#12372A] bg-[#E8F1EC] font-bold'
                : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'
            }`}
          >
            About
          </button>
          <button
            type="button"
            onClick={() => handleNavClick('/adaptive-learning')}
            className={`w-full text-left px-3.5 py-2 rounded-lg text-sm transition-all ${location.pathname.startsWith('/adaptive-learning') ? 'text-[#12372A] bg-[#E8F1EC] font-bold' : 'text-[#66736C] hover:text-[#16221C] hover:bg-[#F3F7F5]'}`}
          >
            Clause Feedback
          </button>
        </div>
      )}
    </header>
  )
}

export default Navbar
