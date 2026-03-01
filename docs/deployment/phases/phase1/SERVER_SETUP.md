# 🖥️ Server S1. [Phase progression overview](#1-phase-progression-overview)
2. [Hardware notes — Dell D09U](#2-hardware-notes--dell-d09u)
3. [Step-by-step: Install Ubuntu Server 22.04](#3-step-by-step-install-ubuntu-server-2204)
4. [Step-by-step: Post-install OS configuration](#4-step-by-step-post-install-os-configuration)
5. [Step-by-step: Fix IP address (router + OS)](#5-step-by-step-fix-ip-address-router--os)
6. [Step-by-step: Install Docker + Docker Compose](#6-step-by-step-install-docker--docker-compose)
7. [Step-by-step: Deploy AlphaTradingDesk](#7-step-by-step-deploy-alphatradingdesk)
8. [LAN domain — alphatradingdesk.local](#8-lan-domain--alphatradingdesklocal)
9. [CI/CD — Git Flow + Semantic Versioning + Auto-Deploy](#9-cicd--git-flow--semantic-versioning--auto-deploy)
10. [Maintenance & ops](#10-maintenance--ops)
11. [DB sync — prod → dev (daily)](#11-db-sync--prod--dev-daily)haTradingDesk

**Date:** March 1, 2026  
**Version:** 1.0  
**Hardware:** Dell OptiPlex Micro (D09U) — Core i7, 19.5V 3.34A  
**Target OS:** Ubuntu Server 22.04 LTS (headless)

> This document covers the full path from bare metal to running app:  
> **Dev (localhost) → Dell server (LAN, fixed IP) → alphatradingdesk.local**

---

## 📋 Table of Contents

1. [Phase progression overview](#1-phase-progression-overview)
2. [Hardware notes — Dell D09U](#2-hardware-notes--dell-d09u)
3. [Step-by-step: Install Ubuntu Server 22.04](#3-step-by-step-install-ubuntu-server-2204)
4. [Step-by-step: Post-install OS configuration](#4-step-by-step-post-install-os-configuration)
5. [Step-by-step: Fix IP address (router + OS)](#5-step-by-step-fix-ip-address-router--os)
6. [Step-by-step: Install Docker + Docker Compose](#6-step-by-step-install-docker--docker-compose)
7. [Step-by-step: Deploy AlphaTradingDesk](#7-step-by-step-deploy-alphatradingdesk)
8. [LAN domain — alphatradingdesk.local](#8-lan-domain--alphatradingdesklocal)
9. [CI/CD — Git Flow + Semantic Versioning + Auto-Deploy](#9-cicd--git-flow--semantic-versioning--auto-deploy)
10. [Maintenance & ops](#10-maintenance--ops)
11. [Data strategy — volumes, backups & dev DB](#11-data-strategy--volumes-backups--dev-db)

---

## 1. Phase Progression Overview

```
PHASE DEV MAC  (Steps 1–13 — NOW)
  Mac (your main machine)
  → docker-compose.dev.yml  (Postgres + backend + frontend, all local)
  → http://localhost:5173   (React + Vite hot reload)
  → http://localhost:8000   (FastAPI uvicorn --reload)
  → http://localhost:8080   (Adminer DB GUI)
  → No Caddy, no nginx — direct ports
  → No Dell needed yet

  ↓  Step 14 — app runs end-to-end, ready to move to Dell

MIGRATION DEV MAC → DELL  (Step 14.0 — one-time)
  1. Prepare Dell: Ubuntu + Docker + IP fixe (SERVER_SETUP.md §3–6)
  2. Dump atd_dev from Mac → restore on Dell
  3. Update .env.dev: DATABASE_URL → 192.168.1.50:5432/atd_dev
  4. Remove db service from docker-compose.dev.yml (Mac no longer runs Postgres)
  5. Verify: make dev → app works, data intact

  ↓  then deploy prod

PHASE PROD DELL  (Step 14.1+)
  Dell OptiPlex Micro (D09U)
  → Ubuntu Server 22.04 LTS (headless)
  → Cable ethernet → router (fixed IP: 192.168.1.50)
  → docker-compose.prod.yml  (images from GHCR — never built on Dell)
  → http://alphatradingdesk.local  (Caddy → React + FastAPI)
  → Access from Mac/iPhone/iPad on same WiFi
  → atd_dev refreshed from atd_prod every 4h (§11.4)

  ↓  (future — when needed)

PHASE FUTURE — Cloud (GCE europe-west9)
  → Same compose stack, change domain + add TLS
  → Zero code changes
```

---

## 2. Hardware Notes — Dell D09U

```
Model:     Dell OptiPlex Micro (D09U001 chassis)
CPU:       Intel Core i7 (7th or 8th gen likely)
Power:     19.5V × 3.34A = 65W max, ~15–25W idle with Docker
RAM:       Depends on your config — minimum 8GB recommended (16GB ideal)
Storage:   250GB+ SSD recommended (PostgreSQL data + Docker images)
Network:   Gigabit Ethernet port (rear) ← use this, NOT WiFi

Ideal configuration for this app:
  - Ubuntu Server (no GUI → saves ~2GB RAM)
  - Docker + Docker Compose V2
  - SSH access from Mac (no screen/keyboard needed after setup)
  - Ethernet cable to router (stable, no WiFi dropout)
```

**Check your RAM before starting:**
```bash
# Boot the Dell with any Linux live USB and run:
free -h
# Or from BIOS: F2 at boot → check RAM
```

---

## 3. Step-by-step: Install Ubuntu Server 22.04

### 3.1 — Download the ISO

```bash
# On your Mac — download Ubuntu Server 22.04 LTS (not Desktop)
# URL: https://ubuntu.com/download/server
# File: ubuntu-22.04.X-live-server-amd64.iso
# Size: ~1.4 GB
```

### 3.2 — Create a bootable USB

```bash
# On Mac — use balenaEtcher (free, GUI)
# https://www.balena.io/etcher/
# 1. Open Etcher
# 2. "Flash from file" → select the .iso
# 3. "Select target" → select your USB drive (8GB+ required)
# 4. "Flash!" → wait ~3 min

# Alternative (terminal):
diskutil list                    # find your USB drive, e.g. /dev/disk3
diskutil unmountDisk /dev/disk3
sudo dd if=ubuntu-22.04.X-live-server-amd64.iso of=/dev/rdisk3 bs=1m status=progress
# Warning: dd is destructive — double-check the disk number
```

### 3.3 — Boot the Dell from USB

```
1. Plug USB into Dell
2. Plug ethernet cable from Dell to router (do this BEFORE booting)
3. Power on Dell
4. Press F12 (boot menu) at the Dell logo
5. Select your USB drive from the boot menu
6. Ubuntu installer starts
```

### 3.4 — Ubuntu Server Installation walkthrough

```
Screen 1: Language → English

Screen 2: Keyboard layout → French (or your layout)

Screen 3: Installation type → Ubuntu Server (NOT minimized)
  ✅ Ubuntu Server  ← choose this

Screen 4: Network
  → Should detect your ethernet (enp3s0 or similar)
  → Leave as DHCP for now (we'll fix IP after install)
  → Note the assigned IP shown on screen — write it down

Screen 5: Proxy → leave empty → Done

Screen 6: Mirror → leave default → Done

Screen 7: Storage layout
  → "Use an entire disk" → select your SSD
  → Enable LVM: YES (allows resizing later)
  → Set up this disk as an LVM group: YES
  → Continue / Done → Confirm destructive action: Continue

Screen 8: Profile setup
  Your name:        alphatradingdesk        (or your name)
  Server name:      alphatradingdesk        ← IMPORTANT — this is your mDNS hostname
  Username:         atd                     (or your choice)
  Password:         [strong password]
  Confirm:          [same]

Screen 9: SSH Setup
  ✅ Install OpenSSH server   ← CHECK THIS — essential for remote access
  Import SSH identity: No (we'll set up keys after)

Screen 10: Featured server snaps → SKIP ALL (uncheck everything)
  → Done

Screen 11: Installing... (10–15 minutes)

Screen 12: Installation complete!
  → "Reboot Now"
  → Remove USB when prompted
  → System reboots
```

### 3.5 — First boot

```
After reboot, you see a login prompt:
  alphatradingdesk login: atd
  Password: [your password]

You're in. 
```

---

## 4. Step-by-step: Post-install OS Configuration

**All these commands run on the Dell (via SSH from Mac, or direct keyboard).**

### 4.1 — Connect from Mac via SSH

```bash
# On your Mac terminal:
# First find the Dell's IP (written down from install, or check router admin)
ssh atd@192.168.1.X     # replace X with actual IP

# First connection: type "yes" to accept host key
# Enter your password
```

### 4.2 — System update

```bash
sudo apt update && sudo apt upgrade -y
sudo apt autoremove -y
```

### 4.3 — Essential packages

```bash
sudo apt install -y \
  curl wget git \
  htop ncdu \
  ufw \
  fail2ban \
  avahi-daemon \     # mDNS / Bonjour — enables .local domain
  ca-certificates \
  gnupg lsb-release
```

### 4.4 — Enable mDNS (Bonjour) for .local domain

```bash
# avahi-daemon is already installed above
sudo systemctl enable avahi-daemon
sudo systemctl start avahi-daemon

# Verify
avahi-daemon --version
# Should output: avahi 0.8

# Test from your Mac:
ping alphatradingdesk.local
# Should reply from Dell's IP — if so, LAN domain is working
```

### 4.5 — Firewall (UFW)

```bash
sudo ufw allow OpenSSH          # SSH — MUST do this before enabling UFW
sudo ufw allow 80/tcp           # HTTP (Caddy)
sudo ufw allow 443/tcp          # HTTPS (future)
sudo ufw enable                 # Enable firewall
sudo ufw status                 # Verify rules
```

### 4.6 — SSH key authentication (from Mac — recommended)

```bash
# On your Mac:
ssh-keygen -t ed25519 -C "alphatradingdesk-server" -f ~/.ssh/atd_key
# Press enter for no passphrase (or add one for extra security)

# Copy public key to server:
ssh-copy-id -i ~/.ssh/atd_key.pub atd@192.168.1.X

# Test:
ssh -i ~/.ssh/atd_key atd@192.168.1.X

# Add to Mac's SSH config for convenience:
cat >> ~/.ssh/config << 'EOF'
Host atd
  HostName 192.168.1.X        # replace with actual IP later (or alphatradingdesk.local)
  User atd
  IdentityFile ~/.ssh/atd_key
EOF

# After: ssh atd  ← one word to connect
```

### 4.7 — Disable password login (after key works)

```bash
# On the server — only if key login works perfectly:
sudo nano /etc/ssh/sshd_config
# Change:
#   PasswordAuthentication yes  →  PasswordAuthentication no
sudo systemctl restart sshd
```

---

## 5. Step-by-step: Fix IP Address (Router + OS)

**Strategy: do both — router reservation AND static OS config. Belt + suspenders.**

### 5.1 — Find the Dell's MAC address

```bash
# On the Dell:
ip link show
# Look for your ethernet interface (enp3s0, eno1, eth0...)
# Note the MAC address: e.g. a8:a1:59:12:34:56
```

### 5.2 — DHCP reservation on router (static IP via router)

```
Every router is different, but the concept is the same:

1. Open router admin: http://192.168.1.1  (or 192.168.0.1 — check router label)
2. Login (admin/admin or check label)
3. Find: DHCP → DHCP Reservations (or "Static Leases" / "Address Binding")
4. Add new entry:
     MAC address:  a8:a1:59:12:34:56  (Dell's MAC)
     IP address:   192.168.1.50       (choose a free IP outside DHCP range)
     Hostname:     alphatradingdesk
5. Save and apply

→ From now on, router always gives 192.168.1.50 to this MAC
```

Common router brands:
```
Freebox:      http://mafreebox.freebox.fr → DHCP → Baux statiques
Bbox:         http://192.168.1.254 → Réseau → DHCP → Réservations
SFR Box:      http://192.168.0.1  → Réseau → Configuration DHCP
Orange Livebox: http://192.168.1.1 → Réseau avancé → DHCP
```

### 5.3 — Static IP on the OS (via Netplan)

```bash
# On the Dell — find your network interface name:
ip link show
# e.g. enp3s0

# Edit netplan config:
sudo nano /etc/netplan/00-installer-config.yaml
```

Replace content with:
```yaml
# /etc/netplan/00-installer-config.yaml
network:
  version: 2
  ethernets:
    enp3s0:                          # replace with your interface name
      dhcp4: false
      addresses:
        - 192.168.1.50/24            # your chosen fixed IP
      routes:
        - to: default
          via: 192.168.1.1           # your router's gateway IP
      nameservers:
        addresses:
          - 1.1.1.1                  # Cloudflare DNS
          - 8.8.8.8                  # Google DNS
      optional: true
```

```bash
# Apply:
sudo netplan apply

# Verify:
ip addr show enp3s0
# Should show inet 192.168.1.50/24

# Test internet:
ping 1.1.1.1 -c 3
```

> ⚠️ After this, your SSH session may drop (IP changed). Reconnect:
> `ssh atd@192.168.1.50`  or  `ssh atd@alphatradingdesk.local`

### 5.4 — Update Mac SSH config

```bash
# On your Mac, update ~/.ssh/config:
Host atd
  HostName alphatradingdesk.local    # use .local now that mDNS is working
  User atd
  IdentityFile ~/.ssh/atd_key
```

---

## 6. Step-by-step: Install Docker + Docker Compose

```bash
# On the Dell:

# 1. Add Docker's official GPG key:
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# 2. Add Docker repository:
echo \
  "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 3. Install Docker:
sudo apt-get update
sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

# 4. Run Docker without sudo (add user to docker group):
sudo usermod -aG docker atd
newgrp docker               # apply without relogging

# 5. Enable Docker to start on boot:
sudo systemctl enable docker
sudo systemctl start docker

# 6. Verify:
docker --version            # Docker version 25.x.x
docker compose version      # Docker Compose version v2.x.x
docker run hello-world      # Should print "Hello from Docker!"
```

---

## 7. Step-by-step: Deploy AlphaTradingDesk

### 7.1 — Clone the repo on the server

```bash
# On the Dell:
mkdir -p ~/apps
cd ~/apps

# If using GitHub:
git clone https://github.com/YOUR_USERNAME/AlphaTradingDesk.git
cd AlphaTradingDesk

# If using a local Git server or rsync instead:
# → see Section 9 (CI/CD)
```

### 7.2 — Create the production .env file

```bash
cd ~/apps/AlphaTradingDesk
cp .env.example .env
nano .env
```

Fill in:
```bash
# .env — production
POSTGRES_DB=atd_prod
POSTGRES_USER=atd
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD_HERE
SECRET_KEY=CHANGE_ME_64_CHAR_RANDOM_STRING
ENCRYPTION_KEY=CHANGE_ME_32_CHAR_AES_KEY
ENVIRONMENT=production
ALLOWED_HOSTS=alphatradingdesk.local,192.168.1.50
```

Generate strong values:
```bash
# Generate SECRET_KEY:
python3 -c "import secrets; print(secrets.token_hex(32))"

# Generate ENCRYPTION_KEY (32 bytes for AES-256):
python3 -c "import secrets; print(secrets.token_hex(16))"
```

### 7.3 — First production start

```bash
cd ~/apps/AlphaTradingDesk

# Build and start:
docker compose -f docker-compose.prod.yml up -d --build

# Check all services are running:
docker compose -f docker-compose.prod.yml ps

# Check logs:
docker compose -f docker-compose.prod.yml logs -f

# Run database migrations:
docker compose -f docker-compose.prod.yml exec backend \
  alembic upgrade head

# Seed initial data (brokers, instruments, sessions, etc.):
docker compose -f docker-compose.prod.yml exec backend \
  python scripts/seed_db.py
```

### 7.4 — Verify it's working

```bash
# From Mac browser:
# → http://alphatradingdesk.local
# → Should show the React app

# From Mac terminal:
curl http://alphatradingdesk.local/api/health
# → {"status": "ok", "db": "connected"}
```

---

## 8. LAN Domain — alphatradingdesk.local

### How it works

```
mDNS (Multicast DNS) — also called Bonjour (Apple) or Avahi (Linux)

The Dell broadcasts "I am alphatradingdesk.local at 192.168.1.50"
to the local network every few seconds.

Any device on the same WiFi/LAN that supports mDNS can resolve it:
  Mac:     native (built in macOS)
  iPhone:  native (iOS supports mDNS)
  iPad:    native
  Linux:   avahi-daemon (already installed)
  Windows: requires Bonjour for Windows (or use IP directly)

→ http://alphatradingdesk.local resolves to http://192.168.1.50
→ Caddy (port 80) receives the request
→ Caddy routes /* to React SPA, /api/* to FastAPI
```

### Verify mDNS is broadcasting

```bash
# On the Dell:
avahi-browse -a -t 2>/dev/null | head -20

# From Mac:
dns-sd -q alphatradingdesk.local
# Should show: alphatradingdesk.local. has address 192.168.1.50

# Or simply:
ping alphatradingdesk.local
```

### Fallback: access by IP

```
If mDNS doesn't work on a specific device (e.g. Android, Windows without Bonjour):
→ Use: http://192.168.1.50  directly — works on all devices
```

---

## 9. CI/CD — Git Flow + Semantic Versioning + Auto-Deploy

> **Scripts & Makefile** — leur contenu complet (deploy.sh, sync-db, Makefile) est documenté
> dans [`implement-phase1.md` → Step 14](implement-phase1.md#step-14--scripts--tooling-once-app-runs-end-to-end).
> À créer au Step 14 — pas avant.

### How it works — the full picture

```
1. You work on the develop branch on your Mac.
2. You test locally: http://localhost:5173  (Vite dev server — hot reload)
3. When ready, you open a Pull Request: develop → main on GitHub.
4. You review, then merge the PR.
5. GitHub Actions fires on the merge to main (GitHub cloud runner — ubuntu-latest):
   a. Reads commit messages to decide the version bump type.
   b. Creates and pushes a new git tag (vX.Y.Z) + GitHub Release.
   c. Builds Docker images (backend + frontend) on the GitHub runner.
   d. Pushes images to GHCR: ghcr.io/<org>/atd-backend:vX.Y.Z + :latest
   e. SSHes into the Dell → runs deploy.sh vX.Y.Z:
      → docker pull ghcr.io/…/atd-backend:vX.Y.Z
      → docker pull ghcr.io/…/atd-frontend:vX.Y.Z
      → docker compose up -d  (no --build — Dell never builds anything)
      → alembic upgrade head
6. App is live at http://alphatradingdesk.local in ~2 min.
```

> **The Dell never builds images and never touches source code.**
> It only pulls pre-built images from GHCR and runs them.
> Build happens on GitHub's cloud runner — fast, clean, portable.
> SSH from GitHub → Dell is secured via a deploy key stored in GitHub Secrets.

### Overview diagram

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart TD
    subgraph MAC["`**Mac** — dev`"]
        direction TB
        devbranch["`develop branch
        localhost:5173`"]
        feat["`feature/* or fix/*`"]
        feat -->|merge| devbranch
    end

    subgraph GH["`**GitHub Actions** — cloud runner`"]
        direction TB
        pr["`Pull Request
        develop → main`"]
        main["`main branch`"]
        tag["`Tag vX.Y.Z
        GitHub Release`"]
        build["`docker build
        backend + frontend`"]
        push["`docker push
        ghcr.io/…/atd:vX.Y.Z`"]
        pr -->|merge| main
        main --> tag
        tag --> build --> push
    end

    subgraph DELL["`**Dell** — prod (runtime only)`"]
        direction TB
        pull["`docker pull
        ghcr.io/…/atd:vX.Y.Z`"]
        up["`docker compose up
        (no --build)`"]
        migrate["`alembic upgrade head`"]
        live["`alphatradingdesk.local`"]
        pull --> up --> migrate --> live
    end

    devbranch -->|"1 push + open PR"| pr
    push -->|"2 SSH → deploy.sh vX.Y.Z"| pull
```

### 9.1 — Branch strategy

```
main        ← production branch — only receives merges from develop via PR
develop     ← integration branch — where you work daily
feature/*   ← optional feature branches (off develop)
fix/*       ← optional bugfix branches (off develop)

Day-to-day workflow:
  1. git checkout develop       (or create feature/my-feature off develop)
  2. Make your changes
  3. git add . && git commit -m "feat: add economic calendar step"
  4. git push origin develop
  5. Test: http://localhost:5173 (Vite hot reload — instant feedback)
  6. Repeat until feature is solid

Release workflow:
  1. Open PR on GitHub: develop → main
  2. Review diff, merge PR (squash commit → single clean message, or merge commit)
  3. GitHub Actions fires → reads commit type → tags → deploys
  4. Done — no manual steps on the server

Rules:
  → Never push directly to main
  → develop can be messy — main is always deployable
  → Each merge to main = one release candidate
```

### 9.2 — Semantic versioning from commit messages

Commit message convention (Conventional Commits):

```
Prefix          Example                                    Version bump
─────────────────────────────────────────────────────────────────────
fix:            fix: correct SL calculation rounding       PATCH  v1.0.0 → v1.0.1
feat:           feat: add economic calendar to analysis    MINOR  v1.0.1 → v1.1.0
feat!:          feat!: redesign trade form API             MAJOR  v1.1.0 → v2.0.0
BREAKING CHANGE (in footer)  → same as feat!              MAJOR
chore:          chore: update deps                         no tag (ignored by CD)
docs:           docs: update README                        no tag (ignored by CD)
refactor:       refactor: extract risk service             no tag (ignored by CD)
test:           test: add unit tests for goals             no tag (ignored by CD)

Rules:
  feat!: prefix   OR   "BREAKING CHANGE:" in commit footer  →  MAJOR  vX.0.0
  feat: prefix                                              →  MINOR  v1.X.0
  fix:  prefix                                              →  PATCH  v1.0.X
  anything else                                             →  no release

Tag format:  v{major}.{minor}.{patch}
Tag created on: main only, after PR merge — never on develop
```

**Examples:**

```
Merge "fix: correct SL rounding when price < 1"    → v1.0.0 → v1.0.1
Merge "feat: add economic calendar to analysis"     → v1.0.1 → v1.1.0
Merge "feat: add Gold module"                       → v1.1.0 → v1.2.0
Merge "feat!: redesign trade form API (breaks /api/trades POST)"
                                                    → v1.2.0 → v2.0.0
Merge "chore: update node dependencies"             → no tag, no deploy
Merge "docs: update README"                         → no tag, no deploy
```

### 9.3 — GitHub Actions workflow (`.github/workflows/cd.yml`)

Already exists at `.github/workflows/cd.yml` — see `CI_CD.md` for the full spec.

Summary of what it does on every merge to main:
1. Compute next semver tag from commit messages
2. `docker build` backend + frontend images on the GitHub cloud runner
3. `docker push` → GHCR (`ghcr.io/<org>/atd-backend:vX.Y.Z` + `:latest`)
4. Create GitHub Release + auto-changelog
5. SSH into the Dell → `~/apps/deploy.sh vX.Y.Z`
   - `docker pull ghcr.io/…/atd-backend:vX.Y.Z`
   - `docker pull ghcr.io/…/atd-frontend:vX.Y.Z`
   - `docker compose up -d` (no `--build` — Dell never builds anything)
   - `alembic upgrade head`

> **The Dell never builds images.** Build happens on GitHub's cloud runner.
> The Dell is a pure runtime — it only pulls and runs pre-built images from GHCR.
> SSH from GitHub cloud → Dell is secured via a deploy key in GitHub Secrets (`DELL_SSH_KEY`).

### 9.4 — GitHub Secrets (to set up once on the repo)

```
GITHUB_TOKEN      ← auto-provided (pushes git tags + GHCR login — no setup needed)
DELL_HOST         ← IP or LAN hostname of the Dell (e.g. 192.168.1.50)
DELL_USER         ← SSH user on Dell (e.g. atd)
DELL_SSH_KEY      ← private SSH key — GitHub SSHes into the Dell to trigger deploy
```

> Generate a dedicated deploy keypair (not your personal key):
> ```bash
> ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/atd_deploy
> # → Add ~/.ssh/atd_deploy.pub to Dell: echo "..." >> ~/.ssh/authorized_keys
> # → Add ~/.ssh/atd_deploy (private) to GitHub Secrets as DELL_SSH_KEY
> ```

### 9.5 — Deploy script + Makefile

> Content documented in [`implement-phase1.md` → Step 14](implement-phase1.md#step-14--scripts--tooling-once-app-runs-end-to-end).
>
> To create at Step 14:
> - `scripts/deploy.sh` — placed at `~/apps/deploy.sh` on the Dell, called by the runner and by `make deploy`
> - `Makefile` — `make dev`, `make deploy`, `make deploy-tag`, `make db-sync` (Mac entry point for all ops)

### 9.6 — Daily workflow (once everything is running)

```
Dev loop:
  1. git checkout develop
  2. make changes, git commit -m "feat: ..."
  3. git push origin develop
  4. Test: http://localhost:5173

Release:
  1. Open PR: develop → main on GitHub
  2. Review + merge
  3. GitHub Actions: detects "feat:" → creates v1.2.0 → deploys to Dell
  4. http://alphatradingdesk.local updated in ~2 min

Rollback:
  make deploy-tag → enter v1.1.9 → previous version live in ~1 min
```

---

## 10. Maintenance & Ops

### Check what's running

```bash
# On the Dell:
docker compose -f ~/apps/AlphaTradingDesk/docker-compose.prod.yml ps
docker stats --no-stream      # CPU/RAM per container
df -h                          # disk usage
free -h                        # RAM usage
```

### Logs

```bash
# All services:
docker compose -f ~/apps/AlphaTradingDesk/docker-compose.prod.yml logs -f

# Just backend:
docker compose -f ~/apps/AlphaTradingDesk/docker-compose.prod.yml logs -f backend

# Last 100 lines:
docker compose -f ~/apps/AlphaTradingDesk/docker-compose.prod.yml logs --tail=100 backend
```

### Restart after power outage

```bash
# Docker and containers start automatically (docker.service + restart: unless-stopped)
sudo systemctl is-enabled docker    # should say "enabled"
```

### Server reboot

```bash
sudo reboot
# Wait 30s, then:
ssh atd
docker ps     # verify all containers restarted
```

---

## 11. Data Strategy — Volumes, Backups & Dev DB

### 11.1 — Architecture: two phases, two configs

#### Phase DEV MAC (Steps 1–13)

```
Mac
└── docker-compose.dev.yml
    ├── db (postgres:16-alpine) ← Postgres runs locally on Mac
    ├── backend
    └── frontend
→ DATABASE_URL=postgresql://atd:dev_password@localhost:5432/atd_dev
→ No Dell needed. Work fully offline if needed.
```

#### After migration (Step 14.0+) — Dell hosts everything

```
Dell server (always-on)
└── PostgreSQL container
    ├── atd_prod   ← production data (written by prod backend)
    └── atd_dev    ← dev data (migrated from Mac, refreshed from prod every 4h)

Mac (dev machine)
└── docker-compose.dev.yml  (db service removed — no local Postgres)
└── .env.dev → DATABASE_URL=postgresql://atd:<pw>@192.168.1.50:5432/atd_dev
```

**Why move dev DB to Dell after Step 14?**
- Mac can be off — `atd_dev` is always reachable on LAN
- No sync to manage between two machines
- `atd_dev` stays in sync with prod data (refreshed every 4h — see §11.4)
- Clean separation: prod data never touched by dev code

### 11.2 — Volume & log layout on the Dell

```
/srv/atd/
├── data/
│   ├── postgres/           ← Docker bind mount (persistent DB files)
│   └── caddy/              ← Caddy data (TLS certs if ever enabled)
├── logs/
│   ├── app/                ← Application logs (FastAPI, Alembic, gunicorn)
│   │   ├── backend.log     ← rotated by Docker logging driver
│   │   └── alembic.log
│   ├── system/             ← OS-level logs (Docker daemon, cron daemon)
│   │   └── docker.log      ← symlink or redirect from journald if needed
│   └── cron/               ← Output of all cron jobs
│       ├── backup-db.log
│       └── (future cron jobs)
└── backups/
    ├── daily/              ← pg_dump .gz files, kept 30 days
    └── weekly/             ← pg_dump .gz files, kept 12 weeks
```

Create on the Dell before first start:
```bash
sudo mkdir -p /srv/atd/data/postgres /srv/atd/data/caddy
sudo mkdir -p /srv/atd/logs/app /srv/atd/logs/system /srv/atd/logs/cron
sudo mkdir -p /srv/atd/backups/rolling /srv/atd/backups/weekly
sudo chown -R atd:atd /srv/atd
```

In `docker-compose.prod.yml`, mount volumes explicitly and configure log rotation:
```yaml
services:
  db:
    image: postgres:15-alpine
    volumes:
      - /srv/atd/data/postgres:/var/lib/postgresql/data

  backend:
    volumes:
      - /srv/atd/logs/app:/app/logs   # FastAPI writes here
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "5"         # keep 5 × 20 MB = 100 MB max per service
```

**Dev logs** — hors repo, créés au démarrage :
```
~/Library/Logs/atd/        ← logs des cron Mac (rsync, db-refresh)
  ├── atd-db-refresh.log
  └── atd-backup-sync.log

[project]/logs/            ← logs dev de l'app (gitignored — créé par make dev ou l'app)
  └── app/                 ← uvicorn --reload output redirigé ici
```
> `logs/` n'est pas tracké en git. Il est créé automatiquement au premier `make dev`
> (ou par l'app elle-même au démarrage). Aucun `.gitkeep`, aucun dossier vide dans le repo.

### 11.3 — Automated backups on the Dell (Docker + cron)

**Strategy:**
- `pg_dump` runs inside the `db` container via `docker exec`
- Host cron triggers it — no extra container needed
- Dumps are gzip-compressed → ~5–20 MB per dump
- Every 6h: keep 48 dumps (~12 days rolling). Weekly (Sunday 03:00): keep 12 weeks.
- Old files pruned automatically by the same cron

**Cron on the Dell** (`crontab -e` as user `atd`):

```cron
# Backup every 6 hours — keep last 48 dumps (~12 days rolling)
0 */6 * * * /home/atd/apps/AlphaTradingDesk/scripts/backup-db.sh rolling >> /srv/atd/logs/cron/backup-db.log 2>&1

# Weekly backup every Sunday at 03:00 — keep 12 weeks
0 3 * * 0 /home/atd/apps/AlphaTradingDesk/scripts/backup-db.sh weekly >> /srv/atd/logs/cron/backup-db.log 2>&1
```

> **`0 */6 * * *`** = at minute 0 of every 6th hour → 00:00, 06:00, 12:00, 18:00.
> Adjust the interval by changing `*/6` : `*/4` = every 4h, `*/12` = every 12h.

**`scripts/backup-db.sh`** (to create at Step 14):
```bash
#!/usr/bin/env bash
# backup-db.sh <rolling|weekly>
# Dumps atd_prod, gzips it, prunes old files.
set -euo pipefail

MODE=${1:-rolling}
BACKUP_DIR="/srv/atd/backups/${MODE}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="${BACKUP_DIR}/atd_prod_${TIMESTAMP}.sql.gz"
COMPOSE="/home/atd/apps/AlphaTradingDesk/docker-compose.prod.yml"

echo "[$(date)] Starting ${MODE} backup → ${FILE}"

docker compose -f "$COMPOSE" exec -T db \
  pg_dump -U atd atd_prod | gzip > "$FILE"

echo "[$(date)] Backup done: $(du -sh "$FILE" | cut -f1)"

# Prune old files
# rolling: keep last 48 dumps (6h × 48 = 12 days)
# weekly:  keep last 12 (12 weeks)
if [ "$MODE" = "rolling" ]; then
  ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +49 | xargs -r rm --
fi
if [ "$MODE" = "weekly" ]; then
  ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +13 | xargs -r rm --
fi

echo "[$(date)] Pruned old ${MODE} backups. Current count: $(ls "$BACKUP_DIR"/*.sql.gz 2>/dev/null | wc -l)"
```

> **Pruning by count** (`ls -1t | tail -n +N | xargs rm`) rather than by age (`-mtime`) →
> works correctly regardless of backup frequency changes. Always keeps exactly N most recent dumps.

### 11.4 — Dev DB refresh: prod → dev (automated, on Dell)

```
Direction: atd_prod → atd_dev  ONLY. Dev never writes to prod.
Runs entirely on the Dell — Mac not involved.

When:
  - Cron on Dell every 4h (same machine, instant — no network transfer)
  - On-demand: ssh atd "~/apps/AlphaTradingDesk/scripts/refresh-dev-db.sh"
```

**How it works:**

```
Dell cron (every 4h)
  └─ pg_dump atd_prod → pipe → psql atd_dev  (DROP + CREATE + restore)
  └─ scrub: UPDATE news_provider_config SET api_key_encrypted = NULL, enabled = FALSE
```

> Tout se passe sur le Dell dans le même container Postgres.
> Pas de transfert réseau, pas de Mac impliqué. Latence ~secondes.

**Cron on the Dell** (ajouter au crontab Dell):
```cron
# Refresh atd_dev from atd_prod every 4 hours
0 */4 * * * /home/atd/apps/AlphaTradingDesk/scripts/refresh-dev-db.sh >> /srv/atd/logs/cron/refresh-dev-db.log 2>&1
```

**`scripts/refresh-dev-db.sh`** (to create at Step 14):
```bash
#!/usr/bin/env bash
# refresh-dev-db.sh — runs ON the Dell
# Dumps atd_prod and restores into atd_dev, scrubs secrets.
set -euo pipefail

COMPOSE="/home/atd/apps/AlphaTradingDesk/docker-compose.prod.yml"
DB_USER="atd"

echo "[$(date)] Refreshing atd_dev from atd_prod..."

# Dump prod and restore directly into dev (pipe — no tmp file needed)
docker compose -f "$COMPOSE" exec -T db \
  pg_dump -U "$DB_USER" atd_prod | \
docker compose -f "$COMPOSE" exec -T db \
  bash -c "psql -U $DB_USER -c 'DROP DATABASE IF EXISTS atd_dev;' && \
           psql -U $DB_USER -c 'CREATE DATABASE atd_dev OWNER $DB_USER;' && \
           psql -U $DB_USER atd_dev"

# Scrub secrets
docker compose -f "$COMPOSE" exec -T db \
  psql -U "$DB_USER" atd_dev -c \
  "UPDATE news_provider_config SET api_key_encrypted = NULL, enabled = FALSE;"

echo "[$(date)] ✅ atd_dev refreshed (secrets scrubbed)."
```

### 11.5 — Mac backup: pull prod dumps from Dell

En plus des backups sur le Dell, les dumps sont copiés sur le Mac automatiquement.
Si le Dell tombe (SSD mort, etc.), tu as une copie locale.

**Cron sur Mac** (ajouter au même `crontab`):
```cron
# Pull new prod backups from Dell every 4 hours (--ignore-existing = never re-downloads)
0 */4 * * * rsync -az --ignore-existing \
  atd@alphatradingdesk.local:/srv/atd/backups/rolling/ \
  ~/Backups/AlphaTradingDesk/rolling/ \
  >> ~/Library/Logs/atd-backup-sync.log 2>&1

# Pull weekly backups every 4 hours too (lightweight — files rarely change)
0 */4 * * * rsync -az --ignore-existing \
  atd@alphatradingdesk.local:/srv/atd/backups/weekly/ \
  ~/Backups/AlphaTradingDesk/weekly/ \
  >> ~/Library/Logs/atd-backup-sync.log 2>&1
```

> **`--ignore-existing`** = skip files already on Mac → only new dumps are transferred.
> Mac éteint → occurrence ratée, le Dell garde ses backups. Rattrapage automatique à la reconnexion.

### 11.6 — Summary

```
Dell (always-on)
├── atd_prod                  ← app data, written by backend
├── atd_dev                   ← refreshed every 4h from prod (scrubbed secrets)
├── /srv/atd/data/            ← Docker bind mounts (persistent, survives restarts)
├── /srv/atd/logs/            ← created by server setup script — NOT in git
│   ├── app/                  ← FastAPI / gunicorn logs
│   ├── system/               ← Docker daemon, OS-level
│   └── cron/                 ← backup-db.log + future cron jobs
└── /srv/atd/backups/
    ├── rolling/ (last 48)    ← every 6h — ~12 days of point-in-time recovery
    └── weekly/  (12 weeks)   ← every Sunday 03:00

Mac (dev machine, can be off)
├── .env.dev → Dell:5432/atd_dev        (no local Postgres)
├── ~/Backups/AlphaTradingDesk/         ← rsync pull from Dell every 4h
├── ~/Library/Logs/atd-*.log            ← cron output (rsync, db-refresh)
└── [project]/logs/                     ← dev app logs — gitignored, created by make dev
```

**All crons use `*/N` intervals — no fixed clock times:**
```
Dell cron:  */6h backup (rolling) + Sunday weekly
Mac cron:   */4h dev DB refresh + */4h rsync pull
```

**Rollback prod DB (disaster recovery):**
```bash
# On the Dell — restore latest rolling backup:
LATEST=$(ls -1t /srv/atd/backups/rolling/*.sql.gz | head -1)
zcat "$LATEST" | \
  docker compose -f ~/apps/AlphaTradingDesk/docker-compose.prod.yml \
  exec -T db psql -U atd atd_prod
```

---

```
Router admin:           http://192.168.1.1
Dell server IP:         192.168.1.50  (DHCP reservation + static OS)
App (LAN domain):       http://alphatradingdesk.local
SSH from Mac:           ssh atd
```

