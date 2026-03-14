"""
Phase 2 — SQLAlchemy ORM models for the Volatility Engine.

Tables:
  - VolatilitySnapshot     → volatility_snapshots  (hypertable)
  - MarketVISnapshot       → market_vi_snapshots   (hypertable)
  - MarketVIPair           → market_vi_pairs
  - WatchlistSnapshot      → watchlist_snapshots
  - VolatilitySettings     → volatility_settings   (1:1 per profile)
  - NotificationSettings   → notification_settings (1:1 per profile)

Note: hypertable DDL (create_hypertable) is handled by Alembic migration
p2001_phase2_volatility.py — not here. SQLAlchemy sees them as regular tables.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from src.core.database import Base


class VolatilitySnapshot(Base):
    """Per-Pair VI snapshot — TimescaleDB hypertable partitioned on timestamp."""

    __tablename__ = "volatility_snapshots"
    __table_args__ = (
        Index("ix_vs_pair_tf_ts", "pair", "timeframe", "timestamp"),
        Index("ix_vs_vi_score_tf", "timeframe", "vi_score"),
    )

    # Composite PK: (pair, timeframe, timestamp) — matches migration DDL
    pair: Mapped[str] = mapped_column(String(20), primary_key=True)
    timeframe: Mapped[str] = mapped_column(String(10), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    vi_score: Mapped[Decimal] = mapped_column(Numeric(5, 3), nullable=False)
    # {"rvol": 0.72, "mfi": 0.58, "atr": 0.61, "bb_width": 0.44,
    #  "ema_score": 85, "ema_signal": "breakout_up"}
    components: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class MarketVISnapshot(Base):
    """Aggregated Market VI snapshot — TimescaleDB hypertable partitioned on timestamp."""

    __tablename__ = "market_vi_snapshots"
    __table_args__ = (
        Index("ix_mvs_tf_ts", "timeframe", "timestamp"),
    )

    # Composite PK: (timeframe, timestamp)
    timeframe: Mapped[str] = mapped_column(String(10), primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True
    )
    vi_score: Mapped[Decimal] = mapped_column(Numeric(5, 3), nullable=False)
    # DEAD | CALM | NORMAL | TRENDING | ACTIVE | EXTREME
    regime: Mapped[str] = mapped_column(String(20), nullable=False)
    # {symbol: vi_score, ...} for all ~50 Binance pairs
    components: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class MarketVIPair(Base):
    """Binance Futures pairs available for Market VI computation.

    Synced daily by sync_instruments task (top-100 by 24h quoteVolume).
    is_selected: controlled from Settings UI (default: top-50 by volume).
    """

    __tablename__ = "market_vi_pairs"
    __table_args__ = (
        Index("ix_mvp_is_selected", "is_selected"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    symbol: Mapped[str] = mapped_column(String(30), nullable=False, unique=True)
    display_name: Mapped[str | None] = mapped_column(String(50))
    quote_volume_24h: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    volume_rank: Mapped[int | None] = mapped_column(Integer)
    is_selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class WatchlistSnapshot(Base):
    """Watchlist snapshot generated after each per-pair VI compute cycle.

    pairs JSONB structure:
      [{pair, vi_score, regime, ema_signal, ema_score,
        change_24h, tf_sup_regime, tf_sup_vi}]
    """

    __tablename__ = "watchlist_snapshots"
    __table_args__ = (
        Index("ix_wls_tf_generated", "timeframe", "generated_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    regime: Mapped[str] = mapped_column(String(20), nullable=False)
    pairs_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pairs: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class VolatilitySettings(Base):
    """Per-profile volatility configuration (1:1 with profiles).

    All configuration stored in JSONB columns — add/remove keys
    without any Alembic migration.

    market_vi JSONB default:
      {
        "pairs": [],           # symbols selected for Market VI
        "weights": {},         # {symbol: weight} overrides (BTC=0.30, ETH=0.20)
        "tf_weights": {        # cross-TF aggregation weights
          "weekday": {"15m": 0.25, "1h": 0.40, "4h": 0.25, "1d": 0.10},
          "weekend": {"15m": 0.50, "1h": 0.40, "4h": 0.10, "1d": 0.00}
        },
        "active_hours_start": "00:00",
        "active_hours_end": "23:59",
        "weekdays_only": false,
        "rolling_window": 20,
        "enabled": true
      }

    per_pair JSONB default:
      {
        "indicators": {"rvol": true, "mfi": true, "atr": true, "bb": true, "ema": true},
        "retention_days": 30,
        "active_hours_start": "00:00",
        "active_hours_end": "23:59",
        "enabled": true
      }

    regimes JSONB default:
      {"dead_max": 0.17, "calm_max": 0.33, "normal_max": 0.50,
       "trending_max": 0.67, "active_max": 0.83}
    """

    __tablename__ = "volatility_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True
    )
    market_vi: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    per_pair: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    regimes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class NotificationSettings(Base):
    """Per-profile Telegram notification configuration (1:1 with profiles).

    bots JSONB: [{bot_token, chat_id, bot_name}]
    market_vi_alerts JSONB: {enabled, bot_name, cooldown_min, regimes: []}
    watchlist_alerts JSONB: {enabled, bot_name, per_tf: {15m: {enabled, cooldown_min, vi_min}}}
    """

    __tablename__ = "notification_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True
    )
    bots: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    market_vi_alerts: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    watchlist_alerts: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
