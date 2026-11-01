"""add review fields to market_analysis_sessions (before/after screenshots, notes, evaluation)

Revision ID: p8015_ma_session_review
Revises: p8014_ma_module_stale_hours
Create Date: 2026-11-01

screenshots_before / screenshots_after : lists of captures {url, at, caption}
after_notes                            : free-text follow-up written when reviewing
evaluation                             : correct | wrong | neutral (NULL = not evaluated)
reviewed_at                            : set when evaluation is chosen
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "p8015_ma_session_review"
down_revision: str | None = "p8014_ma_module_stale_hours"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_TABLE = "market_analysis_sessions"


def _columns() -> list[sa.Column]:
    return [
        sa.Column("screenshots_before", JSONB(), nullable=False, server_default="[]"),
        sa.Column("screenshots_after", JSONB(), nullable=False, server_default="[]"),
        sa.Column("after_notes", sa.Text(), nullable=True),
        sa.Column("evaluation", sa.String(10), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(_TABLE)}
    for col in _columns():
        if col.name not in existing:
            op.add_column(_TABLE, col)


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(_TABLE)}
    for col in reversed(_columns()):
        if col.name in existing:
            op.drop_column(_TABLE, col.name)
