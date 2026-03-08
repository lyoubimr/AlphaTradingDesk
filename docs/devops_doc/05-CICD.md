# AlphaTradingDesk — CI/CD

**Stack:** GitHub Actions · GHCR · Tailscale · semver (Conventional Commits)

---

## Vue d'ensemble

```
push develop / PR → main
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  atd-test.yml — CI                                   │
│  Job 1: backend  → ruff + mypy + pytest              │
│  Job 2: frontend → eslint + tsc + vitest             │
│  Job 3: build    → docker build (no push)            │
│  Durée: ~2–3 min  ·  bloque le merge si échec        │
└──────────────────────────────────────────────────────┘

PR mergée → main
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  atd-deploy.yml — CD                                 │
│  Step 1: calcul semver (Conventional Commits)        │
│  Step 2: si new_tag → build + push GHCR              │
│  Step 3: scp scripts/prod/*.sh → Dell ~/apps/        │
│  Step 4: GitHub Release + changelog                  │
│  Step 5: Tailscale join network                      │
│  Step 6: SSH Dell → deploy.sh vX.Y.Z                 │
│  Durée: ~4–6 min  ·  de merge à live                 │
└──────────────────────────────────────────────────────┘
```

---

## atd-test.yml — CI Détaillé

**Déclencheurs :**
```yaml
on:
  push:
    branches: [develop]           # push direct sur develop
  pull_request:
    branches: [main, develop]     # toute PR vers main ou develop
```

**Job 1 — backend :**
```yaml
services:
  postgres:
    image: postgres:16-alpine     # container DB dédié au job (détruit après)
    # accessible via localhost:5432 dans le job

steps:
  1. checkout@v4              → git clone
  2. setup-python@v5 (3.11)   → Python sur le runner
  3. pip install poetry        → gestionnaire de deps
  4. poetry install            → depuis poetry.lock (déterministe)
  5. ruff check src/ tests/   → linter
  6. mypy src/                → type checker
  7. pytest tests/ --cov=src  → tests + coverage
     env: APP_ENV=test, DATABASE_URL=postgresql://...
```

**Job 2 — frontend :**
```yaml
steps:
  1. checkout@v4
  2. setup-node@v4 (22, cache: npm)   → cache node_modules entre runs
  3. npm ci                            → install depuis package-lock.json
  4. npm run lint                      → ESLint
  5. npm run type-check                → tsc --noEmit
  6. npm run test                      → vitest
```

**Job 3 — build (needs: [backend, frontend]) :**
```yaml
steps:
  1. docker build backend   (push: false)  → valide Dockerfile.backend
  2. docker build frontend  (push: false)  → valide frontend/Dockerfile
# Images jetées après — uniquement pour catch les erreurs Dockerfile avant le CD
```

---

## atd-deploy.yml — CD Détaillé

**Déclencheur :** `push branches: [main]` uniquement (= PR mergée)

### Step 1 — Calcul semver

```yaml
uses: mathieudutour/github-tag-action@v6.2
with:
  github_token: ${{ secrets.GITHUB_TOKEN }}
  default_bump: false           # pas de bump = pas de release = steps suivants skippés
  custom_release_rules: "chore:patch,refactor:patch"
```

L'action analyse tous les commits depuis le dernier tag :

| Type commit | Bump | Deploy ? |
|-------------|------|---------|
| `feat:` | MINOR (`v1.0.0 → v1.1.0`) | ✅ |
| `feat!:` / `BREAKING CHANGE` | MAJOR (`v1.1.0 → v2.0.0`) | ✅ |
| `fix:` | PATCH (`v1.0.0 → v1.0.1`) | ✅ |
| `chore:` / `refactor:` | PATCH | ✅ |
| `docs:` / `test:` / `ci:` / `db:` / `style:` / `perf:` | — | ❌ |

> **Plusieurs commits dans le merge :** l'action prend le **bump le plus élevé**.
> Ex : `chore:` + `feat:` → MINOR bump → deploy.

Tous les steps suivants ont `if: steps.semver.outputs.new_tag != ''`
→ si pas de nouveau tag = rien ne se passe (CI only).

### Step 2 — Build + Push GHCR

