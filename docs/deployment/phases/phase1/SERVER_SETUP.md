# 🖥️ Server Setup — AlphaTradingDesk Phase 1

**Date:** March 2026 — v3.0  
**Hardware:** Dell OptiPlex Micro (D09U) — Core i7, 65W  
**MAC address:** `18:66:DA:13:01:9D` — Fixed LAN IP: `192.168.1.100`  
**Target OS:** Ubuntu Server 24.04 LTS (headless)  
**Deploy model:** Pull pre-built Docker images from GHCR — Dell **never** builds anything

> 📌 **This doc contains values specific to THIS deployment** — adapt them if you
> reinstall on different hardware:
>
> | Value in this doc | What it is | Replace with |
> |-------------------|-----------|--------------|
> | `192.168.1.100` | Dell fixed LAN IP | your server's IP |
> | `18:66:DA:13:01:9D` | ethernet NIC MAC address | your NIC's MAC |
> | `alphatradingdesk.local` | mDNS hostname | the hostname chosen during Ubuntu install |
> | `192.168.1.1` | router gateway | your network's gateway |
> | `atd` | Ubuntu username | the username chosen during install |

---

## 📋 Table of Contents

1. [Big picture — how it all fits together](#1-big-picture)
2. [Hardware notes](#2-hardware-notes)
3. [Install Ubuntu Server 24.04](#3-install-ubuntu-server)
4. [Post-install OS config](#4-post-install-os-config)
5. [Fix IP address](#5-fix-ip-address)
6. [Install Docker](#6-install-docker)
7. [Pre-deploy setup on Dell — dirs, secrets, compose file, scripts](#7-pre-deploy-setup)
8. [GitHub Secrets — CD pipeline wiring](#8-github-secrets)
9. [Persistent volumes — DB + uploads](#9-persistent-volumes)
10. [LAN domain — alphatradingdesk.local](#10-lan-domain)
11. [CI/CD — full flow explained](#11-cicd-flow)
12. [Backups + DB refresh](#12-backups)
13. [Maintenance + ops commands](#13-maintenance)

---

## 1. Big Picture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Your Mac (dev machine)                                               │
│  → docker-compose.dev.yml  (Postgres + backend + frontend, all local) │
│  → http://localhost:5173   (React Vite hot-reload)                    │
│  → commit + push to develop → CI runs (lint/typecheck/tests)          │
└──────────────────────┬───────────────────────────────────────────────┘
                       │  PR: develop → main, then merge
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  GitHub Actions (cloud runner — ubuntu-latest)                        │
│  → build backend image  → push ghcr.io/…/atd-backend:vX.Y.Z         │
│  → build frontend image → push ghcr.io/…/atd-frontend:vX.Y.Z        │
│  → create git tag + GitHub Release                                    │
│  → SSH into Dell → run deploy.sh vX.Y.Z                              │
└──────────────────────┬───────────────────────────────────────────────┘
                       │  SSH (deploy key stored in GitHub Secrets)
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Dell OptiPlex (Ubuntu 24.04 — always-on, LAN)                       │
│  IP LAN fixe : 192.168.1.100  (MAC: 18:66:DA:13:01:9D)               │
│  → docker pull ghcr.io/…/atd-backend:vX.Y.Z                         │
│  → docker pull ghcr.io/…/atd-frontend:vX.Y.Z                        │
│  → docker compose up -d   (rolling restart, DB untouched)            │
│  → alembic upgrade head   (auto-migrate inside entrypoint)           │
│  → http://alphatradingdesk.local  live in ~2 min                     │
└──────────────────────────────────────────────────────────────────────┘

Rules:
  ✅ Dell NEVER runs docker build
  ✅ Dell NEVER has the source code
  ✅ All secrets: GitHub Secrets (CI/CD) + /srv/atd/.env (runtime)
  ✅ Data survives all restarts via bind mounts on /srv/atd/
```

---

## 2. Hardware Notes

```
Model:      Dell OptiPlex Micro D09U
CPU:        Intel Core i7 (7th/8th gen)
Power:      65W max, ~15–25W idle running Docker
RAM:        8 GB minimum — 16 GB ideal
Storage:    250 GB+ SSD required
Network:    Gigabit Ethernet (rear port) ← use this, not WiFi
MAC addr:   18:66:DA:13:01:9D           ← ethernet NIC (for router DHCP reservation)
IP LAN:     192.168.1.100               ← fixed (router reservation + Netplan)
Tailscale:  100.x.x.x                  ← note down after §4.7
Hostname:   alphatradingdesk            ← set during Ubuntu install

Recommended:
  Ubuntu Server 24.04 LTS (no GUI → saves ~2 GB RAM)
  Docker Engine (not Docker Desktop)
  SSH-only after initial setup
```

---

## 3. Install Ubuntu Server

### 3.1 — Flash USB

```bash
# Download: https://ubuntu.com/download/server  (24.04 LTS)
# balenaEtcher (Mac GUI): https://www.balena.io/etcher/

# Or terminal:
diskutil list                  # find USB → e.g. /dev/disk3
diskutil unmountDisk /dev/disk3
sudo dd if=ubuntu-24.04-live-server-amd64.iso of=/dev/rdisk3 bs=1m status=progress
```

### 3.2 — Installation walkthrough

```
1. Plug ethernet cable BEFORE booting
2. Power on → F12 (boot menu) → select USB

Installer screens:
  Language:     English
  Keyboard:     French (or yours)
  Install type: Ubuntu Server  ← NOT minimized
  Network:      leave DHCP — write down the IP shown
  Storage:      use entire disk + LVM enabled
  Profile:
    Server name: alphatradingdesk   ← critical: sets your .local hostname
    Username:    atd
    Password:    [strong password]
  ✅ Install OpenSSH server         ← mandatory
  Snaps:        skip all
  → Reboot → remove USB
```

### 3.3 — First SSH (before the IP is fixed)

```bash
# Use the DHCP IP shown during installation
ssh atd@<dhcp-ip>
# accept fingerprint → enter password
# Once §5 is done, it will always be: ssh atd@192.168.1.100
```

---

## 4. Post-install OS Config

### 4.1 — System update

```bash
sudo apt update && sudo apt upgrade -y && sudo apt autoremove -y
```

### 4.2 — Required packages

```bash
sudo apt install -y \
  curl wget htop ncdu \
  ufw fail2ban \
  avahi-daemon \
  ca-certificates gnupg lsb-release
```

### 4.3 — Enable mDNS (.local domain)

```bash
sudo systemctl enable --now avahi-daemon

# Test from Mac after setup:
ping alphatradingdesk.local
```

### 4.4 — Firewall

```bash
sudo ufw allow OpenSSH   # ← do this FIRST
sudo ufw allow 80/tcp
sudo ufw enable
sudo ufw status
```

### 4.5 — SSH key authentication

```bash
# On your Mac — dedicated key for this server:
ssh-keygen -t ed25519 -C "atd-server" -f ~/.ssh/atd_key

# Copy to Dell (use the DHCP IP shown during install, or 192.168.1.100 if §5 already done):
ssh-copy-id -i ~/.ssh/atd_key.pub atd@<server-ip>

# Test:
ssh -i ~/.ssh/atd_key atd@<server-ip>

# SSH shortcut on Mac:
cat >> ~/.ssh/config << 'EOF'

Host atd
  HostName alphatradingdesk.local
  User atd
  IdentityFile ~/.ssh/atd_key
EOF

# From now on: ssh atd
```

### 4.6 — Disable password auth (after key works)

```bash
sudo nano /etc/ssh/sshd_config
# Set: PasswordAuthentication no
sudo systemctl restart sshd
```

### 4.7 — Install Tailscale

> Tailscale allows the GitHub Actions runner to connect to the Dell via an encrypted tunnel,
> without opening any port on the internet.

```bash
# On the Dell:
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up    # follow the auth link in your browser

# Get the Tailscale IP → this is the value for the GitHub secret DELL_HOST
tailscale ip -4
# Example: 100.94.12.45  ← note this IP
```

> ⚠️ **Put this IP in the GitHub secret `DELL_HOST`** (see §8).  
> Do not use the LAN IP `192.168.1.100` for the secret — GitHub runners  
> cannot resolve private LAN addresses.

## 5. Fix IP Address

Do BOTH — router reservation + OS static config.

### 5.1 — Router DHCP reservation

> The Dell's MAC address is known: `18:66:DA:13:01:9D`

```
Router admin panel (find URL on your router label):
  Freebox:   http://mafreebox.freebox.fr  → Settings → DHCP → Static leases
  Bbox:      http://192.168.1.254         → Network → DHCP → Reservations
  SFR:       http://192.168.0.1           → Network → DHCP
  Livebox:   http://192.168.1.1           → Advanced network → DHCP

Add entry:
  MAC:  18:66:DA:13:01:9D
  IP:   192.168.1.100
  Name: alphatradingdesk
  → Save + apply
```

### 5.2 — Static IP on OS (Netplan)

```bash
# Find the ethernet interface name:
ip link show
# Look for the interface with MAC 18:66:DA:13:01:9D
# Typically: enp3s0, eno1, enp0s31f6 ...

sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp3s0:                      # ← replace with YOUR interface name
      dhcp4: false
      addresses:
        - 192.168.1.100/24
      routes:
        - to: default
          via: 192.168.1.1       # ← your router's gateway
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
      optional: true
```

```bash
sudo netplan apply
# The SSH session will drop — reconnect with the new IP:
ssh atd@192.168.1.100
# From now on, this IP is permanent
```

### 5.3 — Verification

```bash
ip addr show           # confirms 192.168.1.100
ping 1.1.1.1           # internet accessible
tailscale ip -4        # Tailscale still active
```

---

## 6. Install Docker

```bash
# Add Docker GPG key + repo:
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install:
sudo apt-get update
sudo apt-get install -y \
  docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Run without sudo:
sudo usermod -aG docker atd
newgrp docker

# Enable on boot:
sudo systemctl enable docker

# Verify:
docker --version           # Docker version 25.x.x
docker compose version     # Docker Compose version v2.x.x
docker run hello-world
```

---

## 7. Pre-Deploy Setup on Dell

> ⚠️ **Critical sequencing — read before you start.**
>
> The Dell must be **fully prepared BEFORE the first `feat:` merge → `main`**.
> As soon as you merge, CD triggers, builds the images, and SSHes into the Dell to
> deploy them. If the Dell isn't ready, the deploy will fail.
>
> ```
> MANDATORY ORDER:
>   §7.1 → §7.2 → §7.3 → §7.4   ← Dell ready (BEFORE the merge)
>   §8.2 → §8.3 → §8.1           ← GitHub Secrets wired (BEFORE the merge)
>   ──────────────────────────────────────────────────────
>   → merge feat: → main          ← CD triggers
>   → images built + pushed to GHCR by CD
>   → deploy.sh v1.0.0 executed by CD via SSH
>   → docker compose up -d + alembic upgrade head  ← automatic
>   ──────────────────────────────────────────────────────
>   §7.5                          ← POST-deploy verification (not a manual setup step)
> ```
>
> `docker-compose.prod.yml`, `~/apps/.env` and the scripts are **static files**
> you create manually on the Dell — they don't need the images to exist.
> The images (GHCR) only exist after the 1st merge.

The Dell needs only 3 things — no source code, no git clone.

### 7.1 — Create directory structure (run once)

```bash
sudo mkdir -p \
  /srv/atd/data/postgres \
  /srv/atd/data/uploads \
  /srv/atd/logs/app \
  /srv/atd/logs/cron \
  /srv/atd/backups/rolling \
  /srv/atd/backups/weekly
sudo chown -R atd:atd /srv/atd
sudo chmod -R 750 /srv/atd
```

### 7.2 — Create production secrets file

```bash
mkdir -p ~/apps
nano ~/apps/.env
```

```bash
# ~/apps/.env — NEVER commit this file
# Generate values: openssl rand -hex 24 / openssl rand -hex 32
POSTGRES_DB=atd_prod
POSTGRES_USER=atd
POSTGRES_PASSWORD=<openssl rand -hex 24>
SECRET_KEY=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 16>
APP_ENV=prod
ALLOWED_ORIGINS=http://alphatradingdesk.local,http://192.168.1.100
DATABASE_URL=postgresql://atd:<POSTGRES_PASSWORD>@db:5432/atd_prod
```

```bash
chmod 600 ~/apps/.env
```

Also create a DB-only env file (used by the postgres container at init):

```bash
cat > /srv/atd/.env.db << 'EOF'
POSTGRES_DB=atd_prod
POSTGRES_USER=atd
POSTGRES_PASSWORD=<same as above>
EOF
chmod 600 /srv/atd/.env.db
```

### 7.3 — Create docker-compose.prod.yml

```bash
nano ~/apps/docker-compose.prod.yml
```

```yaml
# ~/apps/docker-compose.prod.yml
# Images pulled from GHCR — never built here.
# Pass IMAGE_TAG and GHCR_OWNER as env vars (done by deploy.sh).

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
    image: ghcr.io/${GHCR_OWNER}/atd-backend:${IMAGE_TAG:-latest}
    restart: unless-stopped
    env_file: /home/atd/apps/.env
    environment:
      DATABASE_URL: postgresql://atd:${POSTGRES_PASSWORD}@db:5432/atd_prod
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
    image: ghcr.io/${GHCR_OWNER}/atd-frontend:${IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "80:80"
    depends_on:
      - backend
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
```

### 7.4 — Copy prod scripts to Dell (once only)

The deploy script (`scripts/prod/deploy.sh`) lives in the Git repo and is
**automatically synced to `~/apps/` by CD on every release**.
You only need to copy it **manually once** — for the initial bootstrap,
before CD is wired up:

```bash
# From your Mac — once only, BEFORE the 1st merge → main
scp scripts/prod/deploy.sh \
    scripts/prod/backup-db.sh \
    scripts/prod/healthcheck.sh \
    scripts/prod/setup-cron.sh \
    atd@192.168.1.100:~/apps/

ssh atd@192.168.1.100 "chmod +x ~/apps/*.sh"
```

> ⚠️ **DO NOT run `deploy.sh` now** — it would try to `docker pull`
> images that don't exist yet on GHCR.
> Images are created by CD **only after** the 1st `feat:` → `main` merge.
> CD will call `deploy.sh` automatically.

> After §8 (GitHub Secrets), CD handles all script updates
> automatically — no more `scp` needed per release.

### 7.5 — Post-deploy verification (after the 1st merge → main)

> **CD does all the work.** This block is only to VERIFY that the automatic
> deploy succeeded — do not run anything manually here.

```bash
# Sur le Dell — vérifier que les containers tournent:
docker compose -f ~/apps/docker-compose.prod.yml ps

# Vérifier l'API:
curl http://localhost:8000/api/health    # → {"status": "ok"}

# Depuis ton Mac:
open http://alphatradingdesk.local      # → app live
```

**View published images on GHCR:**
```
https://github.com/<your-org>/AlphaTradingDesk/pkgs/container/atd-backend
https://github.com/<your-org>/AlphaTradingDesk/pkgs/container/atd-frontend
```
> Or directly from GitHub: repo → **Packages** (right column on the main page).
> Images appear there **only after** the 1st `feat:` → `main` merge.

**Manual deploy** (only if you need to force a version without going through CD):
```bash
# On the Dell — requires images to already exist on GHCR
export GHCR_OWNER=<your-github-org-or-username>
~/apps/deploy.sh v1.0.0
```

---

## 8. GitHub Secrets

Go to: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

### 8.1 — Required secrets

| Secret | Value | Notes |
|--------|-------|-------|
| `GITHUB_TOKEN` | auto | **Auto-injected** by GitHub — no setup needed |
| `DELL_HOST` | Tailscale IP `100.x.x.x` | Use Tailscale IP — GitHub runners can't resolve LAN IPs/mDNS |
| `DELL_USER` | `atd` | SSH user on Dell |
| `DELL_SSH_KEY` | private key content | Generate below ↓ |
| `TAILSCALE_AUTHKEY` | Tailscale reusable auth key | Required for GitHub runner → Dell tunnel (see §8.4) |

> **`GHCR_OWNER` is NOT a secret.** It is injected automatically by the pipeline as
> `github.repository_owner` (a built-in GitHub Actions variable). No manual setup needed.
> It works for any org, fork, or migration without touching any code.

### 8.2 — Generate deploy SSH key (dedicated, not your personal key)

```bash
# On your Mac — DEDICATED CI/CD key (not your personal key):
ssh-keygen -t ed25519 -C "github-actions-atd-deploy" \
           -f ~/.ssh/atd_deploy_key -N ""
# -N "" = no passphrase (GitHub Actions needs non-interactive auth)

# Two files created:
#   ~/.ssh/atd_deploy_key      ← PRIVATE → GitHub Secret DELL_SSH_KEY
#   ~/.ssh/atd_deploy_key.pub  ← PUBLIC  → Dell authorized_keys

# Copy the PUBLIC key to the Dell:
ssh-copy-id -i ~/.ssh/atd_deploy_key.pub atd@192.168.1.100

# Test:
ssh -i ~/.ssh/atd_deploy_key atd@192.168.1.100 "echo ✅ OK"

# Copy the PRIVATE key → paste into GitHub Secret DELL_SSH_KEY:
cat ~/.ssh/atd_deploy_key | pbcopy
# → GitHub → Settings → Secrets → DELL_SSH_KEY → paste → Save
```

> ⚠️ **PRIVATE key → GitHub Secret. PUBLIC key → Dell `authorized_keys`.**  
> Never swap them. Never commit either one to the repo.

### 8.3 — Generate TAILSCALE_AUTHKEY

```
1. Go to: https://login.tailscale.com/admin/settings/keys
2. Click "Generate auth key"
3. Check:
   ✅ Reusable    — the CI runner runs on every deploy, needs reuse
   ✅ Ephemeral   — disappears from Tailscale admin after use (no clutter)
   ✅ Pre-authorized — no manual approval needed
4. Expiration: 90 days (set a calendar reminder to renew)
5. Copy the key → GitHub Secret TAILSCALE_AUTHKEY
```

### 8.4 — Verify all 4 secrets are configured

```
GitHub → repo → Settings → Secrets and variables → Actions

You should see exactly:
  DELL_HOST          ✅  (100.x.x.x — Tailscale IP of the Dell)
  DELL_USER          ✅  (atd)
  DELL_SSH_KEY       ✅  (full content -----BEGIN OPENSSH PRIVATE KEY-----)
  TAILSCALE_AUTHKEY  ✅  (tskey-auth-...)
```

If your GitHub repo is **public**, GHCR images are public → no token needed.
If your repo is **private**:

```bash
# Create a PAT on GitHub: Settings → Developer settings → Tokens → Fine-grained
# Permission: read:packages
# Then on the Dell:
echo "<YOUR_TOKEN>" | docker login ghcr.io -u <your-github-username> --password-stdin
# Credentials saved to ~/.docker/config.json — persists across reboots
```

### 8.5 — Why Tailscale? (GitHub runner cannot reach 192.168.1.100)

GitHub cloud runners run on the internet — they cannot SSH directly into your LAN.
Tailscale is installed in §4.7. The CI/CD workflow joins the Tailscale network via `TAILSCALE_AUTHKEY`
before opening SSH on `DELL_HOST` (`100.x.x.x`).

> Tailscale is already installed (§4.7) and `TAILSCALE_AUTHKEY` declared (§8.1).
> The step in `atd-deploy.yml` is already configured — nothing to do manually here.

---

## 9. Persistent Volumes

### 9.1 — Why bind mounts, not named Docker volumes

Named Docker volumes live in `/var/lib/docker/volumes/` — opaque, hard to backup.
Bind mounts are just directories on the host — transparent, easy to `rsync` or inspect.

```
docker compose down -v   → removes named volumes  → our data SAFE (bind mount)
rm -rf /srv/atd/data/    → removes bind mounts    → data LOST
```

### 9.2 — What needs to persist and where

| Container | Data | Host path | What happens if deleted |
|-----------|------|-----------|------------------------|
| `db` | PostgreSQL files | `/srv/atd/data/postgres/` | All DB data lost |
| `backend` | User uploads (images) | `/srv/atd/data/uploads/` | All images lost |
| `backend` | App logs | `/srv/atd/logs/app/` | Logs lost (non-critical) |

### 9.3 — Survival matrix

```
Scenario                         DB data   Uploads   Action needed
────────────────────────────────────────────────────────────────────
docker compose restart           ✅ safe   ✅ safe   nothing
docker compose down              ✅ safe   ✅ safe   nothing
docker compose down -v           ✅ safe   ✅ safe   nothing (bind mounts!)
docker image rm                  ✅ safe   ✅ safe   re-pull image
Server reboot                    ✅ safe   ✅ safe   auto-restart (unless-stopped)
rm -rf /srv/atd/data/postgres    💀 lost   ✅ safe   restore from backup
Server disk failure              💀 lost   💀 lost   restore from Mac rsync copy
```

---

## 10. LAN Domain — alphatradingdesk.local

```
avahi-daemon on the Dell broadcasts: "I am alphatradingdesk.local at 192.168.1.100"

Devices that resolve it natively:
  macOS, iOS, iPadOS   → built-in (Bonjour)
  Linux                → avahi-daemon installed
  Windows              → needs Bonjour for Windows (or use IP directly)
  Android              → use IP directly (192.168.1.100)
```

```bash
# Verify mDNS on Dell:
avahi-daemon --check && echo "running"

# Test from Mac:
ping alphatradingdesk.local         # → 192.168.1.100
open http://alphatradingdesk.local  # → app
```

---

## 11. CI/CD Flow

### 11.1 — CI: `atd-test.yml`

**Triggers:** push to `develop` OR any PR to `main`/`develop`

```
Job 1 — backend (ubuntu-latest + postgres:16-alpine service):
  ① checkout
  ② poetry install
  ③ ruff check src/ tests/
  ④ mypy src/
  ⑤ pytest tests/ --cov=src   (119 tests)

Job 2 — frontend (ubuntu-latest):
  ① checkout
  ② npm ci
  ③ eslint .
  ④ tsc --noEmit
  ⑤ npm run test (vitest)

Job 3 — build (runs after 1+2 pass):
  ① docker build backend (no push — validates Dockerfile only)
  ② docker build frontend (no push)

→ Failure on any job blocks the PR from merging
→ Duration: ~2–3 min
```

### 11.2 — CD: `atd-deploy.yml`

**Trigger:** push to `main` (= PR merged)

```
① Compute next semver from commit message:
   fix:   → PATCH   v1.0.0 → v1.0.1   → build + deploy
   feat:  → MINOR   v1.0.1 → v1.1.0   → build + deploy
   feat!: → MAJOR   v1.1.0 → v2.0.0   → build + deploy
   chore: / docs: / test: / ci:       → NO release, NO deploy

② Login to GHCR with GITHUB_TOKEN (auto)

③ docker build + push backend:
   ghcr.io/<org>/atd-backend:v1.2.3
   ghcr.io/<org>/atd-backend:latest

④ docker build + push frontend:
   ghcr.io/<org>/atd-frontend:v1.2.3
   ghcr.io/<org>/atd-frontend:latest

⑤ Create GitHub Release + auto-changelog

⑥ Sync prod scripts to Dell (appleboy/scp-action):
   scripts/prod/deploy.sh      → ~/apps/deploy.sh
   scripts/prod/backup-db.sh   → ~/apps/backup-db.sh
   scripts/prod/healthcheck.sh → ~/apps/healthcheck.sh
   scripts/prod/setup-cron.sh  → ~/apps/setup-cron.sh
   (setup-server.sh excluded — OS provisioning, manual-only)
   → chmod +x ~/apps/*.sh via SSH

⑦ Connect Tailscale runner to Dell network

⑧ SSH into Dell → inject GHCR_OWNER → run:
   export GHCR_OWNER="<github.repository_owner>"
   ~/apps/deploy.sh v1.2.3
     → docker pull backend:v1.2.3
     → docker pull frontend:v1.2.3
     → docker compose up -d (rolling restart, DB untouched)
     → alembic upgrade head

→ Duration: ~4–6 min from merge to live
```

### 11.3 — Commit type → version bump quick ref

```
feat(scope): add X          → MINOR  → deploys
fix(scope): fix Y           → PATCH  → deploys
feat!: breaking change      → MAJOR  → deploys
chore: update deps          → none   → CI only
docs: update README         → none   → CI only
refactor: clean up service  → none   → CI only
test: add tests             → none   → CI only
db: add migration           → none   → CI only
```

> To force a deploy of a chore/docs change, add one `fix:` commit to the PR.

### 11.4 — Merge strategy: what to do when `develop` has multiple commits?

**Use a regular merge** (`Create a merge commit` on GitHub — this is the default).

The workflow scans **all commits in the merge** and picks the highest bump:

```
develop contains:
  chore: update deps         → patch
  test: add unit tests       → none
  feat: add market analysis  → MINOR  ← wins

→ The merge → main creates a MINOR release  v1.0.0 → v1.1.0
```

| Strategy | Behaviour | Recommendation |
|----------|-----------|----------------|
| **Merge commit** (default) | Scans all commits → picks the highest | ✅ Recommended |
| **Squash merge** | 1 single commit → **its message must have the right prefix** (`feat:` / `fix:`) otherwise `default_bump: false` → no release | ⚠️ Risky if you forget |
| **Rebase** | Same logic as merge commit | ✅ OK too |

> **Simple rule:** if your PR contains at least one `feat:` or `fix:` commit, CD triggers
> after the merge. If it contains only `docs:` / `test:` / `ci:` / `chore:` → no release,
> no deploy (CI only). This is intentional.

### 11.5 — Dell reboot: do containers restart automatically?

**Yes — 100% automatic.** Two combined mechanisms:

```
1. Docker itself is enabled at boot:
   sudo systemctl enable docker   (done in §6)

2. Each container has restart: unless-stopped in docker-compose.prod.yml
   → Docker restarts them automatically after a reboot
```

Boot sequence:
```
Server reboots
  → systemd starts Docker
  → db starts first
  → backend waits for db to be healthy (depends_on + healthcheck)
  → frontend starts
  → app live in ~30 seconds
  → no manual action required
```

> `unless-stopped` means: always restart unless **you stopped it manually**
> (`docker compose down`). A reboot does not count as a manual stop.

Data survival on reboot:
```
DB data    /srv/atd/data/postgres/  → ✅ bind mount, survives everything
Uploads    /srv/atd/data/uploads/   → ✅ bind mount, survives everything
```

---

## 12. Backups

### 12.1 — Cron on Dell (`crontab -e`)

```cron
# pg_dump every 6h — keep last 48 files (~12 days)
0 */6 * * * /home/atd/apps/backup-db.sh rolling >> /srv/atd/logs/cron/backup-db.log 2>&1

# Weekly dump every Sunday 03:00 — keep last 12 weeks
0 3 * * 0 /home/atd/apps/backup-db.sh weekly >> /srv/atd/logs/cron/backup-db.log 2>&1
```

### 12.2 — `~/apps/backup-db.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail
MODE=${1:-rolling}
DIR="/srv/atd/backups/${MODE}"
FILE="${DIR}/atd_prod_$(date +%Y%m%d_%H%M%S).sql.gz"
COMPOSE="$HOME/apps/docker-compose.prod.yml"
echo "[$(date)] Backup $MODE → $FILE"
docker compose -f "$COMPOSE" exec -T db pg_dump -U atd atd_prod | gzip > "$FILE"
echo "[$(date)] Done: $(du -sh "$FILE" | cut -f1)"
KEEP=$( [ "$MODE" = "rolling" ] && echo 49 || echo 13 )
ls -1t "$DIR"/*.sql.gz 2>/dev/null | tail -n +"$KEEP" | xargs -r rm --
```

### 12.3 — Manual backup / restore

```bash
# Backup now:
~/apps/backup-db.sh rolling

# Restore latest:
LATEST=$(ls -1t /srv/atd/backups/rolling/*.sql.gz | head -1)
zcat "$LATEST" | \
  docker compose -f ~/apps/docker-compose.prod.yml exec -T db psql -U atd atd_prod
```

### 12.4 — Pull backups to Mac (cron on Mac)

```bash
# crontab -e on Mac:
0 */4 * * * rsync -az --ignore-existing \
  atd@alphatradingdesk.local:/srv/atd/backups/ \
  ~/Backups/AlphaTradingDesk/ \
  >> ~/Library/Logs/atd-backup-sync.log 2>&1
```

---

## 13. Maintenance

```bash
# Check status:
ssh atd
~/apps/healthcheck.sh                                      # full ops summary
docker compose -f ~/apps/docker-compose.prod.yml ps       # container status
docker stats --no-stream                                   # CPU/RAM
df -h /srv/atd                                             # disk usage

# Logs:
docker compose -f ~/apps/docker-compose.prod.yml logs -f
docker compose -f ~/apps/docker-compose.prod.yml logs -f backend

# Deploy specific version (GHCR_OWNER required for manual call):
export GHCR_OWNER=<your-github-org-or-username>
~/apps/deploy.sh v1.2.3

# Rollback to previous version:
~/apps/deploy.sh v1.2.2

# After power outage (containers auto-restart via unless-stopped):
docker ps    # verify

# Re-seed if DB empty:
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  python -m database.migrations.seeds.seed_all
```

---

```
╔══════════════════════════════════════════════════════════════════════╗
║  QUICK REFERENCE                                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  Dell MAC address    18:66:DA:13:01:9D  (ethernet NIC)               ║
║  Dell LAN IP         192.168.1.100  (DHCP reservation + Netplan)     ║
║  Dell Tailscale      100.x.x.x  → tailscale ip -4  on the Dell       ║
║  SSH shortcut        ssh atd  (via ~/.ssh/config)                     ║
║  App URL (LAN)       http://alphatradingdesk.local                    ║
║  App URL (IP)        http://192.168.1.100                             ║
║                                                                       ║
║  DB data             /srv/atd/data/postgres/                          ║
║  Uploads             /srv/atd/data/uploads/                           ║
║  Backups             /srv/atd/backups/                                ║
║  Logs                /srv/atd/logs/                                   ║
║  Scripts             ~/apps/                                          ║
║  Compose             ~/apps/docker-compose.prod.yml                   ║
║  Env file            ~/apps/.env                                      ║
╠══════════════════════════════════════════════════════════════════════╣
║  GITHUB SECRETS (4 required — Settings → Secrets → Actions)          ║
║  DELL_HOST          100.x.x.x  (tailscale ip -4 on the Dell)         ║
║  DELL_USER          atd                                               ║
║  DELL_SSH_KEY       cat ~/.ssh/atd_deploy_key | pbcopy  (private)     ║
║  TAILSCALE_AUTHKEY  tailscale.com/admin/settings/keys                 ║
║                     → Reusable + Ephemeral + Pre-authorized           ║
║  GITHUB_TOKEN       auto-injected (no setup needed)                  ║
║  GHCR_OWNER         NOT a secret (github.repository_owner, auto)     ║
╚══════════════════════════════════════════════════════════════════════╝
```
