# 🛠️ Phase 1 — Implementation Plan

**Date:** March 1, 2026  
**Version:** 1.8  
**Status:** Step 12 DONE + Market Analysis global session migration → **Ready for Step 13 (Final QA)**

> This document describes **what to build, in what order**.  
> Each step is a working, testable increment — nothing is left dangling.

> **Dev environment during Steps 1–13:** everything runs locally on the Mac.  
> Postgres runs in Docker on the Mac — no Dell needed yet.  
> The Dell comes in at Step 14.0 (migration) and Step 14.1 (prod deploy).

---

## ✅ Completed work log

### Step 1 — DONE (2026-03-01)
- `pyproject.toml` + Poetry venv (Python 3.11)
- `src/main.py` — FastAPI app + `/health` endpoint
- `src/core/config.py` — Pydantic settings
- `docker-compose.dev.yml` — db + backend + frontend + adminer
- `Dockerfile.backend` + `frontend/Dockerfile`
- `Makefile` — all dev/ci/db commands
- `.env.example` / `.env.dev`
- `tests/test_health.py` — pytest passing
- `frontend/` — Vite + React + TypeScript + vitest

### Step 2–3 — DONE (2026-03-01/02)
- Full Phase 1 DB schema via Alembic (76f6b651fb6d)
- Seed data: brokers (Kraken, Vantage), instruments, sessions, trading styles, market analysis modules/indicators

### Step 4–7 — DONE (2026-03-02)
- All backend routes working: profiles, brokers, instruments, trades, strategies, market analysis
- Full trade lifecycle: open → partial close → full close → PnL + capital update (same transaction)
- Atomic strategy WR stats update on `full_close` (trades_count, win_count)

### Step 9 — DONE (2026-03-02)
- `ProfileContext` — active profile persisted in localStorage
- `/settings/profiles` — CRUD, broker selector, ProfilePicker topbar
- ProfilePicker on all pages, auto-selects first profile

### Step 10 — IN PROGRESS (2026-03-02/03)

**Trade form (NewTradePage.tsx) — completed:**
- Fixed Fractional position sizing (Crypto: units, CFD: lots)
- Multi-TP presets (1–4 TPs, Smart Scale / Balanced / Aggressive / Conservative / Profit Max)
- SL direction validation (LONG: SL < entry, SHORT: SL > entry)
- Crypto: leverage slider, safe margin calc (MMR-aware), estimated liquidation price
- CFD: broker margin estimate, maintenance margin, margin level %, margin call warning
- Session auto-detection (UTC-based)
- Strategy dropdown with inline "New strategy" creation
- Confidence score 1–10
- Setup tags (chart patterns / confluences)
- **Expectancy panel** (see below)

**Frontend payload fix (2026-03-02):**
- Fixed `[object Object]` error on submit — corrected field names to match backend schema
  (`take_profit_price`, `position_number`, lowercase direction, `entry_date: null`)
- Improved API error handler: FastAPI 422 arrays are flattened to human-readable string

**LIMIT order cycle de vie complet (2026-03-03):**

Nouveau cycle de vie des trades :
```
MARKET: open → partial → closed
LIMIT:  pending → open → partial → closed
                ↘ cancelled  (jamais déclenché)
```

Règles :
- `MARKET` → status = `open` à la création, `current_risk = risk_amount` réservé immédiatement
- `LIMIT`  → status = `pending` à la création, `current_risk = 0` (aucun risque réservé)
- `POST /api/trades/{id}/activate` → `pending → open`, réserve le risque à ce moment-là
- `POST /api/trades/{id}/cancel`   → `pending → cancelled` uniquement (les trades `open` se closent normalement)

