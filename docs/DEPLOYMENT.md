# LexEase Production Deployment Guide

## Overview

LexEase is designed for a split, production-ready architecture:
- **Frontend**: Single-Page Application (SPA) deployed to **Vercel** with global edge CDN delivery and client-side routing.
- **Backend API & ML Services**: Containerized services hosted on a **persistent Docker host** (e.g. Render, Railway, DigitalOcean Droplet / App Platform, AWS EC2, or VPS) running FastAPI, PostgreSQL 15, and a dedicated adaptive-learning background training worker.

---

## Architecture Diagram

```
                              +---------------------------------------------+
                              |              Vercel Edge CDN                |
                              |  - Frontend SPA (React + Vite + Tailwind)   |
                              |  - Config: Root Directory = frontend        |
                              |  - SPA Rewrites via frontend/vercel.json    |
                              |  - Env: VITE_API_BASE_URL                   |
                              +---------------------------------------------+
                                                     |
                                                     | HTTPS (REST API calls)
                                                     v
+-------------------------------------------------------------------------------------------------------+
|                                    Persistent Docker Host                                             |
|                                                                                                       |
|  [lexease-backend] (Port 8000)                                                                        |
|    - FastAPI REST API (documents, clauses, simplify, rewrite, adaptive learning)                      |
|    - CORS restricted to configured ALLOWED_ORIGINS & optional project-specific preview regex        |
|    - Pre-cached offline Legal-BERT base encoder (/app/hf_cache)                                       |
|    - CPU-only PyTorch (no CUDA dependencies, <1.5GB image footprint)                                 |
|    - Mounts shared volumes: ml_models, ml_adaptive_data                                               |
|    - Health Check: GET /api/health                                                                    |
|                                                                                                       |
|  [lexease-worker] (Background Service)                                                                |
|    - Dedicated training worker: python -m ml.adaptive_learning.worker                                 |
|    - Polls database queue every 5.0 seconds for 'queued' candidate training cycles                    |
|    - Atomically claims and trains Legal-BERT candidate checkpoints                                   |
|    - Validates against fixed validation sets with strict promotion criteria                           |
|    - Promotes approved candidates by updating active_risk_model.json manifest                         |
|    - Recovers interrupted cycles on startup (no orphaned 'running' jobs)                              |
|    - Mounts shared volumes: ml_models, ml_adaptive_data                                               |
|                                                                                                       |
|  [lexease-db] (PostgreSQL 15 Alpine)                                                                  |
|    - Private to internal Docker Compose network (NO host ports exposed)                               |
|    - Mounts persistent volume: postgres_data                                                          |
|    - Stores documents, clauses, feedback, and model version audit history                             |
|                                                                                                       |
|  Shared Persistent Volumes:                                                                           |
|    - postgres_data:      /var/lib/postgresql/data (DB records & queue state)                          |
|    - ml_models:          /app/ml/models (active manifest & trained candidate checkpoints)             |
|    - ml_adaptive_data:   /app/ml/data/adaptive (reviewed training datasets)                           |
+-------------------------------------------------------------------------------------------------------+
```

---

## 1. Vercel Frontend Deployment

### Project Configuration in Vercel
When importing the LexEase repository in the Vercel Dashboard:

| Setting | Value | Description |
| :--- | :--- | :--- |
| **Framework Preset** | `Vite` | Automatically detected by Vercel. |
| **Root Directory** | `frontend` | Points Vercel build process to the frontend subfolder. |
| **Build Command** | `npm run build` | Compiles production assets into `frontend/dist`. |
| **Output Directory** | `dist` | Contains static HTML, JS, CSS, and assets. |
| **Install Command** | `npm install` | Installs frontend dependencies. |

### Environment Variables on Vercel
Configure this single environment variable in **Project Settings -> Environment Variables**:

| Variable | Example Value | Description |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | `https://api.yourdomain.com` | Public URL of your deployed backend Docker host. **Must NEVER be localhost in production.** |

> [!IMPORTANT]
> **Vite Build-Time Inlining**: Vite bakes `VITE_*` environment variables directly into client JavaScript during `npm run build`. If you change `VITE_API_BASE_URL` in Vercel, you must trigger a new deployment for the change to take effect.

### Client-Side SPA Routing (`frontend/vercel.json`)
The LexEase frontend uses `react-router-dom` with deep routes (`/`, `/why-lexease`, `/about`, `/adaptive-learning`, `/adaptive-learning/admin`, `/clause-drafting`). To prevent `404 Not Found` errors when users refresh deep pages or navigate directly, `frontend/vercel.json` configures client-side rewrite rules:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "cleanUrls": true,
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

