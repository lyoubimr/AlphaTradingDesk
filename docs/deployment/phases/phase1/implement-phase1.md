# 🛠️ Phase 1 — Implementation Plan

**Date:** March 1, 2026  
**Version:** 1.2  
**Status:** Ready to start — follows validation of `pre-implement-phase1.md`

> This document describes **what to build, in what order**.  
> Each step is a working, testable increment — nothing is left dangling.

> **Dev environment during Steps 1–13:** everything runs locally on the Mac.  
> Postgres runs in Docker on the Mac — no Dell needed yet.  
> The Dell comes in at Step 14.0 (migration) and Step 14.1 (prod deploy).

---

## 🌿 Git Workflow — How to commit during Phase 1

### Branch strategy

```
main       ← prod only — never commit directly, only receives PR merges
develop    ← your daily work branch ← YOU ARE HERE
feature/*  ← optional, for big isolated features (off develop)
fix/*      ← optional, for bugfixes (off develop)
```

> **`feat/phase01` is not the right branch.**  
> It spans weeks of work — too big for a feature branch.  
> Work on `develop` directly. Use `feature/*` only for isolated, parallel work.

```bash
# If you created feat/phase01, bring it into develop first:
git checkout develop
git merge feat/phase01        # or: git rebase develop feat/phase01
git branch -d feat/phase01    # clean up
git push origin develop
```

### Commit granularity — one commit per logical sub-step

Don't commit per Step (too big). Don't commit every file save (too noisy).  
**Commit when one coherent thing works.**

```
Step 1 example:
  git commit -m "chore: init Poetry project + pyproject.toml"
  git commit -m "chore: add docker-compose.dev.yml (db, backend, frontend, adminer)"
  git commit -m "chore: add .env.example and .env.dev"
  git commit -m "feat: first Alembic migration — empty DB connected"
  git commit -m "ci: add ci.yml — lint + test on push to develop"

Step 2 example:
  git commit -m "feat: add core DB schema — profiles, brokers, instruments"
  git commit -m "feat: add trades + trade_partials schema"
  git commit -m "feat: add market_analysis schema (modules, indicators, sessions)"

Step 6 example:
  git commit -m "feat: trade open/close lifecycle — position size + PnL"
  git commit -m "feat: partial close logic + BE move"
  git commit -m "fix: CFD margin check formula"
```

### Commit message prefixes (Conventional Commits)

```
Prefix       When to use                              Version bump on merge to main
──────────────────────────────────────────────────────────────────────────────────
feat:        new user-visible feature                 MINOR  v1.0.0 → v1.1.0
fix:         bug correction                           PATCH  v1.0.0 → v1.0.1
feat!:       breaking API change                      MAJOR  v1.0.0 → v2.0.0
chore:       setup, config, deps, tooling             none   (no release)
ci:          GitHub Actions changes                   none
docs:        documentation only                       none
refactor:    refactor, no new feature                 none
test:        tests only                               none
```

### When to merge develop → main (= trigger a release + deploy to Dell)

```
During Steps 1–13 → stay on develop, don't merge to main yet
  → CD never fires
  → Dell not needed yet
  → Merge to main only when a usable slice is ready

Suggested merge points:
  After Step 3  → "feat: Phase 1 bootstrap — schema + seed data"     → v0.1.0
  After Step 7  → "feat: full backend API complete"                   → v0.2.0
  After Step 13 → "feat: Phase 1 complete — full UI + QA pass"        → v1.0.0
```

> First merge to main = first real deploy to Dell.  
> Before that: `develop` only, CI runs on every push (lint + tests), no CD.

---

## 🔢 Build Order

### Step 1 — Project bootstrap (1 day)

> 🖥️ **Runs on Mac** — Postgres local, no Dell needed.

```
1. Poetry init → pyproject.toml with dependencies
   (FastAPI, SQLAlchemy, Alembic, Pydantic, uvicorn, python-dotenv)

2. Docker Compose (dev) — everything local on Mac:
   - db service       (postgres:16-alpine — local Postgres)
   - backend service  (FastAPI uvicorn --reload)
   - frontend service (Vite + React, hot reload)
   - adminer service  (DB GUI on :8080 — optional but useful)

3. .env.dev with:
   DATABASE_URL=postgresql://atd:dev_password@localhost:5432/atd_dev
   SECRET_KEY=...
   ENVIRONMENT=development

4. First Alembic migration → empty DB, connection verified

5. CI: GitHub Actions workflow → lint + test on push to develop
```