Changements :
- Migration `c45438781a38` : colonne `order_type VARCHAR(10)` + CHECK `IN ('MARKET','LIMIT')` + status `pending` ajouté + index `idx_trades_order_type`
- `src/core/models/trade.py` — champ `order_type`, contraintes mises à jour
- `src/trades/schemas.py` — `OrderType` Literal, `TradeStatus` inclut `pending`, `TradeOpen.order_type`, `TradeOut/TradeListItem.order_type`
- `src/trades/service.py` — `open_trade` branch MARKET/LIMIT, `activate_trade()`, `cancel_trade()` restreint à `pending`
- `src/trades/router.py` — `POST /api/trades/{id}/activate`
- `frontend/src/types/api.ts` — `TradeOpen.order_type`, `TradeListItem.order_type + status pending`
- `frontend/src/lib/api.ts` — `tradesApi.activate()`
- `frontend/src/pages/trades/NewTradePage.tsx` — `order_type` inclus dans le payload
- `frontend/src/pages/trades/TradesPage.tsx` — badge `⏳ Pending LIMIT`, bouton `Activate` (vert) + `Cancel` (rouge) sur les trades `pending`
- Replaced fake sample data with real API calls (`tradesApi.list(profileId)`)
- Live KPIs: total trades, open count, win rate (≥5 closed trades), total P&L
- Status badges: Open (blue) / Partial (amber) / Closed (gray) / Cancelled (dimmed strikethrough)
- Cancel button on `open` trades → calls `POST /api/trades/{id}/cancel`, optimistic UI update
- Loading skeleton + empty state + error banner
- `TradeListItem.status` type updated to include `'partial'`
- `tradesApi.cancel(tradeId)` added to `api.ts`

**Global WR pill in Topbar — completed (2026-03-03):**
- `GlobalWRPill` component fetches `GET /api/stats/winrate` on mount + every 60s (silent on error)
- Displays mean WR across profiles with ≥5 trades — color-coded (green/amber/red)
- Hidden if no profiles have enough data yet

**Expectancy panel (2026-03-03):**
- Formula: `E(R) = WR × AvgWinR − (1−WR) × 1R`
- Shows R-multiples as primary metric, currency as secondary
- Grades: 🔴 Negative / 🟡 Marginal / 🟢 Good / 💎 Excellent
- **4-level WR source priority** (see Win-rate architecture below)

### Step 11 — DONE (2026-03-03) — Goals / Performance frontend

**Backend additions:**
- `GET /api/trading-styles` — new `styles_router` in `src/brokers/router.py`, `TradingStyleOut` schema
- `GET /api/stats/winrate` — `stats_router` was imported in `main.py` but never registered; fixed
- `src/main.py` — now properly includes `styles_router` + `stats_router`

**Frontend changes:**
- `frontend/src/types/api.ts` — added `TradingStyle`, `GoalOut`, `GoalCreate`, `GoalUpdate`, `GoalProgressItem`, `GoalPeriod` types
- `frontend/src/lib/api.ts` — added `stylesApi.list()` + full `goalsApi` (list, create, update, progress)
- `frontend/src/pages/goals/GoalsPage.tsx` — **fully replaced** placeholder data with real backend:
  - KPI bar: active goals, goals hit this period, avg progress %, worst risk limit usage
  - `ProgressCard` grid — one live card per active goal (period P&L %, target/limit, progress bar, risk bar; color-coded for goal hit / limit hit)
  - `GoalRow` table — all goals, toggle active/inactive, sorted by style + period
  - `NewGoalModal` — create goal: style dropdown (from API), period selector, profit target %, loss limit %
  - Validation: goal > 0, limit < 0, duplicate detection (same style + period)
  - Show-all toggle for profiles with many goals
  - How goals work — explanation panel (periods, progress computation, limit circuit-breaker)

**Key rules:**
- Progress is computed on-demand from closed trades in the current period (no caching in Phase 1)
- Open/partial trades do NOT count toward period P&L
- Daily = today, Weekly = Mon–Sun (ISO), Monthly = 1st–last day of month
- `goal_pct > 0` (enforced by DB CHECK + frontend), `limit_pct < 0` (enforced by DB CHECK + frontend)
- Duplicate (profile, style, period) is rejected → PUT to update instead

---

## 🏗️ Win-rate architecture (implemented 2026-03-03)

Three independent win-rate levels, each with its own source and scope:

| Level | Source | Scope | Updated when |
|-------|--------|-------|--------------|
| **Strategy WR** | `strategies.win_count / trades_count` | Only trades using this strategy | `full_close` if `strategy_id` is set |
| **Profile WR** | `profiles.win_count / trades_count` | ALL closed trades of this profile, strategy-agnostic | Every `full_close`, always |
| **Global WR** | Computed in frontend | `mean(profile.win_rate_pct)` across profiles with ≥5 trades | Not stored — derived on the fly |