```yaml
# Login
uses: docker/login-action@v3
username: ${{ github.actor }}
password: ${{ secrets.GITHUB_TOKEN }}   # auto-injecté, pas besoin de configurer

# Build backend
uses: docker/build-push-action@v5
context: .
file: ./Dockerfile.backend
push: true
tags: |
  ghcr.io/${{ github.repository_owner }}/atd-backend:${{ steps.semver.outputs.new_tag }}
  ghcr.io/${{ github.repository_owner }}/atd-backend:latest

# Build frontend
context: ./frontend
file: ./frontend/Dockerfile
# mêmes tags pour atd-frontend
```

### Step 3 — Sync scripts prod

```yaml
uses: appleboy/scp-action@v0.1.7
source: "scripts/prod/*.sh"
target: "/home/atd/apps/"
strip_components: 2             # retire "scripts/prod/" → atterrit dans ~/apps/

# Puis chmod +x via SSH
ssh: "chmod +x ~/apps/*.sh"
```

Scripts auto-synchonisés : `deploy.sh` · `backup-db.sh` · `setup-cron.sh` · `healthcheck.sh` · `setup-ssl.sh` · `update-server.sh`

> `scripts/setup-server.sh` est exclu — provisioning OS, exécuté une seule fois manuellement avant que CI/CD existe.

### Step 4 — GitHub Release

```yaml
uses: softprops/action-gh-release@v2
tag_name: ${{ steps.semver.outputs.new_tag }}
# → Génère changelog automatique (liste des commits depuis le tag précédent)
# → Crée la release sur github.com/repo/releases
```

### Step 5 — Tailscale

```yaml
uses: tailscale/github-action@v2
authkey: ${{ secrets.TAILSCALE_AUTHKEY }}
# → Le runner GitHub rejoint le réseau Tailscale
# → Peut maintenant atteindre le Dell via 100.x.x.x
```

**Pourquoi Tailscale ?**
```
GitHub Actions runners = VMs dans les datacenters GitHub (internet)
Dell = derrière ta box internet (192.168.1.x = LAN privé, non routable depuis internet)
Ta box ne fait PAS de port forwarding SSH → runners ne peuvent PAS atteindre le Dell

Solutions :
  ✅ Tailscale (mesh VPN P2P) — Dell rejoint Tailscale (IP 100.x.x.x)
     Runner rejoint le même réseau → SSH vers 100.x.x.x comme si direct
  ✅ Self-hosted runner (alternative)
     Runner installé sur le Dell → dans le même réseau → pas besoin de tunnel
     Mais : process à maintenir, pas de matrice de runners
```

### Step 6 — SSH Deploy

```yaml
uses: appleboy/ssh-action@v1
host: ${{ secrets.DELL_HOST }}       # 100.x.x.x (Tailscale)
username: ${{ secrets.DELL_USER }}   # atd
key: ${{ secrets.DELL_SSH_KEY }}     # clé privée ed25519
script: |
  export GHCR_OWNER="${{ github.repository_owner }}"
  ~/apps/deploy.sh "${{ steps.semver.outputs.new_tag }}"
```

`deploy.sh` sur le Dell :
```bash
docker pull ghcr.io/${GHCR_OWNER}/atd-backend:${VERSION}
docker pull ghcr.io/${GHCR_OWNER}/atd-frontend:${VERSION}
export IMAGE_TAG="$VERSION"
docker compose -f ~/apps/docker-compose.prod.yml up -d --no-build backend frontend
# alembic upgrade head = automatique dans l'entrypoint au redémarrage
docker image prune -f --filter "until=72h"
```

---

## GHCR — Container Registry

```
Tags produits à chaque release :
  ghcr.io/<org>/atd-backend:v1.2.3   → version exacte (immutable, pour rollback)
  ghcr.io/<org>/atd-backend:latest   → toujours la dernière version

Même chose pour atd-frontend.

Voir les images : GitHub → repo → Packages
```

**Auth sur le Dell (repo privé uniquement) :**
```bash
echo "<PAT_read:packages>" | docker login ghcr.io -u <username> --password-stdin
# Credentials sauvegardés dans ~/.docker/config.json — persistants
```

