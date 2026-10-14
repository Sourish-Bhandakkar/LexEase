# Use official Python 3.11 slim image
FROM python:3.11-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install uv (psycopg2-binary bundles its own libpq — no extra system libs needed)
RUN pip install --no-cache-dir uv

# Copy lockfile and project manifests first for optimal layer caching
COPY backend/pyproject.toml backend/uv.lock ./backend/
COPY ml/requirements.txt ./ml/requirements.txt

# Install PyTorch CPU directly from the official PyTorch CPU wheel index
RUN uv pip install --system --no-cache --index-url https://download.pytorch.org/whl/cpu torch torchvision

# Install ML dependencies and backend dependencies; using the PyTorch CPU index prevents GPU replacements
RUN uv pip install --system --no-cache --extra-index-url https://download.pytorch.org/whl/cpu -r ml/requirements.txt \
    && uv pip install --system --no-cache -r backend/pyproject.toml

# Verify CPU-only PyTorch: CUDA must be unavailable and torch.version.cuda must be None
RUN python3 -c "import torch; assert not torch.cuda.is_available(), 'CUDA is unexpectedly available'; assert torch.version.cuda is None, f'CUDA version unexpectedly present: {torch.version.cuda}'"

# Copy backend application code and ML pipeline code
COPY backend/app/ ./backend/app/
COPY ml/ ./ml/

# Pre-cache Legal-BERT base model weights and tokenizer into container image for offline inference
ENV HF_HOME=/app/hf_cache
RUN python3 -c "from transformers import AutoTokenizer, AutoModel; AutoTokenizer.from_pretrained('nlpaueb/legal-bert-base-uncased'); AutoModel.from_pretrained('nlpaueb/legal-bert-base-uncased')"

# Set working directory to backend for standard uvicorn execution with root in PYTHONPATH
WORKDIR /app/backend
ENV PYTHONPATH="/app:/app/backend"
ENV TRANSFORMERS_OFFLINE=1
ENV HF_HUB_OFFLINE=1
ENV HF_HOME=/app/hf_cache

# Expose port and start FastAPI
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