**Done when:** `docker compose -f docker-compose.dev.yml up` → API returns `{"status": "ok"}` on `/health`

---

### Step 2 — Core DB schema (1–2 days)

Build tables in this order (dependencies first):

```
1. brokers
2. instruments
3. trading_styles
4. profiles  (+ broker_id FK)
5. profile_goals
6. trades    (+ instrument_id FK, all new fields)
7. trade_partials    (for partial closes)
8. note_templates
9. user_preferences  (last selected style, last period)

Market analysis:
10. market_analysis_modules
11. market_analysis_indicators
12. profile_indicator_config
13. market_analysis_sessions
14. market_analysis_answers
```

Run `alembic upgrade head` → all tables created, no data yet.

**Done when:** schema applies cleanly, no migration errors.

---

### Step 3 — Seed data (half day)

```
1. Seed brokers      → Kraken, Vantage
2. Seed instruments  → ~50 Kraken perps + ~25 Vantage CFDs (from pre-implement doc)
3. Seed trading_styles → scalping, day_trading, swing, position
4. Seed note_templates → default post-trade questions
5. Seed market_analysis_modules + indicators:
   - Crypto (7 indicators: Q1–Q7, Q7 optional)
   - Gold   (5 indicators: Q1–Q5, Q5 optional)
```

All seeds in `database/migrations/seed_*.py` (idempotent — safe to re-run).

**Done when:** DB has seed data, query returns instruments per broker.

---

### Step 4 — Backend: Profiles + Broker config (1 day)

```
API routes:
  GET    /api/brokers
  GET    /api/brokers/:id/instruments
  POST   /api/profiles
  GET    /api/profiles
  GET    /api/profiles/:id
  PUT    /api/profiles/:id
  DELETE /api/profiles/:id
```

Validation:
- Profile must reference a valid broker
- Instrument must belong to profile's broker

**Done when:** create profile linked to Kraken → instruments filtered to Kraken perps.

---

### Step 5 — Backend: Goals & Risk Limits (1 day)

```
API routes:
  GET    /api/profiles/:id/goals
  POST   /api/profiles/:id/goals
  PUT    /api/profiles/:id/goals/:style/:period

Logic (computed on request, no background job yet):
  GET    /api/profiles/:id/goals/progress
    → reads closed trades for current day/week/month
    → computes progress% toward goal and risk% toward limit
    → returns per style × per period
    → periods with goal=0 AND limit=0 → skipped (not returned)
```

**Done when:** API returns goal progress bars with correct percentages.

---

### Step 6 — Backend: Trade Journal (2 days)

```
API routes:
  POST   /api/trades             ← open trade (Market or Limit)
  GET    /api/trades             ← journal list (paginated + filters)
  GET    /api/trades/:id         ← trade detail
  PUT    /api/trades/:id         ← update (SL, TP, status)
  POST   /api/trades/:id/close   ← full close
  POST   /api/trades/:id/partial ← partial close (TP hit)
  DELETE /api/trades/:id

Position size calculation (backend, not frontend):
  Crypto exchange:
    units = risk_amount / abs(entry_price - stop_loss)

  CFD broker:
    lots = risk_amount / (abs(entry_price - stop_loss) × tick_value)

  Margin check (CFD):
    safe_margin = (lots × contract_size × entry_price / max_leverage) × 2.5
    → flag if account_balance < safe_margin

Partial close logic:
  - Creates a trade_partials record
  - Reduces position remaining_qty
  - If move_to_be=true → updates trade.stop_loss = entry_price
  - Recalculates current_risk (= 0 if at BE)
```

**Done when:** full trade lifecycle works: open → partial close → full close → PnL computed.

---

### Step 7 — Backend: Market Analysis (1–2 days)

```
API routes:
  GET    /api/market-analysis/modules
  GET    /api/market-analysis/modules/:id/indicators
  GET    /api/profiles/:id/indicator-config      ← ON/OFF toggles
  PUT    /api/profiles/:id/indicator-config      ← save toggle changes
  POST   /api/market-analysis/sessions           ← save completed analysis
  GET    /api/market-analysis/sessions           ← history (filtered by profile)
  GET    /api/market-analysis/sessions/:id       ← detail

Score computation (backend):
  score_a_pct = sum_of_answers_group_a / (active_indicators_group_a × 2) × 100
  score_b_pct = same for group b (Crypto only)
  bias = 'bullish' if > 60% | 'neutral' if 40–60% | 'bearish' if < 40%

Staleness check:
  GET /api/profiles/:id/market-analysis/staleness
    → returns { module_id, module_name, last_completed_at, days_old, is_stale }
    → is_stale = days_old > 7
```

