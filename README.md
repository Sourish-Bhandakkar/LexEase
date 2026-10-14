# LexEase - Legal Document Simplification & Clause Risk Analysis Using AI

LexEase is a web application designed to help ordinary Indian citizens understand complex legal documents by providing plain-language summaries, clause-by-clause risk classification, interactive grounded Q&A, and translations to Hindi/Marathi.

## Project Structure

*   `/backend` - FastAPI backend application using Python 3.11, `uv` package manager, multi-provider AI layer (Groq, OpenRouter, Gemini), and structured JSON parsing.
*   `/frontend` - React SPA frontend built with Vite, TailwindCSS, React Router, and Axios.
*   `/docs` - Comprehensive API, Architecture, Testing, and Deployment documentation.
*   `docker-compose.yml` - Multi-container setup for local development.

## Current Backend Features
- Health Check (`GET /api/health`)
- PDF Upload & Preprocessing (`POST /documents/upload`)
- Text Extraction, Cleaning & Clause Segmentation
- Indian PII Masking (Email, Phone, Aadhaar, PAN)
- Multi-Provider AI Foundation Layer (`BaseAIProvider`, `AIService`, `ProviderFactory`, `GroqProvider`, `OpenRouterProvider`, `GeminiProvider`)
- Configurable AI Provider Switching via `AI_PROVIDER` (`groq`, `openrouter`, `gemini`)
- Whole Document Summarization (`POST /documents/summarize`)
- Clause-Level Legal Risk Analysis (`POST /clauses/analyze`)
- Grounded Document Q&A (`POST /documents/ask`) with minimum lexical relevance threshold scoring (`min_score = 0.6`) and early termination before AI invocation for unrelated questions.

## Multi-Provider AI Architecture

LexEase supports pluggable AI providers without modifying any upstream business logic or API contracts:

```
                    AIService
                        │
                  BaseAIProvider
                        │
        ┌───────────────┼───────────────┐
        │               │               │
      Gemini           Groq         OpenRouter
        │               │               │
    Gemini API       Groq API     OpenRouter API
```

Active provider selection is driven by environment variable `AI_PROVIDER`:
- `AI_PROVIDER=groq` (Default for seminar & local dev)
- `AI_PROVIDER=openrouter`
- `AI_PROVIDER=gemini`

## Setup Instructions

### Environment Configuration

Copy the example environment file and configure variables:
```bash
cp .env.example .env
```

Configure your preferred AI provider in `.env`:
```env
# Choose provider: "groq", "openrouter", or "gemini"
AI_PROVIDER=groq

# Groq API Configuration
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TIMEOUT=30

# OpenRouter API Configuration
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=openrouter/free
OPENROUTER_TIMEOUT=30

# Google Gemini API Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
GEMINI_TEMPERATURE=0.2
GEMINI_TIMEOUT=30
```

### Running with Docker

Run the entire application stack:
```bash
docker compose up --build
```
*   Frontend will be available at: http://localhost:5173
*   Backend will be available at: http://localhost:8000
*   Database (PostgreSQL) is exposed on port: 5432

### Local Development Setup

#### Backend Setup

Prerequisites: Python 3.11, [uv package manager](https://github.com/astral-sh/uv).

1. Change directory to backend:
   ```bash
   cd backend
   ```
2. Initialize virtual environment and install packages:
   ```bash
   uv venv
   source .venv/bin/activate  # On Windows: .venv\Scripts\activate
   uv sync
   ```
3. Run tests:
   ```bash
   uv run pytest -v
   ```
4. Run the development server:
   ```bash
   uv run uvicorn app.main:app --reload --port 8000
   ```

#### Frontend Setup

Prerequisites: Node.js (v18+).

1. Change directory to frontend:
   ```bash
   cd frontend
   ```
2. Install packages:
   ```bash
   npm install
   ```
3. Run the Vite development server:
   ```bash
   npm run dev
   ```