### Priority in ExpectancyPanel (trade form)
```
1. 🟢 Strategy WR  — if strategy selected AND trades_count ≥ min_trades_for_stats
2. 🔵 Profile WR   — if activeProfile.trades_count ≥ 5
3. 🟡 Global WR    — mean of all profiles that have ≥5 closed trades
4. ⚪ Fallback 60%  — no history at all
```

### Backend changes
- `profiles.trades_count` + `profiles.win_count` — added to DB model + `ProfileOut` schema
- Migration: `a3c7d8e91f02_add_winrate_stats_to_profiles.py`
- `trades/service.py full_close` — atomically increments `profile.trades_count` + `win_count`
  in the same transaction as `capital_current` update and strategy stats
- `GET /api/stats/winrate` (`src/stats/router.py`) — returns per-profile WR list
  (uses `profiles` table directly, NOT strategy aggregation)
- `stats/schemas.py` — `ProfileWinRate` + `WinRateStats` Pydantic models

### Frontend changes
- `types/api.ts` — `Profile` type: added `trades_count`, `win_count`
- `types/api.ts` — new `ProfileWinRate`, `WinRateStats` types
- `lib/api.ts` — new `statsApi.winrate(profileId?)` function
- `NewTradePage.tsx` — `ExpectancyPanel` uses 4-level WR priority
- `NewTradePage.tsx` — fetches `globalWrStats` from `/api/stats/winrate` on mount (silent on error)

---

## 🚫 Cancel trade — LIMIT order (implemented 2026-03-03)

**Problem:** A LIMIT order that never triggers should be cancellable without deleting the journal record and without impacting any stats.

**Solution:** `status = 'cancelled'` (new terminal state alongside `closed`)

### Rules
| Action | `status` | Capital impact | Profile WR | Strategy WR |
|--------|----------|---------------|------------|-------------|
| `full_close` | `closed` | ✅ updated | ✅ incremented | ✅ incremented (if strat set) |
| `cancel_trade` | `cancelled` | ❌ no change | ❌ no change | ❌ no change |
| `delete_trade` | removed | ❌ no change | ❌ no change | ❌ no change |

Only `open` trades can be cancelled (a `partial` already has real fills).

### Changes
- **Migration** `b1d4f2a83e55_add_cancelled_status_to_trades.py`:
  - drops `ck_trades_status` CHECK constraint
  - re-creates with `IN ('open', 'partial', 'closed', 'cancelled')`
- `src/core/models/trade.py` — `ck_trades_status` updated
- `src/trades/schemas.py` — `TradeStatus` Literal updated
- `src/trades/service.py` — new `cancel_trade()` function
- `src/trades/router.py` — `POST /api/trades/{id}/cancel` endpoint
- `delete_trade` now also allows deleting `cancelled` trades

---

---

## 🔧 Fix: Lazy DB engine + Alembic infra (2026-03-03)

**Root cause:** `engine = create_engine(...)` was at **module level** in `src/core/database.py`.  
Any import of `src.core.models` (including Alembic CLI, pytest collection, etc.) would  
immediately try to open DB connections — causing Alembic commands to appear to hang  
(output goes to stderr, exit code was 0, but looked silent/frozen in the terminal).

**Additional problem:** `Dockerfile.backend` did not `COPY alembic.ini`, so running  
`alembic` inside the container had no config file. Same for `docker-compose.dev.yml` —  
no volume mount for `alembic.ini`.

**What was broken:**
- DB had `alembic_version = c45438781a38` stamp but **zero tables** (migrations never ran)
- `/api/profiles` returned 500 (`relation "profiles" does not exist`)
- `make db-upgrade` / `make db-current` appeared to hang

**Fix — `src/core/database.py`:**
```python
# BEFORE (broken): engine created at import time
engine = create_engine(_normalise_db_url(settings.database_url), ...)
SessionLocal = sessionmaker(bind=engine, ...)

# AFTER (correct): lazy — engine created on first call to get_engine()
def get_engine() -> Engine: ...          # returns/creates the singleton engine
def get_session_factory() -> sessionmaker: ...  # bound to the lazy engine
def get_db(): ...                        # FastAPI dependency (kept here for convenience)
```

**Fix — `Dockerfile.backend`:**
```dockerfile
COPY alembic.ini ./alembic.ini   # ← added
```

