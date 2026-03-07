"""step17_strategies_global_and_trade_close_notes

Revision ID: 412487625940
Revises: 63f9f74ede34
Create Date: 2026-03-07 18:29:45.594095

Changes:
  strategies.profile_id  → nullable (NULL = global strategy, shared across all profiles)
  strategies unique(profile_id, name) → replaced by partial unique indexes:
      uq_strategies_global   : UNIQUE(name) WHERE profile_id IS NULL
      uq_strategies_profile  : UNIQUE(profile_id, name) WHERE profile_id IS NOT NULL
  trades.close_notes         → TEXT nullable  (notes added at close time)
  trades.close_screenshot_urls → TEXT[] nullable (closing snapshot URLs)
  trades.entry_screenshot_urls → TEXT[] nullable (entry snapshot URLs, separate from close)
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '412487625940'
down_revision: Union[str, None] = '63f9f74ede34'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. strategies: make profile_id nullable ───────────────────────────
    op.alter_column(
        'strategies', 'profile_id',
        existing_type=sa.BigInteger(),
        nullable=True,
    )

    # ── 2. Replace unique(profile_id, name) with two partial indexes ──────
    # Drop the old compound unique constraint
    op.drop_constraint('strategies_profile_id_name_key', 'strategies', type_='unique')

    # Global strategies: UNIQUE(name) WHERE profile_id IS NULL
    op.create_index(
        'uq_strategies_global', 'strategies', ['name'],
        unique=True,
        postgresql_where=sa.text('profile_id IS NULL'),
    )
    # Profile strategies: UNIQUE(profile_id, name) WHERE profile_id IS NOT NULL
    op.create_index(
        'uq_strategies_profile', 'strategies', ['profile_id', 'name'],
        unique=True,
        postgresql_where=sa.text('profile_id IS NOT NULL'),
    )

    # ── 3. trades: add close_notes + close_screenshot_urls ────────────────
    op.add_column('trades', sa.Column('close_notes', sa.Text(), nullable=True))
    op.add_column(
        'trades',
        sa.Column('close_screenshot_urls', sa.ARRAY(sa.Text()), nullable=True),
    )
    op.add_column(
        'trades',
        sa.Column('entry_screenshot_urls', sa.ARRAY(sa.Text()), nullable=True),
    )


def downgrade() -> None:
    # Reverse trade columns
    op.drop_column('trades', 'entry_screenshot_urls')
    op.drop_column('trades', 'close_screenshot_urls')
    op.drop_column('trades', 'close_notes')

    # Restore old unique constraint
    op.drop_index('uq_strategies_profile', table_name='strategies',
                  postgresql_where=sa.text('profile_id IS NOT NULL'))
    op.drop_index('uq_strategies_global', table_name='strategies',
                  postgresql_where=sa.text('profile_id IS NULL'))
    op.create_unique_constraint('strategies_profile_id_name_key', 'strategies', ['profile_id', 'name'])

    # Restore NOT NULL on profile_id
    op.alter_column(
        'strategies', 'profile_id',
        existing_type=sa.BigInteger(),
        nullable=False,
    )
