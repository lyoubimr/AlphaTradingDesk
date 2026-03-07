"""step16_add_initial_stop_loss_to_trades

Adds `initial_stop_loss` to the `trades` table.

This column stores the original stop-loss price set at trade open.
It NEVER changes after that — unlike `stop_loss` which moves to BE.

This is critical for correct PnL computation:
  _position_pnl uses  abs(entry_price - initial_stop_loss)  to derive
  units_per_position.  When the SL is moved to BE, stop_loss == entry_price
  → price_dist = 0 → PnL = 0 (wrong).  initial_stop_loss always holds
  the original distance regardless of SL moves.

Backfill: existing rows get initial_stop_loss = stop_loss (best-effort;
accurate for rows whose SL was never moved, conservative for BE trades).

Revision ID: 63f9f74ede34
Revises: 18b227e65893
Create Date: 2026-03-07 13:16:59.114966
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '63f9f74ede34'
down_revision: Union[str, None] = '18b227e65893'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add column as nullable first so the ALTER doesn't fail on existing rows
    op.add_column(
        'trades',
        sa.Column('initial_stop_loss', sa.Numeric(20, 8), nullable=True),
    )
    # 2. Back-fill: set initial_stop_loss = stop_loss for all existing rows.
    #    For rows already at BE this is entry_price (not ideal, but the only
    #    safe default — we have no history of what the original SL was).
    op.execute(
        "UPDATE trades SET initial_stop_loss = stop_loss WHERE initial_stop_loss IS NULL"
    )
    # 3. Make NOT NULL now that all rows have a value
    op.alter_column('trades', 'initial_stop_loss', nullable=False)


def downgrade() -> None:
    op.drop_column('trades', 'initial_stop_loss')
