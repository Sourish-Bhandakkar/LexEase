"""
SQLAlchemy engine, session factory, and FastAPI dependency for LexEase.

Usage in route handlers:
    from app.database.session import get_db
    from sqlalchemy.orm import Session

    def my_route(db: Session = Depends(get_db)):
        ...

Engine configuration:
- Default: SQLite with check_same_thread=False (safe for FastAPI's threaded worker pool)
- Override via DATABASE_URL environment variable for PostgreSQL deployment
"""

import sqlite3
from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if isinstance(dbapi_connection, sqlite3.Connection):
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()
        except Exception:
            pass

# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------

def _build_engine():
    """
    Creates the SQLAlchemy engine from settings.DATABASE_URL.

    SQLite receives ``check_same_thread=False`` so it can safely be used
    from FastAPI's threaded worker pool.  PostgreSQL does not need this
    argument (and passing it would raise an error).
    """
    url: str = settings.DATABASE_URL
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg2://", 1)


    connect_args: dict = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    # PostgreSQL / psycopg2 only: skip native HSTORE OID detection.
    # psycopg2 normally issues two extra queries on every new connection to
    # discover HSTORE type OIDs.  When Supabase's transaction-mode pooler
    # returns a connection that is already in an aborted-transaction state,
    # those queries raise InFailedSqlTransaction and crash startup before
    # Base.metadata.create_all() can complete.  LexEase uses no HSTORE
    # columns anywhere, so disabling this feature is completely safe.
    is_postgres = url.startswith("postgresql") or url.startswith("postgres")
    extra: dict = {"use_native_hstore": False} if is_postgres else {}

    return create_engine(
        url,
        connect_args=connect_args,
        # Echo SQL to the log only in debug builds; keep silent in production.
        echo=False,
        **extra,
    )


engine = _build_engine()

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a database session and guarantees cleanup.

    Use with ``Depends(get_db)`` in route handlers.
    """
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
