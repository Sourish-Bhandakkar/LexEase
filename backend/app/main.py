from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.logging import setup_logging
from app.api.routers import health, documents, summary, clause_analysis, clause_rewrite, qa, adaptive_learning
from app.database.migrations.init_db import init_db

# Setup logging
setup_logging()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables on startup
    init_db()
    # Note: Running-cycle recovery and durable queue processing are owned strictly
    # by the dedicated worker service (ml.adaptive_learning.worker).
    # Backend restarts leave running worker jobs and queued cycles untouched.
    yield

app = FastAPI(
    title=settings.PROJECT_NAME,
    description=settings.DESCRIPTION,
    version=settings.VERSION,
    lifespan=lifespan,
)

# Set up CORS origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_origin_regex=settings.ALLOWED_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Export-Mode"],
)

# Include routers
app.include_router(health.router, prefix="/api", tags=["System"])
app.include_router(documents.router)
app.include_router(summary.router)
app.include_router(clause_analysis.router)
app.include_router(clause_rewrite.router)
app.include_router(qa.router)
app.include_router(adaptive_learning.router)

