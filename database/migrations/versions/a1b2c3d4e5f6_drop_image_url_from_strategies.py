"""drop image_url from strategies

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-03-13 00:01:00.000000

Removes the single image_url column from strategies.
Replaced by screenshot_urls TEXT[] (added in f1a2b3c4d5e6) which supports
multiple screenshots. No data loss concern — screenshot_urls is the new
gallery, image_url was a legacy single-image field.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "a1b2c3d4e5f6"
down_revision = "f1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("strategies", "image_url")


def downgrade() -> None:
    op.add_column(
        "strategies",
        sa.Column("image_url", sa.String(500), nullable=True),
    )
