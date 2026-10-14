import axios from 'axios'

/**
 * Resolves the API base URL based on runtime config, environment variables, or host context.
 * In production, it never falls back to localhost unless explicitly hosted on localhost/127.0.0.1.
 *
 * @param {object} [env=import.meta.env]
 * @param {Window|null} [win=window]
 * @returns {string}
 */
export function resolveApiBaseUrl(
  env = import.meta.env,
  win = typeof window !== 'undefined' ? window : null
) {
  if (win?.__LEXEASE_CONFIG__?.API_BASE_URL) {
    return win.__LEXEASE_CONFIG__.API_BASE_URL.replace(/\/+$/, '')
  }
  const explicitApiUrl = env?.VITE_API_BASE_URL
  if (explicitApiUrl && explicitApiUrl.trim()) {
    return explicitApiUrl.replace(/\/+$/, '')
  }
  const fallback = env?.VITE_BACKEND_URL
  if (fallback && fallback.trim()) {
    return fallback.replace(/\/+$/, '')
  }

  const isProd = Boolean(env?.PROD)
  const hostname = win?.location?.hostname || ''
  const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'

  if (isProd) {
    if (!isLocalHost) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(
          '[LexEase] Missing VITE_API_BASE_URL environment variable in production. Configure VITE_API_BASE_URL to point to your deployed backend API.'
        )
      }
      return ''
    }
    // Production build running locally (e.g. local Docker container behind nginx)
    if (win?.location) {
      return win.location.origin
    }
    return ''
  }

  if (win?.location) {
    // When accessed in a browser during development, route API requests through the dev proxy
    return win.location.origin
  }
  return 'http://localhost:8000'
}

export const API_BASE_URL = resolveApiBaseUrl()

const apiClient = axios.create({
  baseURL: API_BASE_URL,
})

/**
 * Extracts a user-friendly error message from an Axios error response.
 * @param {any} error
 * @returns {string}
 */
export function getErrorMessage(error) {
  if (error.response?.data?.detail) {
    const detail = error.response.data.detail
    if (typeof detail === 'string') {
      return detail
    }
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((d) => d.msg || JSON.stringify(d)).join(', ')
    }
    return JSON.stringify(detail)
  }
  if (error.code === 'ERR_NETWORK' || (error.request && !error.response)) {
    return `Cannot reach the LexEase backend at ${API_BASE_URL}. Start or restart the backend, then try again. If it is running, check that this website's address is listed in the backend CORS settings.`
  }
  return error.message || 'An unexpected error occurred while communicating with the server.'
}

/**
 * Health check endpoint.
 * GET /api/health
 */
export async function checkHealth() {
  const response = await apiClient.get('/api/health')
  return response.data
}

export async function submitClauseFeedback(payload) {
  const response = await apiClient.post('/adaptive-learning/feedback', payload)
  return response.data
}

export async function submitClauseFeedbackBatch(payload) {
  const response = await apiClient.post('/adaptive-learning/feedback/submissions', payload)
  return response.data
}

export async function getAdaptiveLearningDashboard() {
  const response = await apiClient.get('/adaptive-learning/dashboard')
  return response.data
}

export async function getPendingClauseFeedback(adminToken) {
  const response = await apiClient.get('/adaptive-learning/feedback/pending', {
    headers: { 'X-Adaptive-Admin-Token': adminToken },
  })
  return response.data
}

export async function getPendingClauseFeedbackSubmissions(adminToken) {
  const response = await apiClient.get('/adaptive-learning/feedback/submissions/pending', {
    headers: { 'X-Adaptive-Admin-Token': adminToken },
  })
  return response.data
}

export async function reviewClauseFeedback(id, decision, adminToken) {
  const response = await apiClient.post(
    `/adaptive-learning/feedback/${encodeURIComponent(id)}/review`,
    { decision },
    { headers: { 'X-Adaptive-Admin-Token': adminToken } },
  )
  return response.data
}

