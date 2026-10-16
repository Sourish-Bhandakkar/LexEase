import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Navbar from '../components/Navbar'
import {
  checkHealth,
  getErrorMessage,
  getPendingClauseFeedback,
  getPendingClauseFeedbackSubmissions,
} from '../api/client'

const SESSION_TOKEN_KEY = 'lexease_adaptive_admin_token'

function AdaptiveLearning() {
  const navigate = useNavigate()
  const [healthStatus, setHealthStatus] = useState(null)
  const [checkingHealth, setCheckingHealth] = useState(false)
  const [secretText, setSecretText] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [error, setError] = useState('')

  const verifyHealth = async () => {
    setCheckingHealth(true)
    try {
      setHealthStatus(await checkHealth())
    } catch (healthError) {
      setHealthStatus({ status: 'unreachable', error: getErrorMessage(healthError) })
    } finally {
      setCheckingHealth(false)
    }
  }

  const handleUnlock = async (event) => {
    event.preventDefault()
    const token = secretText.trim()
    if (!token) return

    setUnlocking(true)
    setError('')
    try {
      await Promise.all([
        getPendingClauseFeedback(token),
        getPendingClauseFeedbackSubmissions(token),
      ])
      sessionStorage.setItem(SESSION_TOKEN_KEY, token)
      navigate('/adaptive-learning/admin')
    } catch (unlockError) {
      setError(getErrorMessage(unlockError))
    } finally {
      setUnlocking(false)
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

      <main className="mx-auto w-full max-w-5xl space-y-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="border-b border-[#DCE6E0] pb-6">
          <span className="rounded bg-[#176B4D]/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#176B4D]">
            Clause Feedback
          </span>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-[#12372A] sm:text-4xl">
            Flag a clause for review
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#66736C]">
            If a risk label looks incorrect, flag that clause from its analysis card and suggest the label you believe is right. A reviewer checks each flag before it becomes an approved reference example.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-3" aria-label="Feedback review steps">
          <article className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F1EC] text-sm font-bold text-[#176B4D]">1</span>
            <h2 className="mt-3 text-sm font-bold text-[#12372A]">Raise a flag</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#66736C]">
              In Clause Risk Analysis, choose <strong>Flag label</strong>, suggest a corrected risk level, and optionally explain your reasoning.
            </p>
          </article>
          <article className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F1EC] text-sm font-bold text-[#176B4D]">2</span>
            <h2 className="mt-3 text-sm font-bold text-[#12372A]">Reviewer checks it</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#66736C]">
              A reviewer compares the clause, the model’s label, and the suggested correction, then approves or rejects the flag.
            </p>
          </article>
          <article className="rounded-2xl border border-[#DCE6E0] bg-white p-5 shadow-sm">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#E8F1EC] text-sm font-bold text-[#176B4D]">3</span>
            <h2 className="mt-3 text-sm font-bold text-[#12372A]">Approved examples are retained</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#66736C]">
              Approved examples stay in the database for possible future offline analysis or training. Submitting or approving feedback does not change the live model.
            </p>
          </article>
        </section>

        <section className="rounded-2xl border border-[#DCE6E0] bg-white p-6 shadow-sm sm:p-8">
          <div className="max-w-2xl">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#66736C]">Reviewer access</span>
            <h2 className="mt-2 text-xl font-bold text-[#12372A]">Open the private review area</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#66736C]">
              Enter the reviewer secret text to view and process submitted flags. Model status and cycle history are on a separate private page.
            </p>
          </div>
          <form onSubmit={handleUnlock} className="mt-5 flex max-w-2xl flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="reviewer-secret-text">Reviewer secret text</label>
            <input
              id="reviewer-secret-text"
              type="password"
              autoComplete="current-password"
              value={secretText}
              onChange={(event) => setSecretText(event.target.value)}
              placeholder="Enter reviewer secret text"
              className="min-w-0 flex-1 rounded-xl border border-[#DCE6E0] px-3.5 py-2.5 text-sm focus:border-[#176B4D] focus:outline-none"
              required
            />
            <button
              type="submit"
              disabled={unlocking || !secretText.trim()}
              className="rounded-xl bg-[#176B4D] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#124F38] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {unlocking ? 'Checking…' : 'Unlock review area'}
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-3 max-w-2xl rounded-xl border border-[#F5C2C2] bg-[#FFF7F7] p-3 text-sm text-[#C94A4A]">
              {error}
            </p>
          )}
        </section>
      </main>
    </div>
  )
}

export default AdaptiveLearning
