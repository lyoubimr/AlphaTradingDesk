"""p8007 — Add swing_setup session type to ritual CHECK constraints

Adds 'swing_setup' to the CHECK constraints on:
  - ritual_steps.session_type
  - ritual_sessions.session_type

swing_setup is an ad-hoc contracts session for swing trading: generates a
1W + 1D + 4H HTF-only watchlist, awards 15 discipline points.

Revision ID: p8007_add_swing_setup_session_type
Revises:     p8006_add_weekend_trading_session_type
Create Date: 2026-06-03
"""

from alembic import op

revision = "p8007_add_swing_setup_session_type"
down_revision = "p8006_add_weekend_trading_session_type"
branch_labels = None
depends_on = None

_NEW_TYPES = (
    "'weekly_setup', 'daily_prep', 'trade_session', 'weekend_review', "
    "'weekend_trading', 'swing_setup', 'spot_monthly', 'spot_weekly'"
)
_OLD_TYPES = (
    "'weekly_setup', 'daily_prep', 'trade_session', 'weekend_review', "
    "'weekend_trading', 'spot_monthly', 'spot_weekly'"
)


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