export async function reviewClauseFeedbackSubmission(id, payload, adminToken) {
  const response = await apiClient.post(
    `/adaptive-learning/feedback/submissions/${encodeURIComponent(id)}/review`,
    payload,
    { headers: { 'X-Adaptive-Admin-Token': adminToken } },
  )
  return response.data
}

export async function reloadActiveModel(adminToken) {
  const response = await apiClient.post(
    '/adaptive-learning/models/reload',
    {},
    { headers: { 'X-Adaptive-Admin-Token': adminToken } },
  )
  return response.data
}

export async function rollbackActiveModel(adminToken) {
  const response = await apiClient.post(
    '/adaptive-learning/models/rollback',
    {},
    { headers: { 'X-Adaptive-Admin-Token': adminToken } },
  )
  return response.data
}

export async function runCandidateCycle(adminToken) {
  const response = await apiClient.post(
    '/adaptive-learning/cycle/run',
    {},
    { headers: { 'X-Adaptive-Admin-Token': adminToken } },
  )
  return response.data
}

/**
 * Uploads a legal PDF file for validation, text extraction, cleaning, clause segmentation, and PII masking.
 * POST /documents/upload
 * @param {File} file
 * @returns {Promise<{
 *   filename: string,
 *   page_count: number,
 *   character_count: number,
 *   document_id: string,
 *   clauses: Array<{ clause_id: string, clause_number: string | null, text: string }>
 * }>}
 */
export async function uploadDocument(file) {
  const formData = new FormData()
  formData.append('file', file)

  const response = await apiClient.post('/documents/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
  return response.data
}

/**
 * Generates an executive summary and key points for a preprocessed document.
 * POST /documents/summarize
 * @param {Array<{ clause_id: string, clause_number: string | null, text: string }>} clauses
 * @returns {Promise<{
 *   summary: string,
 *   key_points: string[],
 *   document_type: string | null
 * }>}
 */
export async function summarizeDocument(clauses, documentId = null) {
  const payload = { clauses }
  if (documentId) {
    payload.document_id = documentId
  }
  const response = await apiClient.post('/documents/summarize', payload)
  return response.data
}

/**
 * Performs legal risk analysis on all preprocessed clause segments in a single AI call.
 * POST /clauses/analyze
 * @param {Array<{ clause_id: string, clause_number: string | null, text: string }>} clauses
 * @param {string | null} documentId
 * @returns {Promise<{
 *   total_clauses: number,
 *   results: Array<{
 *     clause_id: string,
 *     clause_number: string | null,
 *     risk_level: 'low' | 'medium' | 'high',
 *     explanation: string,
 *     recommendation: string,
 *     confidence: number
 *   }>
 * }>}
 */
export async function analyzeClauses(clauses, documentId = null) {
  const payload = { clauses }
  if (documentId) {
    payload.document_id = documentId
  }
  const response = await apiClient.post('/clauses/analyze', payload)
  return response.data
}

/** Draft alternatives for selected clauses after explicit AI-processing consent. */
export async function rewriteSelectedClauses(payload) {
  const response = await apiClient.post('/clauses/rewrite', payload)
  return response.data
}

/** Download a separate reconstructed DOCX containing user-approved revisions. */
export async function downloadProposedDraft(payload) {
  return apiClient.post('/documents/proposed-draft', payload, { responseType: 'blob' })
}

export async function downloadProposedPdf(sourceFile, payload) {
  const formData = new FormData()
  formData.append('file', sourceFile, sourceFile.name)
  formData.append('request_json', JSON.stringify(payload))
  return apiClient.post('/documents/proposed-pdf', formData, {
    responseType: 'blob',
  })
}

/**
 * Grounded Document Q&A against the uploaded document context.
 * POST /documents/ask
 * @param {string} documentId
 * @param {string} question
 * @returns {Promise<{
 *   answer: string,
 *   source_clauses: string[],
 *   confidence: number,
 *   cannot_answer: boolean
 * }>}
 */
export async function askDocumentQuestion(documentId, question) {
  const response = await apiClient.post('/documents/ask', {
    document_id: documentId,
    question,
  })
  return response.data
}

export default apiClient
