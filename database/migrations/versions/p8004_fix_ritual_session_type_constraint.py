"""p8004 — Fix ritual session_type constraints (add spot_monthly, spot_weekly)

The p7001 migration created CHECK constraints on ritual_steps.session_type and
ritual_sessions.session_type with only the Phase 6B values:
  'weekly_setup', 'daily_prep', 'trade_session', 'weekend_review'

The spot session types (spot_monthly, spot_weekly) were added to the ORM model
but never added to the DB constraints → every attempt to start a spot session
was rejected by PostgreSQL with a CHECK constraint violation.

Revision ID: p8004_fix_ritual_session_type_constraint
Revises:     p8003_fix_ritual_outcome_constraint
Create Date: 2026-05-10
"""

from alembic import op

revision = "p8004_fix_ritual_session_type_constraint"
down_revision = "p8003_fix_ritual_outcome_constraint"
branch_labels = None
depends_on = None

_NEW_TYPES = (
    "'weekly_setup', 'daily_prep', 'trade_session', 'weekend_review', "
    "'spot_monthly', 'spot_weekly'"
)
_OLD_TYPES = "'weekly_setup', 'daily_prep', 'trade_session', 'weekend_review'"


def upgrade() -> None:
    # ritual_steps
    op.execute("ALTER TABLE ritual_steps DROP CONSTRAINT IF EXISTS ck_ritual_steps_session_type")
    op.execute(
        f"ALTER TABLE ritual_steps ADD CONSTRAINT ck_ritual_steps_session_type "
        f"CHECK (session_type IN ({_NEW_TYPES}))"
    )
    # ritual_sessions
    op.execute("ALTER TABLE ritual_sessions DROP CONSTRAINT IF EXISTS ck_ritual_sessions_session_type")
    op.execute(
        f"ALTER TABLE ritual_sessions ADD CONSTRAINT ck_ritual_sessions_session_type "
        f"CHECK (session_type IN ({_NEW_TYPES}))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE ritual_steps DROP CONSTRAINT IF EXISTS ck_ritual_steps_session_type")
    op.execute(
        f"ALTER TABLE ritual_steps ADD CONSTRAINT ck_ritual_steps_session_type "
        f"CHECK (session_type IN ({_OLD_TYPES}))"
    )
    op.execute("ALTER TABLE ritual_sessions DROP CONSTRAINT IF EXISTS ck_ritual_sessions_session_type")
    op.execute(
        f"ALTER TABLE ritual_sessions ADD CONSTRAINT ck_ritual_sessions_session_type "
        f"CHECK (session_type IN ({_OLD_TYPES}))"
    )
