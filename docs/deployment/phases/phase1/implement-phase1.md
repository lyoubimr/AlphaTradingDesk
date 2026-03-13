# 🛠️ Phase 1 — Implementation Plan

**Date:** March 1, 2026  
**Updated:** March 13, 2026  
**Version:** 2.9  
**Status:** Phase 1 COMPLETE — v1.0.0 tagged → Step 14 DONE → Post-Phase 1 MA improvements ongoing

> This document describes **what to build, in what order**.  
> Each step is a working, testable increment — nothing is left dangling.

> **Dev environment during Steps 1–13:** everything runs locally on the Mac.  
> Postgres runs in Docker on the Mac — no Dell needed yet.  
> The Dell comes in at Step 14.0 (migration) and Step 14.1 (prod deploy).

---

## 🗺️ Roadmap to v1.0.0 — COMPLETE

| Step | What | Status |
|------|------|--------|
| ~~13-F~~ | MA widget: circular badges, LTF display, compact layout | ✅ DONE |
| ~~13-G~~ | Strategies global (profile_id nullable), trade 1,N strategies, TradeStrategy ORM | ✅ DONE |
| ~~13-H~~ | Dashboard polish: themes (Night/Navy/Light), SnapshotGallery, db_recover.py | ✅ DONE |
| ~~13-I~~ | QA full pass (lint + tests + manual E2E) — 119/119 pytest, 8/8 vitest, 0 type errors | ✅ DONE |
| ~~14~~ | Deploy to Dell (Docker Compose prod, CI/CD pipeline, backup, healthcheck) | ✅ DONE |

**→ v1.0.0 tagged. Prod running on Dell. Next: Phase 2 (Volatility Analysis).**

---

## 🔧 Post-Phase 1 — MA Settings improvements (2026-03-13)

Applied on `develop` after v1.0.0, before Phase 2 kickoff.

### MA-1 — Add / Delete indicators from UI ✅ DONE

**Backend:**
- `src/market_analysis/schemas.py` — new `IndicatorCreate` schema (all fields: key, label, asset_target, tv_symbol, tv_timeframe, timeframe_level, score_block, question, tooltip, answer_*, default_enabled, sort_order)
- `src/market_analysis/service.py` — `create_indicator()` (409 on duplicate key) + `delete_indicator()` (FK cascades)
- `src/market_analysis/router.py` — `POST /modules/{module_id}/indicators` (201) + `DELETE /indicators/{indicator_id}` (204, `response_model=None`)

**Frontend:**
- `frontend/src/types/api.ts` — `MAIndicatorCreate` interface
- `frontend/src/lib/api.ts` — `maApi.createIndicator(moduleId, data)` + `maApi.deleteIndicator(indicatorId)`
- `frontend/src/pages/settings/MarketAnalysisSettingsPage.tsx`:
  - `IndicatorRow` — delete button with inline confirm (Trash2 icon → "Confirm / ✕")
  - `AddIndicatorForm` — shown at top of module (above indicator list), auto-scrolls into view on open; fields: label (auto-slugs key), key, timeframe, score block, asset target (with explanation), TV symbol, TV timeframe, question, guidance/tooltip, answer labels ×3
  - `ModuleSection` — "Add / Cancel" toggle button in module header
  - Main page — `handleDeleteIndicator` + `handleCreateIndicator` handlers update local state

### MA-2 — Seed + Settings page improvements ✅ DONE

- `database/migrations/seeds/seed_market_analysis.py` — module `description` fields cleared (was hardcoded trading methodology text)
- `MarketAnalysisSettingsPage.tsx` — PageHeader subtitle + info tooltip updated; banner rewritten with 5 clear bullets (Edit / Add / Delete / Default enabled / Profile On/Off)
- Bug fixed: `DELETE /indicators/{id}` route had `-> None` instead of `-> Response` + missing `response_model=None` → FastAPI assertion error at startup → backend crashed on restart

### Score calculation — not impacted ✅

Adding/deleting indicators does not break the score calculation:
- `_get_enabled_indicator_ids()` queries DB live — no hardcoded count
- `_score_pct(total, count)` uses `count * 2` where count = enabled indicators in bucket
- `_compute_scores()` skips any answer where `ind_id not in enabled_ids`
- Composite v2 weights auto-adjust: `total_weight = sum(weights for non-empty blocks)`

---

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

### Step 10 — DONE (2026-03-02/03)

**Trade form (NewTradePage.tsx):**
- Fixed Fractional position sizing (Crypto: units, CFD: lots)
- Multi-TP presets (1–4 TPs, Smart Scale / Balanced / Aggressive / Conservative / Profit Max)
- SL direction validation (LONG: SL < entry, SHORT: SL > entry)
- Crypto: leverage slider, safe margin calc (MMR-aware), estimated liquidation price
- CFD: broker margin estimate, maintenance margin, margin level %, margin call warning
- Session auto-detection (UTC-based)
- Strategy dropdown with inline "New strategy" creation
- Confidence score 1–10
- Setup tags (chart patterns / confluences)
- **Expectancy panel** — E(R) = WR × AvgWinR − (1−WR) × 1R, 4-level WR priority

**LIMIT order lifecycle:**
```
MARKET: open → partial → closed
LIMIT:  pending → open → partial → closed
                ↘ cancelled
```
- `POST /api/trades/{id}/activate` — pending → open
- `POST /api/trades/{id}/cancel`   — pending → cancelled only

