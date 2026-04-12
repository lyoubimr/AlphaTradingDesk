"""p5004 — Runner position support (trailing stop as last TP)

Phase 5 runner feature:
  - positions.take_profit_price  → nullable (runner has no fixed TP price)
  - positions.is_runner          → Boolean, NOT NULL DEFAULT false
  - trades.runner_trailing_pct   → Numeric(5,2), nullable — override of profile default
  - trades.runner_activated_at   → DateTime, nullable — when trailing stop was placed
  - trades status CHECK          → add 'runner' status
  - kraken_orders role CHECK     → add 'runner' role

Revision ID: p5004_runner_position
Revises:     p5003_be_on_tp1
Create Date: 2026-04-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "p5004_runner_position"
down_revision = "p5003_be_on_tp1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── positions table ────────────────────────────────────────────────────────

    # 1. Make take_profit_price nullable (runner position has no fixed TP price)
    op.alter_column("positions", "take_profit_price", nullable=True)

    # 2. Add is_runner flag
    op.execute(
        "ALTER TABLE positions ADD COLUMN IF NOT EXISTS is_runner BOOLEAN NOT NULL DEFAULT false"
    )

    # 3. Drop + recreate the exit_price_consistency CHECK to allow runner positions
    #    Original: (status='closed' AND exit_price IS NOT NULL) OR (status!='closed' AND exit_price IS NULL)
    #    Runner position: exit_price is set when trailing stop fills, same as regular close — no change needed
    #    BUT take_profit_price can be NULL → drop the implicit NOT NULL constraint already handled above.

    # 4. Update position status CHECK to include 'runner' (trailing stop placed but not yet filled)
    op.execute("ALTER TABLE positions DROP CONSTRAINT IF EXISTS ck_positions_status")
    op.execute(
        "ALTER TABLE positions ADD CONSTRAINT ck_positions_status "
        "CHECK (status IN ('open', 'runner', 'closed', 'cancelled'))"
    )

    # ── trades table ───────────────────────────────────────────────────────────

    # 5. Add runner_trailing_pct — % deviation for Kraken trailing stop (overrides profile default)
    op.execute(
        "ALTER TABLE trades ADD COLUMN IF NOT EXISTS runner_trailing_pct NUMERIC(5,2)"
    )

    # 6. Add runner_activated_at — timestamp when trailing stop order was placed
    op.execute(
        "ALTER TABLE trades ADD COLUMN IF NOT EXISTS runner_activated_at TIMESTAMP"
    )

    # 7. Update trades status CHECK to include 'runner'
    op.execute("ALTER TABLE trades DROP CONSTRAINT IF EXISTS ck_trades_status")
    op.execute(
        "ALTER TABLE trades ADD CONSTRAINT ck_trades_status "
        "CHECK (status IN ('pending', 'open', 'partial', 'runner', 'closed', 'cancelled'))"
    )

    # ── kraken_orders table ────────────────────────────────────────────────────

    # 8. Update role CHECK to include 'runner'
    op.execute("ALTER TABLE kraken_orders DROP CONSTRAINT IF EXISTS ck_kraken_orders_role")
    op.execute(
        "ALTER TABLE kraken_orders ADD CONSTRAINT ck_kraken_orders_role "
        "CHECK (role IN ('entry', 'sl', 'tp1', 'tp2', 'tp3', 'runner'))"
    )

    # 9. Update order_type CHECK to include 'trailing_stop'
    op.execute("ALTER TABLE kraken_orders DROP CONSTRAINT IF EXISTS ck_kraken_orders_order_type")
    op.execute(
        "ALTER TABLE kraken_orders ADD CONSTRAINT ck_kraken_orders_order_type "
        "CHECK (order_type IN ('market', 'limit', 'stop', 'take_profit', 'trailing_stop'))"
    )


def downgrade() -> None:
    # Restore original trades status CHECK
    op.execute("ALTER TABLE trades DROP CONSTRAINT IF EXISTS ck_trades_status")
    op.execute(
        "ALTER TABLE trades ADD CONSTRAINT ck_trades_status "
        "CHECK (status IN ('pending', 'open', 'partial', 'closed', 'cancelled'))"
    )

    # Restore original positions status CHECK
    op.execute("ALTER TABLE positions DROP CONSTRAINT IF EXISTS ck_positions_status")
    op.execute(
        "ALTER TABLE positions ADD CONSTRAINT ck_positions_status "
        "CHECK (status IN ('open', 'closed', 'cancelled'))"
    )

    # Restore original kraken_orders role CHECK
    op.execute("ALTER TABLE kraken_orders DROP CONSTRAINT IF EXISTS ck_kraken_orders_role")
    op.execute(
        "ALTER TABLE kraken_orders ADD CONSTRAINT ck_kraken_orders_role "
        "CHECK (role IN ('entry', 'sl', 'tp1', 'tp2', 'tp3'))"
    )

    # Restore original kraken_orders order_type CHECK
    op.execute("ALTER TABLE kraken_orders DROP CONSTRAINT IF EXISTS ck_kraken_orders_order_type")
    op.execute(
        "ALTER TABLE kraken_orders ADD CONSTRAINT ck_kraken_orders_order_type "
        "CHECK (order_type IN ('market', 'limit', 'stop', 'take_profit'))"
    )

    op.execute("ALTER TABLE trades DROP COLUMN IF EXISTS runner_activated_at")
    op.execute("ALTER TABLE trades DROP COLUMN IF EXISTS runner_trailing_pct")
    op.execute("ALTER TABLE positions DROP COLUMN IF EXISTS is_runner")

    # Restore NOT NULL on take_profit_price (only safe if no NULL values exist)
    op.alter_column("positions", "take_profit_price", nullable=False)
