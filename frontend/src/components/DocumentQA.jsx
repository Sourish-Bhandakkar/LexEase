import React, { useState, useRef, useEffect } from 'react'
import { askDocumentQuestion, getErrorMessage } from '../api/client'
import {
  IconChat,
  IconAlertTriangle,
  IconLink,
  IconDocument,
  IconSearch,
  IconScales,
} from './Icons'

function DocumentQA({ documentId, filename, onSelectClause }) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeError, setActiveError] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const threadContainerRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isLoading])

  useEffect(() => {
    const container = threadContainerRef.current
    if (!container) return

    let timeoutId = null
    const handleScroll = () => {
      container.classList.add('scrolling')
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        container.classList.remove('scrolling')
      }, 1000)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      clearTimeout(timeoutId)
    }
  }, [])

  const handleAsk = async (qText) => {
    const textToSend = (qText || question).trim()
    if (!textToSend || isLoading) return
    if (!documentId) {
      setActiveError('Document context is not ready. Please re-upload your document.')
      return
    }

    setActiveError(null)
    const userMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }

    setMessages((prev) => [...prev, userMessage])
    setQuestion('')
    setIsLoading(true)

    try {
      const response = await askDocumentQuestion(documentId, textToSend)
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        answer: response.answer,
        source_clauses: response.source_clauses || [],
        confidence: response.confidence ?? 0,
        cannot_answer: response.cannot_answer ?? false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      setActiveError(errorMsg)
      const errorMessage = {
        id: `assistant-err-${Date.now()}`,
        sender: 'assistant',
        isError: true,
        answer: `Failed to answer question: ${errorMsg}`,
        source_clauses: [],
        confidence: 0,
        cannot_answer: true,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleAsk()
    }
  }

  return (
    <div className="flex flex-col min-h-[480px] h-[540px] sm:h-[580px] rounded-xl bg-white border border-[#D4DFD9] shadow-xs overflow-hidden">
      {/* QA Workstation Header */}
      <div className="px-5 py-3.5 border-b border-[#DCE6E0] bg-white flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#12372A] border border-[#176B4D]/30 flex items-center justify-center text-[#E8F1EC] shrink-0 shadow-2xs">
            <IconChat className="w-4 h-4 text-[#E8F1EC]" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-[#16221C] tracking-tight">
              Grounded Document Q&amp;A
            </h3>
            <p className="text-xs text-[#526058]">
              Direct provision queries cited from <span className="text-[#16221C] font-semibold">{filename || 'uploaded document'}</span>
            </p>
          </div>
        </div>

        {documentId && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#E8F1EC] text-[11px] font-mono text-[#176B4D] border border-[#C8DECE] uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3E8E63]"></span>
            <span>REF: DOC-{documentId.substring(0, 8)}</span>
          </span>
        )}
      </div>

      {/* Messages Thread */}
      <div ref={threadContainerRef} className="flex-1 p-4 sm:p-5 overflow-y-auto space-y-4 qa-thread-container bg-[#F8FAF8]/40">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center space-y-4 py-6 px-4 max-w-2xl mx-auto my-auto select-none">
            <div className="w-10 h-10 rounded-xl bg-[#12372A] border border-[#176B4D]/30 flex items-center justify-center text-[#E8F1EC] shadow-2xs">
              <IconSearch className="w-5 h-5 text-[#E8F1EC]" />
            </div>

            <div className="space-y-1 max-w-md">
              <h4 className="text-sm sm:text-base font-bold text-[#16221C] tracking-tight">
                Grounded Legal Contract Research
              </h4>
              <p className="text-xs text-[#526058] leading-relaxed">
                Query covenants, termination clauses, liabilities, and warranties. Every response is strictly cited from the active contract text.
              </p>
            </div>

            {/* 3-Step Verification Pipeline */}
            <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
              {/* Step 1 */}
              <div className="p-3 rounded-lg bg-white border border-[#DCE6E0] shadow-2xs text-left space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono text-[#176B4D] uppercase tracking-wide">
                    01 &bull; Scope
                  </span>
                  <IconDocument className="w-3.5 h-3.5 text-[#526058]" />
                </div>
                <div className="text-xs font-bold text-[#16221C]">Active Contract</div>
                <p className="text-[11px] text-[#526058] leading-normal">
                  Full agreement partitioned into discrete provisions
                </p>
              </div>

              {/* Step 2 */}
              <div className="p-3 rounded-lg bg-white border border-[#DCE6E0] shadow-2xs text-left space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono text-[#176B4D] uppercase tracking-wide">
                    02 &bull; Retrieval
                  </span>
                  <IconScales className="w-3.5 h-3.5 text-[#526058]" />
                </div>
                <div className="text-xs font-bold text-[#16221C]">Direct Clauses Cited</div>
                <p className="text-[11px] text-[#526058] leading-normal">
                  Calibrated lexical search against verified clauses
                </p>
              </div>

              {/* Step 3 */}
              <div className="p-3 rounded-lg bg-white border border-[#DCE6E0] shadow-2xs text-left space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold font-mono text-[#176B4D] uppercase tracking-wide">
                    03 &bull; Output
                  </span>
                  <IconChat className="w-3.5 h-3.5 text-[#176B4D]" />
                </div>
                <div className="text-xs font-bold text-[#16221C]">Synthesized Answer</div>
                <p className="text-[11px] text-[#526058] leading-normal">
                  Grounded findings with clickable clause navigation
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E8F1EC] text-[10px] font-medium text-[#176B4D] border border-[#C8DECE]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3E8E63]"></span>
              <span>Strict anti-hallucination boundary: unstated clauses are explicitly flagged</span>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.sender === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {/* Sender Label */}
              <span className="text-[10px] font-bold text-[#526058] uppercase tracking-wider mb-1 px-1 font-mono">
                {msg.sender === 'user' ? 'YOU' : 'LEXEASE LEGAL INTELLIGENCE'}
              </span>

              {/* Message Bubble */}
              <div
                className={`max-w-[90%] sm:max-w-[82%] rounded-xl p-3.5 sm:p-4 shadow-2xs space-y-2.5 ${
                  msg.sender === 'user'
                    ? 'bg-[#E8F1EC] border border-[#C8DECE] text-[#16221C]'
                    : msg.isError
                    ? 'bg-[#FFF2F2] border border-[#F5C2C2] text-[#C94A4A]'
                    : msg.cannot_answer
                    ? 'bg-white border border-[#F8DEC0] text-[#16221C]'
                    : 'bg-white border border-[#DCE6E0] text-[#16221C] shadow-2xs'
                }`}
              >
                {/* User Text */}
                {msg.sender === 'user' ? (
                  <p className="text-xs sm:text-sm leading-relaxed font-normal">{msg.text}</p>
                ) : (
                  <>
                    {/* Unanswerable banner */}
                    {msg.cannot_answer && !msg.isError && (
                      <div className="flex items-center gap-2 text-xs font-bold text-[#D18A24] bg-[#FEF3E2] px-2.5 py-1.5 rounded border border-[#F8DEC0]">
                        <IconAlertTriangle className="w-4 h-4 text-[#D18A24] shrink-0" />
                        <span>Provision Not Found in Agreement</span>
                      </div>
                    )}

                    {/* AI Answer Text */}
                    <p className="text-xs sm:text-sm leading-relaxed whitespace-pre-line text-[#16221C] font-normal">
                      {msg.answer}
                    </p>

                    {/* Citations & Confidence Bar */}
                    {!msg.cannot_answer && !msg.isError && (
                      <div className="pt-2.5 border-t border-[#DCE6E0] flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        {/* Source Clauses */}
                        {msg.source_clauses && msg.source_clauses.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[#526058] font-bold font-mono text-[10px] tracking-wide">CITED:</span>
                            {msg.source_clauses.map((clauseId) => (
                              <button
                                key={clauseId}
                                type="button"
                                onClick={() => onSelectClause && onSelectClause(clauseId)}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded bg-[#E8F1EC] text-[#176B4D] font-mono font-bold text-[11px] border border-[#C8DECE] hover:border-[#176B4D] hover:bg-[#D4EAE0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#176B4D]/40 transition-all cursor-pointer shadow-2xs"
                                title={`Click to view and highlight Clause #${clauseId} in Risk Analysis`}
                              >
                                <IconLink className="w-3 h-3 text-[#176B4D]" />
                                <span>CLAUSE {clauseId}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[#526058] italic text-[11px]">No direct clause citation</span>
                        )}

                        {/* Confidence */}
                        <span className="text-[#526058] font-mono bg-[#F8FAF8] px-2 py-0.5 rounded border border-[#DCE6E0] text-[10px]">
                          {Math.round((msg.confidence ?? 0) * 100)}% match
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Timestamp */}
              <span className="text-[10px] text-[#526058] px-1 mt-1 font-mono">
                {msg.timestamp}
              </span>
            </div>
          ))
        )}

        {/* Loading Spinner in Thread */}
        {isLoading && (
          <div className="flex flex-col items-start">
            <span className="text-[10px] font-bold text-[#176B4D] uppercase tracking-wider mb-1 px-1 font-mono">
              LEXEASE LEGAL INTELLIGENCE
            </span>
            <div className="bg-white border border-[#DCE6E0] rounded-xl p-4 shadow-2xs flex items-center space-x-3">
              <div className="w-4 h-4 border-2 border-[#176B4D] border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-[#526058] font-medium">
                Retrieving relevant clauses &amp; synthesizing grounded answer...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-3.5 sm:p-4 border-t border-[#DCE6E0] bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleAsk()
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-[#526058]">
              <IconSearch className="w-4 h-4 text-[#526058]" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
              disabled={isLoading || !documentId}
              placeholder={
                documentId
                  ? 'Query agreement terms, obligations, liabilities, termination (e.g. "What are the termination conditions?")...'
                  : 'Upload a document first to ask questions...'
              }
              className="w-full pl-10 pr-20 py-2.5 sm:py-3 rounded-lg bg-[#F8FAF8] border border-[#DCE6E0] text-xs sm:text-sm text-[#16221C] placeholder-[#8C9A92] focus:outline-none focus:border-[#176B4D] focus:ring-1 focus:ring-[#176B4D]/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-2xs"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-[#526058] bg-[#E8F1EC] border border-[#C8DECE] rounded">
                &crarr; Enter
              </kbd>
            </div>
          </div>

          <button
            type="submit"
            disabled={!question.trim() || isLoading || !documentId}
            className="px-4 sm:px-5 py-2.5 sm:py-3 rounded-lg text-white bg-[#176B4D] hover:bg-[#0F5139] border border-transparent font-bold text-xs sm:text-sm shadow-xs hover:shadow-sm active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <span>Ask</span>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.2"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </button>
        </form>

        <div className="flex items-center justify-between px-1 pt-2 text-[10px] text-[#526058]">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3E8E63]"></span>
            <span>Grounded lexical retrieval with PII protection</span>
          </span>
          <span className="font-mono">{question.length} / 2000</span>
        </div>
      </div>
    </div>
  )
}

export default DocumentQA