### Step 11 — DONE (2026-03-03)
- `GET /api/trading-styles` — styles_router
- `GET /api/stats/winrate` — stats_router registered in main.py
- GoalsPage.tsx — real backend: create, toggle, live progress, KPIs, ProgressCard

### Step 12 — DONE (2026-03-03)
- Dashboard fully connected: Goals widget, MA badge, Open Positions, Performance summary
- KPI bar: Open Positions, Today's P&L, Portfolio Risk %, Win Rate

### Step 12.1 — DONE (2026-03-03)
- MA sessions are global (no profile filter) — `GET /api/market-analysis/staleness`
- `PATCH /api/market-analysis/indicators/{id}` — partial update of UI text fields
- Frontend: `maApi.getStalenessGlobal()`, `maApi.patchIndicator()`, profile_id removed from listSessions

### Step 13-A — DONE (2026-03-06) — DB Migrations (Goals v2 + MA v2)

**Migrations applied:**
- `step12_goals_v2.py` — added `avg_r_min`, `max_trades`, `period_type`, `show_on_dashboard` to `profile_goals`
- `step13_goal_override_log.py` — new `goal_override_log` table
- `step14_goals_nullable_style_drop_review.py` (dbf0b348bf21):
  - `profile_goals.style_id` → nullable (NULL = global goal, all styles)
  - `goal_progress_log.style_id` → nullable
  - Dropped `'review'` from `period_type` CHECK — now `'outcome' | 'process'` only
  - Replaced UNIQUE(profile_id, style_id, period) with partial indexes:
    - `uq_profile_goals_style` — WHERE style_id IS NOT NULL
    - `uq_profile_goals_global` — WHERE style_id IS NULL (one global goal per profile+period)
- `step15_goals_unique_add_period_type.py` (7ca85c6b1bd1) — added `period_type` to unique index

### Step 13-B — DONE (2026-03-06) — Backend Goals v2

- `src/goals/schemas.py` — `GoalCreate/Update`: `avg_r_min`, `max_trades`, `period_type`, `show_on_dashboard`
- `src/goals/schemas.py` — `GoalProgressItem`: `avg_r`, `avg_r_min`, `avg_r_hit`, `max_trades_hit`, `period_type`, `show_on_dashboard`
- `src/goals/service.py`:
  - Global goals: `style_id = NULL` → all trades of profile
  - `avg_r` computed from `realized_pnl / risk_amount` on closed trades in period
  - `avg_r_min` passed from `ProfileGoal` → `GoalProgressItem`
  - Circuit breaker (`limit_hit`) fires only for `period_type == 'outcome'`
  - `risk_progress` always computed regardless of period_type (loss is loss)
  - Changing type outcome → process does NOT reset accumulated loss
  - `POST /api/profiles/{id}/goal-overrides` + `GET .../goal-overrides`

### Step 13-C — DONE (2026-03-06) — Backend MA v2 (partial)

- `seed_market_analysis.py` — upsert logic, `score_block` field, fixed emoji/sort_order
- Backend `GoalProgressItem` schema now includes `avg_r_min`
- MA decomposed score columns added to `market_analysis_sessions` (schema-ready, compute logic pending 13-F)

### Step 13-D — DONE (2026-03-06) — Settings + GoalsSettingsPage

- `GoalsSettingsPage.tsx` — full rewrite: global goals, no style grouping, no review, compact layout
- `GoalsPage.tsx`:
  - `ProgressCard` — currency amounts signed (+$410 / -$205), Avg R badge (violet, last in card), loss limit always shown
  - "New Goal" → `/settings/goals?new=1`
  - Compact Period Plan footer
- `DashboardPage.tsx` — GoalsWidget shows global goals (style filter removed)
- `types/api.ts` — `GoalProgressItem.avg_r_min`, `style_id` nullable, `review` removed
- `lib/api.ts` — overrides endpoints, goal_id-based update/delete

### Step 13-E — DONE (2026-03-06) — Goals UX polish

- Avg R bar replaced with compact badge (violet neutral / red negative / amber below goal / green hit)
- Badge positioned last in ProgressCard, separated by thin divider
- Bug fixed: negative avg_r no longer causes full bar (CSS negative width issue)
- `fmtAmount(signed=true)` — P&L shows +/- prefix on currency amounts
- Target/Limit row: `+$410` green / `-$205` red — visually clear

### Bugfix batch — DONE (2026-03-07) — Trade PnL + Goals service + Tests

#### 🐛 initial_stop_loss bug (PnL = 0 on BE trades)

**Root cause:** When a trade moves to Break-Even, `stop_loss = entry_price`. The backend
`_position_pnl()` was computing `price_dist = entry - stop_loss = 0`, leading to
`units = risk / 0 = ∞` or divide-by-zero → PnL always 0 for all subsequent TP closures.

**Fix:**
- `initial_stop_loss` column (added in migration `63f9f74ede34`) now used for all unit calculations
- `src/trades/service.py` — `_position_pnl` uses `trade.initial_stop_loss` (set once at open, never changed)
- `src/trades/schemas.py` — `TradeOut` + `TradeListItem` expose `initial_stop_loss`
- `frontend/src/types/api.ts` — `initial_stop_loss: string` added to `TradeListItem`
- `frontend/src/pages/trades/TradeDetailPage.tsx` — PnL preview + R:R use `initial_stop_loss`
- `database/migrations/seeds/seed_test_data.py` — ETH (2050) and EURUSD (1.08700) BE trades now have correct `initial_stop_loss`

