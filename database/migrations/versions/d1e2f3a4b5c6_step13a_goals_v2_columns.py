"""Step 13-A1: Add v2 columns to profile_goals (avg_r_min, max_trades, period_type, show_on_dashboard)

Revision ID: d1e2f3a4b5c6
Revises: b1d4f2a83e55
Create Date: 2026-03-06 10:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "d1e2f3a4b5c6"
down_revision = "b1d4f2a83e55"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── A1: profile_goals v2 columns ─────────────────────────────────────
    op.add_column(
        "profile_goals",
        sa.Column("avg_r_min", sa.Numeric(4, 2), nullable=True),
    )
    op.add_column(
        "profile_goals",
        sa.Column("max_trades", sa.Integer(), nullable=True),
    )
    op.add_column(
        "profile_goals",
        sa.Column(
            "period_type",
            sa.String(20),
            nullable=False,
            server_default="outcome",
        ),
    )
    op.add_column(
        "profile_goals",
        sa.Column(
            "show_on_dashboard",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("TRUE"),
        ),
    )

    # Add CHECK constraint for period_type
    op.create_check_constraint(
        "ck_profile_goals_period_type",
        "profile_goals",
        "period_type IN ('outcome', 'process', 'review')",
    )

    # ── A2: goal_override_log (new table) ─────────────────────────────────
    op.create_table(
        "goal_override_log",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column(
            "profile_id",
            sa.BigInteger(),
            sa.ForeignKey("profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "style_id",
            sa.BigInteger(),
            sa.ForeignKey("trading_styles.id"),
            nullable=False,
        ),
        sa.Column("period", sa.String(20), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("pnl_pct_at_override", sa.Numeric(10, 4), nullable=True),
        sa.Column("open_risk_pct", sa.Numeric(6, 2), nullable=True),
        sa.Column("reason_text", sa.Text(), nullable=False),
        sa.Column(
            "acknowledged",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("TRUE"),
        ),
        sa.Column(
            "overridden_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index(
        "idx_goal_override_log_profile",
        "goal_override_log",
        ["profile_id", "overridden_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_goal_override_log_profile", table_name="goal_override_log")
    op.drop_table("goal_override_log")

    op.drop_constraint("ck_profile_goals_period_type", "profile_goals", type_="check")
    op.drop_column("profile_goals", "show_on_dashboard")
    op.drop_column("profile_goals", "period_type")
    op.drop_column("profile_goals", "max_trades")
    op.drop_column("profile_goals", "avg_r_min")
