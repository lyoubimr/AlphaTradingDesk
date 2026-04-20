"""p6002 — Add Groq and Gemini AI key columns to analytics_ai_keys

Adds:
  - analytics_ai_keys.groq_key_enc    BYTEA NULL
  - analytics_ai_keys.gemini_key_enc  BYTEA NULL

Both providers offer free tiers:
  - Groq: https://console.groq.com — free Llama/Mistral models
  - Google Gemini: https://aistudio.google.com — free gemini-2.0-flash

Revision ID: p6002_add_groq_gemini_ai_keys
Revises:     p6001_phase6a_analytics
Create Date: 2026-04-20
"""

from __future__ import annotations

from alembic import op

revision = "p6002_add_groq_gemini_ai_keys"
down_revision = "p6001_phase6a_analytics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE analytics_ai_keys
            ADD COLUMN IF NOT EXISTS groq_key_enc   BYTEA NULL,
            ADD COLUMN IF NOT EXISTS gemini_key_enc BYTEA NULL
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE analytics_ai_keys
            DROP COLUMN IF EXISTS groq_key_enc,
            DROP COLUMN IF EXISTS gemini_key_enc
    """)
