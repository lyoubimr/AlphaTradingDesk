"""add is_test flag to profiles

Revision ID: p8011_add_is_test_to_profiles
Revises: p8010_raise_risk_pct_cap
Create Date: 2026-09-15

Adds profiles.is_test (default false). Test profiles behave like normal
profiles (trades, capital, dedicated strategies) but are excluded from
cross-profile aggregates: the global win-rate average (GET /api/stats/winrate
without profile_id) and global strategy stat updates on trade close.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p8011_add_is_test_to_profiles"
down_revision: str | None = "p8010_raise_risk_pct_cap"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column("is_test", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("profiles", "is_test")
