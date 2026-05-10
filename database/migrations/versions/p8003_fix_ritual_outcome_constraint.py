"""p8003 — Fix ritual_sessions outcome constraint (add pairs_pinned)

The CHECK constraint on ritual_sessions.outcome was missing 'pairs_pinned',
which caused a 500 error when a user selected "Pairs Pinned" as the trade
session outcome and then tried to complete the session.

Revision ID: p8003_fix_ritual_outcome_constraint
Revises:     p8002_spot_volatility
Create Date: 2026-05-10
"""

from alembic import op

revision = "p8003_fix_ritual_outcome_constraint"
down_revision = "p8002_spot_volatility"
branch_labels = None
depends_on = None

_NEW_OUTCOMES = "'trade_opened', 'pairs_pinned', 'no_opportunity', 'abandoned', 'vol_too_low'"
_OLD_OUTCOMES = "'trade_opened', 'no_opportunity', 'abandoned', 'vol_too_low'"
_CONSTRAINT = "ck_ritual_sessions_outcome"
_TABLE = "ritual_sessions"


def upgrade() -> None:
    # Drop old constraint (IF EXISTS for idempotency)
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT}")
    # Add new constraint with pairs_pinned included
    op.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (outcome IS NULL OR outcome IN ({_NEW_OUTCOMES}))"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE {_TABLE} DROP CONSTRAINT IF EXISTS {_CONSTRAINT}")
    op.execute(
        f"ALTER TABLE {_TABLE} ADD CONSTRAINT {_CONSTRAINT} "
        f"CHECK (outcome IS NULL OR outcome IN ({_OLD_OUTCOMES}))"
    )
