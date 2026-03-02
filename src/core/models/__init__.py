"""
src/core/models/__init__.py

Single import point for ALL SQLAlchemy models.
Alembic's env.py imports only this module — which guarantees that
Base.metadata is fully populated with every table before autogenerate runs.
"""
from src.core.database import Base  # noqa: F401 — re-exported for Alembic

# Import every model module so their classes register on Base.metadata.
# Order matters only for readability; SQLAlchemy resolves FK relationships lazily.
from src.core.models import (  # noqa: F401
    broker,
    trade,
    journal,
    goals,
    sessions,
    market_analysis,
)

__all__ = ["Base"]
