#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/prod/setup-server.sh
#
# PURPOSE
#   First-time provisioning of the production server.
#   Run this ONCE after a fresh Ubuntu 24.04 install, before any deploy.
#   Idempotent: safe to re-run if interrupted.
#
# WHAT IT DOES
#   Step 1  — System update + required packages
#   Step 2  — Docker Engine (official repo, not snap)
#   Step 3  — Tailscale (LAN → GitHub Actions tunnel)
#   Step 4  — /srv/atd/ directory structure (persistent volumes)
#   Step 5  — ~/apps/ directory structure (compose + scripts + env)
#   Step 6  — Copy prod scripts from repo to ~/apps/
#   Step 7  — Install docker-compose.prod.yml to ~/apps/
#   Step 8  — Print next steps (secrets + first deploy)
#
# WHY this script exists and why it is versioned in the repo
#   - Reproducibility: if the Dell dies, you rebuild the server in ~10 minutes
#   - No manual steps to forget or get wrong
#   - Reviewed in git like any other code
#
# WHY NOT push this via CD?
#   This is a ONE-TIME provisioning script. After the server is set up,
#   all deploys go through deploy.sh (called by atd-deploy.yml).
#   You never need to re-run setup-server.sh unless you rebuild the OS.
#
# USAGE (on the Dell, as user atd)
#   # Copy to Dell:
#   scp scripts/prod/setup-server.sh atd@alphatradingdesk.local:~/setup-server.sh
#   # Run:
#   chmod +x ~/setup-server.sh
#   ~/setup-server.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APPS_DIR="$HOME/apps"
ATD_DATA_DIR="/srv/atd"
GHCR_OWNER="${GHCR_OWNER:-mohamedredalyoubi}"   # ← change if org changes

echo "══════════════════════════════════════════════════"
echo "  ATD — Server provisioning"
echo "  Host: $(hostname) | User: $(whoami)"
echo "══════════════════════════════════════════════════"
echo ""

# ── Step 1: System update ─────────────────────────────────────────────────────
echo "▶  Step 1/8 — System update + packages"
sudo apt-get update -q
sudo apt-get upgrade -y -q
sudo apt-get install -y -q \
  curl wget htop ncdu tree \
  ufw fail2ban \
  avahi-daemon \
  ca-certificates gnupg lsb-release \
  jq

# Enable mDNS (.local DNS resolution on the LAN)
sudo systemctl enable --now avahi-daemon

# Firewall: allow SSH first (avoid locking yourself out), then port 80
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw --force enable
echo "    ✅ UFW: SSH + port 80 allowed"

# fail2ban: protects SSH from brute-force (defaults are fine for LAN)
sudo systemctl enable --now fail2ban
echo "    ✅ fail2ban enabled"
echo ""

# ── Step 2: Docker Engine ────────────────────────────────────────────────────
echo "▶  Step 2/8 — Docker Engine (official repo)"
if command -v docker &>/dev/null; then
  echo "    ℹ️  Docker already installed: $(docker --version)"
else
  # Remove any conflicting packages (snap docker, podman, etc.)
  for pkg in docker.io docker-doc docker-compose podman-docker containerd runc; do
    sudo apt-get remove -y "$pkg" 2>/dev/null || true
  done

  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
    https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -q
  sudo apt-get install -y -q \
    docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  echo "    ✅ Docker installed: $(docker --version)"
fi

# Allow current user to run docker without sudo
sudo usermod -aG docker "$(whoami)"
echo "    ✅ User $(whoami) added to docker group"

# Enable Docker to start on boot
sudo systemctl enable docker
echo "    ✅ Docker enabled on boot"
echo ""

# ── Step 3: Tailscale ────────────────────────────────────────────────────────
echo "▶  Step 3/8 — Tailscale (GitHub Actions → LAN tunnel)"
if command -v tailscale &>/dev/null; then
  echo "    ℹ️  Tailscale already installed: $(tailscale version)"
else
  curl -fsSL https://tailscale.com/install.sh | sh
  echo "    ✅ Tailscale installed"
fi

echo ""
echo "    ⚠️   ACTION REQUIRED: authenticate Tailscale"
echo "    Run: sudo tailscale up"
echo "    Then open the auth URL in your browser."
echo "    After auth: tailscale ip -4  → note the 100.x.x.x IP"
echo "    Set this IP as DELL_HOST in GitHub Secrets."
echo ""

# ── Step 4: /srv/atd/ persistent volume directories ──────────────────────────
echo "▶  Step 4/8 — Creating /srv/atd/ structure"
sudo mkdir -p \
  "${ATD_DATA_DIR}/data/postgres" \
  "${ATD_DATA_DIR}/data/uploads" \
  "${ATD_DATA_DIR}/logs/app" \
  "${ATD_DATA_DIR}/logs/cron" \
  "${ATD_DATA_DIR}/backups/rolling" \
  "${ATD_DATA_DIR}/backups/weekly"

sudo chown -R "$(whoami):$(whoami)" "${ATD_DATA_DIR}"
sudo chmod -R 750 "${ATD_DATA_DIR}"
echo "    ✅ Directories created:"
find "${ATD_DATA_DIR}" -type d | sed 's/^/       /'
echo ""

# ── Step 5: ~/apps/ structure ────────────────────────────────────────────────
echo "▶  Step 5/8 — Creating ~/apps/ structure"
mkdir -p "${APPS_DIR}"

# Create .env template if not already present (never overwrite — user fills secrets)
ENV_FILE="${APPS_DIR}/.env"
if [ ! -f "${ENV_FILE}" ]; then
  cat > "${ENV_FILE}" <<EOF
