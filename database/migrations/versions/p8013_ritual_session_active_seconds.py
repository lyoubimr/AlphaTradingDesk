"""add active_seconds to ritual_sessions

Revision ID: p8013_ritual_session_active_seconds
Revises: p8012_trade_net_pnl_columns
Create Date: 2026-10-31

Time actually spent on the ritual page (tab visible), reported by the frontend
heartbeat. Replaces ended_at - started_at, which counted hours/days away.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p8013_ritual_session_active_seconds"
down_revision: str | None = "p8012_trade_net_pnl_columns"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("ritual_sessions")}
    if "active_seconds" not in existing:
        op.add_column(
            "ritual_sessions",
            sa.Column("active_seconds", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("ritual_sessions")}
    if "active_seconds" in existing:
        op.drop_column("ritual_sessions", "active_seconds")
