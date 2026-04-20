"""p6001 — Phase 6A: Deep Performance Analytics tables

Creates:
  - analytics_settings  (profile_id PK, config JSONB)
      Stores per-profile UI preferences for the analytics page:
      ai_enabled, ai_provider, ai_model, ai_refresh, ai_refresh_hours
  - analytics_ai_keys   (profile_id PK, encrypted API keys per provider)
      Fernet-encrypted API keys for OpenAI / Anthropic / Perplexity.
      Stored as BYTEA — decrypted only at request time using ENCRYPTION_KEY.
  - analytics_ai_cache  (id BIGSERIAL, profile_id, period, summary TEXT)
      Stores the last AI-generated narrative per (profile_id, period).
      One row per profile+period — upserted on each generation.

Follows the Config Table Pattern (profile_id primary key, JSONB config,
ON DELETE CASCADE) — same as risk_settings, volatility_settings.

All CREATE TABLE use IF NOT EXISTS. Safe to replay.

Revision ID: p6001_phase6a_analytics
Revises:     p5005_post_trade_review
Create Date: 2026-04-19
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "p6001_phase6a_analytics"
down_revision = "p5005_post_trade_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. analytics_settings — per-profile AI + display preferences ─────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS analytics_settings (
            profile_id   BIGINT     PRIMARY KEY
                                    REFERENCES profiles(id) ON DELETE CASCADE,
            config       JSONB      NOT NULL DEFAULT '{}',
            updated_at   TIMESTAMP  NOT NULL DEFAULT NOW()
        )
    """)

    # ── 2. analytics_ai_keys — Fernet-encrypted provider API keys ───────────
    # Each key column stores NULL when not configured, or Fernet token (BYTEA).
    op.execute("""
        CREATE TABLE IF NOT EXISTS analytics_ai_keys (
            profile_id          BIGINT  PRIMARY KEY
                                        REFERENCES profiles(id) ON DELETE CASCADE,
            openai_key_enc      BYTEA,
            anthropic_key_enc   BYTEA,
            perplexity_key_enc  BYTEA,
            updated_at          TIMESTAMP  NOT NULL DEFAULT NOW()
        )
    """)

    # ── 3. analytics_ai_cache — cached AI narrative per (profile, period) ───
    # Unique on (profile_id, period) → upserted on each AI generation.
    op.execute("""
        CREATE TABLE IF NOT EXISTS analytics_ai_cache (
            id              BIGSERIAL   PRIMARY KEY,
            profile_id      BIGINT      NOT NULL
                                        REFERENCES profiles(id) ON DELETE CASCADE,
            period          VARCHAR(10) NOT NULL,
            summary         TEXT        NOT NULL,
            generated_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
            tokens_used     INTEGER,
            UNIQUE (profile_id, period)
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_analytics_ai_cache_profile
        ON analytics_ai_cache (profile_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS analytics_ai_cache")
    op.execute("DROP TABLE IF EXISTS analytics_ai_keys")
    op.execute("DROP TABLE IF EXISTS analytics_settings")
