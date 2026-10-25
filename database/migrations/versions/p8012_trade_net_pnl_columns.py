"""add fees_paid / funding_paid / pnl_source to trades

Revision ID: p8012_trade_net_pnl_columns
Revises: p8011_add_is_test_to_profiles
Create Date: 2026-10-25

Net-of-costs PnL reconciled from the Kraken account log. Columns are nullable:
NULL pnl_source = PnL still computed by ATD (manual / not yet reconciled trades).
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p8012_trade_net_pnl_columns"
down_revision: str | None = "p8011_add_is_test_to_profiles"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_COLUMNS = (
    ("fees_paid", sa.Numeric(20, 4)),
    ("funding_paid", sa.Numeric(20, 4)),
    ("pnl_source", sa.String(20)),
)


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("trades")}
    for name, col_type in _COLUMNS:
        if name not in existing:
            op.add_column("trades", sa.Column(name, col_type, nullable=True))
    # Trades closed before the reconciliation existed were aligned to the exchange
    # balance by hand (2026-10-24 16:00 UTC) — never re-apply costs on them.
    op.execute(
        "UPDATE trades SET pnl_source = 'atd_calc' "
        "WHERE status = 'closed' AND pnl_source IS NULL AND closed_at < '2026-10-24 16:00:00'"
    )


def downgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("trades")}
    for name, _ in reversed(_COLUMNS):
        if name in existing:
            op.drop_column("trades", name)
