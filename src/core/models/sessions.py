"""
Session catalog and user preferences models.

`Session` = trading session catalog (Asia / London / New York / etc.)
`UserPreferences` = per-profile UI & display settings
"""
from __future__ import annotations

from datetime import datetime, time

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.core.database import Base


class TradingSession(Base):
    """Trading session catalog — all times in UTC."""
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    start_utc: Mapped[time] = mapped_column(Time, nullable=False)
    end_utc: Mapped[time] = mapped_column(Time, nullable=False)
    # TRUE for NYSE Open (point event, no duration)
    is_point: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    note: Mapped[str | None] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


class UserPreferences(Base):
    __tablename__ = "user_preferences"
    __table_args__ = (UniqueConstraint("profile_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    timezone: Mapped[str] = mapped_column(
        String(50), nullable=False, default="UTC"
    )
    # Ordered list of timeframes shown in trade form dropdown
    analyzed_tf_list: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default='["15m","1h","4h","1d","1w"]',
    )
    # Quick-access flag — mirrors news_provider_config.enabled
    news_intelligence_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    last_style: Mapped[str | None] = mapped_column(String(20))
    last_period: Mapped[str | None] = mapped_column(String(20))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Relationships
    profile: Mapped[Profile] = relationship(back_populates="user_preferences")  # type: ignore[name-defined]


# Late import to resolve forward references
from src.core.models.broker import Profile  # noqa: E402
