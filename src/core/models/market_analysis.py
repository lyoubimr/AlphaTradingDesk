"""
Market analysis models:
  market_analysis_modules, market_analysis_indicators,
  profile_indicator_config, market_analysis_sessions,
  market_analysis_answers, news_provider_config,
  weekly_events, market_analysis_configs.
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
    LargeBinary,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.database import Base


class MarketAnalysisModule(Base):
    __tablename__ = "market_analysis_modules"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text)
    # TRUE for dual-asset modules (e.g. Crypto = BTC + Alts)
    is_dual: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    asset_a: Mapped[str | None] = mapped_column(String(50))
    asset_b: Mapped[str | None] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    indicators: Mapped[list[MarketAnalysisIndicator]] = relationship(back_populates="module")
    sessions: Mapped[list[MarketAnalysisSession]] = relationship(back_populates="module")
    market_analysis_configs: Mapped[list[MarketAnalysisConfig]] = relationship(
        back_populates="module"
    )


class MarketAnalysisIndicator(Base):
    __tablename__ = "market_analysis_indicators"
    __table_args__ = (
        UniqueConstraint("module_id", "key"),
        Index("idx_ma_indicators_module", "module_id"),
        Index("idx_ma_indicators_level", "module_id", "timeframe_level"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    module_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("market_analysis_modules.id", ondelete="CASCADE"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    # 'a' (BTC), 'b' (Alts), or 'single'
    asset_target: Mapped[str] = mapped_column(String(10), nullable=False)
    tv_symbol: Mapped[str] = mapped_column(String(100), nullable=False)
    tv_timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    # 'htf', 'mtf', 'ltf'
    timeframe_level: Mapped[str] = mapped_column(String(10), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    tooltip: Mapped[str | None] = mapped_column(Text)
    answer_bullish: Mapped[str] = mapped_column(String(200), nullable=False)
    answer_partial: Mapped[str] = mapped_column(String(200), nullable=False)
    answer_bearish: Mapped[str] = mapped_column(String(200), nullable=False)
    default_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # v2: which scoring block this indicator belongs to
    # 'trend' | 'momentum' | 'participation'
    score_block: Mapped[str] = mapped_column(String(20), nullable=False, default="trend")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    # Relationships
    module: Mapped[MarketAnalysisModule] = relationship(back_populates="indicators")
    profile_configs: Mapped[list[ProfileIndicatorConfig]] = relationship(back_populates="indicator")
    answers: Mapped[list[MarketAnalysisAnswer]] = relationship(back_populates="indicator")


class ProfileIndicatorConfig(Base):
    __tablename__ = "profile_indicator_config"
    __table_args__ = (UniqueConstraint("profile_id", "indicator_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    indicator_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("market_analysis_indicators.id", ondelete="CASCADE"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="profile_indicator_configs")  # type: ignore[name-defined]
    indicator: Mapped[MarketAnalysisIndicator] = relationship(back_populates="profile_configs")


class MarketAnalysisSession(Base):
    """One completed analysis session — stores 3-TF scores for up to 2 assets."""

    __tablename__ = "market_analysis_sessions"
    __table_args__ = (
        Index(
            "idx_ma_sessions_profile_module",
            "profile_id",
            "module_id",
            "analyzed_at",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    module_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("market_analysis_modules.id"), nullable=False
    )

    # 3-TF scores — Asset A (BTC, Gold, etc.)
    score_htf_a: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_mtf_a: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_ltf_a: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    bias_htf_a: Mapped[str | None] = mapped_column(String(10))
    bias_mtf_a: Mapped[str | None] = mapped_column(String(10))
    bias_ltf_a: Mapped[str | None] = mapped_column(String(10))

    # 3-TF scores — Asset B (Alts, NULL for single-asset modules)
    score_htf_b: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_mtf_b: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_ltf_b: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    bias_htf_b: Mapped[str | None] = mapped_column(String(10))
    bias_mtf_b: Mapped[str | None] = mapped_column(String(10))
    bias_ltf_b: Mapped[str | None] = mapped_column(String(10))

    # v2: decomposed block scores — Asset A
    # Detected as v2 session when score_trend_a IS NOT NULL
    score_trend_a: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_momentum_a: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_participation_a: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_composite_a: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    bias_composite_a: Mapped[str | None] = mapped_column(String(10))

    # v2: decomposed block scores — Asset B (NULL for single-asset modules)
    score_trend_b: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_momentum_b: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_participation_b: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    score_composite_b: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    bias_composite_b: Mapped[str | None] = mapped_column(String(10))

    # News intelligence context (NULL if not fetched)
    news_sentiment: Mapped[str | None] = mapped_column(String(10))
    news_confidence: Mapped[int | None] = mapped_column(Integer)
    news_summary: Mapped[str | None] = mapped_column(Text)
    news_key_themes: Mapped[dict | None] = mapped_column(JSONB)
    news_risks: Mapped[dict | None] = mapped_column(JSONB)
    news_sources: Mapped[dict | None] = mapped_column(JSONB)
    news_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    news_provider: Mapped[str | None] = mapped_column(String(20))
    news_model: Mapped[str | None] = mapped_column(String(40))

    notes: Mapped[str | None] = mapped_column(Text)
    analyzed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="market_analysis_sessions")  # type: ignore[name-defined]
    module: Mapped[MarketAnalysisModule] = relationship(back_populates="sessions")
    answers: Mapped[list[MarketAnalysisAnswer]] = relationship(back_populates="session")


class MarketAnalysisAnswer(Base):
    __tablename__ = "market_analysis_answers"
    __table_args__ = (
        UniqueConstraint("session_id", "indicator_id"),
        Index("idx_ma_answers_session", "session_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("market_analysis_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    indicator_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("market_analysis_indicators.id"),
        nullable=False,
    )
    # 0 = bearish, 1 = partial/neutral, 2 = bullish
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    answer_label: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    session: Mapped[MarketAnalysisSession] = relationship(back_populates="answers")
    indicator: Mapped[MarketAnalysisIndicator] = relationship(back_populates="answers")


class NewsProviderConfig(Base):
    """Per-profile AI news provider config — API key stored AES-256 encrypted."""

    __tablename__ = "news_provider_config"
    __table_args__ = (UniqueConstraint("profile_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    provider: Mapped[str] = mapped_column(String(20), nullable=False, default="perplexity")
    model: Mapped[str] = mapped_column(String(40), nullable=False, default="sonar-pro")
    # AES-256 ciphertext — NULL until key is configured
    api_key_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary)
    api_key_iv: Mapped[bytes | None] = mapped_column(LargeBinary)
    prompt_template: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    max_fetches_per_day: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="news_provider_config")  # type: ignore[name-defined]


class WeeklyEvent(Base):
    """Macro economic events entered weekly — displayed as warnings on trade form."""

    __tablename__ = "weekly_events"
    __table_args__ = (
        CheckConstraint("impact IN ('high', 'medium', 'low')", name="ck_weekly_events_impact"),
        Index("idx_weekly_events_profile_week", "profile_id", "week_start"),
        Index("idx_weekly_events_date_impact", "event_date", "impact"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    event_time: Mapped[datetime | None] = mapped_column(Time)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    impact: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    # e.g. '{"crypto","gold"}', '{"all"}'
    asset_scope: Mapped[list] = mapped_column(ARRAY(Text), nullable=False, server_default='{"all"}')
    note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="weekly_events")  # type: ignore[name-defined]


class MarketAnalysisConfig(Base):
    """Score thresholds and risk multipliers per module — global or per-profile."""

    __tablename__ = "market_analysis_configs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # NULL = global default
    profile_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE")
    )
    module_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("market_analysis_modules.id")
    )
    score_thresholds: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default='{"bullish": 60, "bearish": 40}',
    )
    risk_multipliers: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=(
            '{"bullish_long": 1.20, "bullish_short": 0.70,'
            ' "bearish_long": 0.70, "bearish_short": 1.20}'
        ),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    profile: Mapped[Profile | None] = relationship(back_populates="market_analysis_configs")  # type: ignore[name-defined]
    module: Mapped[MarketAnalysisModule | None] = relationship(
        back_populates="market_analysis_configs"
    )


# Late import to resolve forward references
from src.core.models.broker import Profile  # noqa: E402
