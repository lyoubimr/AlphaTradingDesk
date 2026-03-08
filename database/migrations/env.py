"""
Alembic environment — wired to SQLAlchemy Base.metadata and project settings.

The DATABASE_URL is read from settings (which reads from .env.dev / environment
variables) — never hardcoded here.
"""
from __future__ import annotations

import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# ── Make sure `src` is importable when running alembic from project root ──────
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# ── Import ALL models so Base.metadata is fully populated ─────────────────────
# This single import triggers all model registrations.
from src.core.models import Base  # noqa: E402
from src.core.config import settings  # noqa: E402
from src.core.database import _normalise_db_url  # noqa: E402

# ── Alembic Config object (gives access to alembic.ini values) ────────────────
config = context.config

# Inject DATABASE_URL from settings — normalised to psycopg v3 driver
config.set_main_option("sqlalchemy.url", _normalise_db_url(settings.database_url))

# ── Python logging setup from alembic.ini ─────────────────────────────────────
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Target metadata — what Alembic compares against the live DB ───────────────
target_metadata = Base.metadata


# ── Offline mode (generates SQL without DB connection) ────────────────────────
def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    Generates SQL script output without requiring a live DB connection.
    Useful for reviewing what will be applied before running it.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online mode (runs migrations against a live DB connection) ────────────────
def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    Requires a live PostgreSQL connection.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
