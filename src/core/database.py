"""
Database engine, session factory, and declarative Base.

All models import Base from here so that Base.metadata is a single registry
that Alembic can introspect for autogenerate.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

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


engine = create_engine(
    _normalise_db_url(settings.database_url),
    pool_pre_ping=True,   # drops stale connections before use
    pool_size=10,
    max_overflow=20,
)

SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)