**Rule:** `initial_stop_loss` is set once at `open_trade` and **never updated**. Always use it
(not `stop_loss`) for unit/lot size and PnL calculations.

#### 🐛 direction uppercase in API responses

**Root cause:** DB stores `direction` lowercase (`"long"/"short"`); frontend compares `"LONG"/"SHORT"`.
This caused all direction checks in PnL preview to silently evaluate the wrong branch.

**Fix:**
- `src/trades/schemas.py` — `model_validator(mode="after")` in `TradeOut` + `TradeListItem` uppercases `direction` before returning
- `tests/test_trades.py` — assertion updated to `"LONG"` / `"SHORT"`

#### 🐛 goals/service.py — Strategy.style_id AttributeError

**Root cause:** Old dead code in `_compute_period_data()` tried to join `Strategy` on `style_id`
which was removed from the model in Step 13-A (all goals are now global, `style_id=NULL`).

**Fix:**
- `src/goals/service.py` — removed the two `if style_id is not None` branches that referenced
  `Strategy.style_id` — replaced with a simple direct query (all trades of the profile)
- The `style_id` parameter is preserved for API compatibility but is now a no-op (always `NULL`)

#### 🐛 src/main.py — OSError on pytest macOS (uploads_dir)

**Root cause:** `uploads_dir` defaults to `/app/uploads` (Docker path). `os.makedirs()` at module
level raised `OSError: Read-only file system` when running pytest locally on macOS.

**Fix:**
- `src/main.py` — wrapped `os.makedirs` in try/except; falls back to `$TMPDIR/atd_uploads`
  when the configured path is inaccessible

#### 🧪 Test suite — 118/118 passing (was 7 failing)

| Test file | Fixed |
|-----------|-------|
| `tests/test_goals.py` | `_make_closed_trade` missing `initial_stop_loss` → `NotNullViolation` |
| `tests/test_goals.py` | `TestUpdateGoal` used old URL `PUT .../goals/{style_id}/{period}` → 404; updated to `PUT .../goals/{goal_id}` |
| `tests/test_goals.py` | `test_inactive_goals_excluded` used old PUT URL → updated |
| `tests/test_goals.py` | `test_progress_response_shape` expected_keys outdated → added `goal_id`, `avg_r_min`, `trades` |

#### 🧹 Code quality (2026-03-07)

- `ruff check --fix` → 10 auto-fixed (unused imports + unsorted import blocks)
- `ruff format` → 34 files reformatted
- `mypy src/` → **0 errors** (35 source files)
- `eslint .` → **0 warnings/errors**
- `tsc --noEmit` → **0 type errors**
- vitest → **8/8 passing**
- pytest → **118/118 passing**

### Steps 13-F/G/H — DONE (2026-03-07) — Strategies global + Themes + Snapshot Gallery

- `DashboardPage.tsx` — `TFBadge` component: circular ring badges (HTF/MTF/LTF)
  - Color ring: emerald (bullish) / red (bearish) / amber (neutral)
  - `MAModuleCard` — compact horizontal layout, badges replace progress bars
  - `BadgeRow` extracted to top-level component (fix `react-hooks/static-components` lint rule)
  - LTF score now shown (was missing before)

#### 13-G: Strategies — global shared strategies

**DB changes (migration `412487625940`):**
- `strategies.profile_id` → nullable (`NULL` = global, shared across all profiles)
- Dropped `UNIQUE(profile_id, name)` constraint
- Added two partial indexes:
  - `uq_strategies_global` — `UNIQUE(name) WHERE profile_id IS NULL`
  - `uq_strategies_profile` — `UNIQUE(profile_id, name) WHERE profile_id IS NOT NULL`
- `trades.close_notes` — TEXT nullable (post-trade review notes, editable after close)
- `trades.close_screenshot_urls` — TEXT[] nullable (close snapshots)
- `trades.entry_screenshot_urls` — TEXT[] nullable (entry snapshots)

**DB changes (migration `4365b5e32ea3`):**
- `trade_strategies` — new junction table for trade 1,N strategies (many-to-many)
  - `UNIQUE(trade_id, strategy_id)`
  - FK → `trades.id ON DELETE CASCADE`, `strategies.id ON DELETE CASCADE`

**Backend:**
- `src/core/models/trade.py`:
  - `Strategy.profile_id` → `Mapped[int | None]` (nullable)
  - `Strategy.__table_args__` — removed `UniqueConstraint("profile_id","name")` (replaced by DB partial indexes)
  - New `TradeStrategy` ORM model (junction table)
  - `Trade.strategies` — m2m viewonly relationship via `trade_strategies`
  - `Trade.trade_strategy_links` — writable relationship to `TradeStrategy`
  - `Strategy.trades_m2m` — m2m viewonly relationship
  - `Strategy.trade_strategy_links` — writable relationship
- `src/profiles/service.py` — `list_strategies`: now returns global (profile_id=NULL) + profile-specific, ordered by name
- `src/profiles/schemas.py` — `StrategyOut.profile_id` → `int | None`

**Rule: strategy editing via profile endpoint only works on profile-specific strategies.**
Global strategies (profile_id=NULL) are read-only via `/api/profiles/{id}/strategies`.