# AlphaTradingDesk — Production secrets
# Fill in ALL values before the first deploy.
# chmod 600 ~/apps/.env

POSTGRES_DB=atd_prod
POSTGRES_USER=atd
POSTGRES_PASSWORD=CHANGE_ME_$(openssl rand -hex 8)
SECRET_KEY=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
APP_ENV=prod
ALLOWED_ORIGINS=http://alphatradingdesk.local,http://192.168.1.100
DATABASE_URL=postgresql://atd:CHANGE_ME@db:5432/atd_prod
EOF
  chmod 600 "${ENV_FILE}"
  echo "    ✅ ${ENV_FILE} created (template — fill POSTGRES_PASSWORD)"
else
  echo "    ℹ️  ${ENV_FILE} already exists — not overwritten"
fi

# ── Step 6: Copy prod scripts from this checkout ─────────────────────────────
# This script is run from a local copy of the repo (scp'd to the Dell).
# After first run, scripts are served from the repo at deploy time via
# the setup-cron.sh call in atd-deploy.yml (if configured).
echo "▶  Step 6/8 — Installing prod scripts to ~/apps/"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for script in deploy.sh backup-db.sh setup-cron.sh healthcheck.sh; do
  if [ -f "${SCRIPT_DIR}/${script}" ]; then
    cp "${SCRIPT_DIR}/${script}" "${APPS_DIR}/${script}"
    chmod +x "${APPS_DIR}/${script}"
    echo "    ✅ Installed: ~/apps/${script}"
  else
    echo "    ⚠️  ${script} not found in ${SCRIPT_DIR} — skipping"
  fi
done
echo ""

# ── Step 7: docker-compose.prod.yml ─────────────────────────────────────────
echo "▶  Step 7/8 — Installing docker-compose.prod.yml to ~/apps/"
COMPOSE_FILE="${APPS_DIR}/docker-compose.prod.yml"

if [ -f "${COMPOSE_FILE}" ]; then
  echo "    ℹ️  Already exists — not overwritten"
else
  cat > "${COMPOSE_FILE}" <<COMPOSE_EOF
# ~/apps/docker-compose.prod.yml
# Images pulled from GHCR — never built on this server.
# IMAGE_TAG and GHCR_OWNER are injected by deploy.sh at runtime.

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    env_file: /srv/atd/.env.db
    volumes:
      - /srv/atd/data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U atd -d atd_prod"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

  backend:
    image: ghcr.io/\${GHCR_OWNER}/atd-backend:\${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: /home/atd/apps/.env
    environment:
      DATABASE_URL: postgresql://atd:\${POSTGRES_PASSWORD}@db:5432/atd_prod
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - /srv/atd/data/uploads:/app/uploads
      - /srv/atd/logs/app:/app/logs
    ports:
      - "8000:8000"
    logging:
      driver: json-file
      options: { max-size: "20m", max-file: "5" }

  frontend:
    image: ghcr.io/\${GHCR_OWNER}/atd-frontend:\${IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
COMPOSE_EOF
  echo "    ✅ docker-compose.prod.yml created"
fi

# Create DB-only env file for the postgres container init
DB_ENV="/srv/atd/.env.db"
if [ ! -f "${DB_ENV}" ]; then
  # Extract POSTGRES_* values from the main .env
  grep "^POSTGRES_" "${ENV_FILE}" > "${DB_ENV}" 2>/dev/null || true
  chmod 600 "${DB_ENV}"
  echo "    ✅ /srv/atd/.env.db created from ~/apps/.env"
fi
echo ""

# ── Step 8: Next steps ───────────────────────────────────────────────────────
echo "══════════════════════════════════════════════════"
echo "  ✅  Server provisioning complete!"
echo ""
echo "  NEXT STEPS (manual — required before first deploy)"
echo ""
echo "  1. Authenticate Tailscale:"
echo "     sudo tailscale up"
echo "     tailscale ip -4   → note the 100.x.x.x IP"
echo ""
echo "  2. Set GitHub Secrets (repo Settings → Secrets → Actions):"
echo "     DELL_HOST        = <Tailscale IP 100.x.x.x>"
echo "     DELL_USER        = $(whoami)"
echo "     DELL_SSH_KEY     = <private key — see docs/deployment/SERVER_SETUP.md §8.2>"
echo "     TAILSCALE_AUTHKEY = <reusable authkey from https://login.tailscale.com/admin/settings/keys>"
echo ""
echo "  3. Fill in the DB password in ~/apps/.env:"
echo "     nano ~/apps/.env    # change POSTGRES_PASSWORD"
echo "     grep POSTGRES_PASSWORD ~/apps/.env >> /srv/atd/.env.db  # sync to db env file"
echo ""
echo "  4. Set up cron jobs:"
echo "     ~/apps/setup-cron.sh"
echo ""
echo "  5. First deploy (pull images + start stack):"
echo "     GHCR_OWNER=${GHCR_OWNER} ~/apps/deploy.sh latest"
echo ""
echo "  6. Seed reference data:"
echo "     docker compose -f ~/apps/docker-compose.prod.yml exec backend \\"
echo "       python -m database.migrations.seeds.seed_all"
echo ""
echo "  7. Verify:"
echo "     ~/apps/healthcheck.sh"
echo "     open http://alphatradingdesk.local"
echo "══════════════════════════════════════════════════"
echo ""
echo "  ⚠️   Reconnect your SSH session for the docker group change to take effect:"
echo "     exit  then  ssh atd"
