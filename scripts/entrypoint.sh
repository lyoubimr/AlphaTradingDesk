#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# AlphaTradingDesk — Backend entrypoint
#
# Modes (set via docker-compose command):
#   (no arg / --reload)  → migrate + seed + uvicorn   (API server)
#   celery-worker        → celery worker (Phase 2+)
#   celery-beat          → celery beat scheduler (Phase 2+)
#
# The seed only inserts brokers, instruments, trading_styles, sessions, etc.
# It never touches user data (profiles, trades).
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── Celery short-circuit ─────────────────────────────────────────────────────
# Celery worker/beat depend on db+redis (already healthchecked by Docker).
# They share the same image but skip migration/seed — the backend handles that.
if [ "$1" = "celery-worker" ]; then
  echo "🔧 Starting Celery worker…"
  exec celery -A src.core.celery_app worker --loglevel=info -c 2
fi

if [ "$1" = "celery-beat" ]; then
  echo "⏰ Starting Celery beat scheduler…"
  exec celery -A src.core.celery_app beat --loglevel=info --scheduler celery.beat:PersistentScheduler
fi
# ─────────────────────────────────────────────────────────────────────────────

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
# Detect the DB state and pick the right migration strategy.
#
# ⚠️  SAFETY RULE: we check table EXISTENCE, never row counts.
#     A table that exists but is empty (e.g. no trades yet) is a valid prod DB.
#     Checking `trades = 0` as a proxy for "missing tables" is WRONG and caused
#     user data loss (goals, strategies wiped) when the DB had 0 trades.
#
#   has_tables | has_stamp | MODE
#   -----------|-----------|--------------------------------------------
#   true       | false     | stamp_head  — tables exist, stamp missing
#   false      | true      | clear_stamp — stamp present but tables gone (true volume loss)
#   false      | false     | normal      — fresh DB → upgrade head
#   true       | true      | normal      — already migrated → alembic upgrade head is a no-op
#
python -c "
import os, psycopg
raw = os.environ.get('DATABASE_URL', '').replace('postgresql+psycopg://', 'postgresql://')
with psycopg.connect(raw) as conn:
    # Check if core tables EXIST (not their row count — empty is valid!)
    cur = conn.execute(\"\"\"
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public'
        AND table_name IN ('trades', 'profiles', 'profile_goals')
    \"\"\")
    table_count = cur.fetchone()[0]
    has_tables = table_count >= 3  # all 3 core tables must exist

    # Check if alembic stamp exists
    cur2 = conn.execute(\"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='alembic_version'\")
    has_alembic_table = cur2.fetchone()[0] > 0
    has_stamp = False
    if has_alembic_table:
        cur3 = conn.execute('SELECT COUNT(*) FROM alembic_version')
        has_stamp = cur3.fetchone()[0] > 0
    print(f'has_tables={has_tables} has_stamp={has_stamp}')
    if has_tables and not has_stamp:
        # Tables exist but stamp missing → stamp to head, no DDL needed
        print('MODE=stamp_head')
    elif not has_tables and has_stamp:
        # Stamp says we are at head but tables are truly gone (volume reset)
        # → clear the false stamp so alembic will replay all migrations
        conn.execute('DELETE FROM alembic_version')
        conn.commit()
        print('MODE=clear_stamp')
    else:
        # Normal: either fresh DB (upgrade creates everything) or already migrated (no-op)
        print('MODE=normal')
" >/tmp/atd_dbcheck.txt 2>&1 || true
cat /tmp/atd_dbcheck.txt

if grep -q "MODE=stamp_head" /tmp/atd_dbcheck.txt 2>/dev/null; then
  echo "⚠️  Tables present but stamp missing — stamping to head (no DDL)…"
  alembic stamp head
elif grep -q "MODE=clear_stamp" /tmp/atd_dbcheck.txt 2>/dev/null; then
  echo "⚠️  Stamp present but tables missing — clearing stamp and running full upgrade…"
  alembic upgrade head
  echo "✅ Migrations done."
else
  echo "🔄 Running Alembic migrations…"
  alembic upgrade head
  echo "✅ Migrations done."
fi

echo "🌱 Seeding reference data…"
if python -m database.migrations.seeds.seed_all; then
  echo "✅ Seed done."
else
  echo "⚠️  Seed failed — app will still start. Run manually: python -m database.migrations.seeds.seed_all"
  # Do NOT exit — migrations are done, the app is usable.
  # deploy.sh also runs seed_all as a safety net after every deploy.
fi

# In dev, auto-seed test profiles+trades if the DB has no profiles yet.
# This makes the app immediately usable after a fresh volume or db-reset.
APP_ENV="${APP_ENV:-dev}"
if [ "$APP_ENV" = "dev" ]; then
  PROFILE_COUNT=$(python -c "
import os, psycopg
raw = os.environ.get('DATABASE_URL','').replace('postgresql+psycopg://','postgresql://')
with psycopg.connect(raw) as c:
    print(c.execute('SELECT COUNT(*) FROM profiles').fetchone()[0])
" 2>/dev/null || echo "0")
  if [ "$PROFILE_COUNT" = "0" ]; then
    echo "🧪 No profiles found — seeding test data (dev only)…"
    python -m database.migrations.seeds.seed_test_data
    echo "✅ Test data seeded."
  else
    echo "ℹ️  Profiles already present (${PROFILE_COUNT}) — skipping test seed."
  fi
fi

echo "🚀 Starting uvicorn…"
exec uvicorn src.main:app --host 0.0.0.0 --port 8000 "$@"
