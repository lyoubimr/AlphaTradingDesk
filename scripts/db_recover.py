#!/usr/bin/env python
"""
DB Recovery helper — called by `make db-recover`.

Detects which recovery path is needed:
  - Schema missing (tables absent) → stamp base + alembic upgrade head
  - Schema present but stamp stale → alembic stamp head  (no DDL changes)

Run from inside the backend container (PYTHONPATH=/app already set by entrypoint).
"""

from __future__ import annotations

import subprocess
import sys

from sqlalchemy import inspect, text

from src.core.database import get_engine

engine = get_engine()

with engine.connect() as conn:
    insp        = inspect(engine)
    tables      = set(insp.get_table_names())
    has_alembic = "alembic_version" in tables
    has_trades  = "trades" in tables

    if has_alembic:
        conn.execute(text("DELETE FROM alembic_version"))
        conn.commit()
        print("✓ Cleared stale alembic_version stamp")

if has_trades:
    # Schema already in place — just re-stamp to head (no DDL needed)
    print("→ Schema present — stamping alembic to head (no DDL changes)…")
    result = subprocess.run(["alembic", "stamp", "head"], capture_output=False)
else:
    # Schema missing — run all migrations from scratch
    print("→ Schema missing — running all migrations from base…")
    result = subprocess.run(["alembic", "upgrade", "head"], capture_output=False)

sys.exit(result.returncode)