#### 13-H: Dashboard polish + Themes + Snapshot Gallery

**Themes (8 total):**

| Theme ID | Label | Swatch |
|----------|-------|--------|
| `indigo` | Indigo Night (default) | #6366f1 |
| `emerald` | Emerald Oasis | #10b981 |
| `amber` | Amber Desert | #f59e0b |
| `rose` | Rose Blaze | #f43f5e |
| `cyan` | Cyan Terminal | #06b6d4 |
| `night` | Night Black | #f8fafc |
| `navy` | Navy Pro | #3b82f6 |
| `light` | Light | #6366f1 |

- `frontend/src/context/ThemeContext.tsx` — 3 new theme entries (night, navy, light)
- `frontend/src/index.css` — CSS variable overrides for `[data-theme="night"]`, `[data-theme="navy"]`, `[data-theme="light"]`
- `frontend/src/components/topbar/Topbar.tsx` — theme picker dropdown with swatch dots

**Snapshot Gallery (`TradeDetailPage.tsx`):**
- `SnapshotGallery` component — upload/delete/lightbox for entry + close screenshots
- Entry screenshots: shown on open/partial trades (editable)
- Close screenshots: shown on all statuses, editable always
- `close_notes` text area — editable on all trade statuses (post-trade review)
- API: `tradesApi.uploadEntrySnapshot`, `uploadCloseSnapshot`, `deleteEntrySnapshot`, `deleteCloseSnapshot`
- Types: `TradeOut.entry_screenshot_urls`, `.close_notes`, `.close_screenshot_urls`
- `TradeClose` + `TradeUpdate` schemas accept `close_notes` + `close_screenshot_urls`

**DevOps:**
- `scripts/db_recover.py` — smart recovery script (detects schema state → stamps or migrates)
- `Makefile` — `db-recover` now calls `db_recover.py`; new `db-recover-full` target
- `docker-compose.dev.yml` — `scripts/` bind-mounted into backend container

**Quality after 13-F/G/H:**
- `ruff check` → 0 errors
- `mypy src/` → 0 errors (35 files)
- `eslint` → 0 errors
- `tsc --noEmit` → 0 errors
- `pytest` → **119/119 passing**

---

### Step 13-I — DONE (2026-03-08) — QA full pass

- `ruff check` → 0 errors
- `ruff format` → clean
- `mypy src/` → 0 errors (35 files)
- `eslint .` → 0 warnings/errors
- `tsc --noEmit` → 0 type errors
- `vitest run` → 8/8 passing
- `pytest` → 119/119 passing
- Manual E2E: trade lifecycle, goal progress, MA analysis, themes, snapshot gallery
- `frontend/package.json` — added `type-check` script (required by CI)
- Merged `develop → main` via `--no-ff`
- Tagged `v1.0.0` → pushed to GitHub

---

### Step 14 — DONE (2026-03-14) — Dell prod deploy

**Server provisioning:**
- Ubuntu Server 24.04 LTS on Dell OptiPlex
- `scripts/prod/setup-server.sh` — Docker, UFW, SSH keys, `atd` user, directory layout
- `avahi-daemon` configured for mDNS — `http://alphatradingdesk.local` resolves on LAN
- Tailscale installed for remote CD access

**CI/CD pipeline (`atd-deploy.yml`):**
- 3-job pipeline: `version` (semver bump) → `build` (GHCR push) → `deploy` (SSH to Dell)
- `version` job: conventional-commits bump → pushes tag + version commit to `main`
- `build` job: Docker buildx → images pushed to `ghcr.io`
- `deploy` job: Tailscale join → SSH to Dell → `deploy.sh` (pull GHCR images + `up -d`)
- `GHCR_TOKEN` used for Dell `docker login` (separate from CI build token)

**Prod stack:**
- `docker-compose.prod.yml` — backend + frontend (nginx) + db (postgres:16) + adminer
- `env_file: /home/atd/apps/.env` (fixed from `/root/apps/.env`)
- DB seeded automatically via `entrypoint.sh` on first container start
- Alembic migrations run on every deploy (`alembic upgrade head`)
- `src/core/config.py` — `APP_ENV` reads `environment` field (fixed; default `prod` in Docker)

**Ops scripts (all in `scripts/prod/`):**
- `backup-db.sh` — rolling (every 6h, keep 48) + weekly (Sunday 03:00, keep 13)
- `setup-cron.sh` — installs cron jobs on Dell
- `healthcheck.sh` — containers, API (`/health`), disk, RAM, last backup, alembic head
- `scripts/sync-db-prod-to-dev.sh` — pulls prod DB to Mac dev, scrubs secrets

**Connectivity:**
- SSH config (`~/.ssh/config` Host `atd`) — passwordless rsync + SSH from Mac
- `rsync` backup pull from Dell → Mac (on demand or cron)
- GHCR_OWNER warning suppressed in `backup-db.sh` + `healthcheck.sh`

 (1–4 TPs, Smart Scale / Balanced / Aggressive / Conservative / Profit Max)
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

### Step 13 — Goals v2 + MA v2 + Settings + QA (2026-03-06→)

> **Objectif :** tout finir avant le deploy Dell.
> Steps 13-A through 13-E are DONE. Steps 13-F through 13-I remain.

---

