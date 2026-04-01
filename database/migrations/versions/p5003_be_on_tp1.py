"""p5003 — add be_on_tp1 column to trades

Phase 5 — P5-12: Auto move SL to break-even when TP1 is filled.
Adds a boolean column be_on_tp1 to the trades table.
Default = FALSE (opt-in per trade, only meaningful when automation_enabled=True).

Revision ID: p5003_be_on_tp1
Revises:     p5002_execution_alerts
Create Date: 2026-04-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "p5003_be_on_tp1"
down_revision = "p5002_execution_alerts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "trades",
        sa.Column(
            "be_on_tp1",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("trades", "be_on_tp1")