**Done when:** post analysis session → correct score + bias computed and stored.

---

### Step 8 — Frontend scaffold (1 day)

```
Tech: React + TypeScript + Vite + TailwindCSS + shadcn/ui

Pages scaffold (routes defined, placeholder content):
  /dashboard
  /trades
  /trades/new
  /trades/:id
  /market-analysis
  /market-analysis/new
  /settings/profiles
  /settings/goals
  /settings/instruments
  /settings/market-analysis

Layout:
  - Left sidebar (collapsible on mobile)
  - Top bar: active profile selector
  - Dark theme default
```

**Done when:** all routes render without errors, sidebar navigation works.

---

### Step 9 — Frontend: Dashboard (1–2 days)

```
Widgets:
1. Goals widget
   - Style selector (persisted per profile)
   - 3 rows: Daily / Weekly / Monthly (each: goal bar + risk bar)
   - "No trades today/this week" grey state when no data
   - Status badge: ✅ ON TRACK / ⚠️ WARNING / 🛑 BLOCKED
   - Override button when blocked

2. Market Analysis badge
   - One chip per active module: "Crypto 🟢 79% · 2d ago"
   - ⚠️ yellow if stale (>7d), 🟠 orange if >14d
   - Click → goes to /market-analysis

3. Open Positions list
   - Symbol, direction, entry, current risk, unrealized PnL (manual entry Phase 1)

4. Performance summary
   - Win rate, profit factor, equity curve (last 30 trades)
```

---

### Step 10 — Frontend: Trade Form (2 days)

```
/trades/new:
  - Profile auto-selected (last used)
  - Instrument: searchable dropdown + favourites + recents
  - Direction: big LONG / SHORT toggle
  - Order type: MARKET / LIMIT
  - Entry, SL, TP1 (TP2/TP3 collapsible)
  - risk% editable inline → risk amount + position size recalculated live
  - Market Analysis badge injected above form (if analysis <7d old)
  - Margin safety alert (CFD only)
  - Optional fields: confidence, spread, fees, tags (collapsed)

/trades/:id close panel:
  - FULL / PARTIAL / CUSTOM% selector
  - Exit price input
  - Realized PnL: pre-filled, editable
  - "Move SL to BE?" prompt on partial close
```

---

### Step 11 — Frontend: Market Analysis flow (1–2 days)

```
/market-analysis:
  - Module cards (Crypto, Gold) with last score + date
  - Staleness banner: "⚠️ Your Crypto analysis is 9 days old"
  - History table: Date | Module | Score | Bias | Notes

/market-analysis/new:
  Step 1: Choose module (Crypto / Gold)
  Step 2: For each active indicator:
    - Indicator name + TradingView link (opens new tab)
    - Timeframe hint (e.g. "1W only")
    - Question text
    - 📖 Tooltip/guidance (collapsible)
    - Answer buttons: [🟢 Bullish] [🟡 Neutral] [🔴 Bearish]
    - Progress: "Question 3 of 6"
  Step 3: Summary
    - Score A (+ Score B for Crypto)
    - Interpretation matrix result
    - Risk adjustment preview
    - Notes field
  [Save Analysis]

/settings/market-analysis:
  - Toggle each indicator ON/OFF per module
  - Score thresholds (default 60/40, editable)
  - Risk multipliers (default +20%/-30%, editable)
```

---

### Step 12 — Frontend: Settings pages (1 day)

```
/settings/profiles    ← CRUD, broker selector, currency display
/settings/goals       ← per style × per period, goal + limit fields
/settings/instruments ← view seeded catalog + add/edit/delete custom instruments
```

---

### Step 13 — Final QA pass (1 day)

```
- End-to-end: open trade → partial close → full close → goals updated → analysis stale
- Cross-feature: analysis bias → trade form badge → adjusted risk% → goals updated
- Mobile layout check (responsive)
- No hardcoded values (all from DB / config)
```

---

### Step 14 — Scripts & Tooling (once app runs end-to-end)

> ⚠️ **Do not create these files before Step 13 is done.**  
> These scripts depend on a running Docker Compose stack, a real DB, and a deployed server.  
> Write them when everything works locally and you're ready to deploy to the Dell.

---

#### Step 14.0 — Migrate dev DB from Mac → Dell (one-time)

