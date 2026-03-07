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
# Detect the two failure modes:
#   A) alembic_version exists but tables do not → false stamp → clear stamp + upgrade head
#   B) tables exist but alembic_version is empty → stamp head (DDL already applied)
python -c "
import os, psycopg
raw = os.environ.get('DATABASE_URL', '').replace('postgresql+psycopg://', 'postgresql://')
with psycopg.connect(raw) as conn:
    # Check if core tables exist
    cur = conn.execute(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='trades'\")
    has_trades = cur.fetchone()[0] > 0
    # Check if alembic stamp exists
    cur2 = conn.execute(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='alembic_version'\")
    has_alembic_table = cur2.fetchone()[0] > 0
    has_stamp = False
    if has_alembic_table:
        cur3 = conn.execute('SELECT COUNT(*) FROM alembic_version')
        has_stamp = cur3.fetchone()[0] > 0
    print(f'has_trades={has_trades} has_stamp={has_stamp}')
    if has_alembic_table and not has_stamp and has_trades:
        # Tables exist but stamp missing → stamp to head, no DDL needed
        print('MODE=stamp_head')
    elif not has_trades and has_alembic_table and has_stamp:
        # Stamp exists but tables gone → clear stamp, run upgrade
        conn.execute('DELETE FROM alembic_version')
        conn.commit()
        print('MODE=upgrade_after_clear')
    else:
        print('MODE=normal')
" >/tmp/atd_dbcheck.txt 2>&1 || true
cat /tmp/atd_dbcheck.txt

if grep -q "MODE=stamp_head" /tmp/atd_dbcheck.txt 2>/dev/null; then
  echo "⚠️  Tables present but stamp missing — stamping to head (no DDL)…"
  alembic stamp head
else
  echo "🔄 Running Alembic migrations…"
  alembic upgrade head
  echo "✅ Migrations done."
fi

echo "🌱 Seeding reference data…"
python -m database.migrations.seeds.seed_all
echo "✅ Seed done."

echo "🚀 Starting uvicorn…"
exec uvicorn src.main:app --host 0.0.0.0 --port 8000 "$@"
