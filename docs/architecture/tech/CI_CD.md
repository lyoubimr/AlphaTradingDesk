# 🔄 CI/CD Pipeline — AlphaTradingDesk

**Date:** March 1, 2026
**Version:** 3.0 (registry-based: build on CI → push GHCR → pull on Dell/GCE/Kube)
**Status:** CI created (atd-test.yml) — CD dormant until Dell configured (Step 14)

---

## 🏗️ Pipeline Overview

```
Mac (dev)
  └─ push to develop  ──────────────────────────────────────────────────►
                                                                          │
                                                              PR opened   │
                                                                          ▼
                                               ci.yml  (GitHub cloud runner)
                                               ├─ backend:  ruff + mypy + pytest
                                               └─ frontend: eslint + type-check + vitest
                                                                          │
                                                         ✅ CI green      │
                                                         PR merged to main│
                                                                          ▼
                                               cd.yml  (GitHub cloud runner)
                                               ├─ Compute semver tag
                                               ├─ docker build → image:vX.Y.Z
                                               ├─ docker push → ghcr.io/…/atd:vX.Y.Z
                                               ├─ Create GitHub Release + changelog
                                               └─ SSH into Dell → deploy.sh vX.Y.Z
                                                                          │
                                                                          ▼
                                               Dell (or GCE, or Kube — doesn't matter)
                                               ├─ docker pull ghcr.io/…/atd:vX.Y.Z
                                               ├─ docker compose up   (no build)
                                               └─ alembic upgrade head
```

**Why registry-based?**
- **Portable** — swapping Dell for GCE or Kubernetes = only the deploy target changes, zero pipeline rework
- **Fast deploy** — server just `pull` + `up` (~30 sec), no compile on prod
- **Versioned images** — rollback = `docker pull image:v1.2.2` + `up`
- **Clean separation** — CI builds, CD deploys; the server never touches source code
- **Kube-ready** — Kubernetes only knows how to pull images, never build them

---

## 📁 Workflow Files

```
.github/
└── workflows/
    ├── atd-test.yml    ← ✅ created at Step 1 — runs on every push to develop + PR
    └── atd-deploy.yml  ← ✅ exists — DORMANT until Dell configured (Step 14)
```

---

## 🧪 `atd-test.yml` — Tests on every push / PR

> ✅ **Created at implement Step 1** (project bootstrap).

```yaml
name: CI — Test & Lint

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [develop]

jobs:
  backend:
    name: Backend — lint + typecheck + tests
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_DB: atd_test
          POSTGRES_USER: atd
          POSTGRES_PASSWORD: test_password
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    # Note: no Redis — Celery/Redis are Phase 2+, not needed in Phase 1 tests.

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install Poetry
        run: pip install poetry

      - name: Install dependencies
        run: poetry install --no-root

      - name: Lint (Ruff)
        run: poetry run ruff check src/ tests/

      - name: Type check (mypy)
        run: poetry run mypy src/

      - name: Tests (pytest)
        env:
          DATABASE_URL: postgresql://atd:test_password@localhost:5432/atd_test
          SECRET_KEY: test-secret-key-for-ci
          ENVIRONMENT: test
        run: |
          poetry run pytest tests/ -v --cov=src --cov-report=term-missing -x

  frontend:
    name: Frontend — lint + typecheck + tests
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        working-directory: frontend
        run: npm ci

      - name: Lint (ESLint)
        working-directory: frontend
        run: npm run lint

      - name: Type check
        working-directory: frontend
        run: npm run type-check

      - name: Tests (Vitest)
        working-directory: frontend
        run: npm run test
```

---

## 🚀 `atd-deploy.yml` — Tag, Build, Push & Deploy on merge to main

> ✅ **Already exists** at `.github/workflows/atd-deploy.yml`
> ⚠️ **DORMANT** — activate at implement Step 14 (see `SERVER_SETUP.md` § 9.4).

### How it works

