"""add screenshot_urls to strategies

Revision ID: f1a2b3c4d5e6
Revises: 4365b5e32ea3
Create Date: 2026-03-13 00:00:00.000000

Adds a screenshot_urls TEXT[] column to strategies (nullable).
Complements image_url (single banner) with multi-screenshot gallery support.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "f1a2b3c4d5e6"
down_revision = "4365b5e32ea3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS guards against re-runs on DBs where the column already exists
    # (e.g. prod was ahead of the migration stamp)
    op.execute("ALTER TABLE strategies ADD COLUMN IF NOT EXISTS screenshot_urls TEXT[]")


def downgrade() -> None:
    op.drop_column("strategies", "screenshot_urls")
