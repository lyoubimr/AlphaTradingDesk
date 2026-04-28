"""
Ritual Module — SQLAlchemy ORM models.

Tables:
  - RitualSettings      → ritual_settings     (1:1 per profile, JSONB config)
  - RitualPinnedPair    → ritual_pinned_pairs  (pinned pairs with TTL)
  - RitualStep          → ritual_steps         (step templates per profile×type)
  - RitualSession       → ritual_sessions      (session instances)
  - RitualStepLog       → ritual_step_log      (step completion log)
  - RitualWeeklyScore   → ritual_weekly_score  (weekly discipline score)
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.database import Base


class RitualSettings(Base):
    """Per-profile Ritual configuration (1:1 with profiles).

    All configuration lives in JSONB config — add/remove keys without
    any Alembic migration. Follows the mandatory Config Table Pattern.

    config keys (with defaults):
      trading_windows         list[{label, start, end, days[]}]
      vol_gate_weekend        bool  — show vol warning on weekends
      notif_best_hours        bool  — notify on best trading hours
      notif_weekly_reminder   bool  — remind if weekly setup not done by Tue
      market_analysis_pairs   list[str]  — TV-format indices (CRYPTOCAP:BTC.D …)
      top_n                   {weekly_setup:30, daily_prep:20, trade_session:10, …}
      smart_filter.weights    {1W:4, 1D:3, 4H:2, 1H:1, 15m:0.5}
      smart_filter.trend_bonus        float
      smart_filter.ema_bonus_threshold int
      smart_filter.ema_bonus_factor    float
    """

    __tablename__ = "ritual_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RitualPinnedPair(Base):
    """Pinned watchlist pairs with TTL.

    TTL per timeframe: 1W=7d, 1D=24h, 4H=4h, 1H=1h
    TTL suspended automatically while a trade on this pair is open/pending.
    status: active | expired | archived
    source: watchlist | manual
    """

    __tablename__ = "ritual_pinned_pairs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'expired', 'archived')",
            name="ck_ritual_pinned_status",
        ),
        CheckConstraint(
            "source IN ('watchlist', 'manual')",
            name="ck_ritual_pinned_source",
        ),
        CheckConstraint(
            "timeframe IN ('1W', '1D', '4H', '1H', '15m')",
            name="ck_ritual_pinned_timeframe",
        ),
        Index("ix_ritual_pinned_profile_status", "profile_id", "status"),
        Index("ix_ritual_pinned_expires", "expires_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    pair: Mapped[str] = mapped_column(String(30), nullable=False)
    tv_symbol: Mapped[str | None] = mapped_column(String(50), nullable=True)
    timeframe: Mapped[str] = mapped_column(String(10), nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    pinned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="watchlist")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class RitualStep(Base):
    """Step template per profile × session_type.

    Auto-seeded from DEFAULT_STEPS on first profile access.
    Users can customize labels, order, est_minutes via settings.

    step_type values:
      ai_brief | vi_check | pinned_review | smart_wl | tv_analysis |
      pin_pairs | outcome | market_analysis | goals_review |
      analytics | journal | learning_note | custom
    """

    __tablename__ = "ritual_steps"
    __table_args__ = (
        CheckConstraint(
            "session_type IN ('weekly_setup', 'daily_prep', 'trade_session', 'weekend_review')",
            name="ck_ritual_steps_session_type",
        ),
        CheckConstraint("position >= 1", name="ck_ritual_steps_position_positive"),
        UniqueConstraint(
            "profile_id",
            "session_type",
            "position",
            name="uq_ritual_steps_profile_type_pos",
        ),
        Index("ix_ritual_steps_profile_type", "profile_id", "session_type"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    session_type: Mapped[str] = mapped_column(String(30), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    step_type: Mapped[str] = mapped_column(String(30), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    cadence_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    linked_module: Mapped[str | None] = mapped_column(String(50), nullable=True)
    est_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Relationships
    step_logs: Mapped[list[RitualStepLog]] = relationship(
        back_populates="step", passive_deletes=True
    )


class RitualSession(Base):
    """A single ritual session instance.

    status: in_progress | completed | abandoned
    outcome (trade_session): trade_opened | no_opportunity | abandoned | vol_too_low
    discipline_points: computed at session close and stored for history.
    """

    __tablename__ = "ritual_sessions"
    __table_args__ = (
        CheckConstraint(
            "session_type IN ('weekly_setup', 'daily_prep', 'trade_session', 'weekend_review')",
            name="ck_ritual_sessions_session_type",
        ),
        CheckConstraint(
            "status IN ('in_progress', 'completed', 'abandoned')",
            name="ck_ritual_sessions_status",
        ),
        CheckConstraint(
            "outcome IS NULL OR outcome IN ('trade_opened', 'no_opportunity', 'abandoned', 'vol_too_low')",
            name="ck_ritual_sessions_outcome",
        ),
        Index("ix_ritual_sessions_profile_started", "profile_id", "started_at"),
        Index("ix_ritual_sessions_status", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    session_type: Mapped[str] = mapped_column(String(30), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")
    outcome: Mapped[str | None] = mapped_column(String(30), nullable=True)
    discipline_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Relationships
    step_logs: Mapped[list[RitualStepLog]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True
    )


class RitualStepLog(Base):
    """Step completion log — one row per step per session.

    status: pending | done | skipped
    output: arbitrary JSON (AI brief text, WL result summary, etc.)
    """

    __tablename__ = "ritual_step_log"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'done', 'skipped')",
            name="ck_ritual_step_log_status",
        ),
        Index("ix_ritual_step_log_session", "ritual_session_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ritual_session_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("ritual_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    step_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("ritual_steps.id", ondelete="SET NULL"),
        nullable=True,
    )
    step_type: Mapped[str] = mapped_column(String(30), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    output: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    # Relationships
    session: Mapped[RitualSession] = relationship(back_populates="step_logs")
    step: Mapped[RitualStep | None] = relationship(back_populates="step_logs")


class RitualWeeklyScore(Base):
    """Weekly discipline score — one row per profile per Monday.

    Updated whenever a session is completed or a penalty applied.
    details JSONB: {
      "sessions": {"weekly_setup": 1, "daily_prep": 3, "trade_session": 4, "weekend_review": 0},
      "bonuses":  {"no_opportunity": 2},
      "penalties": {"outside_window": 1, "vol_too_low_trade": 0},
      "points_breakdown": [{"label": str, "points": int}, …]
    }
    """

    __tablename__ = "ritual_weekly_score"
    __table_args__ = (
        UniqueConstraint(
            "profile_id",
            "week_start",
            name="uq_ritual_weekly_score_profile_week",
        ),
        Index("ix_ritual_weekly_score_profile_week", "profile_id", "week_start"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    week_start: Mapped[date] = mapped_column(Date, nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