**`GHCR_OWNER` n'est pas un secret** — c'est `github.repository_owner`, variable built-in GitHub Actions. Fonctionne pour n'importe quel fork ou migration d'org sans toucher au code.

---

## GitHub Secrets — Configuration

| Secret | Valeur | Qui l'utilise |
|--------|--------|--------------|
| `GITHUB_TOKEN` | auto-injecté | GHCR push + git tags (pas à configurer) |
| `DELL_HOST` | IP Tailscale du Dell (`100.x.x.x`) | SSH deploy step |
| `DELL_USER` | `atd` | SSH deploy step |
| `DELL_SSH_KEY` | Contenu `~/.ssh/atd_deploy_key` (PRIVATE) | SSH deploy step |
| `TAILSCALE_AUTHKEY` | Clé auth Tailscale (Reusable + Ephemeral) | Tailscale step |
| `GHCR_TOKEN` | PAT `read:packages` (repo privé seulement) | Dell → docker pull |

**Générer la clé SSH deploy :**
```bash
# Sur le Mac — clé dédiée CI/CD (pas ta clé perso)
ssh-keygen -t ed25519 -C "github-actions-atd-deploy" -f ~/.ssh/atd_deploy_key -N ""
# -N "" = pas de passphrase (GitHub Actions = non-interactif)

# Clé PUBLIQUE → Dell
ssh-copy-id -i ~/.ssh/atd_deploy_key.pub atd@192.168.1.100

# Clé PRIVÉE → GitHub Secret DELL_SSH_KEY
cat ~/.ssh/atd_deploy_key | pbcopy  # → coller dans le secret

# Test
ssh -i ~/.ssh/atd_deploy_key atd@192.168.1.100 "echo ✅ OK"
```

**Générer TAILSCALE_AUTHKEY :**
```
https://login.tailscale.com/admin/settings/keys
→ Generate auth key
→ ✅ Reusable  ✅ Ephemeral  ✅ Pre-authorized
→ Expiry: 90 days (rappel calendrier pour renouveler)
```

---

## Stratégie de Merge

**Recommandé : Merge commit** (défaut GitHub)

```
develop contient :
  chore: update deps        → patch
  test: add unit tests      → aucun
  feat: add market analysis → MINOR ← gagne

→ merge → main crée une release MINOR : v1.0.0 → v1.1.0
```

| Stratégie | Comportement | Recommandation |
|-----------|-------------|----------------|
| **Merge commit** (défaut) | Scanne tous les commits → prend le plus élevé | ✅ |
| **Squash merge** | 1 commit → son message doit avoir le bon préfixe | ⚠️ |
| **Rebase** | Même logique que merge commit | ✅ |

> **Forcer un deploy sans feat/fix :** inclure un `fix:` ou `chore:` dans la PR.

---

## Rollback

```bash
# Rollback vers une version précédente
ssh atd "~/apps/deploy.sh v1.2.2"

# Si la migration de la nouvelle version est cassante (rare) :
ssh atd
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  alembic downgrade -1
~/apps/deploy.sh v1.2.2

# Voir toutes les versions disponibles
# GitHub → repo → Releases
# ou
# GitHub → repo → Packages → atd-backend (liste des tags d'images)
```

---

## Dépannage CI/CD

```bash
# CI échoue sur ruff
make backend-lint    # reproduire localement
make backend-fmt     # auto-fix

# CI échoue sur mypy
make backend-typecheck

# CI échoue sur vitest
cd frontend && npm run test

# Deploy échoue (Tailscale)
# Vérifier que TAILSCALE_AUTHKEY n'a pas expiré (90j)
# Renouveler : https://login.tailscale.com/admin/settings/keys

# Deploy échoue (SSH timeout)
ping 100.x.x.x          # Tailscale IP du Dell
ssh -i ~/.ssh/atd_deploy_key atd@100.x.x.x "echo OK"

# Deploy échoue (GHCR pull sur le Dell)
ssh atd "docker pull ghcr.io/<org>/atd-backend:latest"
# Si repo privé → vérifier docker login ghcr.io sur le Dell

# Voir les logs d'un run GitHub Actions
# GitHub → repo → Actions → run échoué → job → step → logs
```
