"""Step 14 — Goals: style_id nullable (global goals) + drop review period_type

Changes:
  - profile_goals.style_id      → nullable  (NULL = all styles / global)
  - goal_progress_log.style_id  → nullable  (follows parent goal)
  - profile_goals.period_type   → drop 'review', keep 'outcome'|'process'
  - profile_goals               → UNIQUE constraint updated to handle NULL style_id
    (partial unique index: one global goal per profile+period)

Revision ID: dbf0b348bf21
Revises: 4bd9c2c6f708
Create Date: 2026-03-06 21:20:46.965447
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'dbf0b348bf21'
down_revision: Union[str, None] = '4bd9c2c6f708'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Make style_id nullable on profile_goals ──────────────────────────
    # Drop FK constraint first, then alter column, then re-add FK
    op.drop_constraint('profile_goals_style_id_fkey', 'profile_goals', type_='foreignkey')
    op.alter_column('profile_goals', 'style_id',
                    existing_type=sa.BigInteger(),
                    nullable=True)
    op.create_foreign_key(
        'profile_goals_style_id_fkey',
        'profile_goals', 'trading_styles',
        ['style_id'], ['id'],
        ondelete='CASCADE',
    )

    # ── 2. Make style_id nullable on goal_progress_log ──────────────────────
    op.drop_constraint('goal_progress_log_style_id_fkey', 'goal_progress_log',
                       type_='foreignkey')
    op.alter_column('goal_progress_log', 'style_id',
                    existing_type=sa.BigInteger(),
                    nullable=True)
    op.create_foreign_key(
        'goal_progress_log_style_id_fkey',
        'goal_progress_log', 'trading_styles',
        ['style_id'], ['id'],
        ondelete='CASCADE',
    )

    # ── 3. Drop old UNIQUE constraint + add partial unique indexes ───────────
    # Old: UNIQUE(profile_id, style_id, period) — doesn't handle NULL correctly
    op.drop_constraint(
        'profile_goals_profile_id_style_id_period_key',
        'profile_goals',
        type_='unique',
    )
    # Specific style goal: UNIQUE per (profile_id, style_id, period) where style_id IS NOT NULL
    op.create_index(
        'uq_profile_goals_style',
        'profile_goals',
        ['profile_id', 'style_id', 'period'],
        unique=True,
        postgresql_where=sa.text('style_id IS NOT NULL'),
    )
    # Global goal: only ONE per (profile_id, period) where style_id IS NULL
    op.create_index(
        'uq_profile_goals_global',
        'profile_goals',
        ['profile_id', 'period'],
        unique=True,
        postgresql_where=sa.text('style_id IS NULL'),
    )

    # ── 4. Update period_type check: drop 'review', keep outcome|process ────
    op.drop_constraint('ck_profile_goals_period_type', 'profile_goals', type_='check')
    # Migrate any existing 'review' goals to 'outcome' BEFORE adding new constraint
    op.execute("UPDATE profile_goals SET period_type = 'outcome' WHERE period_type = 'review'")
    op.create_check_constraint(
        'ck_profile_goals_period_type',
        'profile_goals',
        "period_type IN ('outcome', 'process')",
    )


def downgrade() -> None:
    # Restore check constraint with review
    op.drop_constraint('ck_profile_goals_period_type', 'profile_goals', type_='check')
    op.create_check_constraint(
        'ck_profile_goals_period_type',
        'profile_goals',
        "period_type IN ('outcome', 'process', 'review')",
    )

    # Restore unique constraint
    op.drop_index('uq_profile_goals_global', table_name='profile_goals')
    op.drop_index('uq_profile_goals_style', table_name='profile_goals')
    op.create_unique_constraint(
        'profile_goals_profile_id_style_id_period_key',
        'profile_goals',
        ['profile_id', 'style_id', 'period'],
    )

    # Restore NOT NULL on style_id
    op.drop_constraint('profile_goals_style_id_fkey', 'profile_goals', type_='foreignkey')
    op.alter_column('profile_goals', 'style_id',
                    existing_type=sa.BigInteger(),
                    nullable=False)
    op.create_foreign_key(
        'profile_goals_style_id_fkey',
        'profile_goals', 'trading_styles',
        ['style_id'], ['id'],
        ondelete='CASCADE',
    )

    op.drop_constraint('goal_progress_log_style_id_fkey', 'goal_progress_log',
                       type_='foreignkey')
    op.alter_column('goal_progress_log', 'style_id',
                    existing_type=sa.BigInteger(),
                    nullable=False)
    op.create_foreign_key(
        'goal_progress_log_style_id_fkey',
        'goal_progress_log', 'trading_styles',
        ['style_id'], ['id'],
        ondelete='CASCADE',
    )
