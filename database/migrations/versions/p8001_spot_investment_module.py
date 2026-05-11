"""p8001 — Spot & Investment Module

Phase 7A — Spot Foundations.

Schema changes (all additive — zero breaking changes to existing tables):
  - profiles           → ADD COLUMN account_type VARCHAR(20) DEFAULT 'contracts'
  - spot_trades        → new table (quantity-based, SL optional, no leverage)
  - deposits           → new table (contribution + withdrawal log per profile)
  - investment_settings → new JSONB config table (Config Table Pattern)

Revision ID: p8001_spot_investment_module
Revises:     p7001_ritual_module
Create Date: 2026-05-02

SAFETY:
  - All CREATE TABLE wrapped in existence checks → idempotent (safe to run twice).
  - ALTER TABLE wrapped in column existence check → idempotent.
  - server_default='contracts' on account_type → zero backfill, zero NULL rows,
    zero downtime. Existing profiles instantly get account_type='contracts'.
  - No DROP, no modification of existing columns or constraints anywhere.
  - Run this migration twice locally before deploying to prod — must produce
    no error on the second run.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.dialects.postgresql import JSONB

revision = "p8001_spot_investment_module"
down_revision = "p7001_ritual_module"
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

    def _existing_constraints(table: str) -> set[str]:
        if table not in existing_tables:
            return set()
        return {c["name"] for c in inspector.get_check_constraints(table)}

    # ── profiles → ADD COLUMN account_type ───────────────────────────────────
    # DEFAULT 'contracts' ensures all existing rows get the right value instantly.
    # No backfill query, no lock escalation, no downtime.
    existing_cols = {c["name"] for c in inspector.get_columns("profiles")}
    if "account_type" not in existing_cols:
        op.add_column(
            "profiles",
            sa.Column(
                "account_type",
                sa.String(20),
                nullable=False,
                server_default="contracts",
            ),
        )
        op.create_check_constraint(
            "ck_profiles_account_type",
            "profiles",
            "account_type IN ('contracts', 'spot')",
        )

    # ── spot_trades ───────────────────────────────────────────────────────────
    # New table for spot/investment positions.
    # Key differences from `trades`:
    #   - stop_loss is NULLABLE (optional guard, not required)
    #   - no leverage / margin_used columns
    #   - quantity + entry_price → total_cost (not risk_amount / lot_size)
    #   - parent_spot_trade_id: optional FK to self (DCA grouping)
    if "spot_trades" not in existing_tables:
        op.create_table(
            "spot_trades",
            sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("parent_spot_trade_id", sa.BigInteger(), nullable=True),
            sa.Column("strategy_id", sa.BigInteger(), nullable=True),
            sa.Column("instrument_id", sa.BigInteger(), nullable=True),
            # Core
            sa.Column("pair", sa.String(30), nullable=False),
            sa.Column("asset_class", sa.String(50), nullable=True),
            sa.Column("analyzed_timeframe", sa.String(10), nullable=True),
            sa.Column("order_type", sa.String(20), nullable=False, server_default="MARKET"),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            # Entry
            sa.Column("entry_price", sa.Numeric(20, 8), nullable=False),
            sa.Column("quantity", sa.Numeric(20, 8), nullable=False),
            sa.Column("total_cost", sa.Numeric(20, 8), nullable=True),  # quantity * entry_price
            sa.Column("entry_date", sa.DateTime(timezone=True), nullable=True),
            # Optional SL guard
            sa.Column("stop_loss", sa.Numeric(20, 8), nullable=True),
            # Take Profits: [{price: float, pct_allocation: float}]
            sa.Column("nb_take_profits", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("tp_targets", JSONB(), nullable=False, server_default="[]"),
            # P&L (populated on close)
            sa.Column("exit_price", sa.Numeric(20, 8), nullable=True),
            sa.Column("realized_pnl", sa.Numeric(20, 8), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            # VI snapshot at entry
            sa.Column("market_vi_at_entry", sa.Numeric(5, 2), nullable=True),
            sa.Column("pair_vi_at_entry", sa.Numeric(5, 2), nullable=True),
            # Meta
            sa.Column("confidence_score", sa.Numeric(5, 2), nullable=True),
            sa.Column("session_tag", sa.String(100), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("structured_notes", JSONB(), nullable=True),
            sa.Column("screenshot_urls", JSONB(), nullable=False, server_default="[]"),
            # Timestamps
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            # Constraints
            sa.CheckConstraint("quantity > 0", name="ck_spot_trades_quantity_positive"),
            sa.CheckConstraint(
                "nb_take_profits BETWEEN 0 AND 3",
                name="ck_spot_trades_nb_tp",
            ),
            sa.CheckConstraint(
                "order_type IN ('MARKET', 'LIMIT')",
                name="ck_spot_trades_order_type",
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'open', 'partial', 'runner', 'closed', 'cancelled')",
                name="ck_spot_trades_status",
            ),
            # Foreign keys
            sa.ForeignKeyConstraint(
                ["profile_id"], ["profiles.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["parent_spot_trade_id"],
                ["spot_trades.id"],
                ondelete="SET NULL",
            ),
            sa.ForeignKeyConstraint(
                ["strategy_id"], ["strategies.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["instrument_id"], ["instruments.id"], ondelete="SET NULL"
            ),
            sa.PrimaryKeyConstraint("id"),
        )

    # ── spot_trades → ADD COLUMN trailing_stop_pct (added post-initial design) ─
    _st_cols = {c["name"] for c in inspector.get_columns("spot_trades")} if "spot_trades" in existing_tables else set()
    if "trailing_stop_pct" not in _st_cols:
        op.add_column(
            "spot_trades",
            sa.Column("trailing_stop_pct", sa.Numeric(6, 4), nullable=True),
        )

    _st_idx = _existing_indexes("spot_trades")
    if "ix_spot_trades_profile_id" not in _st_idx:
        op.create_index("ix_spot_trades_profile_id", "spot_trades", ["profile_id"])
    if "ix_spot_trades_status" not in _st_idx:
        op.create_index("ix_spot_trades_status", "spot_trades", ["status"])
    if "ix_spot_trades_profile_status" not in _st_idx:
        op.create_index(
            "ix_spot_trades_profile_status", "spot_trades", ["profile_id", "status"]
        )
    if "ix_spot_trades_parent" not in _st_idx:
        op.create_index(
            "ix_spot_trades_parent",
            "spot_trades",
            ["parent_spot_trade_id"],
            postgresql_where=sa.text("parent_spot_trade_id IS NOT NULL"),
        )

    # ── deposits ──────────────────────────────────────────────────────────────
    # Tracks capital contributions and withdrawals per profile.
    # amount > 0 = deposit; amount < 0 = withdrawal.
    # is_recurrent = True when logged from ritual deposit_check step.
    if "deposits" not in existing_tables:
        op.create_table(
            "deposits",
            sa.Column("id", sa.BigInteger(), sa.Identity(always=False), nullable=False),
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("amount", sa.Numeric(20, 2), nullable=False),
            sa.Column("deposit_date", sa.Date(), nullable=False),
            sa.Column("label", sa.String(100), nullable=True),
            sa.Column(
                "is_recurrent", sa.Boolean(), nullable=False, server_default="false"
            ),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    _dep_idx = _existing_indexes("deposits")
    if "ix_deposits_profile_id" not in _dep_idx:
        op.create_index("ix_deposits_profile_id", "deposits", ["profile_id"])
    if "ix_deposits_profile_date" not in _dep_idx:
        op.create_index(
            "ix_deposits_profile_date", "deposits", ["profile_id", "deposit_date"]
        )

    # ── investment_settings ───────────────────────────────────────────────────
    # Mandatory Config Table Pattern: profile_id IS the PK, one JSONB column.
    # Auto-created on first GET with DEFAULT_INVESTMENT_CONFIG (service layer).
    if "investment_settings" not in existing_tables:
        op.create_table(
            "investment_settings",
            sa.Column("profile_id", sa.BigInteger(), nullable=False),
            sa.Column("config", JSONB(), nullable=False, server_default="{}"),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("profile_id"),
        )


def downgrade() -> None:
    op.drop_table("investment_settings")
    op.drop_table("deposits")
    op.drop_table("spot_trades")
    op.drop_constraint("ck_profiles_account_type", "profiles", type_="check")
    op.drop_column("profiles", "account_type")
