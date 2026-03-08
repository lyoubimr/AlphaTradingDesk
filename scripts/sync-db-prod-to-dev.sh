#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/sync-db-prod-to-dev.sh
#
# PURPOSE
#   Pull the production database from the Dell and restore it locally
#   in the dev stack (docker-compose.dev.yml).
#   Useful after the first prod deploy to work with real data in dev.
#
# WHAT IT DOES
#   1. pg_dump on the Dell (inside the db container via SSH)
#   2. Transfer the dump to the Mac via SSH
#   3. Stop the local backend (to drop all connections)
#   4. Drop + recreate the local atd_dev database
#   5. Restore the dump into atd_dev
#   6. Restart the local backend
#
# PREREQUISITES
#   - ssh atd  works (alias in ~/.ssh/config)
#   - docker-compose.dev.yml stack is running (db container up)
#   - Dell containers are running (db container up)
#
# USAGE
#   ./scripts/sync-db-prod-to-dev.sh
#   ./scripts/sync-db-prod-to-dev.sh --dry-run   # print steps, do nothing
#
# ⚠️  DESTRUCTIVE — rewrites your local atd_dev database entirely.
#     All local dev data will be lost.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

# ── Config ────────────────────────────────────────────────────────────────────
DELL_SSH_ALIAS="atd"
DELL_COMPOSE="$HOME/apps/docker-compose.prod.yml"
PROD_DB_NAME="atd_prod"
PROD_DB_USER="atd"

DEV_COMPOSE_FILE="docker-compose.dev.yml"
DEV_DB_NAME="atd_dev"
DEV_DB_USER="atd"
DEV_DB_PASSWORD="dev_password"
DEV_DB_SERVICE="db"
DEV_BACKEND_SERVICE="backend"

DUMP_REMOTE="/tmp/atd_prod_sync_$(date +%Y%m%d_%H%M%S).sql.gz"
DUMP_LOCAL="/tmp/atd_prod_sync_$(date +%Y%m%d_%H%M%S).sql.gz"

# ── Helpers ───────────────────────────────────────────────────────────────────
log()  { echo "  $*"; }
step() { echo; echo "▶  $*"; }
run()  {
  if $DRY_RUN; then
    echo "    [DRY-RUN] $*"
  else
    eval "$@"
  fi
}

# ── Preflight checks ──────────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════"
echo "  ATD — Sync prod → dev"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
$DRY_RUN && echo "  ⚠️  DRY-RUN mode — nothing will be changed"
echo "══════════════════════════════════════════════════"

step "Preflight checks"

# Check SSH to Dell
log "SSH to Dell…"
if ! ssh -q -o BatchMode=yes -o ConnectTimeout=5 "${DELL_SSH_ALIAS}" exit 2>/dev/null; then
  echo "  ❌  Cannot SSH to '${DELL_SSH_ALIAS}' — check ~/.ssh/config and Dell status"
  exit 1
fi
log "✅  Dell reachable"

# Check local dev DB is running
log "Local dev DB…"
if ! docker compose -f "${DEV_COMPOSE_FILE}" exec -T "${DEV_DB_SERVICE}" \
    pg_isready -U "${DEV_DB_USER}" -d "${DEV_DB_NAME}" &>/dev/null; then
  echo "  ❌  Local dev DB not running — start it with: docker compose -f ${DEV_COMPOSE_FILE} up -d db"
  exit 1
fi
log "✅  Local dev DB running"

# ── Step 1 — Dump prod DB on Dell ─────────────────────────────────────────────
step "Step 1 — pg_dump on Dell → ${DUMP_REMOTE}"
run "ssh ${DELL_SSH_ALIAS} \"
  export GHCR_OWNER=placeholder IMAGE_TAG=latest
  docker compose -f ${DELL_COMPOSE} exec -T ${DEV_DB_SERVICE/db/db} \
    pg_dump -U ${PROD_DB_USER} ${PROD_DB_NAME} | gzip > ${DUMP_REMOTE}
  echo \\\"  Dump size: \\\$(du -sh ${DUMP_REMOTE} | cut -f1)\\\"
\""

# ── Step 2 — Transfer dump to Mac ─────────────────────────────────────────────
step "Step 2 — Transfer dump → ${DUMP_LOCAL}"
run "scp ${DELL_SSH_ALIAS}:${DUMP_REMOTE} ${DUMP_LOCAL}"
run "ssh ${DELL_SSH_ALIAS} rm -f ${DUMP_REMOTE}"
log "✅  Transfer complete"

# ── Step 3 — Stop local backend (release DB connections) ──────────────────────
step "Step 3 — Stop local backend"
run "docker compose -f ${DEV_COMPOSE_FILE} stop ${DEV_BACKEND_SERVICE} 2>/dev/null || true"
log "✅  Backend stopped"

# ── Step 4 — Drop + recreate local dev DB ─────────────────────────────────────
step "Step 4 — Drop + recreate local atd_dev"
run "docker compose -f ${DEV_COMPOSE_FILE} exec -T ${DEV_DB_SERVICE} \
  psql -U ${DEV_DB_USER} -d postgres -c 'DROP DATABASE IF EXISTS ${DEV_DB_NAME};'"
run "docker compose -f ${DEV_COMPOSE_FILE} exec -T ${DEV_DB_SERVICE} \
  psql -U ${DEV_DB_USER} -d postgres -c 'CREATE DATABASE ${DEV_DB_NAME} OWNER ${DEV_DB_USER};'"
log "✅  Database recreated"

# ── Step 5 — Restore dump ─────────────────────────────────────────────────────
step "Step 5 — Restore prod dump into atd_dev"
run "zcat ${DUMP_LOCAL} | \
  docker compose -f ${DEV_COMPOSE_FILE} exec -T ${DEV_DB_SERVICE} \
  psql -U ${DEV_DB_USER} -d ${DEV_DB_NAME} -q"
log "✅  Restore complete"

# Clean up local dump
run "rm -f ${DUMP_LOCAL}"

# ── Step 6 — Restart backend ──────────────────────────────────────────────────
step "Step 6 — Restart local backend"
run "docker compose -f ${DEV_COMPOSE_FILE} start ${DEV_BACKEND_SERVICE}"
log "✅  Backend restarted"

# ── Done ──────────────────────────────────────────────────────────────────────
echo
echo "══════════════════════════════════════════════════"
echo "  ✅  Sync complete — prod → dev"
echo
echo "  Local dev now mirrors prod data."
echo "  API:      http://localhost:8000/health"
echo "  Frontend: http://localhost:5173"
echo "══════════════════════════════════════════════════"
