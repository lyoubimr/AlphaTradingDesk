#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/sync-remote-backups.sh
#
# PURPOSE
#   Pull production DB backups from a remote server to the local machine.
#   Keeps a local copy of the rolling + weekly archives so you have an
#   off-machine backup even if the remote server is destroyed.
#
# WHAT IT DOES
#   1. rsync rolling/ + weekly/ from REMOTE_SSH:REMOTE_BACKUP_DIR → LOCAL_BACKUP_DIR
#   2. Local rotation: mirrors the remote retention policy
#      rolling → keep 48 files  (~12 days at 6h interval)
#      weekly  → keep 13 files  (~3 months)
#   3. Logs every run to LOCAL_LOG_FILE (auto-rotated at 500 KB)
#   4. Silent / exit 0 when the remote is unreachable (SSH timeout)
#      — safe to run as a scheduled task when the server may be offline
#
# SCHEDULING (--install / --uninstall / --status)
#   macOS  → installs a LaunchAgent (~/Library/LaunchAgents/com.atd.sync-backups.plist)
#            runs every 6h (StartInterval 21600); fires at next boot if missed
#   Linux  → installs a crontab entry (0 */6 * * *)
#
# USAGE
#   scripts/sync-remote-backups.sh                  # manual sync
#   scripts/sync-remote-backups.sh --dry-run        # show what would happen, touch nothing
#   scripts/sync-remote-backups.sh --install        # set up scheduled task
#   scripts/sync-remote-backups.sh --uninstall      # remove scheduled task
#   scripts/sync-remote-backups.sh --status         # show scheduler + last log lines
#
# CONFIGURATION (override via env vars or edit defaults below)
#   REMOTE_SSH          SSH alias or user@host  (default: atd)
#   REMOTE_BACKUP_DIR   path on remote server   (default: /srv/atd/backups)
#   LOCAL_BACKUP_DIR    path on local machine   (default: ~/Backups/AlphaTradingDesk)
#   LOCAL_LOG_FILE      log file path           (default: ~/Library/Logs/atd-rsync.log
#                                                      or ~/.local/log/atd-rsync.log)
#   SSH_TIMEOUT         seconds before giving up (default: 10)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Defaults (override via env) ───────────────────────────────────────────────
REMOTE_SSH="${REMOTE_SSH:-atd}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-/srv/atd/backups}"
LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-$HOME/Backups/AlphaTradingDesk}"
SSH_TIMEOUT="${SSH_TIMEOUT:-10}"

# Log location — macOS uses ~/Library/Logs, Linux falls back to ~/.local/log
if [[ "$(uname)" == "Darwin" ]]; then
  DEFAULT_LOG="$HOME/Library/Logs/atd-rsync.log"
else
  DEFAULT_LOG="$HOME/.local/log/atd-rsync.log"
fi
LOCAL_LOG_FILE="${LOCAL_LOG_FILE:-$DEFAULT_LOG}"

# Retention (number of files to keep locally — mirrors remote policy)
KEEP_ROLLING=48
KEEP_WEEKLY=13

# LaunchAgent identifier (macOS)
LAUNCH_AGENT_ID="com.atd.sync-backups"
LAUNCH_AGENT_PLIST="$HOME/Library/LaunchAgents/${LAUNCH_AGENT_ID}.plist"

# ── Helpers ───────────────────────────────────────────────────────────────────
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
DRY_RUN=false

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "${msg}"
  # Rotate log if > 500 KB
  if [[ -f "${LOCAL_LOG_FILE}" ]] && (( $(stat -f%z "${LOCAL_LOG_FILE}" 2>/dev/null || stat -c%s "${LOCAL_LOG_FILE}" 2>/dev/null || echo 0) > 512000 )); then
    mv "${LOCAL_LOG_FILE}" "${LOCAL_LOG_FILE}.old"
  fi
  echo "${msg}" >> "${LOCAL_LOG_FILE}" 2>/dev/null || true
}

die() { echo "❌  $*" >&2; exit 1; }

