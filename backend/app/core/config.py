import os
from pathlib import Path
from pydantic import BaseModel
from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parents[2]

# Load environment variables from backend/.env regardless of current working directory
load_dotenv(BACKEND_DIR / ".env")
load_dotenv()


def resolve_database_url(url: str | None = None) -> str:
    raw_url = url or os.getenv("DATABASE_URL", "sqlite:///./lexease.db")
    if raw_url.startswith("sqlite:///"):
        db_path = raw_url[len("sqlite:///"):]
        p = Path(db_path)
        if not p.is_absolute():
            if db_path.startswith("./"):
                db_path = db_path[2:]
            p = (BACKEND_DIR / db_path).resolve()
        return f"sqlite:///{p.as_posix()}"

    if raw_url.startswith(("postgresql://", "postgres://", "postgresql+psycopg2://")):
        import re
        match = re.search(r"://([^:@]+)(?::([^@]*))?@", raw_url)
        if match:
            pwd = match.group(2)
            if pwd is None or pwd.strip() == "":
                raise ValueError(
                    "DATABASE_URL contains PostgreSQL connection without a password. "
                    "A secure server-side POSTGRES_PASSWORD is required."
                )
    return raw_url

class Settings(BaseModel):
    PROJECT_NAME: str = "LexEase API"
    DESCRIPTION: str = "Backend API for Legal Document Simplification and Clause Risk Analysis"
    VERSION: str = "0.1.0"
    API_PREFIX: str = "/api"
    
    ALLOWED_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.getenv(
            "ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173",
        ).split(",")
        if origin.strip()
    ]
    ALLOWED_ORIGIN_REGEX: str | None = (
        os.getenv("ALLOWED_ORIGIN_REGEX", "").strip() or None
    )
    
    # Active AI Provider: "gemini", "groq", "openrouter", "cerebras"
    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "gemini").lower()
    
    # Gemini AI Provider Configuration
    GEMINI_API_KEY: str | None = os.getenv("GEMINI_API_KEY")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    GEMINI_TEMPERATURE: float = float(os.getenv("GEMINI_TEMPERATURE", "0.2"))
    GEMINI_TIMEOUT: float = float(os.getenv("GEMINI_TIMEOUT", "30.0"))
    
    # Groq AI Provider Configuration
    GROQ_API_KEY: str | None = os.getenv("GROQ_API_KEY")
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    GROQ_TIMEOUT: float = float(os.getenv("GROQ_TIMEOUT", "30.0"))
    GROQ_REQUEST_DELAY: float = float(os.getenv("GROQ_REQUEST_DELAY", "2.0"))
    
    # OpenRouter AI Provider Configuration
    OPENROUTER_API_KEY: str | None = os.getenv("OPENROUTER_API_KEY")
    OPENROUTER_MODEL: str = os.getenv("OPENROUTER_MODEL", "openrouter/free")
    OPENROUTER_TIMEOUT: float = float(os.getenv("OPENROUTER_TIMEOUT", "30.0"))
    
    # General AI Configuration
    MAX_RETRIES: int = int(os.getenv("MAX_RETRIES", "3"))
    DATABASE_URL: str = resolve_database_url()
    PORT: int = int(os.getenv("PORT", "8000"))
    ADAPTIVE_LEARNING_ADMIN_TOKEN: str | None = os.getenv("ADAPTIVE_LEARNING_ADMIN_TOKEN")

    # Cerebras AI Provider Configuration
    CEREBRAS_API_KEY: str | None = os.getenv("CEREBRAS_API_KEY")
    CEREBRAS_MODEL: str = os.getenv("CEREBRAS_MODEL", "llama-3.3-70b")
    CEREBRAS_TIMEOUT: float = float(os.getenv("CEREBRAS_TIMEOUT", "30.0"))

settings = Settings()
