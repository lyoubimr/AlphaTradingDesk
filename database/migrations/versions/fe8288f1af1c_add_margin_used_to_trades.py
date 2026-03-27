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
    op.add_column('trades', sa.Column('margin_used', sa.Numeric(precision=12, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column('trades', 'margin_used')
