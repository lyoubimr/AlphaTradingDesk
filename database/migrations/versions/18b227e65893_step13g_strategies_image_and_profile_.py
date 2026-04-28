"""step13g_strategies_image_and_profile_min_pnl_threshold

Revision ID: 18b227e65893
Revises: 7ca85c6b1bd1
Create Date: 2026-03-07 11:07:05.339907
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '18b227e65893'
down_revision: str | None = '7ca85c6b1bd1'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Step 13-G — Strategies module
    #
    # strategies.image_url        : direct URL to strategy chart/screenshot (upload Phase 2+)
    # profiles.min_pnl_pct_for_stats : global threshold — trades with abs(pnl%) < this value
    #                                   are NOT counted in WR stats (strategy + profile).
    #                                   Default 0.1% (filters out scratch/BE trades).

    op.add_column(
        "strategies",
        sa.Column("image_url", sa.String(500), nullable=True),
    )
    op.add_column(
        "profiles",
        sa.Column(
            "min_pnl_pct_for_stats",
            sa.Numeric(5, 3),
            nullable=False,
            server_default="0.100",
        ),
    )


def downgrade() -> None:
    op.drop_column("strategies", "image_url")
    op.drop_column("profiles", "min_pnl_pct_for_stats")
