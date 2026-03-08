# 🚀 Deployment Guide — AlphaTradingDesk Phase 1

> From a fresh commit on `develop` to a live app at `http://alphatradingdesk.local`.  
> Two environments: **dev** (your Mac) and **prod** (Dell server via Docker + CD).

---

## 📋 Table of Contents

1. [Environments overview](#1-environments-overview)
2. [Dev — daily workflow](#2-dev--daily-workflow)
3. [Dev — rebuild images locally](#3-dev--rebuild-images-locally)
4. [Staging / testing a prod-like build locally](#4-staging--test-a-prod-like-build-locally)
5. [Production — first deploy](#5-production--first-deploy)
6. [Production — CD flow (every release)](#6-production--cd-flow-every-release)
7. [Production — manual deploy / rollback](#7-production--manual-deploy--rollback)
8. [Database — migrations](#8-database--migrations)
9. [Database — seeds](#9-database--seeds)
10. [Troubleshooting](#10-troubleshooting)
11. [Use cases — common data changes](#11--use-cases--common-data-changes)

---

## 1. Environments overview

| | Dev (Mac) | Prod (Dell) |
|--|-----------|------------|
| **How to start** | `make dev` | Automatic via CD on merge to `main` |
| **Images** | Built on-the-fly by Docker Compose | Pulled from GHCR (never built on server) |
| **DB** | Local Postgres container, ephemeral | `/srv/atd/data/postgres/` bind mount, persistent |
| **URL** | `http://localhost:5173` | `http://alphatradingdesk.local` |
| **Secrets** | `.env.dev` (gitignored) | `~/apps/.env` on the Dell (never in git) |
| **Hot reload** | ✅ Vite HMR + uvicorn --reload | ❌ containers restart only on new image |

---

## 2. Dev — daily workflow

```bash
# Start everything (Postgres + backend + frontend)
make dev

# Backend only (faster, reuses existing Postgres)
make backend        # uvicorn --reload :8000

# Frontend only
make frontend       # vite dev :5173

# Run all tests (ruff + mypy + pytest + eslint + vitest)
make test

# Backend tests only
APP_ENV=test .venv/bin/pytest tests/ -q

# Frontend tests only
cd frontend && npm test

# Stop everything
make down

# See all commands
make help
```

The dev stack reads `.env.dev`. Copy from the example if you don't have it:

```bash
cp .env.example .env.dev
# Edit: set POSTGRES_PASSWORD (anything works for dev)
```

---

## 3. Dev — rebuild images locally

You only need this when you change a `Dockerfile` or want to test the exact prod image.

```bash
# Rebuild backend image
docker compose -f docker-compose.dev.yml build backend

# Rebuild frontend image
docker compose -f docker-compose.dev.yml build frontend

# Rebuild everything from scratch (no cache)
docker compose -f docker-compose.dev.yml build --no-cache

# Rebuild + restart
docker compose -f docker-compose.dev.yml up --build -d
```

> 💡 **Normal dev** uses Vite HMR and uvicorn `--reload` — no rebuild needed on code changes.  
> Rebuild only when `Dockerfile`, `pyproject.toml`, `package.json`, or `nginx.conf` changes.

---

## 4. Staging — test a prod-like build locally

Useful before merging to `main` to catch image-build issues.

```bash
# Build prod images locally (same as what CD does)
docker build -t atd-backend:local -f Dockerfile.backend .
docker build -t atd-frontend:local -f frontend/Dockerfile ./frontend

# Run them together with prod compose (point to local images)
IMAGE_TAG=local GHCR_OWNER=local \
  docker compose -f ~/apps/docker-compose.prod.yml up -d

# Check
curl http://localhost:8000/api/health   # → {"status": "ok"}
open http://localhost                   # → frontend

# Tear down
docker compose -f ~/apps/docker-compose.prod.yml down
```

---

## 5. Production — first deploy

> ⚠️ **One-time setup.** Do this ONCE before your first `feat:` merge to `main`.

### Order matters

```
1. Dell OS + Docker ready  (SERVER_SETUP.md §1–6)
2. Run setup-server.sh     (§7 below)
3. Set GitHub Secrets      (SERVER_SETUP.md §8)
4. Tag v0.9.0              (so first release = v1.0.0)
5. Merge feat: PR → main   (CD fires automatically)
```

### Step 1 — Provision the Dell (once)

```bash
# From your Mac — copy the provisioning script to the Dell
scp scripts/prod/setup-server.sh atd@<server-ip>:~/setup-server.sh

# On the Dell
ssh atd@<server-ip>
chmod +x ~/setup-server.sh
~/setup-server.sh
```

This script installs Docker, Tailscale, creates `/srv/atd/` directories,
generates `~/apps/.env` template, copies all prod scripts, and writes
`docker-compose.prod.yml`. It is **idempotent** — safe to re-run.

### Step 2 — Fill in secrets on the Dell

```bash
# On the Dell
nano ~/apps/.env
# Replace POSTGRES_PASSWORD with a real value (openssl rand -hex 24)
# Sync to DB env file:
grep "^POSTGRES_" ~/apps/.env > /srv/atd/.env.db
chmod 600 /srv/atd/.env.db
```

### Step 3 — Set GitHub Secrets

Go to: **GitHub repo → Settings → Secrets and variables → Actions**

| Secret | Value |
|--------|-------|
| `DELL_HOST` | Tailscale IP (`tailscale ip -4` on Dell) |
| `DELL_USER` | `atd` |
| `DELL_SSH_KEY` | private key (`~/.ssh/atd_deploy_key`) |
| `TAILSCALE_AUTHKEY` | reusable key from tailscale.com/admin |

See full instructions: [`SERVER_SETUP.md §8`](phases/phase1/SERVER_SETUP.md#8-github-secrets)

### Step 4 — Set the v1.0.0 baseline tag

```bash
# From your Mac (on develop or main)
git tag v0.9.0
git push origin v0.9.0
# First feat: merge → main will now create v1.0.0
```

### Step 5 — Trigger the first deploy

```bash
# Open a PR: develop → main
# Must contain at least one feat: or fix: commit
# Merge it → CD fires automatically
```

CD will:
1. Build `atd-backend:v1.0.0` + `atd-frontend:v1.0.0` → push to GHCR
2. Create GitHub Release `v1.0.0`
3. SSH into Dell → `deploy.sh v1.0.0`
4. `docker compose up -d` + `alembic upgrade head`

App live at `http://alphatradingdesk.local` in ~5 min.

---

## 6. Production — CD flow (every release)

Every merge to `main` that contains a `feat:` or `fix:` commit:

```
merge → main
  ① semver computed from commit messages
     feat: → MINOR   fix:/chore:/refactor: → PATCH   feat!: → MAJOR
     docs:/test:/ci:/db: → NO RELEASE

  ② docker build backend → ghcr.io/<org>/atd-backend:vX.Y.Z + :latest
  ③ docker build frontend → ghcr.io/<org>/atd-frontend:vX.Y.Z + :latest

  ④ GitHub Release created with auto-changelog

  ⑤ Scripts synced to Dell:
     deploy.sh / backup-db.sh / healthcheck.sh / setup-cron.sh → ~/apps/

  ⑥ SSH → Dell → deploy.sh vX.Y.Z
     → docker pull both images
     → docker compose up -d  (rolling restart, DB untouched)
     → alembic upgrade head  (auto-migration in entrypoint)

Total time: ~4–6 min from merge to live
```

---

## 7. Production — manual deploy / rollback

```bash
# SSH into Dell
ssh atd

# Deploy a specific version (images must exist on GHCR)
export GHCR_OWNER=<your-github-org-or-username>
~/apps/deploy.sh v1.2.3

# Rollback to previous version
~/apps/deploy.sh v1.2.2

# Check what's running
docker compose -f ~/apps/docker-compose.prod.yml ps
docker compose -f ~/apps/docker-compose.prod.yml logs -f backend

# Full health check
~/apps/healthcheck.sh
```

---

## 8. Database — migrations

Migrations run **automatically** on every container start via `scripts/entrypoint.sh`.  
You never need to run Alembic manually in production.

### Dev — create a new migration

```bash
# After editing SQLAlchemy models in src/core/models/
make migration MSG="add snapshots table"
# → creates database/migrations/versions/<hash>_add_snapshots_table.py

# Review the generated file, then apply:
make migrate        # alembic upgrade head

# Downgrade one step (if needed):
make downgrade
```

### Verify migration state

```bash
# Dev
APP_ENV=dev .venv/bin/alembic current

# Prod (on Dell)
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  alembic current
```

---

## 9. Database — seeds

Seeds populate reference data (instruments, brokers, MA modules, etc.).  
They run automatically on first start via the entrypoint.

### Manual seed (if needed)

```bash
# Dev
APP_ENV=dev .venv/bin/python -m database.migrations.seeds.seed_all

# Prod
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  python -m database.migrations.seeds.seed_all
```

### Backup & restore (prod)

```bash
# Manual backup now
~/apps/backup-db.sh rolling

# Restore latest backup
LATEST=$(ls -1t /srv/atd/backups/rolling/*.sql.gz | head -1)
zcat "$LATEST" | \
  docker compose -f ~/apps/docker-compose.prod.yml exec -T db \
  psql -U atd atd_prod
```

---

## 10. Troubleshooting

### Container won't start

```bash
docker compose -f ~/apps/docker-compose.prod.yml logs backend
docker compose -f ~/apps/docker-compose.prod.yml logs db
```

### Migration failed on startup

```bash
# Check entrypoint logs
docker compose -f ~/apps/docker-compose.prod.yml logs backend | grep -i alembic

# Force re-run migration manually
docker compose -f ~/apps/docker-compose.prod.yml exec backend alembic upgrade head
```

### Image pull fails (GHCR auth)

```bash
# For private repos — login on the Dell
echo "<YOUR_PAT>" | docker login ghcr.io -u <github-username> --password-stdin
```

### DB data after accidental `docker compose down -v`

> ✅ **Not an issue.** We use bind mounts, not named volumes.  
> `docker compose down -v` only removes named volumes.  
> Your data lives in `/srv/atd/data/postgres/` — untouched.

### Check disk space

```bash
df -h /srv/atd
docker system df         # Docker image/container usage
docker system prune -f   # clean up unused images (safe)
```

### Full health overview

```bash
~/apps/healthcheck.sh    # prints container status, disk, backups
```

---

## 11. 🧩 Use Cases — common data changes

Practical recipes for the most common "I need to change X" situations.  
All seeds are **idempotent** — safe to re-run at any time on any environment.

---

### 11.1 — Add a trading pair (Kraken or Vantage)

**File:** `database/migrations/seeds/seed_instruments.py`

```python
# In KRAKEN_INSTRUMENTS list — example: add a new perp
{"symbol": "PF_TONUSD", "display_name": "Toncoin (TON)", "min_lot": Decimal("1"), "max_leverage": 10, **_KRAKEN_BASE},

# In VANTAGE_INSTRUMENTS list — example: add a new CFD
{"symbol": "USOIL",  "display_name": "US Crude Oil",  "asset_class": "Commodity", ...},
```

**Deploy:**

```bash
# 1. Edit the file on your Mac
# 2. Commit + push to develop
git add database/migrations/seeds/seed_instruments.py
git commit -m "db: add TON/USD and USOIL instruments to seed"
git push origin develop

# 3. Merge to main (if it's a db: commit, no release, but seeds re-run on next deploy)
#    OR re-seed immediately on dev:
APP_ENV=dev .venv/bin/python -m database.migrations.seeds.seed_all

# 4. Re-seed prod manually (no restart needed — seeds are idempotent):
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  python -m database.migrations.seeds.seed_all
```

> 💡 New instruments appear immediately in the Trade form dropdown after re-seeding.  
> Existing trades are NOT affected.

---

### 11.2 — Add a broker

**File:** `database/migrations/seeds/seed_brokers.py`

```python
# In the BROKERS list:
{
    "name": "OANDA",
    "market_type": "CFD",
    "default_currency": "USD",
    "is_predefined": True,
    "status": "active",
},
```

Then add its instruments in `seed_instruments.py` (same pattern as Vantage).

**Deploy:**

```bash
git add database/migrations/seeds/seed_brokers.py \
        database/migrations/seeds/seed_instruments.py
git commit -m "db: add OANDA broker + instruments to seed"
git push origin develop

# Re-seed dev:
APP_ENV=dev .venv/bin/python -m database.migrations.seeds.seed_all

# Re-seed prod:
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  python -m database.migrations.seeds.seed_all
```

> ⚠️ Broker names are used as unique keys (`ON CONFLICT DO NOTHING` on `name`).  
> Renaming an existing broker requires a manual SQL update, not a re-seed.

---

### 11.3 — Remove / deactivate an instrument or broker

Seeds use `ON CONFLICT DO NOTHING` — they never delete rows.  
To deactivate without deleting (safe for instruments linked to existing trades):

**Option A — via the UI** (preferred): mark as inactive in the Brokers settings page.

**Option B — direct SQL on dev:**

```bash
APP_ENV=dev .venv/bin/python - <<'EOF'
from src.core.database import get_session_factory
from src.core.models.broker import Instrument
SessionLocal = get_session_factory()
with SessionLocal() as db:
    db.query(Instrument).filter_by(symbol="PF_XBTUSD").update({"is_active": False})
    db.commit()
    print("done")
EOF
```

**Option B — direct SQL on prod:**

```bash
docker compose -f ~/apps/docker-compose.prod.yml exec db \
  psql -U atd atd_prod -c \
  "UPDATE instruments SET is_active = false WHERE symbol = 'PF_XBTUSD';"
```

> ✅ Inactive instruments no longer appear in the trade form but historical trades keep their data.

---

### 11.4 — Modify a global strategy

**File:** `database/migrations/seeds/seed_global_strategies.py`

Edit the strategy name, description, or default parameters in the list, then re-seed:

```bash
git commit -m "db: update ICT OTE strategy description"

# Dev
APP_ENV=dev .venv/bin/python -m database.migrations.seeds.seed_all

# Prod
docker compose -f ~/apps/docker-compose.prod.yml exec backend \
  python -m database.migrations.seeds.seed_all
```

> ⚠️ Global strategies use `ON CONFLICT DO NOTHING` — editing an existing row in the seed
> file does **not** update it in the DB if it already exists.  
> To update an existing strategy: edit it via the UI → Strategies page, or do a direct SQL update.

---

### 11.5 — Add a new seed category entirely (e.g. trading sessions)

1. Create `database/migrations/seeds/seed_<category>.py` — follow the pattern of `seed_brokers.py`
2. Import and call it in `seed_all.py` in the right dependency order
3. Commit as `db: add <category> seed`
4. Re-seed dev + prod

```python
# seed_all.py — add at the right position in dependency order
from database.migrations.seeds.seed_<category> import seed_<category>

# Inside main():
seed_<category>(session)
```

---

### 11.6 — Full re-seed from scratch (dev only)

> ⚠️ **Never wipe prod data.** This is for dev only.

```bash
# Drop and recreate the dev DB, then re-seed
make db-reset       # docker compose down + volume wipe + up + migrate + seed
# OR step by step:
make down
docker volume rm $(docker volume ls -q | grep atd)
make dev
APP_ENV=dev .venv/bin/python -m database.migrations.seeds.seed_all
```
