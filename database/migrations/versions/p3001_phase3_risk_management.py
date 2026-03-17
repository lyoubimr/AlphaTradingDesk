"""Phase 3 — Dynamic Risk Management tables + column

Revision ID: p3001_phase3_risk_management
Revises: p2001_phase2_volatility
Create Date: 2026-03-17 00:00:00.000000

Creates:
  - risk_settings    (JSONB config per profile — criteria, weights, factors,
                      global_multiplier_max, risk_guard, alert_banner)

Adds column:
  - trades.dynamic_risk_snapshot  JSONB NULL
    (full Risk Advisor breakdown stored at trade-open time for auditability)

All CREATE TABLE use IF NOT EXISTS.
ADD COLUMN uses IF NOT EXISTS (PostgreSQL 9.6+).
Safe to replay on a DB where the objects already exist.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "p3001_phase3_risk_management"
down_revision = "p2001_phase2_volatility"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. risk_settings — Dynamic Risk config per profile ───────────────────
    # One row per profile.  Created automatically on first GET (upsert in
    # service layer with DEFAULT_RISK_CONFIG).  UNIQUE on profile_id so a
    # duplicate INSERT is caught at DB level.
    #
    # config JSONB shape (canonical — see pre-implement-phase3.md):
    # {
    #   "criteria": {
    #     "market_vi":   { "enabled": true, "weight": 0.20, "factors": {...} },
    #     "pair_vi":     { "enabled": true, "weight": 0.25, "factors": {...} },
    #     "ma_direction":{ "enabled": true, "weight": 0.20, "factors": {...} },
    #     "strategy_wr": { "enabled": true, "weight": 0.20,
    #                      "min_factor": 0.50, "max_factor": 1.50 },
    #     "confidence":  { "enabled": true, "weight": 0.15,
    #                      "min_factor": 0.50, "max_factor": 1.50 }
    #   },
    #   "global_multiplier_max": 2.0,
    #   "risk_guard": {
    #     "enabled": true, "force_allowed": true, "hard_block_at_zero": false
    #   },
    #   "alert_banner": {
    #     "enabled": true, "trigger_threshold_pct": 100.0
    #   }
    # }
    op.execute("""
        CREATE TABLE IF NOT EXISTS risk_settings (
            profile_id  BIGINT      PRIMARY KEY
                                    REFERENCES profiles(id) ON DELETE CASCADE,
            config      JSONB       NOT NULL DEFAULT '{}',
            updated_at  TIMESTAMP   NOT NULL DEFAULT NOW()
        )
    """)

    # ── 2. trades.dynamic_risk_snapshot — Risk Advisor snapshot at open ──────
    # Nullable — trades opened before Phase 3 (or without the adviser) have
    # NULL.  Stores the full breakdown returned by compute_risk_multiplier()
    # so the trade record is self-contained and auditable.
    #
    # Shape mirrors RiskMultiplierResult (see src/risk_management/engine.py):
    # {
    #   "multiplier": 1.285,
    #   "base_risk_pct": 2.0,
    #   "adjusted_risk_pct": 2.57,
    #   "criteria": [
    #     { "name": "market_vi", "enabled": true, "value_label": "TRENDING",
    #       "factor": 1.50, "weight": 0.20, "contribution": 0.300 },
    #     ...
    #   ],
    #   "budget_remaining_pct": 3.2,
    #   "budget_blocking": false,
    #   "force_used": false
    # }
    op.execute("""
        ALTER TABLE trades
            ADD COLUMN IF NOT EXISTS dynamic_risk_snapshot JSONB
    """)


def downgrade() -> None:
    # Remove column first (no table dependency), then drop the settings table.
    op.execute("""
        ALTER TABLE trades
            DROP COLUMN IF EXISTS dynamic_risk_snapshot
    """)
    op.execute("DROP TABLE IF EXISTS risk_settings")
