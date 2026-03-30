"""p5002 — add execution_alerts column to notification_settings

Phase 5 — P5-11: Kraken execution notification events.
Adds an execution_alerts JSONB column to notification_settings.
Default = '{}' (evaluated at application layer via DEFAULT_EXECUTION_ALERTS_CONFIG).

Revision ID: p5002_execution_alerts
Revises:     p5001_phase5_kraken_execution
Create Date: 2026-03-28
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = "p5002_execution_alerts"
down_revision = "p5001_phase5_kraken_execution"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notification_settings",
        sa.Column(
            "execution_alerts",
            JSONB,
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("notification_settings", "execution_alerts")
