"""add mmr to instruments

Revision ID: 9e301382735c
Revises: p8008_allow_4_take_profits
Create Date: 2026-07-21 14:19:16.597165
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9e301382735c'
down_revision: str | None = 'p8008_allow_4_take_profits'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # mmr = Maintenance Margin Rate per instrument, fetched from Kraken API.
    # NULL means fallback to the hardcoded CRYPTO_MMR constant in trades/service.py.
    op.add_column(
        "instruments",
        sa.Column("mmr", sa.Numeric(6, 4), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("instruments", "mmr")
