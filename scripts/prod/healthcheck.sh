#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/healthcheck.sh
#
# PURPOSE
#   Quick status check of the production stack on the Dell.
#   Gives you a single-screen overview without having to remember all commands.
#
# WHAT IT SHOWS
#   1. Container status (running/stopped, health, image tag, uptime)
#   2. API /health endpoint (HTTP 200 + JSON response)
#   3. Disk usage — /srv/atd/ (data + backups)
#   4. Memory usage (Docker containers)
#   5. Latest backup file (rolling)
#   6. Alembic current revision
#
# USAGE
#   ~/apps/healthcheck.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

COMPOSE_FILE="$HOME/apps/docker-compose.prod.yml"
ATD_DATA_DIR="/srv/atd"

echo "══════════════════════════════════════════════════"
echo "  ATD — Production healthcheck"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "══════════════════════════════════════════════════"
echo ""

# ── 1. Container status ───────────────────────────────────────────────────────
echo "▶  Containers"
docker compose -f "${COMPOSE_FILE}" ps --format "table {{.Name}}\t{{.Status}}\t{{.Image}}"
echo ""

# ── 2. API healthcheck ────────────────────────────────────────────────────────
echo "▶  API /health"
HTTP_RESPONSE="$(curl -s -o /tmp/atd_health_body.txt -w "%{http_code}" http://localhost:8000/health 2>/dev/null || echo "000")"
if [ "${HTTP_RESPONSE}" = "200" ]; then
  echo "    ✅  HTTP ${HTTP_RESPONSE} — $(cat /tmp/atd_health_body.txt)"
else
  echo "    ❌  HTTP ${HTTP_RESPONSE} — backend not responding"
fi
echo ""

# ── 3. Disk usage ────────────────────────────────────────────────────────────
echo "▶  Disk usage — /srv/atd/"
if [ -d "${ATD_DATA_DIR}" ]; then
  du -sh "${ATD_DATA_DIR}"/* 2>/dev/null | sed 's/^/    /' || echo "    (empty)"
  echo ""
  echo "    Host disk:"
  df -h / | tail -1 | awk '{print "    Used: "$3" / "$2" ("$5" full)"}'
else
  echo "    ⚠️  ${ATD_DATA_DIR} not found — run setup-server.sh first"
fi
echo ""

# ── 4. Container memory ───────────────────────────────────────────────────────
echo "▶  Container resource usage"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null \
  | sed 's/^/    /' || echo "    (no containers running)"
echo ""

# ── 5. Latest backup ─────────────────────────────────────────────────────────
echo "▶  Latest backup"
LATEST="$(ls -1t "${ATD_DATA_DIR}/backups/rolling/"*.sql.gz 2>/dev/null | head -1 || true)"
if [ -n "${LATEST}" ]; then
  BACKUP_AGE="$(( ( $(date +%s) - $(stat -c %Y "${LATEST}") ) / 3600 ))"
  echo "    ✅  $(basename "${LATEST}") — $(du -sh "${LATEST}" | cut -f1) — ${BACKUP_AGE}h ago"
  if [ "${BACKUP_AGE}" -gt 8 ]; then
    echo "    ⚠️  Last backup is older than 8h — check cron: crontab -l"
  fi
else
  echo "    ⚠️  No backup found in ${ATD_DATA_DIR}/backups/rolling/"
  echo "    Run: ~/apps/backup-db.sh rolling"
fi
echo ""

# ── 6. Alembic revision ───────────────────────────────────────────────────────
echo "▶  Alembic migration status"
ALEMBIC_OUT="$(docker compose -f "${COMPOSE_FILE}" exec -T backend alembic current 2>&1 || echo "ERROR")"
echo "    ${ALEMBIC_OUT}"
echo ""

echo "══════════════════════════════════════════════════"
echo "  Logs:    docker compose -f ~/apps/docker-compose.prod.yml logs -f"
echo "  Deploy:  ~/apps/deploy.sh <version>"
echo "  Backup:  ~/apps/backup-db.sh rolling"
echo "══════════════════════════════════════════════════"
