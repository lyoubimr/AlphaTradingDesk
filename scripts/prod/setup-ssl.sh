#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/setup-ssl.sh
#
# PURPOSE
#   Generate a self-signed TLS certificate for the AlphaTradingDesk LAN server.
#   The certificate covers both the mDNS hostname and the fixed LAN IP via SAN
#   (Subject Alternative Names), so modern browsers accept it without errors
#   once the cert is trusted in the OS keychain.
#
# WHAT IT DOES
#   1. Creates /srv/atd/certs/ (if not already present)
#   2. Generates a 10-year self-signed cert (atd.crt + atd.key) with SAN for:
#        - alphatradingdesk.local  (mDNS hostname used on macOS/iOS)
#        - 192.168.1.100           (LAN IP — for devices that use IP directly)
#   3. Sets strict permissions (cert: 644, key: 600)
#   4. Prints instructions to trust the cert on macOS and iOS
#
# WHY SELF-SIGNED (not Let's Encrypt)?
#   Let's Encrypt requires a publicly reachable domain for its HTTP/DNS challenge.
#   *.local domains are mDNS-only (RFC 6762) — they have no public DNS record.
#   A self-signed cert with SAN is the correct solution for LAN-only deployments.
#
# HOW TO MAKE BROWSERS TRUST IT (no security warnings):
#   macOS:
#     1. scp atd@alphatradingdesk.local:/srv/atd/certs/atd.crt ~/Downloads/atd.crt
#     2. sudo security add-trusted-cert -d -r trustRoot \
#            -k /Library/Keychains/System.keychain ~/Downloads/atd.crt
#     → Chrome, Safari, curl all accept it immediately
#
#   iOS / iPadOS:
#     1. scp the .crt to Mac, then AirDrop it to iPhone/iPad
#     2. Settings → General → VPN & Device Management → install the profile
#     3. Settings → General → About → Certificate Trust Settings → enable full trust
#
#   Windows:
#     1. Copy atd.crt to Windows
#     2. Double-click → Install certificate → Local Machine → Trusted Root CAs
#
# USAGE (run once on the Dell, as user atd)
#   chmod +x ~/apps/setup-ssl.sh
#   ~/apps/setup-ssl.sh
#
# RE-RUN BEHAVIOUR
#   If /srv/atd/certs/atd.crt already exists, the script skips generation
#   and only prints the trust instructions again.
#   To force regeneration: rm /srv/atd/certs/atd.{crt,key} && ~/apps/setup-ssl.sh
#
# AFTER RUNNING THIS SCRIPT
#   Update docker-compose.prod.yml frontend service (see SERVER_SETUP.md §7.6):
#     ports:  - "443:443"   (add alongside "80:80")
#     volumes:
#       - /srv/atd/certs:/etc/nginx/certs:ro
#   Then: docker compose -f ~/apps/docker-compose.prod.yml up -d frontend
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CERT_DIR="/srv/atd/certs"
CERT_FILE="${CERT_DIR}/atd.crt"
KEY_FILE="${CERT_DIR}/atd.key"
DAYS=3650          # 10 years — avoids expiry hassle on a LAN-only cert
HOSTNAME="alphatradingdesk.local"
LAN_IP="192.168.1.100"

echo "══════════════════════════════════════════════════"
echo "  ATD — SSL certificate setup"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════════════════"

# ── Guard: skip if cert already exists ───────────────────────────────────────
if [[ -f "${CERT_FILE}" ]]; then
  echo ""
  echo "ℹ️   Certificate already exists: ${CERT_FILE}"
  echo "    Expiry: $(openssl x509 -noout -enddate -in "${CERT_FILE}" | cut -d= -f2)"
  echo ""
  echo "    To regenerate: rm ${CERT_FILE} ${KEY_FILE} && ~/apps/setup-ssl.sh"
  echo ""
  _TRUST_ONLY=true
else
  _TRUST_ONLY=false
fi

# ── Create directory ──────────────────────────────────────────────────────────
if [[ "${_TRUST_ONLY}" == "false" ]]; then
  mkdir -p "${CERT_DIR}"

  echo ""
  echo "▶  Generating self-signed certificate…"
  echo "   Hostname : ${HOSTNAME}"
  echo "   LAN IP   : ${LAN_IP}"
  echo "   Validity : ${DAYS} days (~10 years)"
  echo ""

  # Generate private key + certificate in one command.
  # -subj sets the certificate subject (CN only).
  # -addext "subjectAltName=..." adds the SAN extension (required by modern browsers).
  openssl req -x509 -newkey rsa:4096 -sha256 \
    -days "${DAYS}" \
    -nodes \
    -keyout "${KEY_FILE}" \
    -out "${CERT_FILE}" \
    -subj "/CN=${HOSTNAME}/O=AlphaTradingDesk/OU=LAN" \
    -addext "subjectAltName=DNS:${HOSTNAME},IP:${LAN_IP}"

  # Set strict permissions
  chmod 644 "${CERT_FILE}"
  chmod 600 "${KEY_FILE}"

  echo "✅  Certificate generated:"
  echo "    ${CERT_FILE}  (cert — mount into Nginx container)"
  echo "    ${KEY_FILE}   (private key — never share)"
  echo ""
  echo "    Fingerprint:"
  openssl x509 -noout -fingerprint -sha256 -in "${CERT_FILE}"
fi

# ── Post-setup instructions ───────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo "  📋  NEXT STEPS"
echo "══════════════════════════════════════════════════"
echo ""
echo "1. Open UFW port 443 (if not already done):"
echo "   sudo ufw allow 443/tcp"
echo "   sudo ufw status"
echo ""
echo "2. Update docker-compose.prod.yml — frontend service:"
echo "   ports:"
echo '     - "80:80"'
echo '     - "443:443"   ← add this'
echo "   volumes:"
echo "     - /srv/atd/certs:/etc/nginx/certs:ro   ← add this"
echo ""
echo "3. Restart the frontend container:"
echo "   docker compose -f ~/apps/docker-compose.prod.yml up -d frontend"
echo ""
echo "4. Trust the certificate on your Mac:"
echo "   # Download the cert:"
echo "   scp atd@alphatradingdesk.local:${CERT_FILE} ~/Downloads/atd.crt"
echo "   # Trust it (requires sudo):"
echo "   sudo security add-trusted-cert -d -r trustRoot \\"
echo "        -k /Library/Keychains/System.keychain ~/Downloads/atd.crt"
echo "   # Restart Chrome/Safari → no more warning"
echo ""
echo "5. Test:"
echo "   curl -k https://alphatradingdesk.local/api/health"
echo "   # After trusting: curl https://alphatradingdesk.local/api/health"
echo ""
echo "══════════════════════════════════════════════════"
