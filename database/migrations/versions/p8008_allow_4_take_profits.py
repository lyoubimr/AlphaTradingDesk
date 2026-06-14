"""p8008 — Allow up to 4 take-profits per trade

Updates two CHECK constraints that hard-cap TPs at 3:

  - trades.nb_take_profits: >= 1 AND <= 3  →  >= 1 AND <= 4
  - positions.position_number: ANY([1,2,3]) →  ANY([1,2,3,4])

The frontend already supports 4 TPs (NewTradePage tpCount: 1|2|3|4);
this migration aligns the DB constraints.

Revision ID: p8008_allow_4_take_profits
Revises:     p8007_add_swing_setup_session_type
Create Date: 2026-06-14
"""

from alembic import op

revision = "p8008_allow_4_take_profits"
down_revision = "p8007_add_swing_setup_session_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # trades — nb_take_profits now allows 1-4
    op.execute("ALTER TABLE trades DROP CONSTRAINT IF EXISTS ck_trades_nb_tp_range")
    op.execute(
        "ALTER TABLE trades ADD CONSTRAINT ck_trades_nb_tp_range "
        "CHECK (nb_take_profits >= 1 AND nb_take_profits <= 4)"
    )

    # positions — position_number now allows 1-4
    op.execute("ALTER TABLE positions DROP CONSTRAINT IF EXISTS ck_positions_number_range")
    op.execute(
        "ALTER TABLE positions ADD CONSTRAINT ck_positions_number_range "
        "CHECK (position_number = ANY (ARRAY[1, 2, 3, 4]))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE trades DROP CONSTRAINT IF EXISTS ck_trades_nb_tp_range")
    op.execute(
        "ALTER TABLE trades ADD CONSTRAINT ck_trades_nb_tp_range "
        "CHECK (nb_take_profits >= 1 AND nb_take_profits <= 3)"
    )

    op.execute("ALTER TABLE positions DROP CONSTRAINT IF EXISTS ck_positions_number_range")
    op.execute(
        "ALTER TABLE positions ADD CONSTRAINT ck_positions_number_range "
        "CHECK (position_number = ANY (ARRAY[1, 2, 3]))"
    )