#### ✅ 13-A — DB Migrations — DONE
#### ✅ 13-B — Backend Goals v2 — DONE
#### ✅ 13-C — Backend MA v2 (seed + schema) — DONE (compute logic in 13-F)
#### ✅ 13-D — Settings + GoalsSettingsPage — DONE
#### ✅ 13-E — Goals UX polish — DONE

---

#### 🔜 13-F — Market Analysis v2 Frontend + Backend compute

> **This is the next step.**

**F1 — Backend: decomposed score computation (`src/market_analysis/service.py`)**
```python
def compute_decomposed_scores(answers: list[MAAnswer], indicators: list[MAIndicator]) -> dict:
    """
    Returns score_trend, score_momentum, score_participation, score_composite, bias_composite
    for each asset group (a / b).

    Indicator weights by timeframe:  HTF=0.6  MTF=0.3  LTF=0.1
    Block weights:                   Trend=0.45  Momentum=0.30  Participation=0.25
    Bias thresholds:                 ≥65 = bullish | ≤34 = bearish | else = neutral
    """
```

- `create_session()` → calls `compute_decomposed_scores()`, populates new columns
- `get_trade_conclusion(trend, momentum, participation, bias) → TradeConclusion`
- `GET /api/market-analysis/sessions/{id}/conclusion` endpoint

**Trade Conclusion rules (priority order):**

| Condition | Label | Color |
|-----------|-------|-------|
| `bias=bearish AND participation<40` | 🔴 Risk-Off — No Longs | red |
| `trend≥65 AND momentum<40` | ⚠️ Late Stage / Exhaustion | amber |
| `trend≥65 AND momentum≥60 AND participation≥55 AND bias=bullish` | 🟢 Trend Following — Full Size | green |
| `trend≥55 AND (momentum<50 OR participation<50)` | 🟡 Wait for Confirmation | amber |
| `momentum≥60 AND trend<50` | ⚡ Day Trade Only | amber |
| default | 🟡 Neutral — Selective | neutral |

**F2 — Frontend: `NewAnalysisPage.tsx` — summary screen v2**
```
📊 TREND/STRUCTURE    ████████░░ 79%  🟢 Bullish
⚡ MOMENTUM/VOLUME    ██████░░░░ 58%  🟡 Neutral
🔄 PARTICIPATION      ████░░░░░░ 44%  🟡 Neutral
────────────────────────────────────
🎯 COMPOSITE          ███████░░░ 64%  🟡 NEUTRAL

[Conclusion card]
🟡 Wait for Confirmation
"Trend present but momentum not confirming. Reduce size or wait."
Styles recommandés: Swing careful · Day Trade
Size advice: 50–75%
```

**F3 — Frontend: `MarketAnalysisPage.tsx` — conclusion per module**
- Each module card shows `TradeConclusion` badge of last session (emoji + label + size_advice)

**F4 — Frontend: `DashboardPage.tsx` — MAWidget conclusion badge**
- Short conclusion (emoji + label) on each module card in the MA widget

**F5 — Frontend: `NewAnalysisPage.tsx` — visual grouping by score_block**
- Questions grouped by block (Trend / Momentum / Participation)
- Block progress bar shown at end of questionnaire

---

#### ⏳ 13-G — Strategy Module

> A dedicated strategy settings page + minor backend additions.

**What:**
- `/settings/strategies` — new page `StrategiesSettingsPage.tsx`
- List all strategies per profile (name, emoji, win rate bar, trades_count)
- Edit name / emoji / notes inline
- `min_trades_for_stats` override per strategy (default 5)
- Archive strategy (archived still appear in closed trade history)
- Performance summary per strategy: win/loss streak, avg R per strategy

**Backend additions:**
- `GET /api/profiles/{id}/strategies` — already exists, enhance with `avg_r`, `streak`
- `PATCH /api/profiles/{id}/strategies/{id}` — partial update (name, emoji, is_archived, min_trades_for_stats)
- `POST /api/profiles/{id}/strategies/{id}/archive` — soft archive

**Frontend additions:**
- `frontend/src/pages/settings/StrategiesSettingsPage.tsx` — new page
- `SettingsPage.tsx` — add "Strategies" link in Trading section
- Strategy dropdown in `NewTradePage.tsx` — hide archived strategies (already filtered by `is_active`)

---

#### ⏳ 13-H — Dashboard Polish

> Small UI improvements on the dashboard — no new features.

**Planned changes:**
- Open Positions widget: show unrealized P&L estimate (manual entry field on trade row)
- Performance widget: add Profit Factor computation from closed trades
- KPI bar: Portfolio Risk % — show breakdown (open vs pending LIMIT)
- Goals widget on Dashboard: match GoalsPage card style (period badges, Avg R badge)
- MA widget: show conclusion badge from latest session per module
- General: loading skeletons where missing, consistent empty states

---

#### ⏳ 13-I — QA Full Pass

```
Backend:
  [ ] make lint — ruff + mypy 0 errors
  [ ] make test — pytest all green
  [ ] alembic upgrade head — no errors on fresh DB
  [ ] seed_market_analysis.py re-run — idempotent

Frontend:
  [ ] make lint-fe — eslint 0 errors
  [ ] vitest run — all tests pass
  [ ] tsc --noEmit — 0 errors

End-to-end (manual):
  [ ] Create profile → log trade → partial close → full close → goal progress updates
  [ ] Goal hit → ✅ badge on Dashboard
  [ ] Limit hit (outcome) → Limit hit badge shown, process goal not blocked
  [ ] New MA analysis → decomposed scores → conclusion shown on /market-analysis
  [ ] Dashboard MAWidget → conclusion badge per module
  [ ] Settings Goals → toggle period_type → no circuit breaker for process
  [ ] Settings Strategies → edit name, archive strategy
  [ ] Avg R badge: positive/negative/goal hit states all correct
  [ ] Mobile layout: Dashboard, Goals, MarketAnalysis responsive
```