---

## 2. Persistent Docker Host Deployment

The backend API, training worker, PostgreSQL database, and model artifact storage run together using Docker Compose.

### Server-Side Environment Secrets (`.env`)
Create a `.env` file on your Docker host (or set environment variables in your orchestrator). **Never commit real values to Git.**

```env
# ==============================================================================
# LexEase Server-Side Environment Configuration
# ==============================================================================

# Server Network & CORS
PORT=8000
# Production Vercel domain; keep localhost origins for local development only
ALLOWED_ORIGINS=https://<your-project-domain>.vercel.app,http://localhost:5173
# Optional: Restricted preview origin regex for Vercel preview deployments.
# Do NOT use broad wildcard regexes like *.vercel.app. Restrict to your exact project/team slug:
# Example: ^https://<your-project-name>(-[a-zA-Z0-9_-]+)?(-<your-team-slug>)?\.vercel\.app$
ALLOWED_ORIGIN_REGEX=

# Active AI Provider: "groq", "openrouter", "gemini", or "cerebras"
AI_PROVIDER=groq

# Groq AI Provider
GROQ_API_KEY=your_groq_production_api_key
GROQ_MODEL=openai/gpt-oss-120b
GROQ_TIMEOUT=30.0

# OpenRouter AI Provider
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=openrouter/free
OPENROUTER_TIMEOUT=30.0

# Google Gemini AI Provider
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
GEMINI_TEMPERATURE=0.2
GEMINI_TIMEOUT=30.0

# Cerebras AI Provider
CEREBRAS_API_KEY=your_cerebras_api_key
CEREBRAS_MODEL=llama-3.3-70b
CEREBRAS_TIMEOUT=30.0

# General AI Settings
MAX_RETRIES=3

# Database Secrets (Required)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=generate_a_long_secure_random_password_here
POSTGRES_DB=lexease
DATABASE_URL=postgresql+psycopg2://${POSTGRES_USER}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB}

# Adaptive Learning Admin Review Secret
# Protects candidate training submission, model reload, and model rollback endpoints
ADAPTIVE_LEARNING_ADMIN_TOKEN=generate_a_high_entropy_random_admin_secret_token_here

# Model Checkpoint Synchronization (Optional Hugging Face Fallback)
# Only required if local model files are not included in the repository / Git LFS:
# LEXEASE_MODEL_REPO_ID=your-org/lexease-risk-model
# LEXEASE_MODEL_REVISION=main
# HF_TOKEN=your_huggingface_read_token
```

### Docker Volume Persistence
LexEase uses three named Docker volumes configured with `restart: unless-stopped`:

1. **`postgres_data` (`/var/lib/postgresql/data`)**:
   - Preserves all processed documents, clauses, feedback reviews, and `AdaptiveModelVersion` audit records across container upgrades and restarts.
2. **`ml_models` (`/app/ml/models`)**:
   - Shared between `lexease-backend` and `lexease-worker`.
   - Stores `active_risk_model.json` (the active model manifest), baseline checkpoints (`final_risk_model/`), and fine-tuned candidate checkpoints (`adaptive/{version}/`).
3. **`ml_adaptive_data` (`/app/ml/data/adaptive`)**:
   - Shared between `lexease-backend` and `lexease-worker`.
   - Stores reviewed training feedback datasets (`approved-{version}.csv`) generated for candidate cycles.

> [!CAUTION]
> **Preserving Volume Data**: Never run `docker compose down -v` in production, as `-v` deletes Docker named volumes and wipes persistent database records and trained model checkpoints. Use `docker compose down` or `docker compose stop`.

### Private PostgreSQL Security
In `docker-compose.yml`, the `db` service definition does not bind host ports:
- PostgreSQL is accessible **only** to the internal `backend` and `worker` containers on the private Compose bridge network (`db:5432`).
- Port 5432 is **not** exposed to the public internet, protecting database credentials from outside connection attempts.

---

## 3. CPU-Only PyTorch & Offline Model Artifacts

### CPU-Only PyTorch Build
To keep container images compact (~1.5 GB instead of >6 GB) and prevent GPU driver mismatches on CPU instances:
- `backend/Dockerfile` installs PyTorch CPU wheels directly from the official PyTorch CPU wheel index:
  ```dockerfile
  RUN uv pip install --system --no-cache --index-url https://download.pytorch.org/whl/cpu torch torchvision
  RUN uv pip install --system --no-cache --extra-index-url https://download.pytorch.org/whl/cpu -r ml/requirements.txt \
      && uv pip install --system --no-cache -r backend/pyproject.toml
  ```