> **When:** after Step 13 is done and the Dell is prepared (Ubuntu + Docker + IP fixe — see `SERVER_SETUP.md §3–6`).  
> **Goal:** move `atd_dev` from local Mac Postgres to the Dell, then keep developing with the DB on the Dell.

```
1. Dump atd_dev from Mac local Postgres:
   docker compose -f docker-compose.dev.yml exec -T db \
     pg_dump -U atd atd_dev > /tmp/atd_dev_migration.sql

2. Copy dump to Dell:
   scp /tmp/atd_dev_migration.sql atd@alphatradingdesk.local:/tmp/

3. On the Dell — create atd_dev and restore:
   ssh atd
   docker compose -f ~/apps/AlphaTradingDesk/docker-compose.prod.yml exec -T db \
     psql -U atd -c "CREATE DATABASE atd_dev OWNER atd;"
   docker compose -f ~/apps/AlphaTradingDesk/docker-compose.prod.yml exec -T db \
     psql -U atd atd_dev < /tmp/atd_dev_migration.sql

4. Update .env.dev on Mac:
   DATABASE_URL=postgresql://atd:<pw>@192.168.1.50:5432/atd_dev

5. Remove db service from docker-compose.dev.yml
   (Mac no longer runs a local Postgres)

6. Verify:
   make dev → app connects to Dell, all data present
   make migrate → runs cleanly against Dell atd_dev

7. Clean up:
   rm /tmp/atd_dev_migration.sql
   ssh atd "rm /tmp/atd_dev_migration.sql"
```

**Done when:** `make dev` on Mac connects to `atd_dev` on Dell — all data intact, no local Postgres.

---

#### 14.1 — `Makefile` (project root)

The Makefile is the **single entry point for all dev and ops commands**.  
Run from your Mac. No need to remember long Docker commands.

```makefile
# ─────────────────────────────────────────────────────────────────────────────
# AlphaTradingDesk — Makefile
# Run from project root on Mac.
# ─────────────────────────────────────────────────────────────────────────────

.PHONY: help dev dev-down migrate shell deploy deploy-tag prod-logs \
        db-sync db-sync-auto lint test build clean

PROD_SSH     := atd                                        # ~/.ssh/config Host
PROD_COMPOSE := ~/apps/AlphaTradingDesk/docker-compose.prod.yml
DEV_COMPOSE  := docker-compose.dev.yml

help:
	@echo ""
	@echo "  Dev"
	@echo "    make dev            Start local dev stack (localhost:5173)"
	@echo "    make dev-down       Stop local dev stack"
	@echo "    make migrate        Run alembic migrations on dev DB"
	@echo "    make shell          Open bash shell in dev backend container"
	@echo ""
	@echo "  Deploy (needs Dell server running)"
	@echo "    make deploy         Deploy latest main to Dell"
	@echo "    make deploy-tag     Deploy a specific tag (rollback)"
	@echo "    make prod-logs      Tail prod logs"
	@echo ""
	@echo "  Database"
	@echo "    make db-sync        Sync prod DB → dev (interactive, once/day)"
	@echo "    make db-sync-auto   Sync prod DB → dev (no prompt, for cron)"
	@echo ""
	@echo "  Code quality"
	@echo "    make lint           ruff + eslint"
	@echo "    make test           pytest"
	@echo ""

# ── Dev ───────────────────────────────────────────────────────────────────────
dev:
	docker compose -f $(DEV_COMPOSE) up

dev-down:
	docker compose -f $(DEV_COMPOSE) down

migrate:
	docker compose -f $(DEV_COMPOSE) exec backend alembic upgrade head

shell:
	docker compose -f $(DEV_COMPOSE) exec backend bash

# ── Deploy ────────────────────────────────────────────────────────────────────
# CI/CD (GitHub Actions cloud runner → SSH to Dell) handles deploys on PR merge.
# These targets are for manual deploys and rollbacks.

deploy:
	ssh $(PROD_SSH) "~/apps/deploy.sh"

deploy-tag:
	@read -p "Tag to deploy (e.g. v1.2.3): " tag; \
	ssh $(PROD_SSH) "~/apps/deploy.sh $$tag"

prod-logs:
	ssh $(PROD_SSH) "docker compose -f $(PROD_COMPOSE) logs -f --tail=100"

# ── DB sync ───────────────────────────────────────────────────────────────────
# Syncs prod DB → local dev. Run once a day before working.
# Cron example (Mac): 0 7 * * 1-5 cd /path/to/project && make db-sync-auto

db-sync:
	@bash scripts/sync-db-prod-to-dev.sh

db-sync-auto:
	@FORCE=1 bash scripts/sync-db-prod-to-dev.sh

# ── Code quality ──────────────────────────────────────────────────────────────
lint:
	docker compose -f $(DEV_COMPOSE) exec backend ruff check .
	cd frontend && npm run lint

test:
	docker compose -f $(DEV_COMPOSE) exec backend pytest
```