**Fix — `docker-compose.dev.yml`:**
```yaml
volumes:
  - ./alembic.ini:/app/alembic.ini   # ← added
```

**Fix — `Makefile`:**
- Replaced `POETRY := poetry run` (poetry not on PATH) with `.venv/bin/*` variables
- All `db-*` targets now run via `$(COMPOSE) exec -T backend alembic ...`  
  (container has `db` hostname, `-T` avoids TTY issues in CI/scripts)
- Added `db-current` and `db-history` targets
- Note: Alembic output goes to **stderr** (configured in `alembic.ini`), so commands
  appear silent in stdout-only contexts — exit code 0 = success

**Verified:** `make db-upgrade` exits 0, `/api/profiles` returns `200 []`

---

## 🌿 Git Workflow — How to commit during Phase 1

### Branch strategy

```
main       ← prod only — never commit directly, only receives PR merges
develop    ← your daily work branch ← YOU ARE HERE
feature/*  ← optional, for big isolated features ---

## 📌 Future phases — planning notes (captured 2026-03-03)

These features are **intentionally deferred** from Phase 1. Each will become its
own step or sub-step in a later phase. Captured here so the context is not lost.

---

### 🔵 LIMIT order risk accounting (Phase 2 step candidate)

**Context:** Currently `open` LIMIT orders have the same risk accounting as MARKET orders.
A cancelled LIMIT has no capital/WR impact (✅ implemented). But multiple pending LIMITs
that all trigger simultaneously could exceed `max_concurrent_risk_pct` without warning.

**Planned logic:**
```
current_risk   = Σ risk of all MARKET (open) trades
pending_risk   = Σ risk of all LIMIT (pending) trades, per profile
combined_risk  = current_risk + pending_risk

if combined_risk > profile.max_concurrent_risk_pct:
    dashboard_notification(
        level='warning',
        message="Pending LIMIT orders would push total risk to X.X% — exceeds max."
    )
```

**Where to implement:**
- Trade model: differentiate `order_type = 'LIMIT'` as pending vs triggered
- Dashboard: **Risk overview widget** — split current vs pending risk
- Trade form: banner when order_type = LIMIT: "Limit orders don't consume risk until triggered."
- When LIMIT triggers: status changes to open → recalculate combined risk

---

### 🔵 Risk gating by strategy + confidence (Phase 2 step candidate)

**Context:** In the trade form, strategy and confidence are collected before any numbers.
In a future step these will **gate the maximum allowed risk percentage**.

**Planned logic:**
```
base_risk_pct  = profile.risk_percentage_default

if strategy.win_rate ≥ threshold_high AND confidence ≥ 8:
    effective_risk_max = base_risk_pct × 1.25
elif strategy.win_rate < threshold_low OR confidence ≤ 3:
    effective_risk_max = base_risk_pct × 0.75
else:
    effective_risk_max = base_risk_pct

# Phase 3: market analysis also feeds into risk gating
if market_analysis.bias == 'bullish' AND direction == 'LONG':
    effective_risk_max *= 1.10
```

**Where to implement:**
- Backend: `GET /api/profiles/:id/effective-risk?strategy_id=&confidence=&direction=`
- Frontend: trade form shows `Effective max risk: X.X%` badge
- DB: `strategies.win_rate_threshold_high/low` configurable per profile

---

### 🔵 Strategy settings page (Phase 2 step candidate)

**Context:** Strategies show live WR in the dropdown. A dedicated settings page is needed.

**Route:** `/settings/strategies`
- List all strategies per profile (name, emoji, win rate bar, trades count)
- Edit name / emoji
- Set `min_trades_for_stats` override per strategy (default: 5)
- Set `win_rate_threshold_high` / `win_rate_threshold_low` (default: 60% / 45%)
- Archive / delete strategy (archived still appear in closed trade history)
- Performance sparkline: win/loss streak, avg R:R per strategy

---

### 🔵 Trade settings + Expectancy configuration (Phase 2 step candidate)

**Context:** ExpectancyPanel has hardcoded thresholds and 60% fallback.

**Current defaults (hardcoded in `NewTradePage.tsx`):**
```
DEFAULT_WIN_RATE = 60%
MIN_PROFILE_TRADES = 5
Grade thresholds (as R-multiple):
  < 0    → 🔴 Negative
  0–0.5  → 🟡 Marginal
  0.5–1  → 🟢 Good
  ≥ 1    → 💎 Excellent
