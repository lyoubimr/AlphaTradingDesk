"""
Phase 6A — SQLAlchemy ORM models for the Analytics module.

Tables:
  - AnalyticsSettings  → analytics_settings  (1:1 per profile)
  - AnalyticsAIKeys    → analytics_ai_keys   (1:1 per profile)
  - AnalyticsAICache   → analytics_ai_cache  (1 per profile+period)

All tables created by migration p6001_phase6a_analytics.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import BYTEA, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from src.core.database import Base


class AnalyticsSettings(Base):
    """Per-profile display + AI preferences for the analytics page.

    config JSONB shape:
    {
      "ai_enabled":       false,
      "ai_provider":      "openai",   // "openai" | "anthropic" | "perplexity"
      "ai_model":         "gpt-4o-mini",
      "ai_refresh":       "daily",    // "per_trade" | "daily" | "manual"
      "ai_refresh_hours": 24
    }
    """

    __tablename__ = "analytics_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )


class AnalyticsAIKeys(Base):
    """Fernet-encrypted API keys for AI providers.

    Each *_key_enc column stores either NULL (not configured) or the
    Fernet-encrypted token as raw bytes.  Keys are decrypted only at
    request time using settings.encryption_key.
    """

    __tablename__ = "analytics_ai_keys"

    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    openai_key_enc: Mapped[bytes | None] = mapped_column(BYTEA, nullable=True)
    anthropic_key_enc: Mapped[bytes | None] = mapped_column(BYTEA, nullable=True)
    perplexity_key_enc: Mapped[bytes | None] = mapped_column(BYTEA, nullable=True)
    groq_key_enc: Mapped[bytes | None] = mapped_column(BYTEA, nullable=True)
    gemini_key_enc: Mapped[bytes | None] = mapped_column(BYTEA, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )


class AnalyticsAICache(Base):
    """Cached AI narrative per (profile, period).

    Unique on (profile_id, period) — upserted on each successful generation.
    """

    __tablename__ = "analytics_ai_cache"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    period: Mapped[str] = mapped_column(String(10), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )
    tokens_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
