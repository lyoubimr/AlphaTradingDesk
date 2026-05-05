"""
Phase 7 — Spot Volatility ORM models.

Tables (created by migration p8002_spot_volatility):
  - spot_watchlist_snapshots  → per-TF VI snapshot (global — not per-profile)
  - spot_volatility_settings  → global JSONB config (key='global')
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.core.database import Base


class SpotWatchlistSnapshot(Base):
    """Per-TF watchlist snapshot for Kraken Spot pairs.

    Structure mirrors WatchlistSnapshot (contracts) — same pairs JSONB format:
      [{pair, vi_score, regime, alert, change_24h, ema_score, ema_signal,
        tf_sup_regime, tf_sup_vi}]
    """

    __tablename__ = "spot_watchlist_snapshots"
    __table_args__ = (
        Index("ix_swls_tf_generated", "timeframe", "generated_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    regime: Mapped[str] = mapped_column(String(20), nullable=False)
    pairs_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    # [{pair, vi_score, regime, alert, change_24h, ema_score, ema_signal, tf_sup_regime, tf_sup_vi}]
    pairs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class SpotVolatilitySettings(Base):
    """Global config for the spot volatility engine.

    Single row with key='global' (not per-profile — spot watchlist is shared).
    Config Table Pattern: one JSONB config column, deep-merged on PUT.
    """

    __tablename__ = "spot_volatility_settings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    key: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, default="global")
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
