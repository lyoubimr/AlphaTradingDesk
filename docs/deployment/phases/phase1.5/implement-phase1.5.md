# 🛠️ Phase 1.5 — Implementation Plan

**Date:** March 13, 2026  
**Version:** 0.4  
**Status:** In Progress — Steps 1–5 + Favorites ✅ · Step 6 next

> This document lists the recommended implementation order for the immediate
> post-Phase 1 work.

---

## 🗺️ Roadmap

| Step | What | Status |
|------|------|--------|
| 1 | Expand Kraken instrument seeds | ✅ Done |
| 2 | Expand Vantage instrument seeds (curated) | ✅ Done |
| 3 | Add broker catalog support scripts | ✅ Done |
| ★ | Instrument favorites (localStorage) in picker | ✅ Done |
| 4 | Add inline custom instrument creation in New Trade | ✅ Done |
| 5 | Fix strategy and trade image serving reliability | ✅ Done |
| 6 | Build Market Analysis editor foundation | Planned |
| 7 | Build Market Analysis module/question answer editor UI | Planned |
| 8 | Add screenshot capture and clipboard paste for strategy and trade images | Planned |
| 9 | QA pass in dev + seed run in dev | Planned |
| 10 | Prod deploy + seed run in prod | Planned |

---

## Step 1 — Expand Kraken instrument seeds ✅

### Goal

Cover all tradeable Kraken perpetual futures.

### Done

- `scripts/update_kraken_catalog.py` — fetches live Kraken Futures API, patches `KRAKEN_INSTRUMENTS` block in seed file
- **317 PF_* perpetual futures** seeded (66×50×, 46×25×, 136×20×, 69×10×)
- Docstring auto-updated, ruff clean, 126 tests pass
- Rerunnable: `./venv/bin/python scripts/update_kraken_catalog.py [--dry-run]`

---

## Step 2 — Expand Vantage instrument seeds ✅

### Goal

Comprehensive curated Vantage CFD catalog (MT4/MT5 Standard/STP accounts).

### Done

- `scripts/update_vantage_catalog.py` — hardcoded curated catalog, patches `VANTAGE_INSTRUMENTS` block
- **89 CFD instruments**: 15 commodities (metals + energy + softs), 18 crypto, 40 forex (majors + minors + exotics), 16 indices
- Docstring auto-updated, ruff clean, 126 tests pass
- Rerunnable: `.venv/bin/python scripts/update_vantage_catalog.py [--dry-run]`

---

## Step 3 — Broker catalog support scripts ✅

### Done

- `scripts/update_kraken_catalog.py` — live API → seed patch (see Step 1)
- `scripts/update_vantage_catalog.py` — curated catalog → seed patch (see Step 2)
- Both support `--dry-run`, both update the docstring count automatically
- Cheatsheet (`custom/cheatsheet.md`) updated with usage commands

### Rule

These scripts support seed maintenance. They are not production runtime logic.

---

## ★ Instrument favorites in picker ✅

### Done

- `useInstrumentFavorites` hook in `NewTradePage.tsx` — reads/writes `localStorage` key `atd_instrument_favorites`
- Toggle star (★) visible on hover on each instrument row
- When no active search: **Favorites** section shown at top of dropdown (amber header)
- Selected instrument shows ★ in the trigger button if it is a favorite
- No backend change, no migration, survives Docker restarts (browser-side)

---

## Step 4 — Add inline custom instrument creation in New Trade ✅

### Done

- `InstrumentCreate` type added to `frontend/src/types/api.ts`
- `instrumentsApi.create(brokerId, data)` added to `frontend/src/lib/api.ts`
- `InstrumentPicker` extended with `brokerId` + `onCreated` props
- **"Add missing instrument…"** button at bottom of dropdown (only shown when broker is set)
- Clicking it replaces the list with an inline mini-form: symbol (auto-uppercased), display name, asset class selector, tick value, pip size, min lot, max leverage (all optional except symbol + name)
- On submit: `POST /api/brokers/{brokerId}/instruments` → new instrument added to local list + auto-selected
- Validation errors from backend displayed inline
- Cancel returns to the search list
- New instrument immediately available for the trade without page reload

