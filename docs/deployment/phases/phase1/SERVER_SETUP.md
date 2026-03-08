# 🖥️ Server Setup — AlphaTradingDesk Phase 1

**Date:** March 2026 — v3.0  
**Hardware:** Dell OptiPlex Micro (D09U) — Core i7, 65W  
**MAC address:** `18:66:DA:13:01:9D` — LAN IP fixe: `192.168.1.100`  
**Target OS:** Ubuntu Server 24.04 LTS (headless)  
**Deploy model:** Pull pre-built Docker images from GHCR — Dell **never** builds anything

> 📌 **Ce doc contient des valeurs spécifiques à CE déploiement** — à adapter si tu
> réinstalles sur un autre matériel :
>
> | Valeur dans ce doc | Ce que c'est | À remplacer par |
> |--------------------|-------------|-----------------|
> | `192.168.1.100` | IP LAN fixe du Dell | l'IP de ton serveur |
> | `18:66:DA:13:01:9D` | MAC address NIC ethernet | la MAC de ton NIC |
> | `alphatradingdesk.local` | hostname mDNS | le hostname choisi lors de l'install Ubuntu |
> | `192.168.1.1` | gateway routeur | la gateway de ton réseau |
> | `atd` | username Ubuntu | le username choisi lors de l'install |

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
MAC addr:   18:66:DA:13:01:9D           ← ethernet NIC (pour réservation DHCP routeur)
IP LAN:     192.168.1.100               ← fixe (réservation routeur + Netplan)
Tailscale:  100.x.x.x                  ← à noter après §4.7
Hostname:   alphatradingdesk            ← défini pendant l'install Ubuntu

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

### 3.3 — First SSH (avant que l'IP soit fixée)

```bash
# Utiliser l'IP DHCP affichée pendant l'installation
ssh atd@<dhcp-ip>
# accept fingerprint → enter password
# Une fois §5 fait, ce sera toujours: ssh atd@192.168.1.100
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

# Copy to Dell:
ssh-copy-id -i ~/.ssh/atd_key.pub atd@192.168.1.X

# Test:
ssh -i ~/.ssh/atd_key atd@192.168.1.X

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

> Tailscale permet au runner GitHub Actions de se connecter au Dell via un tunnel chiffré,
> sans ouvrir aucun port sur Internet.

```bash
# Sur le Dell:
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up    # suit le lien d'auth dans le navigateur

# Récupérer l'IP Tailscale → c'est la valeur du secret GitHub DELL_HOST
tailscale ip -4
# Exemple: 100.94.12.45  ← noter cette IP
```

> ⚠️ **Mettre cette IP dans le secret GitHub `DELL_HOST`** (voir §8).  
> Ne pas utiliser l'IP LAN `192.168.1.100` pour le secret — les runners GitHub  
> ne peuvent pas résoudre les adresses LAN privées.

## 5. Fix IP Address

Do BOTH — router reservation + OS static config.

### 5.1 — Router DHCP reservation

> La MAC address du Dell est connue : `18:66:DA:13:01:9D`

```
Router admin panel (find URL on your router label):
  Freebox:   http://mafreebox.freebox.fr  → Paramètres → DHCP → Baux statiques
  Bbox:      http://192.168.1.254         → Réseau → DHCP → Réservations
  SFR:       http://192.168.0.1           → Réseau → DHCP
  Livebox:   http://192.168.1.1           → Réseau avancé → DHCP

Add entry:
  MAC:  18:66:DA:13:01:9D
  IP:   192.168.1.100
  Name: alphatradingdesk
  → Save + apply
```

### 5.2 — Static IP on OS (Netplan)

```bash
# Trouver le nom de l'interface ethernet:
ip link show
# Chercher l'interface avec la MAC 18:66:DA:13:01:9D
# Typiquement: enp3s0, eno1, enp0s31f6 ...

sudo nano /etc/netplan/00-installer-config.yaml
```

```yaml
network:
  version: 2
  ethernets:
    enp3s0:                      # ← remplacer par TON nom d'interface
      dhcp4: false
      addresses:
        - 192.168.1.100/24
      routes:
        - to: default
          via: 192.168.1.1       # ← gateway de ton routeur
      nameservers:
        addresses: [1.1.1.1, 8.8.8.8]
      optional: true
```

```bash
sudo netplan apply
# La session SSH tombe — se reconnecter avec la nouvelle IP:
ssh atd@192.168.1.100
# À partir de maintenant, cette IP est permanente
```

### 5.3 — Vérification

```bash
ip addr show           # confirme 192.168.1.100
ping 1.1.1.1           # internet accessible
tailscale ip -4        # Tailscale toujours actif
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

