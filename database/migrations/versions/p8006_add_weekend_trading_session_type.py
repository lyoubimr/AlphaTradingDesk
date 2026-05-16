"""p8006 — Add weekend_trading session type to ritual CHECK constraints

Adds 'weekend_trading' to the CHECK constraints on:
  - ritual_steps.session_type
  - ritual_sessions.session_type

This is a new standalone session type (separate from weekend_review) for
optional trading sessions on weekends. It generates a 1H + 15m watchlist
and awards max 5 discipline points.

Revision ID: p8006_add_weekend_trading_session_type
Revises:     p8005_fix_ema_bonus_threshold
Create Date: 2026-05-16
"""

from alembic import op

revision = "p8006_add_weekend_trading_session_type"
down_revision = "p8005_fix_ema_bonus_threshold"
branch_labels = None
depends_on = None

_NEW_TYPES = (
    "'weekly_setup', 'daily_prep', 'trade_session', 'weekend_review', "
    "'weekend_trading', 'spot_monthly', 'spot_weekly'"
)
_OLD_TYPES = (
    "'weekly_setup', 'daily_prep', 'trade_session', 'weekend_review', "
    "'spot_monthly', 'spot_weekly'"
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
