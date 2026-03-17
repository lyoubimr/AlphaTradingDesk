# Post-Mortem — Phase 2 Production Deploy Incident
**Date:** 2026-03-15
**Severity:** P1 — Full production outage (backend restart loop, all API requests failing)
**Duration:** ~45 minutes
**Version affected:** v2.0.0 → v2.0.2 (first Phase 2 prod deploy)
**Resolved in:** v2.0.3

---

## Timeline

| Time (UTC+1) | Event |
|---|---|
| 21:10 | PR `develop → main` merged — CD triggered |
| 21:15 | Build succeeded, deploy job SSHed into Dell |
| 21:22 | Migration failed: `extension "timescaledb" is not available` |
| 21:24 | Fix pushed: TimescaleDB extension wrapped in `DO $$ IF EXISTS` block |
| 21:35 | Second migration attempt: `UniqueViolation` on `volatility_snapshots_id_seq` |
| 21:38 | Fix pushed: all BIGSERIAL `CREATE TABLE` wrapped in `DO $$` with orphan sequence cleanup |
| 21:50 | Migration succeeded. Backend started but showed Redis error in Health UI |
| 22:05 | Root cause identified: `REDIS_URL` missing from `~/apps/.env` — default was `localhost` |
| 22:10 | `REDIS_URL=redis://redis:6379/0` added to `~/apps/.env` on Dell |
| 22:20 | Celery services added to `docker-compose.prod.yml` — were missing entirely |
| 22:30 | All 6 containers up. Backend enters restart loop: `Can't locate revision p2001_phase2_volatility` |
| 22:35 | Root cause: backend running old `:latest` image (pre-Phase 2) — `deploy.sh` used `--no-build` against stale image |
| 22:40 | Deeper root cause found: `POSTGRES_PASSWORD` not interpolated in `DATABASE_URL` — `deploy.sh` never sourced `/srv/atd/.env.db` |
| 22:55 | Fix committed: `deploy.sh` now sources `/srv/atd/.env.db`; `config.py` default `redis://localhost` → `redis://redis` |
| 23:10 | v2.0.3 deployed via CD — all services healthy |

---

## Root Causes

### RC-1 — `docker-compose.prod.yml` not updated for Phase 2
The prod compose file lives only on the Dell (not in the repo). Phase 2 required 3 new services: `redis`, `celery-worker`, `celery-beat`. These were in `docker-compose.dev.yml` but nobody updated the prod file before merging to main.

**Impact:** Redis and Celery never started on first deploy.

---

### RC-2 — `scripts/prod/deploy.sh` not updated for Phase 2
`deploy.sh` hard-coded only `backend` and `frontend` in the rolling restart command. New services added to the compose file were never started by the CD pipeline.

**Impact:** Even after manually updating `docker-compose.prod.yml`, the CD would have left Redis/Celery down on the next deploy.

---

### RC-3 — `POSTGRES_PASSWORD` not available to `docker compose` during deploy
`deploy.sh` calls `docker compose -f docker-compose.prod.yml up` which interpolates `${POSTGRES_PASSWORD}` in `DATABASE_URL`. But the password lives in `/srv/atd/.env.db` (secure, not sourced by the deploy script). Result: `DATABASE_URL=postgresql://atd:@db:5432/atd_prod` (empty password) → Postgres auth failure → backend restart loop.

**Impact:** Backend could not authenticate to PostgreSQL after a CD redeploy.

---

### RC-4 — `redis_url` default hardcoded to `localhost`
In `src/core/config.py`, the `REDIS_URL` Field default was `redis://localhost:6379/0`. This works only on bare-metal / dev. Inside Docker Compose, the Redis service is named `redis`. Without `REDIS_URL` in the env, the backend connected to `localhost:6379` which doesn't exist in the container.

**Impact:** Health UI showed Redis error; VI caching disabled; live prices API hitting external APIs on every call.

---

### RC-5 — TimescaleDB extension not available on plain `postgres:16-alpine`
The Phase 2 migration unconditionally ran `CREATE EXTENSION timescaledb CASCADE`. The prod DB uses `postgres:16-alpine` (not TimescaleDB image). The migration crashed on first run, leaving a partial state in the DB (sequences created, tables not).

**Impact:** Migration failed; backend could not start.

---

### RC-6 — BIGSERIAL orphaned sequences after partial migration rollback
After RC-5 caused a rollback, PostgreSQL had cleaned up the tables but left the BIGSERIAL sequences behind (known pg behavior). On retry, `CREATE TABLE IF NOT EXISTS` skipped table creation but tried to create the sequence again → `UniqueViolation`.

**Impact:** Migration failed on second run even after fixing RC-5.

---

## Fixes Applied

