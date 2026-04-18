"""p5005 — Post-trade review JSONB column on trades + review_tags_settings table

- trades.post_trade_review  JSONB nullable: badge tags, outcome, note per trade
- review_tags_settings table: per-profile custom tag configuration (Config Table Pattern)

Revision ID: p5005_post_trade_review
Revises:     p5004_runner_position
Create Date: 2026-04-18
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "p5005_post_trade_review"
down_revision = "p5004_runner_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── trades table ───────────────────────────────────────────────────────────
    op.add_column("trades", sa.Column("post_trade_review", JSONB, nullable=True))

    # ── review_tags_settings table ────────────────────────────────────────────
    op.create_table(
        "review_tags_settings",
        sa.Column(
            "profile_id",
            sa.BigInteger,
            sa.ForeignKey("profiles.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column("config", JSONB, nullable=False, server_default="{}"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=False),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("review_tags_settings")
    op.drop_column("trades", "post_trade_review")

