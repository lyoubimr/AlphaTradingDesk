"""add screenshot_urls to strategies

Revision ID: f1a2b3c4d5e6
Revises: 4365b5e32ea3
Create Date: 2026-03-13 00:00:00.000000

Adds a screenshot_urls TEXT[] column to strategies (nullable).
Complements image_url (single banner) with multi-screenshot gallery support.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "4365b5e32ea3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "strategies",
        sa.Column(
            "screenshot_urls",
            postgresql.ARRAY(sa.Text()),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("strategies", "screenshot_urls")