**A1 — `profile_goals` v2 :**
```sql
ALTER TABLE profile_goals
  ADD COLUMN avg_r_min         DECIMAL(4,2),      -- NULL = pas de target R (ex: 1.3)
  ADD COLUMN max_trades        INT,               -- NULL = illimité (ex: 6/semaine)
  ADD COLUMN period_type       VARCHAR(20) NOT NULL DEFAULT 'outcome',
  -- 'outcome' → P&L + circuit breaker actif
  -- 'process' → pas de P&L target, juste review (ex: daily pour swing)
  -- 'review'  → affiché en lecture seule, pas de circuit breaker
  ADD COLUMN show_on_dashboard BOOLEAN NOT NULL DEFAULT TRUE;
```

**A2 — `goal_override_log` (nouvelle table) :**
```sql
CREATE TABLE goal_override_log (
    id                   BIGSERIAL PRIMARY KEY,
    profile_id           BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    style_id             BIGINT NOT NULL REFERENCES trading_styles(id),
    period               VARCHAR(20) NOT NULL,
    period_start         DATE NOT NULL,
    pnl_pct_at_override  DECIMAL(10,4),
    open_risk_pct        DECIMAL(6,2),
    reason_text          TEXT NOT NULL,           -- obligatoire
    acknowledged         BOOLEAN NOT NULL DEFAULT TRUE,
    overridden_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**A3 — `market_analysis_indicators` : champ `score_block` :**
```sql
ALTER TABLE market_analysis_indicators
  ADD COLUMN score_block VARCHAR(20) NOT NULL DEFAULT 'trend';
  -- 'trend' | 'momentum' | 'participation'
```

**A4 — `market_analysis_sessions` : scores décomposés :**
```sql
ALTER TABLE market_analysis_sessions
  ADD COLUMN score_trend_a          DECIMAL(5,2),
  ADD COLUMN score_momentum_a       DECIMAL(5,2),
  ADD COLUMN score_participation_a  DECIMAL(5,2),
  ADD COLUMN score_composite_a      DECIMAL(5,2),   -- 0–100, weighted final
  ADD COLUMN bias_composite_a       VARCHAR(10),    -- 'bullish'|'neutral'|'bearish'
  ADD COLUMN score_trend_b          DECIMAL(5,2),
  ADD COLUMN score_momentum_b       DECIMAL(5,2),
  ADD COLUMN score_participation_b  DECIMAL(5,2),
  ADD COLUMN score_composite_b      DECIMAL(5,2),
  ADD COLUMN bias_composite_b       VARCHAR(10);
-- Anciennes colonnes score_htf/mtf/ltf_a/b conservées (compat descendante)
-- Sessions v2 détectées par : score_trend_a IS NOT NULL
```

---

#### 13-B — Backend Goals v2

**B1 — `src/goals/schemas.py` :**
- `GoalCreate` / `GoalUpdate` : ajouter `avg_r_min`, `max_trades`, `period_type`, `show_on_dashboard`
- `GoalProgressItem` : ajouter `avg_r`, `avg_r_hit`, `max_trades_hit`, `period_type`, `show_on_dashboard`

**B2 — `src/goals/service.py` :**
- `compute_progress()` : calculer `avg_r` depuis `positions.realized_pnl / trades.risk_amount` sur la période
- Circuit breaker : ne s'active QUE si `period_type == 'outcome'` (pas pour `'process'` ni `'review'`)
- `avg_r_hit = avg_r >= avg_r_min` si `avg_r_min` défini

**B3 — `src/goals/router.py` :**
- `POST /api/profiles/{id}/goal-overrides` — log override (texte obligatoire)
- `GET  /api/profiles/{id}/goal-overrides` — historique des overrides

---

#### 13-C — Backend MA v2

**C1 — `database/migrations/seeds/seed_market_analysis.py` :**
- Ajouter `score_block` à chaque indicateur (voir mapping dans `custom/plan_integration_ma_v2.md`)
- `alts_htf_1w_others` → `score_block = 'participation'`, `default_enabled = False` (redondant avec TOTAL2)

**C2 — `src/market_analysis/service.py` :**
- `compute_decomposed_scores(answers)` → renvoie `score_trend`, `score_momentum`, `score_participation`, `score_composite`, `bias_composite`
- Weights : HTF=0.6 / MTF=0.3 / LTF=0.1 (par indicateur) × bloc : Trend=0.45 / Momentum=0.30 / Participation=0.25
- Thresholds : ≥65 = bullish | ≤34 = bearish | reste = neutral
- `create_session()` : appeler `compute_decomposed_scores()` et peupler les nouvelles colonnes

**C3 — `src/market_analysis/schemas.py` :**
- `SessionCreate` / `SessionOut` / `SessionListItem` : exposer les nouvelles colonnes

**C4 — Conclusions trade-type (`trade_conclusion`) :**
- Fonction `get_trade_conclusion(score_trend, score_momentum, score_participation, bias_composite)` → renvoie un objet `TradeConclusion`
- Endpoint `GET /api/market-analysis/sessions/{id}/conclusion`
- Voir logique complète dans §13-D

---

#### 13-D — Logique "Trade Conclusion" (cœur de la valeur)

> Traduit les 3 scores + composite en recommandation actionnable pour le trade.

```python
# Règles de conclusion (en ordre de priorité)

