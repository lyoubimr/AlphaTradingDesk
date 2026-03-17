#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/setup-sudoers.sh
#
# PURPOSE
#   Install passwordless sudo rules for the 'atd' service account.
#   Required by update-server.sh, which runs apt-get and reboot from cron
#   (no interactive terminal available → sudo prompts for password → fails).
#
# WHAT IT INSTALLS
#   /etc/sudoers.d/atd  — NOPASSWD rules for:
#     - /usr/bin/apt-get   (OS package management)
#     - /sbin/reboot       (controlled reboot after updates)
#     - /usr/sbin/reboot   (same, different path on some Ubuntu versions)
#
# WHY NOT FULL SUDO?
#   'atd' is a dedicated service account. Granting it only the required
#   commands follows the principle of least privilege: it can update packages
#   and reboot — nothing else.  No shell, no file writes outside its own dirs.
#
# USAGE (run on the Dell, as root)
#   sudo bash ~/apps/setup-sudoers.sh           # default user: atd
#   sudo bash ~/apps/setup-sudoers.sh myuser    # explicit username
#
# PREREQUISITES
#   - User 'atd' must already exist (created during initial server setup)
#   - Must be run as root
#   - visudo must be installed (included in Ubuntu by default)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ATD_USER="${1:-atd}"
SUDOERS_FILE="/etc/sudoers.d/${ATD_USER}"

# ── Guard: must run as root ───────────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
  echo "❌  This script must be run as root." >&2
  echo "    Usage: sudo bash ~/apps/setup-sudoers.sh" >&2
  exit 1
fi

# ── Guard: user must exist ────────────────────────────────────────────────────
if ! id "${ATD_USER}" &>/dev/null; then
  echo "❌  User '${ATD_USER}' does not exist." >&2
  echo "    Ensure the service account was created during initial server setup." >&2
  exit 1
fi

echo "⚙️   Installing sudoers rules for user: ${ATD_USER}"
echo "    Target file: ${SUDOERS_FILE}"

# ── Write sudoers fragment ────────────────────────────────────────────────────
# Use a temp file + visudo validation before placing in /etc/sudoers.d/
# to prevent a broken sudoers from locking root out.
TEMP_FILE="$(mktemp)"
trap 'rm -f "${TEMP_FILE}"' EXIT

cat > "${TEMP_FILE}" << EOF
# AlphaTradingDesk — passwordless sudo for service account '${ATD_USER}'
# Managed by setup-sudoers.sh — do not edit manually
#
# Allows the ATD service account to run OS package updates and reboot
# from cron (no TTY available → password prompt would make cron job fail).
# Restricted to the minimum required commands only.

${ATD_USER} ALL=(ALL) NOPASSWD: /usr/bin/apt-get
${ATD_USER} ALL=(ALL) NOPASSWD: /sbin/reboot
${ATD_USER} ALL=(ALL) NOPASSWD: /usr/sbin/reboot
EOF

# ── Validate syntax before activating ────────────────────────────────────────
echo "🔍  Validating sudoers syntax…"
if visudo -cf "${TEMP_FILE}"; then
  cp "${TEMP_FILE}" "${SUDOERS_FILE}"
  chmod 440 "${SUDOERS_FILE}"
  echo ""
  echo "✅  Sudoers installed: ${SUDOERS_FILE}"
  echo "    '${ATD_USER}' can now run apt-get and reboot without a password."
  echo ""
  echo "    Verify:"
  echo "      sudo -u ${ATD_USER} sudo -n apt-get --version"
  echo "      sudo -u ${ATD_USER} sudo -n reboot --help 2>&1 | head -1"
else
  echo "❌  Syntax validation failed — no changes made." >&2
  exit 1
fi
