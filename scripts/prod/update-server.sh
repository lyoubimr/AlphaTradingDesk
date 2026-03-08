#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/update-server.sh
#
# PURPOSE
#   Apply OS security and package updates on the Dell production server,
#   then reboot — regardless of whether updates were available.
#
# WHAT IT DOES
#   1. apt update          — refresh package index
#   2. apt upgrade -y      — apply all available updates (non-interactive)
#   3. apt autoremove -y   — remove unused packages
#   4. apt autoclean       — free downloaded package cache
#   5. Log the full run to /srv/atd/logs/cron/update-server.log
#   6. Reboot unconditionally (scheduled: 1st Sunday of month at 04:00)
#
# WHY UNCONDITIONAL REBOOT?
#   A reboot ensures: kernel updates are applied, memory leaks cleared,
#   and all services restart cleanly. Docker containers come back up
#   automatically via `restart: unless-stopped` + `systemctl enable docker`.
#   Scheduled at 04:00 → after the weekly backup (03:00) and any backlog
#   of backup I/O has completed.
#
# USAGE
#   Called automatically by cron (see setup-cron.sh):
#     1st Sunday of each month at 04:00
#
#   Manual run (as atd on Dell):
#     ~/apps/update-server.sh
#
# LOG
#   /srv/atd/logs/cron/update-server.log
#   Rotation: kept to last 500 lines at the start of each run.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

LOG_FILE="/srv/atd/logs/cron/update-server.log"
LOG_DIR="$(dirname "${LOG_FILE}")"

# ── Ensure log directory exists ───────────────────────────────────────────────
mkdir -p "${LOG_DIR}"

# ── Rotate log — keep last 500 lines ─────────────────────────────────────────
if [[ -f "${LOG_FILE}" ]]; then
  tail -n 500 "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
fi

# ── All output (stdout + stderr) goes to log + console ───────────────────────
exec >> "${LOG_FILE}" 2>&1

echo ""
echo "══════════════════════════════════════════════════"
echo "  ATD — OS update + reboot"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════"

# ── Step 1 — Refresh package index ───────────────────────────────────────────
echo ""
echo "▶  apt update…"
sudo apt-get update -q

# ── Step 2 — Apply all updates (non-interactive) ─────────────────────────────
echo ""
echo "▶  apt upgrade…"
DEBIAN_FRONTEND=noninteractive sudo apt-get upgrade -y -q \
  -o Dpkg::Options::="--force-confold" \
  -o Dpkg::Options::="--force-confdef"

# ── Step 3 — Remove unused packages ──────────────────────────────────────────
echo ""
echo "▶  apt autoremove…"
sudo apt-get autoremove -y -q

# ── Step 4 — Clean package cache ─────────────────────────────────────────────
echo ""
echo "▶  apt autoclean…"
sudo apt-get autoclean -q

# ── Step 5 — Docker image prune (keep disk clean) ─────────────────────────────
echo ""
echo "▶  Docker image prune (dangling images older than 72h)…"
docker image prune -f --filter "until=72h" || true

# ── Step 6 — Summary ─────────────────────────────────────────────────────────
echo ""
echo "✅  Update complete — $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "▶  Disk usage:"
df -h /srv/atd | tail -1
echo ""
echo "▶  Rebooting in 10 seconds…"
echo "   (containers will restart automatically via restart: unless-stopped)"
echo "══════════════════════════════════════════════════"

# ── Step 7 — Reboot ──────────────────────────────────────────────────────────
sleep 10
sudo reboot