> ⚠️ **Séquençage critique — lire avant de commencer.**
>
> Le Dell doit être **entièrement préparé AVANT le premier merge `feat:` → `main`**.
> Dès que tu merges, la CD se déclenche, build les images, et SSH dans le Dell pour
> les déployer. Si le Dell n't pas prêt, le deploy échoue.
>
> ```
> ORDRE OBLIGATOIRE :
>   §7.1 → §7.2 → §7.3 → §7.4   ← Dell prêt (AVANT le merge)
>   §8.2 → §8.3 → §8.1           ← GitHub Secrets câblés (AVANT le merge)
>   ──────────────────────────────────────────────────────
>   → merge feat: → main          ← CD se déclenche
>   → images buildées + pushées sur GHCR par la CD
>   → deploy.sh v1.0.0 exécuté par la CD via SSH
>   → docker compose up -d + alembic upgrade head  ← automatique
>   ──────────────────────────────────────────────────────
>   §7.5                          ← vérification POST-deploy (pas un setup manuel)
> ```
>
> `docker-compose.prod.yml`, `~/apps/.env` et les scripts sont des **fichiers statiques**
> que tu crées manuellement sur le Dell — ils n'ont pas besoin des images pour exister.
> Les images (GHCR) n'existent qu'après le 1er merge.

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
# Générer les valeurs: openssl rand -hex 24 / openssl rand -hex 32
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
    env_file: /root/apps/.env
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

### 7.4 — Get the deploy script onto the Dell

The deploy script (`scripts/prod/deploy.sh`) lives in the Git repo and is
**automatically synced to `~/apps/` by the CI/CD pipeline on every release**.
You only need to copy it manually for the very first deploy (before CI/CD is wired up):

```bash
# From your Mac — first time only (LAN IP, Tailscale pas encore nécessaire):
scp scripts/prod/deploy.sh \
    scripts/prod/backup-db.sh \
    scripts/prod/healthcheck.sh \
    scripts/prod/setup-cron.sh \
    atd@192.168.1.100:~/apps/

ssh atd@192.168.1.100 "chmod +x ~/apps/*.sh"
```

> After Step 8 (GitHub Secrets) is done, CI/CD handles all future script updates
> automatically — no manual `scp` needed after each release.

**`GHCR_OWNER` — important:**
The script requires `GHCR_OWNER` to be exported before running.
CI/CD injects it automatically (`github.repository_owner`).
For manual runs from the Dell:

```bash
export GHCR_OWNER=<your-github-org-or-username>
~/apps/deploy.sh v1.2.3
```

> Never hardcode a username inside the script — it must remain generic for portability.

### 7.5 — Vérification post-deploy (après le 1er merge → main)

> **La CD fait tout le travail.** Ce bloc est uniquement pour VÉRIFIER que le deploy
> automatique a bien fonctionné — pas pour lancer quoi que ce soit manuellement.

```bash
# Sur le Dell — vérifier que les containers tournent:
docker compose -f ~/apps/docker-compose.prod.yml ps

# Vérifier l'API:
curl http://localhost:8000/api/health    # → {"status": "ok"}

# Depuis ton Mac:
open http://alphatradingdesk.local      # → app live
```

> **Deploy manuel** (si jamais tu as besoin de forcer une version sans passer par la CD) :
> ```bash
> export GHCR_OWNER=<your-github-org-or-username>
> ~/apps/deploy.sh v1.0.0
> ```

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
# On your Mac — clé DÉDIÉE CI/CD (pas ta clé perso):
ssh-keygen -t ed25519 -C "github-actions-atd-deploy" \
           -f ~/.ssh/atd_deploy_key -N ""
# -N "" = pas de passphrase (GitHub Actions a besoin d'auth non-interactive)

# Deux fichiers créés:
#   ~/.ssh/atd_deploy_key      ← PRIVÉE → GitHub Secret DELL_SSH_KEY
#   ~/.ssh/atd_deploy_key.pub  ← PUBLIQUE → Dell authorized_keys

# Copier la clé PUBLIQUE sur le Dell:
ssh-copy-id -i ~/.ssh/atd_deploy_key.pub atd@192.168.1.100

# Tester:
ssh -i ~/.ssh/atd_deploy_key atd@192.168.1.100 "echo ✅ OK"

# Copier la clé PRIVÉE → coller dans GitHub Secret DELL_SSH_KEY:
cat ~/.ssh/atd_deploy_key | pbcopy
# → GitHub → Settings → Secrets → DELL_SSH_KEY → coller → Save
```

> ⚠️ **Clé PRIVÉE → GitHub Secret. Clé PUBLIQUE → Dell `authorized_keys`.**  
> Ne jamais inverser. Ne jamais commiter l'une ou l'autre dans le repo.

### 8.3 — Générer le TAILSCALE_AUTHKEY

```
1. Aller sur: https://login.tailscale.com/admin/settings/keys
2. Cliquer "Generate auth key"
3. Cocher:
   ✅ Reusable    — le runner CI s'exécute à chaque deploy, a besoin de réutilisation
   ✅ Ephemeral   — disparaît de l'admin Tailscale après usage (pas de pollution)
   ✅ Pre-authorized — pas d'approbation manuelle nécessaire