```

**Planned settings (route: `/settings/trade`):**
- Default win rate fallback (%)
- Expectancy grade thresholds (editable)
- Whether to store expectancy value on trade submit (default: ON)
- Whether to show expectancy panel on trade form (default: ON)

**DB change needed:**
- `trades.expectancy_at_open DECIMAL(10,4)` — stored at submit time
- `user_preferences.expectancy_config JSONB` — stores thresholds per profile

---

### 🔵 Market analysis → risk gating (Phase 3 step candidate)

**Context:** Market analysis sessions produce a bias score. This should feed into
risk gating alongside strategy and confidence (see "Risk gating" note above).

**Planned logic:**
- `GET /api/profiles/:id/market-analysis/latest` returns `{ bias, score_pct, days_old }`
- If analysis > 7 days old → treat as Neutral (stale)
- Trade form badge: `"Crypto 🟢 79% · 2d ago"` shown above Section 3 (Prices)

---
DEFAULT_WIN_RATE = 60%
Grade thresholds (as multiple of R):
  < 0    → 🔴 Negative
  0–0.5  → 🟡 Marginal
  0.5–1  → 🟢 Good
  ≥ 1    → 💎 Excellent
```

**Planned settings (route: `/settings/trade`):**
- Default win rate fallback (%)
- Expectancy grade thresholds (editable table: label / emoji / threshold)
- Whether to store expectancy value on trade submit (default: ON)
- Whether to show expectancy panel on trade form (default: ON)

**DB change needed:**
- `trades.expectancy_at_open DECIMAL(10,4)` — stored at submit time, calculated frontend-side
- `user_preferences.expectancy_config JSONB` — stores thresholds per profile

---

### 🔵 Market analysis → risk gating (Phase 3 step candidate)

**Context:** Market analysis sessions (Crypto, Gold modules) produce a bias score
(Bullish / Neutral / Bearish). This should feed into risk gating alongside strategy
and confidence (see "Risk gating" note above).

**Planned logic:**
- `GET /api/profiles/:id/market-analysis/latest` returns `{ bias, score_pct, days_old }`
- If analysis > 7 days old → treat as Neutral (stale)
- Trade form badge: `"Crypto 🟢 79% · 2d ago"` shown above Section 3 (Prices)
- Risk multiplier applied server-side (or client-side preview in Section 3 header)

---

**Phase:** 1 · **Step:** 10 active · **Branch:** `develop`
f develop)
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

5. CI: GitHub Actions → `atd-test.yml` — lint + test on every push to develop + PR
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

### Step 9 — Frontend: Settings/Profiles + ProfilePicker (1 day)

> **⚠️ Plan change (2026-03-02):** Originally Step 12. Moved here because all
> subsequent Dashboard/Trade/Analysis widgets require an active profile.
> `/settings/profiles` is a hard prerequisite for Steps 10–12.

```
ProfilePicker (topbar, all pages):
  - Dropdown listing all active profiles (GET /api/profiles)
  - Active profile persisted in localStorage (key: atd_active_profile_id)
  - Auto-selects first profile if none stored
  - Shows: name + market_type badge + capital_current
  - Available on every page via ProfileContext (React context)

/settings/profiles:
  - List all profiles (cards: name, broker, market type, capital, status)
  - [+ New Profile] button → modal form
  - Edit profile → same modal pre-filled
  - Soft-delete (DELETE /api/profiles/:id) with confirmation
  - Fields: name, broker (dropdown GET /api/brokers), market_type,
            capital_start, risk_percentage_default, trading_style_id
  - Active badge on the currently selected profile
```

**Done when:** user can create/edit/delete profiles, select active profile
in topbar, and the selection persists across page reloads.

---

### Step 10 — Frontend: Trade Form (2 days)