- Build-time assertion verifies CPU-only operation:
  ```dockerfile
  RUN python3 -c "import torch; assert not torch.cuda.is_available(); assert torch.version.cuda is None"
  ```

### Pre-Cached Legal-BERT Base Model
- During `docker build`, the base encoder `nlpaueb/legal-bert-base-uncased` is downloaded into `/app/hf_cache`.
- The container runtime runs with `TRANSFORMERS_OFFLINE=1` and `HF_HUB_OFFLINE=1`, ensuring the backend can start and serve predictions even on air-gapped or restricted-network hosts.

### Fine-Tuned Checkpoint & Hugging Face Hub Fallback
The risk classification head checkpoint is located at `ml/models/final_risk_model`:
- **Local / Git LFS Checkpoint**: Contains `pytorch_model.bin` (~440 MB), `metadata.json`, `tokenizer_config.json`, and `tokenizer.json`/`vocab.txt`.
- **Integrity Validation**: `ml.models.artifact_manager` verifies the file size (>1 MB) and inspects the binary header to ensure it is not an unpulled Git LFS pointer text file.
- **Hugging Face Hub Fallback**: If checkpoints are missing or unpulled on the server, `artifact_manager.ensure_lexease_model_artifacts()` automatically downloads the model weights from the Hugging Face repository specified in `LEXEASE_MODEL_REPO_ID` (using `HF_TOKEN` if private). Download requests temporarily bypass offline mode and restore offline isolation immediately after completion.
- **Manifest Tracking**: The active model is tracked by `ml/models/active_risk_model.json`. `ClauseAnalysisService.reload_if_updated()` watches the manifest timestamp and automatically hot-reloads model weights when a candidate is promoted or rolled back, without restarting the container.

---

## 4. Adaptive Learning & Promotion Rules

### Durable Database Job Queue
1. **Submission**: An admin initiates a candidate cycle via `POST /api/adaptive-learning/models/train-candidate` with the `X-Adaptive-Admin-Token` header.
2. **Atomic Queueing**: The backend creates an `AdaptiveModelVersion` record with `status="queued"` and returns HTTP 202 immediately. No long-running training threads run in the API server.
3. **Worker Processing**: The dedicated `lexease-worker` service polls PostgreSQL every 5.0 seconds. It claims one queued job atomically (`UPDATE ... WHERE status = 'queued' RETURNING id`).
4. **Crash Recovery**: If the worker container is restarted while a job is running, `cleanup_orphaned_running_jobs()` automatically marks the interrupted job as `failed` on startup, preventing stuck jobs or duplicate promotions. Backend restarts leave running worker jobs completely untouched.

### Strict Promotion & Safety Floor Criteria
Candidate models are evaluated against the active parent baseline on a fixed validation set:
- **Primary Improvement**: Must achieve $\ge 0.005$ (0.5%) absolute improvement on either `accuracy` or `macro_f1`. Exact ties are rejected.
- **Non-Regression**: Neither `accuracy` nor `macro_f1` may regress beyond the tolerance ($0.0$).
- **High-Risk Safety Floor**: `high_risk_recall` must be $\ge 0.80$ and must not regress from the parent baseline.
- **Full Precision Audit**: Unrounded metrics, pass/fail reasons, parent version, and thresholds are permanently logged to PostgreSQL.

---

## 5. Operations & Health Verification

### Health Check Endpoint
Check backend health:
```bash
curl -f https://api.yourdomain.com/api/health
```
Expected response:
```json
{"status":"healthy","version":"0.1.0","service":"LexEase Backend"}
```

### Inspecting Running Services on the Docker Host
```bash
# View container status
docker compose ps

# Inspect backend logs
docker compose logs --tail=100 -f backend

# Inspect training worker polling logs
docker compose logs --tail=100 -f worker

# Verify database connection
docker compose exec backend python -c "from app.database.session import engine; engine.connect(); print('Database connected successfully!')"
```

### Deploying Updates

#### Frontend Update (Vercel):
Push changes to the GitHub repository branch connected to Vercel. Vercel automatically builds and deploys the new static assets with zero downtime.

#### Backend / Worker Update (Docker Host):
Rebuild and recreate only the application containers, preserving existing volumes:
```bash
docker compose up --build -d backend worker
```
Persistent database records (`postgres_data`) and model weights (`ml_models`) are preserved untouched.
