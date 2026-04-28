"""add win-rate stats columns to profiles

Adds trades_count and win_count to the profiles table.
These are updated atomically on every trade close (same transaction
as capital_current update) to ensure they never drift out of sync.

Revision ID: a3c7d8e91f02
Revises: 4fd42b663b3e
Create Date: 2026-03-02 18:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3c7d8e91f02"
down_revision: str | None = "4fd42b663b3e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # trades_count: total number of closed trades for this profile (all strategies)
    op.add_column(
        "profiles",
        sa.Column(
            "trades_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    # win_count: number of closed trades with realized_pnl > 0
    op.add_column(
        "profiles",
        sa.Column(
            "win_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    op.drop_column("profiles", "win_count")
    op.drop_column("profiles", "trades_count")
