#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# AlphaTradingDesk — Backend entrypoint
#
# Runs on every container start (dev, prod, CI):
#   1. Wait for PostgreSQL to be ready
#   2. Run Alembic migrations (idempotent — safe if already at head)
#   3. Run reference data seed (idempotent — skips existing rows)
#   4. Start uvicorn
#
# The seed only inserts brokers, instruments, trading_styles, sessions, etc.
# It never touches user data (profiles, trades).
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "⏳ Waiting for PostgreSQL…"
until python -c "
import os, psycopg
conn_str = os.environ.get('DATABASE_URL', '').replace('postgresql://', 'postgresql+psycopg://')
# Use raw psycopg (not SQLAlchemy) for the health check
raw = os.environ.get('DATABASE_URL', '').replace('postgresql+psycopg://', 'postgresql://')
psycopg.connect(raw).close()
" 2>/dev/null; do
  sleep 1
done
echo "✅ PostgreSQL ready."

echo "🔄 Running Alembic migrations…"
alembic upgrade head
echo "✅ Migrations done."

echo "🌱 Seeding reference data…"
python -m database.migrations.seeds.seed_all
echo "✅ Seed done."

echo "🚀 Starting uvicorn…"
exec uvicorn src.main:app --host 0.0.0.0 --port 8000 "$@"
