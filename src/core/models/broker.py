"""
Broker-related models: brokers, instruments, trading_styles, profiles.

profiles references brokers (optional FK) and is referenced by almost
every other table — it is defined here to keep FK dependencies clear.
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
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.database import Base


class Broker(Base):
    __tablename__ = "brokers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    market_type: Mapped[str] = mapped_column(String(50), nullable=False)
    default_currency: Mapped[str] = mapped_column(String(10), nullable=False)
    is_predefined: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    instruments: Mapped[list[Instrument]] = relationship(back_populates="broker")
    profiles: Mapped[list[Profile]] = relationship(back_populates="broker")


class Instrument(Base):
    __tablename__ = "instruments"
    __table_args__ = (
        UniqueConstraint("broker_id", "symbol"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    broker_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("brokers.id", ondelete="CASCADE"), nullable=False
    )
    symbol: Mapped[str] = mapped_column(String(30), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    asset_class: Mapped[str] = mapped_column(String(50), nullable=False)
    base_currency: Mapped[str | None] = mapped_column(String(10))
    quote_currency: Mapped[str | None] = mapped_column(String(10))
    pip_size: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    tick_value: Mapped[Decimal | None] = mapped_column(Numeric(20, 10))
    min_lot: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    is_predefined: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    # Relationships
    broker: Mapped[Broker] = relationship(back_populates="instruments")
    trades: Mapped[list[Trade]] = relationship(back_populates="instrument")  # type: ignore[name-defined]


class TradingStyle(Base):
    __tablename__ = "trading_styles"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    default_timeframes: Mapped[str | None] = mapped_column(String(50))
    description: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(default=0)

    # Relationships
    profile_goals: Mapped[list[ProfileGoal]] = relationship(back_populates="style")  # type: ignore[name-defined]
    goal_progress_logs: Mapped[list[GoalProgressLog]] = relationship(back_populates="style")  # type: ignore[name-defined]


class Profile(Base):
    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint("capital_start > 0", name="ck_profiles_capital_start_positive"),
        CheckConstraint("capital_current > 0", name="ck_profiles_capital_current_positive"),
        CheckConstraint(
            "risk_percentage_default > 0 AND risk_percentage_default <= 10",
            name="ck_profiles_risk_pct_range",
        ),
        CheckConstraint(
            "market_type IN ('CFD', 'Crypto')",
            name="ck_profiles_market_type",
        ),
        CheckConstraint(
            "max_concurrent_risk_pct > 0",
            name="ck_profiles_max_concurrent_risk_positive",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Basic info
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    market_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Broker link (optional)
    broker_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("brokers.id", ondelete="SET NULL")
    )
    currency: Mapped[str | None] = mapped_column(String(10))

    # Capital tracking
    capital_start: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)
    capital_current: Mapped[Decimal] = mapped_column(Numeric(20, 2), nullable=False)

    # Risk settings
    risk_percentage_default: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("2.0")
    )
    max_concurrent_risk_pct: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=Decimal("2.0")
    )

    # Metadata
    description: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    broker: Mapped[Broker | None] = relationship(back_populates="profiles")
    trades: Mapped[list[Trade]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    strategies: Mapped[list[Strategy]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    tags: Mapped[list[Tag]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    performance_snapshots: Mapped[list[PerformanceSnapshot]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    profile_goals: Mapped[list[ProfileGoal]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    goal_progress_logs: Mapped[list[GoalProgressLog]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    note_templates: Mapped[list[NoteTemplate]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    user_preferences: Mapped[UserPreferences | None] = relationship(back_populates="profile")  # type: ignore[name-defined]
    market_analysis_sessions: Mapped[list[MarketAnalysisSession]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    profile_indicator_configs: Mapped[list[ProfileIndicatorConfig]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    news_provider_config: Mapped[NewsProviderConfig | None] = relationship(back_populates="profile")  # type: ignore[name-defined]
    weekly_events: Mapped[list[WeeklyEvent]] = relationship(back_populates="profile")  # type: ignore[name-defined]
    market_analysis_configs: Mapped[list[MarketAnalysisConfig]] = relationship(back_populates="profile")  # type: ignore[name-defined]


# Forward-reference imports (resolved at runtime, avoid circular imports)
from src.core.models.trade import Strategy, Tag, Trade  # noqa: E402
from src.core.models.journal import NoteTemplate, PerformanceSnapshot  # noqa: E402
from src.core.models.goals import GoalProgressLog, ProfileGoal  # noqa: E402
from src.core.models.sessions import UserPreferences  # noqa: E402
from src.core.models.market_analysis import (  # noqa: E402
    MarketAnalysisConfig,
    MarketAnalysisSession,
    NewsProviderConfig,
    ProfileIndicatorConfig,
    WeeklyEvent,
)
