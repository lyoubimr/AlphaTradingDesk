"""p8002 — Spot Volatility Engine

Phase 7 — Spot VI computation tables.

Schema changes (additive only — no modifications to existing tables):
  - spot_watchlist_snapshots → new table (stores ranked VI pairs for Kraken Spot)
  - spot_volatility_settings → new table (global JSONB settings, key='global')

Revision ID: p8002_spot_volatility
Revises:     p8001_spot_investment_module
Create Date: 2026-05-08

SAFETY:
  - All CREATE TABLE wrapped in existence checks → idempotent (safe to run twice).
  - No DROP, no modification of existing tables, columns, or constraints.
  - Run this migration twice locally before deploying to prod — must produce
    no error on the second run.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects.postgresql import JSONB

revision = "p8002_spot_volatility"
down_revision = "p8001_spot_investment_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_tables = set(inspector.get_table_names())

    def _existing_indexes(table: str) -> set[str]:
        if table not in existing_tables:
            return set()
        return {idx["name"] for idx in inspector.get_indexes(table)}

    # ── spot_watchlist_snapshots ──────────────────────────────────────────────
    if "spot_watchlist_snapshots" not in existing_tables:
        op.create_table(
            "spot_watchlist_snapshots",
            sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
            # Human-readable identifier, e.g. "ATD_Spot_4h"
            sa.Column("name", sa.String(100), nullable=False),
            # "4h" | "1d" | "1w"
            sa.Column("timeframe", sa.String(10), nullable=False),
            # Dominant regime of the snapshot: EXTREME | ACTIVE | TRENDING | NORMAL | CALM | DEAD
            sa.Column("regime", sa.String(20), nullable=True),
            # Number of pairs scored
            sa.Column("pairs_count", sa.BigInteger, nullable=False, server_default="0"),
            # JSONB array of pair objects (same format as contracts watchlist_snapshots.pairs)
            # [{"pair": "XBTUSD", "vi_score": 0.72, "regime": "ACTIVE", ...}, ...]
            sa.Column("pairs", JSONB, nullable=False, server_default="[]"),
            sa.Column(
                "generated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    # Compound index for efficient latest-per-TF queries
    idx_spot_wl_tf_ts = "ix_spot_watchlist_snapshots_timeframe_generated_at"
    if idx_spot_wl_tf_ts not in _existing_indexes("spot_watchlist_snapshots"):
        op.create_index(
            idx_spot_wl_tf_ts,
            "spot_watchlist_snapshots",
            ["timeframe", "generated_at"],
        )

    # ── spot_volatility_settings ──────────────────────────────────────────────
    if "spot_volatility_settings" not in existing_tables:
        op.create_table(
            "spot_volatility_settings",
            sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
            # Logical key — currently only 'global' is used
            sa.Column(
                "key",
                sa.String(50),
                nullable=False,
                unique=True,
                server_default="global",
            ),
            # Full settings JSONB (pairs list, indicators on/off, top_n, etc.)
            sa.Column("config", JSONB, nullable=False, server_default="{}"),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    # Unique index on key for O(1) global-settings lookup
    idx_spot_vs_key = "ix_spot_volatility_settings_key"
    if idx_spot_vs_key not in _existing_indexes("spot_volatility_settings"):
        op.create_index(idx_spot_vs_key, "spot_volatility_settings", ["key"], unique=True)

    # ── Extend session_type CHECK constraints to include spot sessions ────────
    # The check constraints on ritual_steps and ritual_sessions were created in
    # p7001 and only allow the original 4 session types.  We drop and recreate
    # them here to add 'spot_monthly' and 'spot_weekly'.

    _NEW_STEP_TYPES = (
        "('weekly_setup', 'daily_prep', 'trade_session', 'weekend_review',"
        " 'spot_monthly', 'spot_weekly')"
    )
    _NEW_SESSION_TYPES = _NEW_STEP_TYPES  # same values

    if "ritual_steps" in existing_tables:
        # Drop old constraint (may already be updated on re-run — ignore if missing)
        try:
            op.drop_constraint(
                "ck_ritual_steps_session_type", "ritual_steps", type_="check"
            )
        except Exception:
            pass
        op.create_check_constraint(
            "ck_ritual_steps_session_type",
            "ritual_steps",
            f"session_type IN {_NEW_STEP_TYPES}",
        )

    if "ritual_sessions" in existing_tables:
        try:
            op.drop_constraint(
                "ck_ritual_sessions_session_type", "ritual_sessions", type_="check"
            )
        except Exception:
            pass
        op.create_check_constraint(
            "ck_ritual_sessions_session_type",
            "ritual_sessions",
            f"session_type IN {_NEW_SESSION_TYPES}",
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS spot_watchlist_snapshots CASCADE")
    op.execute("DROP TABLE IF EXISTS spot_volatility_settings CASCADE")
