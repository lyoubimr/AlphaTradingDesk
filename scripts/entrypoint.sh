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

echo "🔄 Checking DB state…"
# Detect false stamp: alembic_version exists but actual tables do not.
# This can happen when the DB was stamped manually without running migrations.
TABLE_EXISTS=$(python -c "
import os, psycopg
raw = os.environ.get('DATABASE_URL', '').replace('postgresql+psycopg://', 'postgresql://')
with psycopg.connect(raw) as conn:
    cur = conn.execute(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='profiles'\")
    print(cur.fetchone()[0])
" 2>/dev/null || echo "0")

if [ "$TABLE_EXISTS" = "0" ]; then
  echo "⚠️  Tables missing — clearing false stamp and running full migration…"
  python -c "
import os, psycopg
raw = os.environ.get('DATABASE_URL', '').replace('postgresql+psycopg://', 'postgresql://')
with psycopg.connect(raw) as conn:
    conn.execute('DELETE FROM alembic_version')
    conn.commit()
print('Stamp cleared.')
" 2>/dev/null || true
fi

echo "🔄 Running Alembic migrations…"
alembic upgrade head
echo "✅ Migrations done."

echo "🌱 Seeding reference data…"
python -m database.migrations.seeds.seed_all
echo "✅ Seed done."

echo "🚀 Starting uvicorn…"
exec uvicorn src.main:app --host 0.0.0.0 --port 8000 "$@"
