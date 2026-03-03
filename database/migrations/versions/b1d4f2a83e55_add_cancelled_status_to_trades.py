"""add cancelled status to trades

Allows open limit orders to be cancelled without deleting the trade record.
A cancelled trade:
  - keeps its entry_price, SL, TPs as a journal entry
  - has NO impact on profile.capital_current, profile WR, or strategy WR
  - cannot be re-opened (final state, same as 'closed' for deletion rules)

The pnl_consistency check also needs updating:
  Before: only 'closed' can have realized_pnl
  After:  'closed' must have realized_pnl; 'cancelled' has realized_pnl = NULL

Revision ID: b1d4f2a83e55
Revises: a3c7d8e91f02
Create Date: 2026-03-03 18:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b1d4f2a83e55"
down_revision: Union[str, None] = "a3c7d8e91f02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Drop old status constraint
    op.drop_constraint("ck_trades_status", "trades")

    # 2. Re-create with 'cancelled' added
    op.create_check_constraint(
        "ck_trades_status",
        "trades",
        "status IN ('open', 'partial', 'closed', 'cancelled')",
    )

    # 3. Drop old pnl_consistency constraint (it only allowed closed to have pnl)
    op.drop_constraint("ck_trades_pnl_consistency", "trades")

    # 4. Re-create: closed must have pnl, cancelled and others must NOT
    op.create_check_constraint(
        "ck_trades_pnl_consistency",
        "trades",
        "(status = 'closed' AND realized_pnl IS NOT NULL) OR "
        "(status != 'closed' AND realized_pnl IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_trades_status", "trades")
    op.create_check_constraint(
        "ck_trades_status",
        "trades",
        "status IN ('open', 'partial', 'closed')",
    )
    op.drop_constraint("ck_trades_pnl_consistency", "trades")
    op.create_check_constraint(
        "ck_trades_pnl_consistency",
        "trades",
        "(status = 'closed' AND realized_pnl IS NOT NULL) OR "
        "(status != 'closed' AND realized_pnl IS NULL)",
    )
