"""add margin_used to trades

Revision ID: fe8288f1af1c
Revises: p3001_phase3_risk_management
Create Date: 2026-03-27 15:13:33.781315
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'fe8288f1af1c'
down_revision: Union[str, None] = 'p3001_phase3_risk_management'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS — idempotent: column may already exist if a previous
    # failed deployment added it before the migration could be stamped.
    op.execute("ALTER TABLE trades ADD COLUMN IF NOT EXISTS margin_used NUMERIC(12, 2)")


def downgrade() -> None:
    op.drop_column('trades', 'margin_used')
