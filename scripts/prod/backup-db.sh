#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/backup-db.sh
#
# PURPOSE
#   Create a compressed PostgreSQL dump of the production database.
#   Keeps a rolling window of backups (48 for rolling = ~12 days at 6h interval,
#   13 for weekly = ~3 months).
#
# WHAT IT DOES
#   1. Run pg_dump inside the running db container (no need to expose port 5432)
#   2. Gzip the output directly (streaming — no temp uncompressed file)
#   3. Rotate old backups: keep only the N most recent files
#
# WHY pg_dump inside the container and not from the host?
#   The DB port 5432 is NOT exposed to the host in prod (security best practice).
#   We exec inside the container instead — no network exposure needed.
#
# USAGE
#   ~/apps/backup-db.sh rolling    # called every 6h by cron
#   ~/apps/backup-db.sh weekly     # called every Sunday 03:00 by cron
#   ~/apps/backup-db.sh rolling    # manual on-demand backup
#
# OUTPUT FILES
#   /srv/atd/backups/rolling/atd_prod_YYYYMMDD_HHMMSS.sql.gz
#   /srv/atd/backups/weekly/atd_prod_YYYYMMDD_HHMMSS.sql.gz
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

MODE="${1:-rolling}"
COMPOSE_FILE="$HOME/apps/docker-compose.prod.yml"
BACKUP_DIR="/srv/atd/backups/${MODE}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUTPUT_FILE="${BACKUP_DIR}/atd_prod_${TIMESTAMP}.sql.gz"

# How many files to keep per mode
# rolling: 48 files × 6h = ~12 days of coverage
# weekly:  13 files × 7d = ~3 months of coverage
case "$MODE" in
  rolling) KEEP=49 ;;   # keep 48, +1 so tail -n +49 removes oldest
  weekly)  KEEP=14 ;;   # keep 13
  *)
    echo "❌  Unknown mode: $MODE (use 'rolling' or 'weekly')" >&2
    exit 1
    ;;
esac

# ── 1. Sanity check ────────────────────────────────────────────────────────────
if [ ! -d "${BACKUP_DIR}" ]; then
  echo "❌  Backup directory not found: ${BACKUP_DIR}" >&2
  echo "    Run setup-server.sh first." >&2
  exit 1
fi

# ── 2. Verify the db container is running ─────────────────────────────────────
if ! docker compose -f "${COMPOSE_FILE}" exec -T db pg_isready -U atd -d atd_prod > /dev/null 2>&1; then
  echo "❌  DB container is not ready. Aborting backup." >&2
  exit 1
fi

# ── 3. Run pg_dump → gzip → file ──────────────────────────────────────────────
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting ${MODE} backup → ${OUTPUT_FILE}"
docker compose -f "${COMPOSE_FILE}" exec -T db \
  pg_dump -U atd atd_prod | gzip > "${OUTPUT_FILE}"

FILE_SIZE="$(du -sh "${OUTPUT_FILE}" | cut -f1)"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done — size: ${FILE_SIZE}"

# ── 4. Rotate: delete files beyond the keep window ────────────────────────────
# ls -1t: sort by modification time (newest first)
# tail -n +N: skip the N most recent → gives the ones to delete
DELETED=$(ls -1t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | tail -n +"${KEEP}" | xargs -r rm -v -- | wc -l)
[ "${DELETED}" -gt 0 ] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotated ${DELETED} old backup(s)."

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete."
