"""step15_goals_unique_add_period_type

Revision ID: 7ca85c6b1bd1
Revises: dbf0b348bf21
Create Date: 2026-03-06 21:32:40.130561
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7ca85c6b1bd1'
down_revision: str | None = 'dbf0b348bf21'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """
    Extend unique constraints on profile_goals to include period_type.

    Before (step14):
      uq_profile_goals_global : (profile_id, period)            WHERE style_id IS NULL
      uq_profile_goals_style  : (profile_id, style_id, period)  WHERE style_id IS NOT NULL

    After (step15):
      uq_profile_goals_global : (profile_id, period, period_type)            WHERE style_id IS NULL
      uq_profile_goals_style  : (profile_id, style_id, period, period_type)  WHERE style_id IS NOT NULL

    Rationale: a profile may have both an 'outcome' and a 'process' goal for the
    same period (e.g. daily outcome + daily process).  The old constraint made
    that impossible; adding period_type to the key allows it while still
    preventing exact duplicates.
    """
    # Drop old constraints (partial indexes — must use raw SQL names)
    op.drop_index("uq_profile_goals_global", table_name="profile_goals")
    op.drop_index("uq_profile_goals_style",  table_name="profile_goals")

    # Recreate with period_type included
    op.create_index(
        "uq_profile_goals_global",
        "profile_goals",
        ["profile_id", "period", "period_type"],
        unique=True,
        postgresql_where=sa.text("style_id IS NULL"),
    )
    op.create_index(
        "uq_profile_goals_style",
        "profile_goals",
        ["profile_id", "style_id", "period", "period_type"],
        unique=True,
        postgresql_where=sa.text("style_id IS NOT NULL"),
    )


def downgrade() -> None:
    # Restore step14 constraints (without period_type)
    op.drop_index("uq_profile_goals_global", table_name="profile_goals")
    op.drop_index("uq_profile_goals_style",  table_name="profile_goals")

    op.create_index(
        "uq_profile_goals_global",
        "profile_goals",
        ["profile_id", "period"],
        unique=True,
        postgresql_where=sa.text("style_id IS NULL"),
    )
    op.create_index(
        "uq_profile_goals_style",
        "profile_goals",
        ["profile_id", "style_id", "period"],
        unique=True,
        postgresql_where=sa.text("style_id IS NOT NULL"),
    )
