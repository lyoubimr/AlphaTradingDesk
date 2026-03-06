"""Step 13-A3+A4: Add score_block to indicators + decomposed scores to sessions

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Create Date: 2026-03-06 10:05:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "e2f3a4b5c6d7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── A3: market_analysis_indicators — score_block ──────────────────────
    op.add_column(
        "market_analysis_indicators",
        sa.Column(
            "score_block",
            sa.String(20),
            nullable=False,
            server_default="trend",
        ),
    )
    op.create_check_constraint(
        "ck_ma_indicators_score_block",
        "market_analysis_indicators",
        "score_block IN ('trend', 'momentum', 'participation')",
    )

    # ── A4: market_analysis_sessions — decomposed scores ─────────────────
    # Asset A decomposed scores
    op.add_column("market_analysis_sessions", sa.Column("score_trend_a", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("score_momentum_a", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("score_participation_a", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("score_composite_a", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("bias_composite_a", sa.String(10), nullable=True))

    # Asset B decomposed scores (NULL for single-asset modules)
    op.add_column("market_analysis_sessions", sa.Column("score_trend_b", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("score_momentum_b", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("score_participation_b", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("score_composite_b", sa.Numeric(5, 2), nullable=True))
    op.add_column("market_analysis_sessions", sa.Column("bias_composite_b", sa.String(10), nullable=True))

    # Note: old HTF/MTF/LTF columns are preserved for backward compatibility.
    # v2 sessions are detected by: score_trend_a IS NOT NULL


def downgrade() -> None:
    op.drop_column("market_analysis_sessions", "bias_composite_b")
    op.drop_column("market_analysis_sessions", "score_composite_b")
    op.drop_column("market_analysis_sessions", "score_participation_b")
    op.drop_column("market_analysis_sessions", "score_momentum_b")
    op.drop_column("market_analysis_sessions", "score_trend_b")

    op.drop_column("market_analysis_sessions", "bias_composite_a")
    op.drop_column("market_analysis_sessions", "score_composite_a")
    op.drop_column("market_analysis_sessions", "score_participation_a")
    op.drop_column("market_analysis_sessions", "score_momentum_a")
    op.drop_column("market_analysis_sessions", "score_trend_a")

    op.drop_constraint("ck_ma_indicators_score_block", "market_analysis_indicators", type_="check")
    op.drop_column("market_analysis_indicators", "score_block")
