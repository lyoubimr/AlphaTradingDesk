"""p5001 Phase 5 — Kraken Execution schema

Revision ID: p5001_phase5_kraken_execution
Revises: p3001_phase3_risk_management
Create Date: 2026-03-28

Changes:
  1. instruments.contract_value_precision  (INTEGER, nullable)
  2. trades.automation_enabled             (BOOLEAN NOT NULL DEFAULT false)
  3. trades.kraken_entry_order_id          (TEXT, nullable)
  4. CREATE TABLE automation_settings      (Config Table Pattern — JSONB)
  5. CREATE TABLE kraken_orders            (full order lifecycle tracking)
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = "p5001_phase5_kraken_execution"
down_revision = "fe8288f1af1c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. instruments — add contract_value_precision
    # ------------------------------------------------------------------
    op.add_column(
        "instruments",
        sa.Column("contract_value_precision", sa.Integer(), nullable=True),
    )

    # ------------------------------------------------------------------
    # 2. trades — add automation columns
    # ------------------------------------------------------------------
    op.add_column(
        "trades",
        sa.Column(
            "automation_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "trades",
        sa.Column("kraken_entry_order_id", sa.String(100), nullable=True),
    )

    # ------------------------------------------------------------------
    # 3. automation_settings — Config Table Pattern (profile_id PK, JSONB)
    # ------------------------------------------------------------------
    op.create_table(
        "automation_settings",
        sa.Column("profile_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.ForeignKeyConstraint(
            ["profile_id"],
            ["profiles.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("profile_id"),
        if_not_exists=True,
    )

    # ------------------------------------------------------------------
    # 4. kraken_orders
    # ------------------------------------------------------------------
    op.create_table(
        "kraken_orders",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("trade_id", sa.BigInteger(), nullable=False),
        sa.Column("profile_id", sa.BigInteger(), nullable=False),
        sa.Column("kraken_order_id", sa.String(100), nullable=False),
        sa.Column("kraken_fill_id", sa.String(100), nullable=True),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default=sa.text("'open'")),
        sa.Column("order_type", sa.String(20), nullable=False),
        sa.Column("symbol", sa.String(30), nullable=False),
        sa.Column("side", sa.String(4), nullable=False),
        sa.Column("size", sa.Numeric(18, 8), nullable=False),
        sa.Column("limit_price", sa.Numeric(18, 8), nullable=True),
        sa.Column("filled_price", sa.Numeric(18, 8), nullable=True),
        sa.Column("filled_size", sa.Numeric(18, 8), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "sent_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("filled_at", sa.DateTime(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "role IN ('entry','sl','tp1','tp2','tp3')",
            name="ck_kraken_orders_role",
        ),
        sa.CheckConstraint(
            "status IN ('open','filled','cancelled','error')",
            name="ck_kraken_orders_status",
        ),
        sa.CheckConstraint(
            "order_type IN ('market','limit','stop','take_profit')",
            name="ck_kraken_orders_order_type",
        ),
        sa.CheckConstraint(
            "side IN ('buy','sell')",
            name="ck_kraken_orders_side",
        ),
        sa.ForeignKeyConstraint(["trade_id"], ["trades.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["profile_id"], ["profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kraken_order_id"),
        sa.UniqueConstraint("kraken_fill_id"),
        if_not_exists=True,
    )
    op.create_index("ix_kraken_orders_trade_id", "kraken_orders", ["trade_id"])
    op.create_index("ix_kraken_orders_status", "kraken_orders", ["status"])
    op.create_index("ix_kraken_orders_role", "kraken_orders", ["role"])


def downgrade() -> None:
    # Indexes first, then table, then columns
    op.drop_index("ix_kraken_orders_role", table_name="kraken_orders")
    op.drop_index("ix_kraken_orders_status", table_name="kraken_orders")
    op.drop_index("ix_kraken_orders_trade_id", table_name="kraken_orders")
    op.drop_table("kraken_orders")
    op.drop_table("automation_settings")
    op.drop_column("trades", "kraken_entry_order_id")
    op.drop_column("trades", "automation_enabled")
    op.drop_column("instruments", "contract_value_precision")