---

## Step 5 — Fix strategy and trade image serving reliability ✅

### Root cause

In prod, nginx served uploaded files from the React build directory (`try_files $uri`) instead of proxying to FastAPI. FastAPI mounts `/uploads` via `StaticFiles` at startup — nginx had no `location /uploads/` block so all image requests returned 404.

### Done

- Added `location /uploads/ { proxy_pass http://backend:8000; … }` to `frontend/nginx.conf`, **before** the SPA catch-all `location /`
- Same proxy headers as `/api/` block
- No backend change needed — `StaticFiles` mount in `src/main.py` was already correct
- Fix applies to strategy chart images and trade entry/close snapshots

---

## Step 6 — Build Market Analysis editor foundation

### Goal

Move market analysis from static seeded text toward editable DB-driven content.

### Work

- define editable fields and safe constraints
- add backend CRUD where missing
- preserve current scoring semantics as much as possible

---

## Step 7 — Build Market Analysis module/question/answer editor UI

### Goal

Allow operators to create and maintain analysis content from the interface.

### Work

- module list and detail editor
- question / indicator editor
- answer label and score editor
- sort order and default-enabled controls

---

## Step 8 — Add screenshot capture and clipboard paste for strategy and trade images

### Goal

Reduce friction for adding strategy chart images.

### Work

- add direct screenshot capture flow
- optionally support paste-from-clipboard image upload
- reuse existing upload endpoints where possible
- support both strategy images and trade snapshots where the UX makes sense

### Rule

Only start this after Step 1 is fully stable.

---

## Step 9 — QA pass in dev + seed run in dev

### Goal

Validate all Phase 1.5 work in dev and apply the new seeds to the dev database.

### Work

- run full test suite: `APP_ENV=test .venv/bin/pytest tests/ --tb=short -q`
- apply new seeds on dev DB: `make db-seed`
- verify Kraken instruments count in dev DB (expect 317)
- verify Vantage instruments count in dev DB (expect 89)
- validate New Trade instrument flow (picker shows new instruments)
- validate Market Analysis editor
- validate image upload and rendering
- extend automated tests where practical

---

## Step 10 — Prod deploy + seed run in prod

### Goal

Ship all Phase 1.5 work to the Dell prod server and apply the new seeds.

### Work

1. Open PR `develop → main` on GitHub
2. CI must pass → merge → CD builds and deploys to Dell automatically
3. After deploy, apply new seeds in prod:

```bash
# Option A — via Makefile (from Dell or via docker exec)
make db-seed-prod

# Option B — directly in the running backend container
docker compose -f docker-compose.prod.yml exec -T backend \
  python -m database.migrations.seeds.seed_all
```

4. Verify instrument counts in prod DB:

```bash
docker compose -f docker-compose.prod.yml exec db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "SELECT b.name, COUNT(*) FROM instruments i JOIN brokers b ON b.id=i.broker_id GROUP BY b.name;"
```

5. Smoke-test New Trade flow on `http://alphatradingdesk.local`

### Rule

Never merge to main without CI passing.
The seed is idempotent — safe to run multiple times.

---

## 📌 Backlog — Phase 2 (deferred)

### Broker instrument sync automation

**Context:** `scripts/update_kraken_catalog.py` is a one-shot dev/ops script — run manually to regenerate the seed file. It is **not** an app-runtime integration.

**What is deferred:** Automated, scheduled synchronization of the instrument catalog directly in the running app:

- Kraken: poll `futures.kraken.com/derivatives/api/v3/instruments` periodically
- Vantage / other MT5 brokers: ingest catalog from MT5 gateway or broker API
- Mark instruments as `is_active=False` when delisted (instead of deleting, to preserve trade history)
- Scheduler: Celery beat or a lightweight cron inside the backend container

**Why deferred:** Requires Celery + Redis (Phase 2+ stack) and a UI to review/approve changes before applying. Doing this in Phase 1.5 would add runtime complexity without clear user value yet.

**Where to implement:** End of Phase 2 (after Volatility Analysis), or as a dedicated Phase 3 sub-step before Watchlist generation.
