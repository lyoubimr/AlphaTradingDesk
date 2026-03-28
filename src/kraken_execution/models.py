"""
src/kraken_execution/models.py

SQLAlchemy models for Phase 5 Kraken Execution:
  - AutomationSettings: per-profile config (Config Table Pattern — JSONB)
  - KrakenOrder:        one row per order sent to Kraken Futures
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from src.core.database import Base

if TYPE_CHECKING:
    from src.core.models.broker import Profile
    from src.core.models.trade import Trade

# ---------------------------------------------------------------------------
# Default config — used only as seed when a profile has no row yet.
# DB is always the source of truth after first access.
# API keys are NEVER in defaults — they must be set by the user via the UI.
# ---------------------------------------------------------------------------
DEFAULT_AUTOMATION_CONFIG: dict = {
    "enabled": False,
    "pnl_status_interval_minutes": 60,
    "max_leverage_override": None,  # None = use instrument max_leverage from DB
}


class AutomationSettings(Base):
    """
    Per-profile Kraken Execution configuration.

    Follows the project Config Table Pattern:
      - profile_id is the PK (no surrogate id)
      - All settings in a single JSONB config column
      - ON DELETE CASCADE

    config shape:
      {
        "enabled": bool,
        "pnl_status_interval_minutes": int,
        "max_leverage_override": int | null,
        "kraken_api_key_enc": "<fernet-ciphertext>",     # encrypted — never returned by API
        "kraken_api_secret_enc": "<fernet-ciphertext>",  # encrypted — never returned by API
      }
    """

    __tablename__ = "automation_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="automation_settings")  # type: ignore[name-defined]


class KrakenOrder(Base):
    """
    One row per order sent to Kraken Futures.

    Lifecycle:
      open → filled  (happy path)
      open → cancelled (manual cancel or entry cancelled)
      open → error   (Kraken rejected the order)

    Idempotence: kraken_order_id and kraken_fill_id are UNIQUE — no double processing.
    """

    __tablename__ = "kraken_orders"

    __table_args__ = (
        CheckConstraint(
            "role IN ('entry','sl','tp1','tp2','tp3')",
            name="ck_kraken_orders_role",
        ),
        CheckConstraint(
            "status IN ('open','filled','cancelled','error')",
            name="ck_kraken_orders_status",
        ),
        CheckConstraint(
            "order_type IN ('market','limit','stop','take_profit')",
            name="ck_kraken_orders_order_type",
        ),
        CheckConstraint(
            "side IN ('buy','sell')",
            name="ck_kraken_orders_side",
        ),
        Index("ix_kraken_orders_trade_id", "trade_id"),
        Index("ix_kraken_orders_status", "status"),
        Index("ix_kraken_orders_role", "role"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    trade_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("trades.id", ondelete="CASCADE"),
        nullable=False,
    )
    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Kraken identifiers
    kraken_order_id: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    kraken_fill_id: Mapped[str | None] = mapped_column(String(100), unique=True)

    # Order metadata
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # entry|sl|tp1|tp2|tp3
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    order_type: Mapped[str] = mapped_column(String(20), nullable=False)  # market|limit|stop|take_profit
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    side: Mapped[str] = mapped_column(String(4), nullable=False)  # buy|sell

    # Sizes & prices (always Numeric — no float)
    size: Mapped[float] = mapped_column(Numeric(18, 8), nullable=False)
    limit_price: Mapped[float | None] = mapped_column(Numeric(18, 8))
    filled_price: Mapped[float | None] = mapped_column(Numeric(18, 8))
    filled_size: Mapped[float | None] = mapped_column(Numeric(18, 8))

    # Error details (if status=error)
    error_message: Mapped[str | None] = mapped_column(Text)

    # Timestamps
    sent_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    filled_at: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)

    # Relationships
    trade: Mapped[Trade] = relationship(back_populates="kraken_orders")  # type: ignore[name-defined]
    profile: Mapped[Profile] = relationship(back_populates="kraken_orders")  # type: ignore[name-defined]