```
Trigger: every merge to main (via PR)
Runner:  GitHub cloud runner (standard ubuntu-latest)

Steps:
  1. Checkout (full history — needed for semver)
  2. Detect commit type → compute semver tag
  3. docker build → ghcr.io/<org>/atd-backend:vX.Y.Z
                    ghcr.io/<org>/atd-frontend:vX.Y.Z
  4. docker push → GHCR (GitHub Container Registry — free, private)
  5. Create GitHub Release + auto-changelog
  6. SSH into Dell → ~/apps/deploy.sh vX.Y.Z
       └─ docker pull ghcr.io/…/atd-backend:vX.Y.Z
       └─ docker pull ghcr.io/…/atd-frontend:vX.Y.Z
       └─ docker compose up   (no --build)
       └─ alembic upgrade head
  7. Log "no release" if no version bump warranted
```

> **Why SSH and not self-hosted runner for CD?**
> The GitHub cloud runner builds and pushes the image.
> Then it SSH's into the Dell to trigger the pull + up.
> This is standard (no self-hosted runner needed), works from any server
> (Dell today, GCE tomorrow), and keeps the Dell as a pure runtime — it
> never touches source code or builds anything.

### Semantic versioning rules

```
Prefix                                                      Bump
──────────────────────────────────────────────────────────────────────
fix:            fix: correct SL rounding                    PATCH  v1.0.X
chore:          chore: update dependencies                  PATCH  v1.0.X
refactor:       refactor: extract risk calculator           PATCH  v1.0.X
feat:           feat: add economic calendar                 MINOR  v1.X.0
feat!:          feat!: redesign trade form API              MAJOR  vX.0.0
BREAKING CHANGE (in commit footer)                          MAJOR  vX.0.0
docs/test/ci                                                no tag — skipped
```

---

## 🔐 GitHub Secrets

**Phase 1** — secrets needed for CD:
```
GITHUB_TOKEN      ← auto-provided by GitHub (pushes tags + GHCR login)
DELL_HOST         ← IP or hostname of Dell on LAN (e.g. 192.168.1.50)
DELL_USER         ← SSH user on Dell (e.g. mohamed)
DELL_SSH_KEY      ← private SSH key (GitHub SSHes into Dell to trigger deploy)
```

> **GHCR auth** — `GITHUB_TOKEN` already has `write:packages` permission.
> No extra token needed for pushing to `ghcr.io`.

**Future (Phase 2+):**
```
KRAKEN_API_KEY      ← Kraken API (Phase 3)
KRAKEN_API_SECRET   ← Kraken API (Phase 3)
TELEGRAM_BOT_TOKEN  ← Notifications (Phase 4)
GCE_HOST            ← if/when migrating to GCE (replaces DELL_HOST)
```

---

## 🛡️ Branch Protection (set on GitHub repo settings)

```
Branch: main
  ✅ Require PR before merging
  ✅ Require status checks: backend + frontend (ci.yml jobs)
  ✅ Require branch to be up to date before merging
  ✅ Dismiss stale reviews on new commits
```

---

## 🌿 Git Branch Strategy

```
main         ← Production — only receives merges from develop via PR
develop      ← Daily work — push here, test locally, open PR when ready
feature/xxx  ← Optional feature branches off develop
fix/xxx      ← Optional bugfix branches off develop
```

**Naming conventions:**
```
feature/phase1-goals-system
feature/phase1-market-analysis
fix/sl-calculation-rounding
docs/update-server-setup
```

---

## 📊 Summary

| When | Workflow | Runner | What it does | Phase |
|---|---|---|---|---|
| push to develop / PR opened | `atd-test.yml` | GitHub cloud | lint + tests | ✅ created at Step 1 |
| PR merged to main | `atd-deploy.yml` | GitHub cloud | build → push GHCR → SSH deploy | ⚠️ dormant → activate at Step 14 |

**Migration path (zero pipeline rework):**
```
Phase 1:  Dell (SSH deploy, pull from GHCR)
Phase 2+: GCE  (same pipeline, change DELL_HOST → GCE_HOST in secrets)
Phase 3+: Kube (same images from GHCR, change deploy step to kubectl rollout)
```
