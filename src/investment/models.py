"""
Phase 7 — Investment & Spot module ORM models.

Tables (created by migration p8001_spot_investment_module):
  - spot_trades         → spot position log (quantity-based, SL optional)
  - deposits            → contribution / withdrawal log per profile
  - investment_settings → per-profile JSONB config (Config Table Pattern)
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.core.database import Base


class SpotTrade(Base):
    """Spot position — quantity-based entry, SL optional, no leverage.

    Key differences from the `trades` table:
    - stop_loss is nullable (optional risk guard)
    - no leverage / margin_used columns
    - total_cost = quantity × entry_price (stored on open, replaces risk_amount)
    - parent_spot_trade_id: optional self-FK for DCA entry grouping
    - tp_targets: JSONB [{price, pct_allocation}] — same shape as positions
    """

    __tablename__ = "spot_trades"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_spot_trades_quantity_positive"),
        CheckConstraint("nb_take_profits BETWEEN 0 AND 3", name="ck_spot_trades_nb_tp"),
        CheckConstraint(
            "order_type IN ('MARKET', 'LIMIT')", name="ck_spot_trades_order_type"
        ),
        CheckConstraint(
            "status IN ('pending', 'open', 'partial', 'runner', 'closed', 'cancelled')",
            name="ck_spot_trades_status",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    # Optional DCA grouping: NULL = standalone entry, non-NULL = sub-entry
    parent_spot_trade_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("spot_trades.id", ondelete="SET NULL")
    )
    strategy_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("strategies.id", ondelete="SET NULL")
    )
    instrument_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("instruments.id", ondelete="SET NULL")
    )

    # Core
    pair: Mapped[str] = mapped_column(String(30), nullable=False)
    asset_class: Mapped[str | None] = mapped_column(String(50))
    analyzed_timeframe: Mapped[str | None] = mapped_column(String(10))
    order_type: Mapped[str] = mapped_column(String(20), nullable=False, default="MARKET")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")

    # Entry
    entry_price: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(20, 8), nullable=False)
    total_cost: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    entry_date: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

    # Optional SL guard (not required for spot — no forced liquidation risk)
    stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    # Trailing stop as percentage distance (e.g. 5.0 = 5% trail below peak)
    trailing_stop_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 4))

    # Take Profits: [{price: float, pct_allocation: float}]
    nb_take_profits: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    tp_targets: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # P&L (populated on close)
    exit_price: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    realized_pnl: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    closed_at: Mapped[datetime.datetime | None] = mapped_column(DateTime(timezone=True))

    # VI snapshot at entry
    market_vi_at_entry: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    pair_vi_at_entry: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))

    # Meta
    confidence_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    session_tag: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    structured_notes: Mapped[dict | None] = mapped_column(JSONB)
    screenshot_urls: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Timestamps
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Deposit(Base):
    """Deposit or withdrawal event for a spot profile.

    amount > 0 = capital added (deposit / DCA contribution)
    amount < 0 = capital withdrawn (profit taking / emergency)
    is_recurrent = True when logged via the ritual deposit_check step
    """

    __tablename__ = "deposits"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    deposit_date: Mapped[datetime.date] = mapped_column(Date, nullable=False)
    label: Mapped[str | None] = mapped_column(String(100))
    is_recurrent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class InvestmentSettings(Base):
    """Per-profile investment configuration — Config Table Pattern.

    profile_id IS the primary key (1:1 with profiles).
    Auto-created on first GET with DEFAULT_INVESTMENT_CONFIG.

    config JSONB shape:
    {
      "recurrent_deposit": {
        "enabled": bool, "amount": float, "currency": str,
        "frequency": "monthly", "day_of_month": int, "next_due": str|null
      },
      "price_tracking": {
        "refresh_frequency_hours": int, "last_fetched_at": str|null
      },
      "watchlist_htf": {
        "timeframes": ["1W","1D","4H"], "top_n": int
      }
    }
    """

    __tablename__ = "investment_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