def get_trade_conclusion(trend, momentum, participation, bias) -> TradeConclusion:
    """
    trend, momentum, participation : float 0–100
    bias : 'bullish' | 'neutral' | 'bearish'
    """

    # 🔴 RISK-OFF — ne pas trader long
    if bias == 'bearish' and participation < 40:
        return TradeConclusion(
            emoji="🔴",
            label="Risk-Off — No Longs",
            detail="USDT.D rising + weak participation. BTC longs not recommended.",
            trade_types=[],
            size_advice="cash or short only",
            color="red",
        )

    # 🔴 LATE STAGE — momentum diverge du trend
    if trend >= 65 and momentum < 40:
        return TradeConclusion(
            emoji="⚠️",
            label="Late Stage / Exhaustion",
            detail="Trend strong but momentum fading. Reduce size, take early TPs.",
            trade_types=["swing_short_term"],
            size_advice="reduced (50%)",
            color="amber",
        )

    # 🟢 FULL TREND — tout aligné
    if trend >= 65 and momentum >= 60 and participation >= 55 and bias == 'bullish':
        return TradeConclusion(
            emoji="🟢",
            label="Trend Following — Full Size",
            detail="All factors aligned. Swing longs, high R:R setups, normal size.",
            trade_types=["swing", "position"],
            size_advice="normal (100%)",
            color="green",
        )

    # 🟡 WAIT FOR CONFIRMATION — trend fort mais momentum/participation faible
    if trend >= 55 and (momentum < 50 or participation < 50):
        return TradeConclusion(
            emoji="🟡",
            label="Wait for Confirmation",
            detail="Trend present but momentum or participation not confirming. Reduce size or wait.",
            trade_types=["swing_careful"],
            size_advice="reduced (50–75%)",
            color="amber",
        )

    # ⚡ DAY TRADE ONLY — momentum fort mais trend faible
    if momentum >= 60 and trend < 50:
        return TradeConclusion(
            emoji="⚡",
            label="Day Trade Only",
            detail="Short-term momentum only. No swing positions. Quick exits.",
            trade_types=["day_trading"],
            size_advice="reduced (50%)",
            color="amber",
        )

    # 🟡 NEUTRAL — rien d'exceptionnel
    return TradeConclusion(
        emoji="🟡",
        label="Neutral — Selective",
        detail="Mixed signals. Only A+ setups, reduced size.",
        trade_types=["day_trading", "swing_careful"],
        size_advice="reduced (50%)",
        color="neutral",
    )
```

**Schéma `TradeConclusion` (Pydantic) :**
```python
class TradeConclusion(BaseModel):
    emoji: str                   # "🟢" | "⚠️" | "🔴" | "⚡" | "🟡"
    label: str                   # "Trend Following — Full Size"
    detail: str                  # explication 1 phrase
    trade_types: list[str]       # ["swing", "position"] — styles recommandés
    size_advice: str             # "normal (100%)" | "reduced (50%)"
    color: str                   # "green" | "amber" | "red" | "neutral"
```

---

#### 13-E — Frontend Goals v2

**E1 — `GoalsPage.tsx` — enrichissements :**
- `ProgressCard` : afficher `avg_r` bar + `avg_r_min` target (si défini)
- `ProgressCard` : afficher `trade_count / max_trades` badge (si défini)
- Période `period_type = 'process'` → style visuel différent (pas de progress bar P&L, message "Focus on process today")
- Période `period_type = 'review'` → grisé, pas de circuit breaker

**E2 — `NewTradePage.tsx` — override dialog v2 :**
```
🛑 WEEKLY LOSS LIMIT REACHED (-X.X% / -X.X%)

Why are you overriding this limit?
[ textarea — obligatoire, min 20 chars ]

☐ I acknowledge I am violating my risk plan

[Cancel]     [Override & Log →]
```
→ Appelle `POST /api/profiles/{id}/goal-overrides`

**E3 — `GoalsPage.tsx` — section "Override History" :**
- Table : Date | Period | Style | P&L at override | Reason
- Accessible en bas de la page Goals

---

#### 13-F — Frontend MA v2

**F1 — `NewAnalysisPage.tsx` — groupement visuel :**
- Questions regroupées par bloc (Trend / Momentum / Participation)
- Progress bar par bloc à la fin du questionnaire (calculée en frontend depuis les réponses + `score_block`)

**F2 — `NewAnalysisPage.tsx` — Summary screen v2 :**
```
📊 TREND/STRUCTURE    ████████░░ 79%  🟢 Bullish
⚡ MOMENTUM/VOLUME    ██████░░░░ 58%  🟡 Neutral
🔄 PARTICIPATION      ████░░░░░░ 44%  🟡 Neutral
━━━━━━━━━━━━━━━━━━━━━━━
🎯 COMPOSITE          ███████░░░ 64%  🟡 NEUTRAL

