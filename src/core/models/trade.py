"""
Trade-related models: strategies, tags, trades, positions, trade_tags.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.database import Base


class Strategy(Base):
    __tablename__ = "strategies"
    __table_args__ = (
        UniqueConstraint("profile_id", "name"),
        CheckConstraint("trades_count >= 0", name="ck_strategies_trades_count"),
        CheckConstraint("win_count >= 0", name="ck_strategies_win_count"),
        CheckConstraint("win_count <= trades_count", name="ck_strategies_win_lte_trades"),
        CheckConstraint("min_trades_for_stats >= 1", name="ck_strategies_min_trades"),
        Index("idx_strategies_profile", "profile_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    rules: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(7))
    emoji: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")

    # Stats — updated atomically on trade close
    trades_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    win_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    min_trades_for_stats: Mapped[int] = mapped_column(Integer, nullable=False, default=5)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="strategies")  # type: ignore[name-defined]
    trades: Mapped[list[Trade]] = relationship(back_populates="strategy")


class Tag(Base):
    __tablename__ = "tags"
    __table_args__ = (
        UniqueConstraint("profile_id", "name"),
        Index("idx_tags_profile", "profile_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str | None] = mapped_column(String(7))
    emoji: Mapped[str | None] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="tags")  # type: ignore[name-defined]
    trade_tags: Mapped[list[TradeTag]] = relationship(back_populates="tag")


class Trade(Base):
    __tablename__ = "trades"
    __table_args__ = (
        CheckConstraint(
            "direction IN ('long', 'short')", name="ck_trades_direction"
        ),
        CheckConstraint(
            "status IN ('open', 'partial', 'closed')", name="ck_trades_status"
        ),
        CheckConstraint("risk_amount > 0", name="ck_trades_risk_amount_positive"),
        CheckConstraint("potential_profit > 0", name="ck_trades_potential_profit_positive"),
        CheckConstraint(
            "(status = 'closed' AND realized_pnl IS NOT NULL) OR "
            "(status != 'closed' AND realized_pnl IS NULL)",
            name="ck_trades_pnl_consistency",
        ),
        CheckConstraint(
            "nb_take_profits >= 1 AND nb_take_profits <= 3",
            name="ck_trades_nb_tp_range",
        ),
        CheckConstraint(
            "confidence_score IS NULL OR "
            "(confidence_score >= 0 AND confidence_score <= 100)",
            name="ck_trades_confidence_score_range",
        ),
        Index("idx_trades_profile_created", "profile_id", "created_at"),
        Index("idx_trades_pair", "pair"),
        Index("idx_trades_status", "status"),
        Index("idx_trades_strategy", "strategy_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    instrument_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("instruments.id", ondelete="SET NULL")
    )
    strategy_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("strategies.id", ondelete="SET NULL")
    )
    market_analysis_session_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("market_analysis_sessions.id", ondelete="SET NULL")
    )

    # Trade info
    pair: Mapped[str] = mapped_column(String(20), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    asset_class: Mapped[str | None] = mapped_column(String(50))
    analyzed_timeframe: Mapped[str | None] = mapped_column(String(10))

    # Entry details
    entry_price: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    entry_date: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    # Risk management
    stop_loss: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    nb_take_profits: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Risk calculations
    risk_amount: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    potential_profit: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    current_risk: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))

    # Trade status
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open")
    realized_pnl: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))

    # VI adjustment (Phase 2+) — stored but not computed in Phase 1
    market_vi_at_entry: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    pair_vi_at_entry: Mapped[Decimal | None] = mapped_column(Numeric(5, 3))
    vi_adjusted_risk_amount: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))

    # Auto-trading (Phase 4+)
    auto_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    signal_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    slippage: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    commission: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))

    # CFD/Crypto specifics
    leverage: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    spread: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    estimated_fees: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    confidence_score: Mapped[int | None] = mapped_column(Integer)
    session_tag: Mapped[str | None] = mapped_column(String(20))

    # Metadata
    notes: Mapped[str | None] = mapped_column(Text)
    structured_notes: Mapped[dict | None] = mapped_column(JSONB)
    screenshot_urls: Mapped[list | None] = mapped_column(ARRAY(Text))

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="trades")  # type: ignore[name-defined]
    instrument: Mapped[Instrument | None] = relationship(back_populates="trades")  # type: ignore[name-defined]
    strategy: Mapped[Strategy | None] = relationship(back_populates="trades")
    positions: Mapped[list[Position]] = relationship(back_populates="trade")
    trade_tags: Mapped[list[TradeTag]] = relationship(back_populates="trade")


class Position(Base):
    """One TP target per position (up to 3 per trade)."""
    __tablename__ = "positions"
    __table_args__ = (
        UniqueConstraint("trade_id", "position_number"),
        CheckConstraint(
            "position_number IN (1, 2, 3)", name="ck_positions_number_range"
        ),
        CheckConstraint(
            "lot_percentage > 0 AND lot_percentage <= 100",
            name="ck_positions_lot_pct_range",
        ),
        CheckConstraint(
            "status IN ('open', 'closed', 'cancelled')", name="ck_positions_status"
        ),
        CheckConstraint(
            "(status = 'closed' AND exit_price IS NOT NULL) OR "
            "(status != 'closed' AND exit_price IS NULL)",
            name="ck_positions_exit_price_consistency",
        ),
        Index("idx_positions_trade", "trade_id"),
        Index("idx_positions_status", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    trade_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("trades.id", ondelete="CASCADE"), nullable=False
    )
    position_number: Mapped[int] = mapped_column(Integer, nullable=False)
    take_profit_price: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    lot_percentage: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open")
    exit_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    exit_date: Mapped[datetime | None] = mapped_column(DateTime)
    realized_pnl: Mapped[Decimal | None] = mapped_column(Numeric(20, 2))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    trade: Mapped[Trade] = relationship(back_populates="positions")


class TradeTag(Base):
    __tablename__ = "trade_tags"
    __table_args__ = (
        UniqueConstraint("trade_id", "tag_id"),
        Index("idx_trade_tags_trade", "trade_id"),
        Index("idx_trade_tags_tag", "tag_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    trade_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("trades.id", ondelete="CASCADE"), nullable=False
    )
    tag_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("tags.id", ondelete="CASCADE"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    trade: Mapped[Trade] = relationship(back_populates="trade_tags")
    tag: Mapped[Tag] = relationship(back_populates="trade_tags")


# Late import to resolve forward references (broker.py defines Profile/Instrument)
from src.core.models.broker import Instrument, Profile  # noqa: E402