4. Expiration: 90 jours (prévoir un rappel calendrier pour renouveler)
5. Copier la clé → GitHub Secret TAILSCALE_AUTHKEY
```

### 8.4 — Vérifier que les 4 secrets sont bien configurés

```
GitHub → repo → Settings → Secrets and variables → Actions

Tu dois voir exactement:
  DELL_HOST          ✅  (100.x.x.x — IP Tailscale du Dell)
  DELL_USER          ✅  (atd)
  DELL_SSH_KEY       ✅  (contenu complet -----BEGIN OPENSSH PRIVATE KEY-----)
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

### 8.4 — Pourquoi Tailscale ? (GitHub runner ne peut pas atteindre 192.168.1.100)

GitHub cloud runners tournent sur Internet — ils ne peuvent pas SSH dans ton LAN directement.
Tailscale est installé en §4.7. Le workflow CI/CD se connecte au réseau Tailscale via `TAILSCALE_AUTHKEY`
avant d'ouvrir le SSH sur `DELL_HOST` (`100.x.x.x`).

> Tailscale est déjà installé (§4.7) et `TAILSCALE_AUTHKEY` déclaré (§8.1).
> Le step dans `atd-deploy.yml` est déjà configuré — rien à faire manuellement ici.

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

### 11.4 — Merge strategy : quoi faire quand `develop` a plusieurs commits ?

**Utilise un merge ordinaire** (`Create a merge commit` sur GitHub — c'est le défaut).

Le workflow scanne **tous les commits du merge** et prend le bump le plus élevé :

```
develop contient :
  chore: update deps         → patch
  test: add unit tests       → none
  feat: add market analysis  → MINOR  ← gagne

→ Le merge → main crée une release MINOR  v1.0.0 → v1.1.0
```

| Stratégie | Comportement | Recommandation |
|-----------|-------------|----------------|
| **Merge commit** (défaut) | Scanne tous les commits → prend le plus haut | ✅ Recommandé |
| **Squash merge** | 1 seul commit → **son message doit avoir le bon préfixe** (`feat:` / `fix:`) sinon `default_bump: false` → pas de release | ⚠️ Risqué si on oublie |
| **Rebase** | Même logique que merge commit | ✅ OK aussi |

> **Règle simple :** si ta PR contient au moins un commit `feat:` ou `fix:`, la CD se
> déclenche après le merge. Si elle contient uniquement `docs:` / `test:` / `ci:` /
> `chore:` → pas de release, pas de deploy (CI only). C'est voulu.

### 11.5 — Reboot du Dell : les containers redémarrent-ils automatiquement ?

**Oui — 100% automatique.** Deux mécanismes combinés :

```
1. Docker lui-même est activé au boot :
   sudo systemctl enable docker   (fait en §6)

2. Chaque container a restart: unless-stopped dans docker-compose.prod.yml
   → Docker les relance automatiquement après le reboot
```

Séquence au reboot :
```
Serveur reboot
  → systemd démarre Docker
  → db démarre en premier
  → backend attend que db soit healthy (depends_on + healthcheck)
  → frontend démarre
  → app live en ~30 secondes
  → aucune action manuelle requise
```

> `unless-stopped` signifie : redémarre toujours sauf si **tu l'as arrêté manuellement**
> (`docker compose down`). Un reboot ne compte pas comme un arrêt manuel.

Survie des données au reboot :
```
DB data    /srv/atd/data/postgres/  → ✅ bind mount, survit à tout
Uploads    /srv/atd/data/uploads/   → ✅ bind mount, survit à tout
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
chmod +x ~/apps/backup-db.sh
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
║  Dell MAC address    18:66:DA:13:01:9D  (NIC ethernet)               ║
║  Dell LAN IP         192.168.1.100  (DHCP reservation + Netplan)     ║
║  Dell Tailscale      100.x.x.x  → tailscale ip -4  sur le Dell       ║
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
║  DELL_HOST          100.x.x.x  (tailscale ip -4 sur le Dell)         ║
║  DELL_USER          atd                                               ║
║  DELL_SSH_KEY       cat ~/.ssh/atd_deploy_key | pbcopy  (privée)      ║
║  TAILSCALE_AUTHKEY  tailscale.com/admin/settings/keys                 ║
║                     → Reusable + Ephemeral + Pre-authorized           ║
║  GITHUB_TOKEN       auto-injecté (pas de setup)                      ║
║  GHCR_OWNER         PAS un secret (github.repository_owner, auto)    ║
╚══════════════════════════════════════════════════════════════════════╝
```