rotate_local() {
  local dir="$1"
  local keep="$2"
  local deleted
  # ls -1t: newest first; tail -n +N: skip first N → files to delete
  deleted=$(ls -1t "${dir}"/*.sql.gz 2>/dev/null | tail -n +"$((keep + 1))" | xargs -r rm -v -- | wc -l || echo 0)
  [[ "${deleted}" -gt 0 ]] && log "  rotated ${deleted} old local file(s) in $(basename "${dir}")"
}

# ── Argument parsing ──────────────────────────────────────────────────────────
ACTION="sync"
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=true ;;
    --install)   ACTION="install" ;;
    --uninstall) ACTION="uninstall" ;;
    --status)    ACTION="status" ;;
    --help|-h)
      sed -n '3,32p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
      exit 0
      ;;
    *) die "Unknown argument: $arg  (use --help)" ;;
  esac
done

# ── INSTALL ───────────────────────────────────────────────────────────────────
install_scheduler() {
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "▶  Installing LaunchAgent: ${LAUNCH_AGENT_ID}"
    mkdir -p "$(dirname "${LAUNCH_AGENT_PLIST}")"
    cat > "${LAUNCH_AGENT_PLIST}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_ID}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SCRIPT_PATH}</string>
  </array>

  <!-- Run every 6 hours (21600 seconds).
       Unlike StartCalendarInterval, StartInterval fires relative to when
       the agent was loaded — so it works correctly even when the Mac was
       off at the scheduled time. macOS will also catch up on missed runs
       at the next boot (ThrottleInterval ensures no double-run spam). -->
  <key>StartInterval</key>
  <integer>21600</integer>

  <!-- Do NOT run immediately on load (first run after 6h) -->
  <key>RunAtLoad</key> <false/>

  <key>StandardOutPath</key>
  <string>${LOCAL_LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOCAL_LOG_FILE}</string>

  <!-- Keep trying if the job exits non-zero (network may not be up yet) -->
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key> <false/>
  </dict>
</dict>
</plist>
PLIST
    launchctl load "${LAUNCH_AGENT_PLIST}" 2>/dev/null && \
      echo "  ✅  LaunchAgent loaded — will run every 6h" || \
      echo "  ✅  Plist written — run: launchctl load ${LAUNCH_AGENT_PLIST}"
  else
    # Linux — add crontab entry
    local cron_line="0 */6 * * * bash ${SCRIPT_PATH} >> ${LOCAL_LOG_FILE} 2>&1"
    if crontab -l 2>/dev/null | grep -qF "${SCRIPT_PATH}"; then
      echo "  ℹ️  Cron entry already present — nothing changed"
    else
      ( crontab -l 2>/dev/null; echo "${cron_line}" ) | crontab -
      echo "  ✅  Cron entry added: ${cron_line}"
    fi
  fi
}

# ── UNINSTALL ─────────────────────────────────────────────────────────────────
uninstall_scheduler() {
  if [[ "$(uname)" == "Darwin" ]]; then
    if [[ -f "${LAUNCH_AGENT_PLIST}" ]]; then
      launchctl unload "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true
      rm -f "${LAUNCH_AGENT_PLIST}"
      echo "✅  LaunchAgent removed"
    else
      echo "ℹ️  LaunchAgent not installed"
    fi
  else
    if crontab -l 2>/dev/null | grep -qF "${SCRIPT_PATH}"; then
      crontab -l 2>/dev/null | grep -vF "${SCRIPT_PATH}" | crontab -
      echo "✅  Cron entry removed"
    else
      echo "ℹ️  No cron entry found"
    fi
  fi
}

# ── STATUS ────────────────────────────────────────────────────────────────────
show_status() {
  echo "══════════════════════════════════════════════════"
  echo "  ATD — Remote backup sync status"
  echo "══════════════════════════════════════════════════"
  echo ""
  echo "▶  Config"
  echo "   Remote:    ${REMOTE_SSH}:${REMOTE_BACKUP_DIR}"
  echo "   Local:     ${LOCAL_BACKUP_DIR}"
  echo "   Log:       ${LOCAL_LOG_FILE}"
  echo "   Script:    ${SCRIPT_PATH}"
  echo ""

  echo "▶  Scheduler"
  if [[ "$(uname)" == "Darwin" ]]; then
    if [[ -f "${LAUNCH_AGENT_PLIST}" ]]; then
      echo "   ✅  LaunchAgent installed (every 6h)"
      launchctl list | grep "${LAUNCH_AGENT_ID}" | sed 's/^/   /' || echo "   (not loaded yet)"
    else
      echo "   ❌  LaunchAgent NOT installed — run: $0 --install"
    fi
  else
    if crontab -l 2>/dev/null | grep -qF "${SCRIPT_PATH}"; then
      echo "   ✅  Cron entry present"
      crontab -l | grep "${SCRIPT_PATH}" | sed 's/^/   /'
    else
      echo "   ❌  No cron entry — run: $0 --install"
    fi
  fi
  echo ""

  echo "▶  Local files"
  for mode in rolling weekly; do
    local dir="${LOCAL_BACKUP_DIR}/${mode}"
    if [[ -d "${dir}" ]]; then
      local count
      count=$(ls -1 "${dir}"/*.sql.gz 2>/dev/null | wc -l || echo 0)
      local latest
      latest=$(ls -1t "${dir}"/*.sql.gz 2>/dev/null | head -1 || true)
      if [[ -n "${latest}" ]]; then
        local age_h
        if [[ "$(uname)" == "Darwin" ]]; then
          age_h=$(( ( $(date +%s) - $(stat -f%m "${latest}") ) / 3600 ))
        else
          age_h=$(( ( $(date +%s) - $(stat -c%Y "${latest}") ) / 3600 ))
        fi
        echo "   ${mode}: ${count} files — latest: $(basename "${latest}") (${age_h}h ago)"
      else
        echo "   ${mode}: empty"
      fi
    else
      echo "   ${mode}: directory not found"
    fi
  done
  echo ""

  echo "▶  Last 10 log lines"
  if [[ -f "${LOCAL_LOG_FILE}" ]]; then
    tail -10 "${LOCAL_LOG_FILE}" | sed 's/^/   /'
  else
    echo "   (no log file yet)"
  fi
  echo ""
}

# ── Dispatch non-sync actions ─────────────────────────────────────────────────
case "${ACTION}" in
  install)   install_scheduler; exit 0 ;;
  uninstall) uninstall_scheduler; exit 0 ;;
  status)    show_status; exit 0 ;;
esac

# ── SYNC ──────────────────────────────────────────────────────────────────────
mkdir -p "$(dirname "${LOCAL_LOG_FILE}")" 2>/dev/null || true

log "════ sync-remote-backups START ════"
$DRY_RUN && log "  ⚠️  DRY-RUN — nothing will be written"

# 1. Check SSH reachability (fast timeout — don't block if server is off)
log "  Checking SSH to '${REMOTE_SSH}'…"
if ! ssh -q \
     -o BatchMode=yes \
     -o ConnectTimeout="${SSH_TIMEOUT}" \
     -o StrictHostKeyChecking=no \
     "${REMOTE_SSH}" exit 2>/dev/null; then
  log "  ⚠️  Remote '${REMOTE_SSH}' unreachable — skipping sync (will retry next run)"
  log "════ sync-remote-backups END (skipped) ════"
  exit 0
fi
log "  ✅  Remote reachable"

# 2. Create local directories
mkdir -p "${LOCAL_BACKUP_DIR}/rolling" "${LOCAL_BACKUP_DIR}/weekly"

# 3. rsync each mode
for mode in rolling weekly; do
  remote_path="${REMOTE_SSH}:${REMOTE_BACKUP_DIR}/${mode}/"
  local_path="${LOCAL_BACKUP_DIR}/${mode}/"

  log "  rsync ${mode}: ${remote_path} → ${local_path}"

  if $DRY_RUN; then
    rsync -az --dry-run --stats \
      -e "ssh -o ConnectTimeout=${SSH_TIMEOUT} -o BatchMode=yes" \
      "${remote_path}" "${local_path}" 2>&1 | grep -E "^(Number|Total|sent|received)" | \
      sed 's/^/    /' || true
  else
    rsync -az --stats \
      -e "ssh -o ConnectTimeout=${SSH_TIMEOUT} -o BatchMode=yes" \
      "${remote_path}" "${local_path}" 2>&1 | grep -E "^(Number|Total|sent|received)" | \
      sed 's/^/    /' | while IFS= read -r line; do log "${line}"; done || true
  fi
done

# 4. Local rotation (keep same window as remote)
if ! $DRY_RUN; then
  rotate_local "${LOCAL_BACKUP_DIR}/rolling" "${KEEP_ROLLING}"
  rotate_local "${LOCAL_BACKUP_DIR}/weekly"  "${KEEP_WEEKLY}"
fi

# 5. Summary
ROLLING_COUNT=$(ls -1 "${LOCAL_BACKUP_DIR}/rolling/"*.sql.gz 2>/dev/null | wc -l || echo 0)
WEEKLY_COUNT=$(ls -1  "${LOCAL_BACKUP_DIR}/weekly/"*.sql.gz  2>/dev/null | wc -l || echo 0)
log "  Local totals — rolling: ${ROLLING_COUNT} files | weekly: ${WEEKLY_COUNT} files"
log "════ sync-remote-backups END ════"