[Conclusion card]
🟡 Wait for Confirmation
"Trend present but momentum not confirming. Reduce size or wait."
Styles recommandés : Swing careful · Day Trade
Size advice : 50–75%
```

**F3 — `MarketAnalysisPage.tsx` — conclusion par module :**
- Chaque module card affiche la `TradeConclusion` de la dernière session
- Badge coloré + label + size advice

**F4 — `DashboardPage.tsx` — MAWidget conclusion :**
- Conclusion courte (emoji + label) sur chaque module card

---

#### 13-G — Settings pages

**G1 — `/settings/goals` (nouvelle page `GoalsSettingsPage.tsx`) :**
- Affiche la matrice Période × Style
- Permet de configurer `period_type` par combinaison (outcome / process / review)
- Permet de toggle `show_on_dashboard`
- Permet de définir `avg_r_min` et `max_trades` par goal

**G2 — `SettingsPage.tsx` — navigation :**
- Section "Trading" → Goals Settings
- Section "Market Analysis" → MA Settings (déjà existant)
- Structure claire avec icônes

**G3 — `/settings/market-analysis` (existant, enrichir) :**
- Déjà existant : `MarketAnalysisSettingsPage.tsx`
- Ajouter : affichage du `score_block` par indicateur (Trend/Momentum/Participation)
- Toggle `default_enabled` déjà fonctionnel

---

#### 13-H — QA final (checklist complète)

```
Backend :
  [ ] make lint — ruff + mypy pass (0 errors)
  [ ] make test — pytest all green
  [ ] Alembic upgrade head — pas d'erreur
  [ ] seed_market_analysis.py — score_block reclassifié sur tous les indicateurs

Frontend :
  [ ] make lint-fe — eslint 0 erreurs
  [ ] vitest run — all tests pass
  [ ] TSC --noEmit — 0 erreurs

End-to-end :
  [ ] Créer profil → ouvrir trade → partial close → full close → goal progress mis à jour
  [ ] Goal atteint → badge 🎯 sur Dashboard
  [ ] Limit hit → dialog override v2 → log visible dans Override History
  [ ] Nouvelle analyse MA → scores décomposés → conclusion affichée sur /market-analysis
  [ ] Dashboard MAWidget → conclusion badge par module
  [ ] Settings Goals → changer period_type daily Swing → 'process' → plus de circuit breaker
  [ ] Settings MA → toggle indicateur → plus affiché dans NewAnalysisPage
  [ ] Mobile layout : Dashboard, Goals, MarketAnalysis (responsive)
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

## 🚀 Phase 1 — v1.0.0 Release checklist — ✅ COMPLETE

> All steps complete. v1.0.0 tagged. Prod deployed to Dell.

### Code

- [x] Step 1 — Project bootstrap (FastAPI + Vite + Docker + CI)
- [x] Step 2–3 — Full DB schema + Alembic migrations + seed data
- [x] Step 4–7 — All backend routes (profiles, brokers, trades, strategies, goals, stats, market analysis)
- [x] Step 9 — Settings/Profiles page + ProfilePicker
- [x] Step 10 — Trade form (risk calc, multi-TP, LIMIT lifecycle, expectancy, margin/leverage)
- [x] Step 11 — Goals page (real backend: create, toggle, live progress, KPIs)
- [x] Step 12 — Dashboard fully connected (Goals widget, MA badge, Open Positions, Performance)
- [x] Step 12.1 — Market Analysis global sessions + PATCH indicator endpoint
- [x] Step 13-A — DB Migrations (Goals v2: avg_r_min, period_type, global goals, override log)
- [x] Step 13-B — Backend Goals v2 (global goals, avg_r, circuit breaker, overrides)
- [x] Step 13-C — Backend MA v2 seed + schema (score_block, decomposed columns)
- [x] Step 13-D — GoalsSettingsPage + DashboardPage global goals
- [x] Step 13-E — Goals UX: signed amounts, Avg R badge, loss limit always shown
- [x] Step 13-F — MA widget: circular TFBadge (HTF/MTF/LTF), LTF shown, BadgeRow extracted
- [x] Step 13-G — Strategies global (profile_id nullable), trade 1,N m2m, TradeStrategy ORM
- [x] Step 13-H — Themes (8), SnapshotGallery, close_notes, db_recover.py, Makefile targets
- [x] Step 13-I — QA full pass: 119/119 pytest · 8/8 vitest · 0 ruff · 0 mypy · 0 eslint · 0 tsc

### Deployment (Step 14)

- [x] Dell Ubuntu server provisioned (setup-server.sh)
- [x] CI pipeline green (atd-test.yml)
- [x] CD pipeline: version bump → GHCR build → Tailscale SSH deploy (atd-deploy.yml)
- [x] docker-compose.prod.yml running on Dell
- [x] Prod DB seeded (brokers, instruments, sessions, styles, MA modules/indicators)
- [x] Alembic migrations applied on prod
- [x] mDNS/Bonjour: http://alphatradingdesk.local resolves on LAN
- [x] Cron backups: rolling (every 6h) + weekly (Sunday 03:00) via backup-db.sh
- [x] Healthcheck script: healthcheck.sh (containers, API, disk, RAM, backup, alembic)
- [x] DB sync: sync-db-prod-to-dev.sh (prod → dev, secrets scrubbed)
- [x] rsync backup retrieval: Dell → Mac (passwordless via SSH config)

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

**Next:** → Phase 2 (Volatility Analysis — VI scores)

