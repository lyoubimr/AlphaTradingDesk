"""
Phase 3 — SQLAlchemy ORM model for the Dynamic Risk Management module.

Tables:
  - RiskSettings  → risk_settings  (1:1 per profile)

The risk_settings table is created by Alembic migration p3001_phase3_risk_management.py.
SQLAlchemy sees it as a regular table.

config JSONB shape (canonical default in defaults.py):
  {
    "criteria": {
      "market_vi":    { "enabled": bool, "weight": float, "factors": {...} },
      "pair_vi":      { "enabled": bool, "weight": float, "factors": {...} },
      "ma_direction": { "enabled": bool, "weight": float, "factors": {...} },
      "strategy_wr":  { "enabled": bool, "weight": float,
                        "min_factor": float, "max_factor": float },
      "confidence":   { "enabled": bool, "weight": float,
                        "min_factor": float, "max_factor": float }
    },
    "global_multiplier_max": float,
    "risk_guard": { "enabled": bool, "force_allowed": bool,
                    "hard_block_at_zero": bool },
    "alert_banner": { "enabled": bool, "trigger_threshold_pct": float }
  }
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.core.database import Base


class RiskSettings(Base):
    """Dynamic Risk Settings per profile.

    One row per profile — profile_id IS the primary key (same pattern as
    VolatilitySettings).  Created automatically on first GET (upsert in
    service layer with DEFAULT_RISK_CONFIG).
    """

    __tablename__ = "risk_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
