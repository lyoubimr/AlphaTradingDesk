"""raise risk_percentage_default cap from 10 to 100

Revision ID: p8010_raise_risk_pct_cap
Revises: 9e301382735c
Create Date: 2026-08-18

Removes the hard DB-level cap of 10% on risk_percentage_default so that
profiles can be configured with higher per-trade risk (e.g. spot/swing).
The Pydantic schema and frontend input now allow values up to 100.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "p8010_raise_risk_pct_cap"
down_revision: str | None = "9e301382735c"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_profiles_risk_pct_range", "profiles", type_="check")
    op.create_check_constraint(
        "ck_profiles_risk_pct_range",
        "profiles",
        "risk_percentage_default > 0 AND risk_percentage_default <= 100",
    )


def downgrade() -> None:
    op.drop_constraint("ck_profiles_risk_pct_range", "profiles", type_="check")
    op.create_check_constraint(
        "ck_profiles_risk_pct_range",
        "profiles",
        "risk_percentage_default > 0 AND risk_percentage_default <= 10",
    )
