#!/usr/bin/env python
"""
DB Recovery helper — called by `make db-recover`.

Detects which recovery path is needed:
  - Schema present, stamp missing  → alembic stamp head  (no DDL — tables already there)
  - Schema present, stamp present  → alembic upgrade head (no-op if already at head)
  - Schema missing, stamp present  → clear false stamp + alembic upgrade head (full replay)
  - Schema missing, stamp missing  → alembic upgrade head (fresh DB)

⚠️  SAFETY RULE: we check table EXISTENCE, never row counts.
    A valid prod DB can have 0 trades (user hasn't traded yet).
    Checking `trades = 0` as a proxy for "schema missing" is WRONG and would
    trigger a full migration replay → DROP + recreate all tables → data loss.

Run from inside the backend container (PYTHONPATH=/app already set by entrypoint).
"""

from __future__ import annotations

import subprocess
import sys

from sqlalchemy import inspect, text

from src.core.database import get_engine

CORE_TABLES = {"trades", "profiles", "profile_goals"}

engine = get_engine()

with engine.connect() as conn:
    insp   = inspect(engine)
    tables = set(insp.get_table_names())

    # Check table EXISTENCE — not row counts
    has_tables  = CORE_TABLES.issubset(tables)
    has_alembic = "alembic_version" in tables
    has_stamp   = False
    if has_alembic:
        has_stamp = conn.execute(text("SELECT COUNT(*) FROM alembic_version")).scalar() > 0

    print(f"has_tables={has_tables}  has_stamp={has_stamp}")

    if has_tables and not has_stamp:
        # Tables exist but stamp missing — stamp to head, no DDL needed
        print("→ Schema present, stamp missing — stamping to head (no DDL)…")
        result = subprocess.run(["alembic", "stamp", "head"], capture_output=False)

    elif not has_tables and has_stamp:
        # False stamp (volume reset) — clear it so Alembic replays all migrations
        print("→ Tables missing but stamp present — clearing false stamp + full upgrade…")
        conn.execute(text("DELETE FROM alembic_version"))
        conn.commit()
        result = subprocess.run(["alembic", "upgrade", "head"], capture_output=False)

    else:
        # Normal: either already migrated (no-op) or fresh DB (creates everything)
        print("→ Normal path — running alembic upgrade head…")
        result = subprocess.run(["alembic", "upgrade", "head"], capture_output=False)

sys.exit(result.returncode)