```
/trades/new:
  - Profile auto-selected (last used, from ProfileContext)
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

### Step 12 — DONE (2026-03-03) — Frontend: Dashboard

**Widgets (all connected to real API, using active profile from ProfileContext):**

1. **Goals widget**
   - `goalsApi.progress(profileId)` + `stylesApi.list()`
   - Style tab selector (only shown when multiple styles have active goals)
   - One `GoalRow` per period (daily / weekly / monthly), sorted
   - Each row: P&L %, goal progress bar (brand/emerald), risk bar (amber/red)
   - Status badge: ✅ HIT / 🛑 BLOCKED / ⚠️ WARNING / ON TRACK
   - Empty state + link to /goals

2. **Market Analysis badge**
   - `maApi.getStaleness(profileId)`
   - One chip per module: `[dot] ModuleName · Xd ago`
   - Dot color: 🟢 fresh / 🟡 >7d / 🟠 >14d / ⚪ never
   - "stale" count badge in header
   - Alert when modules never analyzed (link to /market-analysis/new)

3. **Open Positions**
   - `tradesApi.list(profileId)` filtered to `open` | `partial`
   - Each row: symbol, direction arrow, entry price, risk $, booked P&L (partial only)
   - Status badge per row
   - Clickable → navigates to /trades/:id
   - Pending LIMIT orders shown as a footer alert (separate from "open" count)

4. **Performance summary**
   - Computed from `tradesApi.list()` (closed trades, `realized_pnl !== null`)
   - Win Rate (N/A if < 5 trades), Profit Factor, Avg R:R — all color-coded
   - Mini equity curve SVG (last 30 closed trades, cumulative P&L line + gradient fill)
   - Best trade / Worst trade (currency-formatted)

**KPI bar (top, always visible when profile is set):**
- Open Positions count
- Today's P&L (sum of `realized_pnl` from trades closed today)
- Portfolio Risk % (total `risk_amount` open ÷ `capital_current`)
- Win Rate (requires ≥5 closed trades)

**All widgets:** loading skeleton (spinner), error state, empty state with CTA links.

**Files changed:**
- `frontend/src/pages/dashboard/DashboardPage.tsx` — fully rewritten (no fake data)

> **⚠️ Plan change (2026-03-02):** Originally Step 9. Moved here so Dashboard
> widgets can be built against real data (real trades, real analyses, real goals)
> rather than empty state. ProfileContext (Step 9) is a hard prerequisite.

```
Widgets (all read from API using active profile from ProfileContext):

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

### Step 12.1 — DONE (2026-03-03) — Market Analysis: global sessions + frontend refactor

**Context:** Market Analysis sessions are not per-profile — they represent a global market view
(e.g. "Crypto macro analysis on 2026-03-03"). Filtering by profile was incorrect and has been removed.

**Backend additions:**
- `GET /api/market-analysis/staleness` — **new global endpoint** — returns last session date per
  active module regardless of profile. `is_stale = True` if no session or older than 7 days.
  Used by `MarketAnalysisPage` (overview). Profile-scoped staleness (`/profiles/{id}/market-analysis/staleness`)
  kept for backwards compatibility (Dashboard badge).
- `PATCH /api/market-analysis/indicators/{id}` — partial update of UI-text fields
  (`label`, `question`, `tooltip`, `answer_bullish/partial/bearish`, `default_enabled`).
  Immutable fields (`key`, `module_id`, `tv_symbol`, `timeframe_level`) are silently ignored.
  Powers the `/settings/market-analysis` inline editor (Phase 2 backlog, backend ready).
- `src/market_analysis/schemas.py` — added `IndicatorUpdate` schema
- `src/market_analysis/service.py` — added `get_staleness_global()` + `patch_indicator()`

**Frontend changes:**
- `frontend/src/lib/api.ts`:
  - `maApi.listSessions(moduleId?, limit)` — **profile_id parameter removed** (was always wrong)
  - `maApi.getStalenessGlobal()` — new, calls `GET /api/market-analysis/staleness`
  - `maApi.patchIndicator(id, data)` — new, calls `PATCH /api/market-analysis/indicators/{id}`
  - `maApi.getStaleness(profileId)` — kept as-is for Dashboard badge (profile-scoped)
- `frontend/src/pages/market-analysis/MarketAnalysisPage.tsx` — updated `listSessions` call
  from `maApi.listSessions(activeProfile.id, undefined, 30)` → `maApi.listSessions(undefined, 30)`
- `frontend/src/pages/dashboard/DashboardPage.tsx` — updated `listSessions` call
  from `maApi.listSessions(profileId, undefined, 10)` → `maApi.listSessions(undefined, 10)`