#### 14.2 — `scripts/deploy.sh` (runs on the Dell)

Placed at `~/apps/deploy.sh` on the Dell server.  
Called via SSH by the GitHub Actions **cloud runner** (automatic, on PR merge to main),
and by `make deploy` / `make deploy-tag` (manual, from Mac via SSH).

> **The Dell never builds images.** It only pulls pre-built images from GHCR and runs them.
> Build happens on the GitHub cloud runner (Steps 3–5 of `cd.yml`).


```bash
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — runs on the Dell server
# Called by:
#   - GitHub Actions cloud runner (automatic, via SSH on PR merge to main)
#   - `make deploy` or `make deploy-tag` (manual, from Mac via SSH)
#
# Usage:
#   ~/apps/deploy.sh              # pull :latest images and deploy
#   ~/apps/deploy.sh v1.2.3       # pull a specific tag (rollback)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/apps/AlphaTradingDesk}"
COMPOSE_FILE="${APP_DIR}/docker-compose.prod.yml"
DEPLOY_ENV="${DEPLOY_ENV:-$HOME/apps/.env.deploy}"
LOG_FILE="${LOG_FILE:-$HOME/apps/deploy.log}"
TAG="${1:-}"

log() {
  echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*" | tee -a "$LOG_FILE"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"
log "🚀 Deploy started — tag: ${TAG:-latest}"

# 1. Load GHCR credentials (stored in ~/apps/.env.deploy on the Dell)
[[ -f "$DEPLOY_ENV" ]] && source "$DEPLOY_ENV"
if [[ -n "${GHCR_TOKEN:-}" && -n "${GHCR_USER:-}" ]]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
  log "GHCR login OK"
fi

# 2. Set image tag to pull
IMAGE_TAG="${TAG:-latest}"
export IMAGE_TAG
log "Pulling images: tag=${IMAGE_TAG}"

# 3. Pull images from GHCR (no --build — images built by GitHub Actions cloud runner)
docker compose -f "$COMPOSE_FILE" pull
log "Images pulled"

# 4. Restart stack
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
log "Stack restarted"

# 5. Run pending Alembic migrations
docker compose -f "$COMPOSE_FILE" exec -T backend alembic upgrade head
log "Migrations done"

# 6. Prune dangling images
docker image prune -f
log "Old images pruned"

# 7. Health check
sleep 3
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost/api/health 2>/dev/null || echo "000")

if [[ "$HTTP_STATUS" == "200" ]]; then
  log "✅ Deploy complete — ${IMAGE_TAG} (HTTP ${HTTP_STATUS})"
else
  log "⚠️  Deploy done but health check returned HTTP ${HTTP_STATUS} — check logs"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" >> "$LOG_FILE"
```


Setup on the Dell (once, before first deploy):
```bash
# On the Dell:
chmod +x ~/apps/deploy.sh
```

#### 14.3 — `scripts/sync-db-prod-to-dev.sh` (runs on Mac)

Dumps the prod PostgreSQL DB from the Dell and restores it into the local dev Docker DB.  
Secrets are scrubbed after restore.  
Run once a day before working — or on demand before testing a release.

