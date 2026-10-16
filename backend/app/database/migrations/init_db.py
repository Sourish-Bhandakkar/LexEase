"""
Database initialization for LexEase.

Creates all tables defined in the ORM models if they do not already exist.
Safe to call on every application startup — SQLAlchemy's ``create_all``
is idempotent (it skips tables that are already present).

Usage:
    from app.database.migrations.init_db import init_db
    init_db()
"""

import logging

from sqlalchemy import inspect, text

from app.database.models import Base
from app.database import session as session_module

logger = logging.getLogger(__name__)


def init_db() -> None:
    """
    Creates all database tables using the configured engine.

    This function is called once at application startup via the FastAPI
    lifespan event.  It is intentionally simple — no Alembic migrations
    are required for the SQLite phase of development.

    When switching to PostgreSQL, replace this with Alembic's
    ``upgrade("head")`` call.
    """
    try:
        active_engine = session_module.engine
        Base.metadata.create_all(bind=active_engine)
        _migrate_clause_feedback_source_group(active_engine)
        _migrate_adaptive_model_versions_display_label(active_engine)
        logger.info("Database tables initialized successfully.")
    except Exception as exc:
        logger.error(f"Database initialization failed: {exc}")
        raise


def _migrate_clause_feedback_source_group(active_engine=None) -> None:
    """Add the adaptive-learning grouping column to databases created earlier."""
    target_engine = active_engine or session_module.engine
    inspector = inspect(target_engine)
    if not inspector.has_table("clause_feedback"):
        return

    columns = {column["name"] for column in inspector.get_columns("clause_feedback")}
    with target_engine.begin() as connection:
        if "source_group_id" not in columns:
            # Keep existing reviewed/pending feedback. Its original document group
            # is unknown, so assign each legacy row a unique group rather than
            # incorrectly grouping unrelated clauses together.
            connection.execute(text("ALTER TABLE clause_feedback ADD COLUMN source_group_id VARCHAR"))
        connection.execute(text(
            "UPDATE clause_feedback "
            "SET source_group_id = 'legacy_' || id "
            "WHERE source_group_id IS NULL OR source_group_id = ''"
        ))

    feedback_table = Base.metadata.tables["clause_feedback"]
    for index in feedback_table.indexes:
        index.create(bind=target_engine, checkfirst=True)


def _migrate_adaptive_model_versions_display_label(active_engine=None) -> None:
    """Add display_label column to adaptive_model_versions for existing databases."""
    target_engine = active_engine or session_module.engine
    inspector = inspect(target_engine)
    if not inspector.has_table("adaptive_model_versions"):
        return

    columns = {column["name"] for column in inspector.get_columns("adaptive_model_versions")}
    if "display_label" not in columns:
        with target_engine.begin() as connection:
            connection.execute(text("ALTER TABLE adaptive_model_versions ADD COLUMN display_label VARCHAR"))
