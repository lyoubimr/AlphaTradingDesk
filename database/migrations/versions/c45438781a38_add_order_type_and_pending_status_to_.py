"""add_order_type_and_pending_status_to_trades

Revision ID: c45438781a38
Revises: b1d4f2a83e55
Create Date: 2026-03-03 18:13:37.737207
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c45438781a38'
down_revision: str | None = 'b1d4f2a83e55'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add order_type column (MARKET | LIMIT), default MARKET for all existing rows
    op.add_column(
        'trades',
        sa.Column('order_type', sa.String(10), nullable=False, server_default='MARKET'),
    )

    # 2. Drop old status CHECK constraint, re-create with 'pending' added
    op.drop_constraint('ck_trades_status', 'trades', type_='check')
    op.create_check_constraint(
        'ck_trades_status',
        'trades',
        "status IN ('pending', 'open', 'partial', 'closed', 'cancelled')",
    )

    # 3. Add order_type CHECK constraint
    op.create_check_constraint(
        'ck_trades_order_type',
        'trades',
        "order_type IN ('MARKET', 'LIMIT')",
    )

    # 4. Add index on order_type for fast "pending LIMIT" queries
    op.create_index('idx_trades_order_type', 'trades', ['order_type'])


def downgrade() -> None:
    op.drop_index('idx_trades_order_type', table_name='trades')
    op.drop_constraint('ck_trades_order_type', 'trades', type_='check')
    op.drop_constraint('ck_trades_status', 'trades', type_='check')
    op.create_check_constraint(
        'ck_trades_status',
        'trades',
        "status IN ('open', 'partial', 'closed', 'cancelled')",
    )
    op.drop_column('trades', 'order_type')
