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
    # ── Orphaned pg_type cleanup ──────────────────────────────────────────────
    # PostgreSQL's CREATE TABLE inserts into pg_type BEFORE checking pg_class.
    # If a prior partial deployment left orphaned type entries (pg_type row
    # exists but pg_class row does NOT), even "IF NOT EXISTS" raises
    # UniqueViolation on pg_type_typname_nsp_index.
    # Fix: delete orphaned composite + array types for each table we manage,
    # but ONLY when the table itself does not exist — never touch live tables.
    # In Docker, POSTGRES_USER is a superuser so DELETE FROM pg_type is allowed.
    op.execute("""
        DO $$
        DECLARE
            ns_oid oid;
            tnames text[] := ARRAY['analytics_settings', 'analytics_ai_keys', 'analytics_ai_cache'];
            tname  text;
        BEGIN
            SELECT oid INTO ns_oid FROM pg_namespace WHERE nspname = 'public';
            FOREACH tname IN ARRAY tnames LOOP
                -- Only remove the type when the real table doesn't exist
                IF NOT EXISTS (
                    SELECT 1 FROM pg_class
                    WHERE relname = tname AND relnamespace = ns_oid AND relkind = 'r'
                ) THEN
                    DELETE FROM pg_type
                    WHERE typname IN (tname, '_' || tname)
                      AND typnamespace = ns_oid;
                END IF;
            END LOOP;
        END $$
    """)

    # ── 1. analytics_settings — per-profile AI + display preferences ─────────
    op.execute("""
        DO $$ BEGIN
            CREATE TABLE analytics_settings (
                profile_id   BIGINT     PRIMARY KEY
                                        REFERENCES profiles(id) ON DELETE CASCADE,
                config       JSONB      NOT NULL DEFAULT '{}',
                updated_at   TIMESTAMP  NOT NULL DEFAULT NOW()
            );
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """)

    # ── 2. analytics_ai_keys — Fernet-encrypted provider API keys ───────────
    # Each key column stores NULL when not configured, or Fernet token (BYTEA).
    op.execute("""
        DO $$ BEGIN
            CREATE TABLE analytics_ai_keys (
                profile_id          BIGINT  PRIMARY KEY
                                            REFERENCES profiles(id) ON DELETE CASCADE,
                openai_key_enc      BYTEA,
                anthropic_key_enc   BYTEA,
                perplexity_key_enc  BYTEA,
                updated_at          TIMESTAMP  NOT NULL DEFAULT NOW()
            );
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """)

    # ── 3. analytics_ai_cache — cached AI narrative per (profile, period) ───
    # Unique on (profile_id, period) → upserted on each AI generation.
    op.execute("""
        DO $$ BEGIN
            CREATE TABLE analytics_ai_cache (
                id              BIGSERIAL   PRIMARY KEY,
                profile_id      BIGINT      NOT NULL
                                            REFERENCES profiles(id) ON DELETE CASCADE,
                period          VARCHAR(10) NOT NULL,
                summary         TEXT        NOT NULL,
                generated_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
                tokens_used     INTEGER,
                UNIQUE (profile_id, period)
            );
        EXCEPTION WHEN duplicate_table THEN NULL;
        END $$
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_analytics_ai_cache_profile
        ON analytics_ai_cache (profile_id)
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS analytics_ai_cache")
    op.execute("DROP TABLE IF EXISTS analytics_ai_keys")
    op.execute("DROP TABLE IF EXISTS analytics_settings")