```bash
#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sync-db-prod-to-dev.sh — runs on Mac
# Dumps prod DB from Dell → restores into local dev Docker DB.
# Secrets scrubbed after restore (API keys never in dev).
#
# Usage:
#   bash scripts/sync-db-prod-to-dev.sh   # interactive (asks confirmation)
#   make db-sync                           # same, via Makefile
#   make db-sync-auto                      # FORCE=1, for cron
#
# Requirements:
#   - SSH access to prod: `ssh atd` must work (see SERVER_SETUP.md §4.6)
#   - Local docker-compose.dev.yml with a `db` service
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROD_SSH_HOST="${PROD_SSH_HOST:-atd}"
PROD_COMPOSE="${PROD_COMPOSE:-~/apps/AlphaTradingDesk/docker-compose.prod.yml}"
PROD_DB_NAME="${PROD_DB_NAME:-atd_prod}"
PROD_DB_USER="${PROD_DB_USER:-atd}"

LOCAL_COMPOSE="${LOCAL_COMPOSE:-docker-compose.dev.yml}"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-db}"
LOCAL_DB_NAME="${LOCAL_DB_NAME:-atd_dev}"
LOCAL_DB_USER="${LOCAL_DB_USER:-atd}"

DUMP_FILE="/tmp/atd_prod_sync_$(date +%Y%m%d_%H%M%S).sql"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔄 Prod → Dev DB Sync  |  $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "  Source: $PROD_SSH_HOST  →  Target: localhost dev DB"
echo "  ⚠️  Local dev DB will be REPLACED. Secrets will be scrubbed."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "${FORCE:-0}" != "1" ]]; then
  read -r -p "  Continue? [y/N] " confirm
  [[ "$confirm" =~ ^[yY]$ ]] || { echo "Cancelled."; exit 0; }
fi

# 1. Dump from prod via SSH
echo "  [1/5] Dumping prod DB..."
ssh "$PROD_SSH_HOST" \
  "docker compose -f $PROD_COMPOSE exec -T db \
   pg_dump -U $PROD_DB_USER --no-password \
   --exclude-table-data=news_provider_config \
   $PROD_DB_NAME" \
  > "$DUMP_FILE"
echo "  → $(du -sh "$DUMP_FILE" | cut -f1)"

# 2. Ensure local dev DB is up
echo "  [2/5] Starting local dev DB..."
docker compose -f "$LOCAL_COMPOSE" up -d db
sleep 2

# 3. Drop and recreate local DB
echo "  [3/5] Resetting local dev DB..."
docker compose -f "$LOCAL_COMPOSE" exec -T "$LOCAL_DB_CONTAINER" \
  psql -U "$LOCAL_DB_USER" -c \
  "DROP DATABASE IF EXISTS $LOCAL_DB_NAME; CREATE DATABASE $LOCAL_DB_NAME;"

# 4. Restore dump
echo "  [4/5] Restoring dump..."
docker compose -f "$LOCAL_COMPOSE" exec -T "$LOCAL_DB_CONTAINER" \
  psql -U "$LOCAL_DB_USER" "$LOCAL_DB_NAME" < "$DUMP_FILE"

# 5. Scrub secrets
echo "  [5/5] Scrubbing secrets..."
docker compose -f "$LOCAL_COMPOSE" exec -T "$LOCAL_DB_CONTAINER" \
  psql -U "$LOCAL_DB_USER" "$LOCAL_DB_NAME" -c \
  "UPDATE news_provider_config
   SET api_key_encrypted = NULL, api_key_iv = NULL, enabled = FALSE
   WHERE api_key_encrypted IS NOT NULL;"

rm -f "$DUMP_FILE"
echo "  ✅ Done — dev DB mirrors prod (secrets scrubbed)"
echo ""
echo "  Next: apply any pending dev migrations:"
echo "    make migrate"
```

Cron setup (Mac) — sync every weekday at 07:00:
```bash
# In terminal on Mac:
crontab -e
# Add:
# 0 7 * * 1-5 cd /path/to/AlphaTradingDesk && make db-sync-auto \
#   >> ~/Library/Logs/atd-db-sync.log 2>&1
```

#### What gets synced / not synced

```
✅ SYNCED (full data):
   trades, positions, trade_partials
   market_analysis_sessions, market_analysis_answers
   weekly_events
   profiles, profile_goals, goal_progress_log
   user_preferences, brokers, instruments
   strategies, tags, note_templates, performance_snapshots

❌ NOT SYNCED (scrubbed):
   news_provider_config.api_key_encrypted  → set to NULL
   news_provider_config.api_key_iv         → set to NULL
   news_provider_config.enabled            → set to FALSE
   (use a test API key in dev .env)
```

> **DB version safety:** after sync, run `make migrate` to apply any new migrations
> on top of the prod snapshot — exactly simulating what will happen on the real deploy.
> If a migration fails on prod data → you catch it in dev BEFORE pushing.

---

## �📦 Deliverable at end of Phase 1

```
✅ Docker Compose dev stack (API + DB + Frontend)
✅ Full DB schema + seed data
✅ All backend routes tested (Postman / pytest)
✅ All UI pages functional and connected to backend
✅ No JSON config files — everything configurable via UI
✅ Makefile (make dev, make deploy, make db-sync)
✅ scripts/deploy.sh on the Dell
✅ scripts/sync-db-prod-to-dev.sh tested and working
✅ README.md with setup instructions
```

---

**Next:** → `post-implement-phase1.md`
