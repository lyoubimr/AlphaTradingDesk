"""add stale_hours / warn_hours to market_analysis_modules

Revision ID: p8014_ma_module_stale_hours
Revises: p8013_ritual_session_active_seconds
Create Date: 2026-10-31

Per-module freshness windows (hours). NULL stale_hours = default 7 days,
NULL warn_hours = no "aging" phase. Lets the intraday Pulse module expire after
48h (amber from 30h) while HTF modules keep their own cadence.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p8014_ma_module_stale_hours"
down_revision: str | None = "p8013_ritual_session_active_seconds"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_COLUMNS = ("stale_hours", "warn_hours")


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("market_analysis_modules")}
    for name in _COLUMNS:
        if name not in existing:
            op.add_column(
                "market_analysis_modules",
                sa.Column(name, sa.Integer(), nullable=True),
            )


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("market_analysis_modules")}
    for name in reversed(_COLUMNS):
        if name in existing:
            op.drop_column("market_analysis_modules", name)
