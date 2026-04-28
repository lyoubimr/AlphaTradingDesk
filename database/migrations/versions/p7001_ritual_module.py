"""p7001 — Ritual Module

Creates 6 new tables for the Trading Ritual feature:
  - ritual_settings       → per-profile JSONB config (1:1)
  - ritual_pinned_pairs   → pinned watchlist pairs with TTL
  - ritual_steps          → step templates per profile × session_type
  - ritual_sessions       → session instances (started/ended/outcome)
  - ritual_step_log       → step completion log per session
  - ritual_weekly_score   → weekly discipline score

Revision ID: p7001_ritual_module
Revises:     p6003_positions_tp_hit
Create Date: 2026-04-26
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects.postgresql import JSONB

revision = "p7001_ritual_module"
down_revision = "p6003_positions_tp_hit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    existing_tables = set(inspector.get_table_names())

    def _existing_indexes(table: str) -> set[str]:
        if table not in existing_tables:
            return set()
        return {idx["name"] for idx in inspector.get_indexes(table)}

    # ── ritual_settings ─────────────────────────────────────────────────────
    # JSONB config per profile — MUST follow Config Table Pattern.
    # profile_id IS the primary key, no surrogate id.
    if "ritual_settings" not in existing_tables:
        op.create_table(
            "ritual_settings",
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("config", JSONB(), nullable=False, server_default="{}"),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.ForeignKeyConstraint(
                ["profile_id"], ["profiles.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("profile_id"),
        )

    # ── ritual_pinned_pairs ──────────────────────────────────────────────────
    if "ritual_pinned_pairs" not in existing_tables:
        op.create_table(
            "ritual_pinned_pairs",
            sa.Column(
                "id", sa.BigInteger(), sa.Identity(always=False), nullable=False
            ),
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("pair", sa.String(30), nullable=False),
            sa.Column("tv_symbol", sa.String(50), nullable=True),
            sa.Column("timeframe", sa.String(10), nullable=False),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column(
                "pinned_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("source", sa.String(20), nullable=False, server_default="watchlist"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.CheckConstraint(
                "status IN ('active', 'expired', 'archived')",
                name="ck_ritual_pinned_status",
            ),
            sa.CheckConstraint(
                "source IN ('watchlist', 'manual')",
                name="ck_ritual_pinned_source",
            ),
            sa.CheckConstraint(
                "timeframe IN ('1W', '1D', '4H', '1H', '15m')",
                name="ck_ritual_pinned_timeframe",
            ),
            sa.ForeignKeyConstraint(
                ["profile_id"], ["profiles.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    _pp_idx = _existing_indexes("ritual_pinned_pairs")
    if "ix_ritual_pinned_profile_status" not in _pp_idx:
        op.create_index(
            "ix_ritual_pinned_profile_status",
            "ritual_pinned_pairs",
            ["profile_id", "status"],
        )
    if "ix_ritual_pinned_expires" not in _pp_idx:
        op.create_index(
            "ix_ritual_pinned_expires",
            "ritual_pinned_pairs",
            ["expires_at"],
        )

    # ── ritual_steps ─────────────────────────────────────────────────────────
    if "ritual_steps" not in existing_tables:
        op.create_table(
            "ritual_steps",
            sa.Column(
                "id", sa.BigInteger(), sa.Identity(always=False), nullable=False
            ),
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("session_type", sa.String(30), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("step_type", sa.String(30), nullable=False),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("cadence_hours", sa.Integer(), nullable=True),
            sa.Column("is_mandatory", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("linked_module", sa.String(50), nullable=True),
            sa.Column("est_minutes", sa.Integer(), nullable=True),
            sa.Column("config", JSONB(), nullable=False, server_default="{}"),
            sa.CheckConstraint(
                "session_type IN ('weekly_setup', 'daily_prep', 'trade_session', 'weekend_review')",
                name="ck_ritual_steps_session_type",
            ),
            sa.CheckConstraint(
                "position >= 1",
                name="ck_ritual_steps_position_positive",
            ),
            sa.ForeignKeyConstraint(
                ["profile_id"], ["profiles.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("profile_id", "session_type", "position", name="uq_ritual_steps_profile_type_pos"),
        )
    if "ix_ritual_steps_profile_type" not in _existing_indexes("ritual_steps"):
        op.create_index(
            "ix_ritual_steps_profile_type",
            "ritual_steps",
            ["profile_id", "session_type"],
        )

    # ── ritual_sessions ───────────────────────────────────────────────────────
    if "ritual_sessions" not in existing_tables:
        op.create_table(
            "ritual_sessions",
            sa.Column(
                "id", sa.BigInteger(), sa.Identity(always=False), nullable=False
            ),
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("session_type", sa.String(30), nullable=False),
            sa.Column(
                "started_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="in_progress"),
            sa.Column("outcome", sa.String(30), nullable=True),
            sa.Column("discipline_points", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.CheckConstraint(
                "session_type IN ('weekly_setup', 'daily_prep', 'trade_session', 'weekend_review')",
                name="ck_ritual_sessions_session_type",
            ),
            sa.CheckConstraint(
                "status IN ('in_progress', 'completed', 'abandoned')",
                name="ck_ritual_sessions_status",
            ),
            sa.CheckConstraint(
                "outcome IS NULL OR outcome IN ('trade_opened', 'no_opportunity', 'abandoned', 'vol_too_low')",
                name="ck_ritual_sessions_outcome",
            ),
            sa.ForeignKeyConstraint(
                ["profile_id"], ["profiles.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    _rs_idx = _existing_indexes("ritual_sessions")
    if "ix_ritual_sessions_profile_started" not in _rs_idx:
        op.create_index(
            "ix_ritual_sessions_profile_started",
            "ritual_sessions",
            ["profile_id", "started_at"],
        )
    if "ix_ritual_sessions_status" not in _rs_idx:
        op.create_index(
            "ix_ritual_sessions_status",
            "ritual_sessions",
            ["status"],
        )

    # ── ritual_step_log ───────────────────────────────────────────────────────
    if "ritual_step_log" not in existing_tables:
        op.create_table(
            "ritual_step_log",
            sa.Column(
                "id", sa.BigInteger(), sa.Identity(always=False), nullable=False
            ),
            sa.Column("ritual_session_id", sa.BigInteger(), nullable=False),
            sa.Column("step_id", sa.BigInteger(), nullable=True),
            sa.Column("step_type", sa.String(30), nullable=False),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("output", JSONB(), nullable=False, server_default="{}"),
            sa.CheckConstraint(
                "status IN ('pending', 'done', 'skipped')",
                name="ck_ritual_step_log_status",
            ),
            sa.ForeignKeyConstraint(
                ["ritual_session_id"],
                ["ritual_sessions.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["step_id"],
                ["ritual_steps.id"],
                ondelete="SET NULL",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
    if "ix_ritual_step_log_session" not in _existing_indexes("ritual_step_log"):
        op.create_index(
            "ix_ritual_step_log_session",
            "ritual_step_log",
            ["ritual_session_id"],
        )

    # ── ritual_weekly_score ───────────────────────────────────────────────────
    if "ritual_weekly_score" not in existing_tables:
        op.create_table(
            "ritual_weekly_score",
            sa.Column(
                "id", sa.BigInteger(), sa.Identity(always=False), nullable=False
            ),
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("week_start", sa.Date(), nullable=False),
            sa.Column("score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_score", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("details", JSONB(), nullable=False, server_default="{}"),
            sa.ForeignKeyConstraint(
                ["profile_id"], ["profiles.id"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("profile_id", "week_start", name="uq_ritual_weekly_score_profile_week"),
        )
    if "ix_ritual_weekly_score_profile_week" not in _existing_indexes("ritual_weekly_score"):
        op.create_index(
            "ix_ritual_weekly_score_profile_week",
            "ritual_weekly_score",
            ["profile_id", "week_start"],
        )


def downgrade() -> None:
    op.drop_table("ritual_weekly_score")
    op.drop_table("ritual_step_log")
    op.drop_table("ritual_sessions")
    op.drop_table("ritual_steps")
    op.drop_table("ritual_pinned_pairs")
    op.drop_table("ritual_settings")
