"""
Database engine, session factory, and declarative Base.

All models import Base from here so that Base.metadata is a single registry
that Alembic can introspect for autogenerate.

Engine creation is **lazy** — the engine is built the first time it is
accessed via `get_engine()`.  This means importing this module (or any model)
never opens a DB connection, which lets Alembic CLI, pytest collection, and
other tooling work without a live database.
"""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from src.core.config import settings


def _normalise_db_url(url: str) -> str:
    """Ensure we always use the psycopg v3 driver (postgresql+psycopg://).

    Accepts plain 'postgresql://' (e.g. from a cloud secret) and upgrades it.
    Already-correct 'postgresql+psycopg://' URLs pass through unchanged.
    """
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


class Base(DeclarativeBase):
    """Single declarative base shared by all SQLAlchemy models."""

    pass


# ── Lazy engine ───────────────────────────────────────────────────────────────
# The engine is created on first call to get_engine() — never at import time.
# This lets Alembic CLI, tests, and other tooling import models without
# requiring an active DB connection.

_engine: Engine | None = None


def get_engine() -> Engine:
    """Return the (lazily-created) SQLAlchemy engine."""
    global _engine
    if _engine is None:
        _engine = create_engine(
            _normalise_db_url(settings.database_url),
            pool_pre_ping=True,  # drops stale connections before use
            pool_size=10,
            max_overflow=20,
        )
    return _engine


def get_session_factory() -> sessionmaker[Session]:
    """Return a SessionLocal factory bound to the lazy engine."""
    return sessionmaker(
        bind=get_engine(),
        autocommit=False,
        autoflush=False,
    )


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