| # | Fix | Commit |
|---|-----|--------|
| RC-1 | Added `redis`, `celery-worker`, `celery-beat` to `docker-compose.prod.yml` on Dell | manual |
| RC-2 | Updated `deploy.sh` rolling restart to include all Phase 2 services | `ci(deploy): add redis + celery...` |
| RC-3 | `deploy.sh` now sources `/srv/atd/.env.db` with `set -a` before `docker compose` | `fix(config): fix redis default URL...` |
| RC-4 | `config.py` default changed `localhost` → `redis` | `fix(config): fix redis default URL...` |
| RC-5 | Migration wraps `CREATE EXTENSION` in `DO $$ IF EXISTS (pg_available_extensions)` | `db: make TimescaleDB extension...` |
| RC-6 | Migration wraps all `BIGSERIAL CREATE TABLE` in `DO $$` with `DROP SEQUENCE IF EXISTS` before create | `db: make all BIGSERIAL CREATE TABLE...` |

---

## What Worked Well

- Tailscale SSH access to Dell allowed rapid diagnosis and manual intervention
- `docker logs` immediately surfaced error messages
- Alembic `IF NOT EXISTS` guards on indexes prevented further failures
- CI (ruff, mypy, ESLint) caught code issues before reaching prod

---

## Action Items & Prevention

### Immediate (done in v2.0.3)
- [x] `deploy.sh` sources `/srv/atd/.env.db` for `POSTGRES_PASSWORD`
- [x] `redis_url` default corrected to `redis://redis:6379/0`
- [x] Phase 2 migration fully idempotent (TimescaleDB optional, BIGSERIAL sequences cleaned)
- [x] `docker-compose.prod.yml` on Dell updated with all Phase 2 services

### Process (added to copilot-instructions.md)
- [x] Checklist added: for any `feat!:` / major release that adds new Docker services, Copilot must remind to:
  1. Update `docker-compose.prod.yml` on Dell
  2. Update `deploy.sh` rolling restart service list
  3. Add new env vars to `~/apps/.env`
  4. Ensure secrets from `/srv/atd/.env.db` are sourced in `deploy.sh`

### Future improvements
- [ ] Consider committing a `docker-compose.prod.yml` template to the repo (with placeholder paths) so diffs are visible in PRs
- [ ] Add a pre-deploy smoke test step in CD: verify compose file declares all expected services before restart
- [ ] Watch issue: TF+1 (`tf_sup_vi`) regime not generated in watchlist snapshots — not a deploy issue, tracked separately

---

## Lessons Learned

1. **The prod compose file drift risk is real.** When it's not in the repo, it silently diverges from what dev expects. Consider a repo-tracked template.
2. **`deploy.sh` must always be updated together with new service additions.** Added as explicit rule in `copilot-instructions.md`.
3. **Secrets sourcing in CI/CD is subtle.** `docker compose` interpolation requires variables exported in the calling shell — not just present in some file somewhere.
4. **Always test migrations on a plain postgres image before deploying** — not just on TimescaleDB dev environment.

---

## Follow-up Fixes — 2026-03-17 (post-deploy polish)

### UI — Topbar sessions overflow (commit `07954b4`)

**Problem:** Session pills (`🇬🇧 EUR closes in 19m`) were too wide — 3 simultaneous sessions (EUR + NY + NYSE overlap) overflowed into the right side (prices, clock, bell).

**Fix:** Replaced pills with 10px pulsing colored dots. Hover/click shows tooltip with full label + closes-in time. Colors: Asia=#38bdf8, EUR=#a78bfa, NY=#fb923c, NYSE=#f87171, Overlap=#c084fc.

**Also fixed:**
- `Sidebar.tsx`: double-v version prefix (`vv2.0.4` → `v2.0.4`) — CI injects `v` prefix, sidebar was adding another
- `Topbar.tsx`: `flex-1` on left div prevents overlap with `shrink-0` right side

### Backend — Celery 30min interval gate never triggered (commit `07954b4`)

**Problem:** `execution_interval_minutes: 30` on 15m TF was set in DB but watchlists kept generating every 15min.

**Root cause:** Gate used `minute % 30 == 0` (exact match). Celery beat fires at :00/:30 but task executes at :03/:33 due to dispatch delay → `3 % 30 = 3 ≠ 0` → always skipped.

**Fix:** Window check: `minute % interval >= interval // 2` → tolerates up to 14min dispatch delay for a 30min interval.

### Backend — EMA convergence (commit `07954b4`)

- `_TF_EMA_REF["1d"]` : 200 → 100 (EMA200 needs 9yr of daily data to converge)
- `_TF_EMA_REF["1w"]` : 50 → 55 (Fibonacci, ~13 months weekly, converges in 220 bars)
- `_TF_CANDLE_LIMIT["4h"]` : 220 → 500 (EMA200 on 4h: 11% residual at 220 → 0.7% at 500)

