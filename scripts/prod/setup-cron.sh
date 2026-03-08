#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/setup-cron.sh
#
# PURPOSE
#   Install all production crontab entries on the Dell server.
#   Run this ONCE after the first deploy, or re-run to update/reset crons.
#
# WHAT IT CONFIGURES
#   1. DB backup every 6h (rolling — 48 files ≈ 12 days)
#   2. DB backup every Sunday 03:00 (weekly — 13 files ≈ 3 months)
#   3. Log rotation check every day at 01:00 (truncate app logs > 100MB)
#
# HOW IT WORKS
#   - Reads current crontab with `crontab -l`
#   - Strips any existing ATD cron entries (idempotent — safe to re-run)
#   - Appends fresh entries
#   - Installs the new crontab with `crontab -`
#   This approach means running this script multiple times is always safe.
#
# USAGE (run on the Dell, as user atd)
#   chmod +x ~/apps/setup-cron.sh
#   ~/apps/setup-cron.sh
#   crontab -l    # verify
#
# PREREQUISITES
#   - ~/apps/backup-db.sh  must exist and be executable
#   - /srv/atd/logs/cron/  must exist
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BACKUP_SCRIPT="$HOME/apps/backup-db.sh"
UPDATE_SCRIPT="$HOME/apps/update-server.sh"
CRON_LOG="/srv/atd/logs/cron/backup-db.log"
LOG_DIR="/srv/atd/logs/app"
TRUNCATE_THRESHOLD_MB=100

# ── Guard: scripts must exist ─────────────────────────────────────────────────
if [ ! -f "${BACKUP_SCRIPT}" ]; then
  echo "❌  ${BACKUP_SCRIPT} not found." >&2
  echo "    Run setup-server.sh first, or copy scripts/prod/backup-db.sh to ~/apps/" >&2
  exit 1
fi

if [ ! -f "${UPDATE_SCRIPT}" ]; then
  echo "❌  ${UPDATE_SCRIPT} not found." >&2
  echo "    Copy scripts/prod/update-server.sh to ~/apps/" >&2
  exit 1
fi

chmod +x "${BACKUP_SCRIPT}"
chmod +x "${UPDATE_SCRIPT}"

# ── Build the cron entries block ──────────────────────────────────────────────
# The sentinel comments (# ATD-BEGIN / # ATD-END) delimit our block so
# the script can cleanly remove and replace it on subsequent runs.
read -r -d '' ATD_CRON_BLOCK <<'CRON_EOF' || true
# ATD-BEGIN — managed by setup-cron.sh — do not edit manually between these lines

# DB backup every 6 hours — rolling window, keeps last 48 files (~12 days)
0 */6 * * * /home/atd/apps/backup-db.sh rolling >> /srv/atd/logs/cron/backup-db.log 2>&1

# DB backup every Sunday at 03:00 — weekly archive, keeps last 13 files (~3 months)
0 3 * * 0 /home/atd/apps/backup-db.sh weekly >> /srv/atd/logs/cron/backup-db.log 2>&1

# Log rotation: truncate app log files larger than 100 MB (daily at 01:00)
0 1 * * * find /srv/atd/logs/app -name "*.log" -size +100M -exec truncate -s 50M {} \; 2>/dev/null

# OS update + reboot — 1st Sunday of the month at 04:00
# (after the weekly backup at 03:00 — reboot is unconditional)
# "day-of-month <= 7" + "day-of-week = 0" = 1st Sunday of the month
0 4 1-7 * 0 /home/atd/apps/update-server.sh >> /srv/atd/logs/cron/update-server.log 2>&1

# ATD-END
CRON_EOF

# ── Remove previous ATD block (if any) then append new one ───────────────────
echo "📋  Installing ATD crontab entries…"

# Get current crontab (ignore error if empty)
CURRENT_CRON="$(crontab -l 2>/dev/null || true)"

# Strip existing ATD block using awk (remove lines between # ATD-BEGIN and # ATD-END inclusive)
STRIPPED_CRON="$(echo "${CURRENT_CRON}" | awk '
  /^# ATD-BEGIN/ { skip=1 }
  !skip { print }
  /^# ATD-END/ { skip=0 }
')"

# Install combined crontab
{
  echo "${STRIPPED_CRON}"
  echo ""
  echo "${ATD_CRON_BLOCK}"
} | crontab -

echo ""
echo "✅  Crontab installed. Current ATD entries:"
echo "────────────────────────────────────────────"
crontab -l | grep -A 20 "# ATD-BEGIN" || echo "(not found — something went wrong)"
echo "────────────────────────────────────────────"
echo ""
echo "ℹ️   Cron log (backups)  : ${CRON_LOG}"
echo "    Cron log (updates)  : /srv/atd/logs/cron/update-server.log"
echo "    To check next run   : crontab -l"
echo "    To remove all ATD crons: crontab -e → delete # ATD-BEGIN ... # ATD-END block"
