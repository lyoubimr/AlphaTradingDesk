"""
Goals models: profile_goals, goal_progress_log, goal_override_log.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.database import Base


class ProfileGoal(Base):
    __tablename__ = "profile_goals"
    __table_args__ = (
        # Partial unique indexes are handled in DB via migration (step14).
        # SQLAlchemy model reflects the logical constraint only — no duplicate UniqueConstraint here.
        CheckConstraint("goal_pct > 0", name="ck_profile_goals_goal_pct_positive"),
        CheckConstraint("limit_pct < 0", name="ck_profile_goals_limit_pct_negative"),
        CheckConstraint(
            "period_type IN ('outcome', 'process')",
            name="ck_profile_goals_period_type",
        ),
        Index("idx_profile_goals_profile", "profile_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    # NULL = global goal (all styles) — set via step14 migration
    style_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("trading_styles.id", ondelete="CASCADE"), nullable=True
    )
    period: Mapped[str] = mapped_column(String(20), nullable=False)  # daily/weekly/monthly
    goal_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    limit_pct: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # v2 fields
    avg_r_min: Mapped[Decimal | None] = mapped_column(Numeric(4, 2), nullable=True)
    max_trades: Mapped[int | None] = mapped_column(Integer, nullable=True)
    period_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="outcome"
    )  # 'outcome' | 'process'
    show_on_dashboard: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="profile_goals")  # type: ignore[name-defined]
    style: Mapped[TradingStyle | None] = relationship(back_populates="profile_goals")  # type: ignore[name-defined]


class GoalProgressLog(Base):
    __tablename__ = "goal_progress_log"
    __table_args__ = (
        Index(
            "idx_goal_progress_profile_period",
            "profile_id",
            "period_start",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    style_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("trading_styles.id"), nullable=False
    )
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    pnl_pct: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    goal_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    limit_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    goal_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    limit_hit: Mapped[bool] = mapped_column(Boolean, default=False)
    # Phase 2+ — stored as 1.0 (neutral) until VI module is active
    vi_multiplier: Mapped[Decimal] = mapped_column(Numeric(5, 3), default=Decimal("1.0"))
    adjusted_goal: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    adjusted_limit: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    snapshot_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="goal_progress_logs")  # type: ignore[name-defined]
    style: Mapped[TradingStyle] = relationship(back_populates="goal_progress_logs")  # type: ignore[name-defined]


class GoalOverrideLog(Base):
    """Audit log for circuit-breaker overrides — requires a mandatory written reason."""

    __tablename__ = "goal_override_log"
    __table_args__ = (Index("idx_goal_override_log_profile", "profile_id", "overridden_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    style_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("trading_styles.id"), nullable=False
    )
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    pnl_pct_at_override: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    open_risk_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    reason_text: Mapped[str] = mapped_column(Text, nullable=False)
    acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    overridden_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="goal_override_logs")  # type: ignore[name-defined]
    style: Mapped[TradingStyle] = relationship(back_populates="goal_override_logs")  # type: ignore[name-defined]


# Late import to resolve forward references
from src.core.models.broker import Profile, TradingStyle  # noqa: E402
