"""
Journal models: performance_snapshots, note_templates.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
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


class PerformanceSnapshot(Base):
    __tablename__ = "performance_snapshots"
    __table_args__ = (
        UniqueConstraint("profile_id", "snapshot_date"),
        Index(
            "idx_performance_snapshots_profile_date",
            "profile_id",
            "snapshot_date",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)

    # Capital
    capital_start: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    capital_current: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)

    # P&L
    pnl_absolute: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    pnl_percent: Mapped[Decimal] = mapped_column(Numeric(10, 4), nullable=False)

    # Stats
    trade_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    win_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    loss_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    win_rate: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    profit_factor: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))

    # Equity curve data
    equity_curve: Mapped[list | None] = mapped_column(ARRAY(Numeric(20, 2)))
    max_drawdown: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    sharpe_ratio: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))

    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="performance_snapshots")  # type: ignore[name-defined]


class NoteTemplate(Base):
    __tablename__ = "note_templates"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # NULL profile_id = global default template
    profile_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # JSON array of question objects:
    # [{"key": "went_well", "label": "What went well?", "type": "text"}, ...]
    questions: Mapped[dict] = mapped_column(JSONB, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    profile: Mapped[Profile | None] = relationship(back_populates="note_templates")  # type: ignore[name-defined]


# Late import to resolve forward references
from src.core.models.broker import Profile  # noqa: E402
