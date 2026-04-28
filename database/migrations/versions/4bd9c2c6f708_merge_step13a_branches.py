"""merge step13a branches

Revision ID: 4bd9c2c6f708
Revises: c45438781a38, e2f3a4b5c6d7
Create Date: 2026-03-06 15:19:27.049119
"""
from __future__ import annotations

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = '4bd9c2c6f708'
down_revision: str | None = ('c45438781a38', 'e2f3a4b5c6d7')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