**Goals page fixes (also 2026-03-03):**
- `frontend/src/pages/goals/GoalsPage.tsx` — inline editing for goals (upsert + delete flow),
  fully connected to `goalsApi` (create, update, delete, progress)

---

### Step 13 — Final QA pass (1 day)

```
- End-to-end: open trade → partial close → full close → goals updated → analysis stale
- Cross-feature: analysis bias → trade form badge → adjusted risk% → goals updated
- Mobile layout check (responsive)
- No hardcoded values (all from DB / config)
```

---

### 🗒️ Post-Phase 1 backlog — features volontairement reportées

> Ces features sont **identifiées, conçues, mais hors scope Phase 1**.
> À implémenter en priorité au début de Phase 2 avant d'attaquer Volatility.

#### Indicator Editor (Settings → Market Analysis)

**Contexte :** Les questions/indicateurs sont actuellement définis en DB via `seed_market_analysis.py`
et sont read-only depuis l'UI. Les modifier manuellement en DB via Adminer fonctionne
(`UPDATE market_analysis_indicators SET question = '…' WHERE key = '…'`) mais ce n'est pas ergonomique.

**Ce qu'il faut construire :**

Backend :
```
PATCH /api/market-analysis/indicators/{id}
  Body: { question?, label?, tooltip?, answer_bullish?, answer_partial?, answer_bearish?, default_enabled? }
  → Met à jour uniquement les champs fournis (partial update)
  → Seuls les champs "UI text" sont patchables — key, module_id, asset_target, tv_symbol, tv_timeframe, timeframe_level sont immutables
```

Frontend : `/settings/market-analysis`
```
- Liste de tous les indicateurs groupés par module
- Inline edit : clic sur question → textarea en place
- Toggle default_enabled par indicateur
- Bouton Save par ligne
- Reset to default (depuis les valeurs de la seed)
```

**Note importante :** `profile_indicator_config` (toggle ON/OFF par profil) **existe déjà**
via `GET/PUT /api/profiles/{id}/indicator-config`. Ce endpoint peut être exposé dans
`/settings/market-analysis` dès Phase 2 sans backend supplémentaire.

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

## 🚀 Phase 1 — v1.0.0 Release checklist

> Steps 1–11 complete. After this checklist → merge `develop → main` → tag `v1.0.0`.

### Code

- [x] Step 1 — Project bootstrap (FastAPI + Vite + Docker + CI)
- [x] Step 2–3 — Full DB schema + Alembic migrations + seed data
- [x] Step 4–7 — All backend routes (profiles, brokers, trades, strategies, goals, stats, market analysis)
- [x] Step 9 — Settings/Profiles page + ProfilePicker
- [x] Step 10 — Trade form (risk calc, multi-TP, LIMIT lifecycle, expectancy, margin/leverage)
- [x] Step 11 — Goals page (real backend: create, toggle, live progress, KPIs)
- [x] Step 12 — Dashboard fully connected (Goals widget, MA badge, Open Positions, Performance)
- [x] Step 12.1 — Market Analysis global sessions (no profile filter) + PATCH indicator endpoint

### Quality gates

- [ ] `make lint` — ruff + mypy pass (0 errors)
- [ ] `make lint-fe` — eslint pass
- [ ] `make test` — pytest all green
- [ ] `vitest run` — all tests pass
- [ ] Manual QA: create profile → log trade → partial close → full close → goal progress updates

### Git

```bash
# Confirm clean working tree
git status

# Final commit
git add -A && git commit -m "feat(market-analysis): Step 12.1 — global sessions, PATCH indicator, Goals inline edit"

# Merge to main and tag
git checkout main
git merge --no-ff develop -m "feat: Phase 1 complete — v1.0.0"
git tag v1.0.0
git push origin main --tags
```

---

## 📦 Deliverable at end of Phase 1

```
✅ Docker Compose dev stack (API + DB + Frontend)
✅ Full DB schema + seed data
✅ All backend routes tested (Postman / pytest)
✅ All UI pages functional and connected to backend
✅ No JSON config files — everything configurable via UI
✅ Makefile (make dev, make deploy, make db-sync)
✅ scripts/deploy.sh on the Dell
✅ README.md with setup instructions
```

---

**Next:** → `post-implement-phase1.md` → Dell deploy (Step 14)

