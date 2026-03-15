"""Phase 2 — TimescaleDB extension + volatility tables

Revision ID: p2001_phase2_volatility
Revises: a1b2c3d4e5f6
Create Date: 2026-03-14 00:00:00.000000

Creates:
  - TimescaleDB extension (IF NOT EXISTS)
  - volatility_snapshots     (hypertable on timestamp — Per-Pair VI)
  - market_vi_snapshots      (hypertable on timestamp — Market VI global)
  - market_vi_pairs          (Binance pairs for Market VI, top-100 configurable)
  - watchlist_snapshots      (generated watchlist snapshots)
  - volatility_settings      (JSONB config per profile)
  - notification_settings    (JSONB Telegram config per profile)

All CREATE TABLE use IF NOT EXISTS.
All ADD COLUMN use IF NOT EXISTS.
Hypertables use IF NOT EXISTS (create_hypertable 3rd arg).
Safe to replay on a DB where tables already exist.
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "p2001_phase2_volatility"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. TimescaleDB extension (optional) ──────────────────────────────────
    # Installed only when timescale/timescaledb image is used.
    # On plain postgres:16 (e.g. first prod deploy), the DO block is a no-op
    # and all tables are created as regular PostgreSQL tables — Phase 2 works
    # fully, just without time-series chunk optimisation.
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'
            ) THEN
                CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
            END IF;
        END $$
    """)

    # ── 2. volatility_snapshots — Per-Pair VI (hypertable) ───────────────────
    # Stores computed VI scores per pair + timeframe.
    # Partition key: timestamp (daily chunks, auto-compressed after 7 days).
    op.execute("""
        CREATE TABLE IF NOT EXISTS volatility_snapshots (
            id          BIGSERIAL,
            pair        VARCHAR(20)     NOT NULL,
            timeframe   VARCHAR(10)     NOT NULL,
            vi_score    DECIMAL(5,3)    NOT NULL,
            components  JSONB           NOT NULL DEFAULT '{}',
            timestamp   TIMESTAMPTZ     NOT NULL,
            PRIMARY KEY (pair, timeframe, timestamp)
        )
    """)

    # Convert to hypertable only when TimescaleDB is available
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                PERFORM create_hypertable(
                    'volatility_snapshots', 'timestamp',
                    if_not_exists => TRUE,
                    chunk_time_interval => INTERVAL '1 day'
                );
            END IF;
        END $$
    """)

    # Index on vi_score for fast ranking queries (watchlist ORDER BY vi_score DESC)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_vs_pair_tf_ts
        ON volatility_snapshots (pair, timeframe, timestamp DESC)
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_vs_vi_score_tf
        ON volatility_snapshots (timeframe, vi_score DESC)
    """)

    # ── 3. market_vi_snapshots — Market VI global (hypertable) ───────────────
    # Stores the aggregated market score per timeframe.
    op.execute("""
        CREATE TABLE IF NOT EXISTS market_vi_snapshots (
            id          BIGSERIAL,
            timeframe   VARCHAR(10)     NOT NULL,
            vi_score    DECIMAL(5,3)    NOT NULL,
            regime      VARCHAR(20)     NOT NULL,
            components  JSONB           NOT NULL DEFAULT '{}',
            timestamp   TIMESTAMPTZ     NOT NULL,
            PRIMARY KEY (timeframe, timestamp)
        )
    """)

    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                PERFORM create_hypertable(
                    'market_vi_snapshots', 'timestamp',
                    if_not_exists => TRUE,
                    chunk_time_interval => INTERVAL '1 day'
                );
            END IF;
        END $$
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mvs_tf_ts
        ON market_vi_snapshots (timeframe, timestamp DESC)
    """)

    # ── 4. market_vi_pairs — Binance pairs for Market VI ─────────────────────
    # Top-100 Binance Futures pairs (synced by sync_instruments task).
    # is_selected: controlled from Settings UI (default top-50 by volume).
    op.execute("""
        CREATE TABLE IF NOT EXISTS market_vi_pairs (
            id              BIGSERIAL       PRIMARY KEY,
            symbol          VARCHAR(30)     NOT NULL UNIQUE,
            display_name    VARCHAR(50),
            quote_volume_24h DECIMAL(20,2),
            volume_rank     INTEGER,
            is_selected     BOOLEAN         NOT NULL DEFAULT FALSE,
            created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_mvp_is_selected
        ON market_vi_pairs (is_selected)
    """)

    # ── 5. watchlist_snapshots ────────────────────────────────────────────────
    # Generated after each per-pair VI compute cycle.
    # pairs JSONB: [{pair, vi_score, regime, ema_signal, ema_score,
    #                change_24h, tf_sup_regime, tf_sup_vi}]
    op.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_snapshots (
            id              BIGSERIAL       PRIMARY KEY,
            name            VARCHAR(100)    NOT NULL,
            timeframe       VARCHAR(10)     NOT NULL,
            regime          VARCHAR(20)     NOT NULL,
            pairs_count     INTEGER         NOT NULL DEFAULT 0,
            pairs           JSONB           NOT NULL DEFAULT '[]',
            generated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_wls_tf_generated
        ON watchlist_snapshots (timeframe, generated_at DESC)
    """)

    # ── 6. volatility_settings — JSONB config per profile ────────────────────
    # One row per profile. Created on first access (upsert in service layer).
    # JSONB columns: add/remove keys without migrations.
    op.execute("""
        CREATE TABLE IF NOT EXISTS volatility_settings (
            profile_id      BIGINT          PRIMARY KEY
                                            REFERENCES profiles(id) ON DELETE CASCADE,
            market_vi       JSONB           NOT NULL DEFAULT '{}',
            per_pair        JSONB           NOT NULL DEFAULT '{}',
            regimes         JSONB           NOT NULL DEFAULT '{}',
            updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
        )
    """)

    # ── 7. notification_settings — Telegram bots + alert config ──────────────
    op.execute("""
        CREATE TABLE IF NOT EXISTS notification_settings (
            profile_id          BIGINT      PRIMARY KEY
                                            REFERENCES profiles(id) ON DELETE CASCADE,
            bots                JSONB       NOT NULL DEFAULT '[]',
            market_vi_alerts    JSONB       NOT NULL DEFAULT '{}',
            watchlist_alerts    JSONB       NOT NULL DEFAULT '{}',
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)


def downgrade() -> None:
    # Drop in reverse dependency order.
    # Hypertables are dropped with DROP TABLE (chunks cascade automatically).
    op.execute("DROP TABLE IF EXISTS notification_settings")
    op.execute("DROP TABLE IF EXISTS volatility_settings")
    op.execute("DROP TABLE IF EXISTS watchlist_snapshots")
    op.execute("DROP TABLE IF EXISTS market_vi_pairs")
    op.execute("DROP TABLE IF EXISTS market_vi_snapshots")
    op.execute("DROP TABLE IF EXISTS volatility_snapshots")
    # Do NOT drop timescaledb extension — other tables may depend on it
    # and it cannot be re-created idempotently without a DB restart
