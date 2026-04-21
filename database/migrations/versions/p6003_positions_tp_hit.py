"""p6003 — Add tp_hit flag to positions

Adds:
  - positions.tp_hit  BOOLEAN NOT NULL DEFAULT FALSE

Semantics:
  - TRUE  → the position exited AT its take_profit_price (real TP hit)
  - FALSE → the position was closed early (full_close / manual exit before TP)

Previously analytics inferred TP hits from exit_price ≈ take_profit_price with
a price-tolerance hack.  This column makes the intent explicit at write time.

Revision ID: p6003_positions_tp_hit
Revises:     p6002_add_groq_gemini_ai_keys
Create Date: 2026-04-21
"""

from alembic import op
import sqlalchemy as sa

revision = "p6003_positions_tp_hit"
down_revision = "p6002_add_groq_gemini_ai_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add tp_hit column — default FALSE so all existing positions stay safe.
    # Existing rows are conservatively left as FALSE (unknown intent) rather
    # than trying to retroactively infer TP hits from exit_price proximity.
    # IF NOT EXISTS guard — idempotent in case the column was added manually.
    op.execute(
        "ALTER TABLE positions ADD COLUMN IF NOT EXISTS"
        " tp_hit BOOLEAN NOT NULL DEFAULT FALSE"
    )


def downgrade() -> None:
    op.drop_column("positions", "tp_hit")
