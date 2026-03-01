# 📈 Phases & Infrastructure Evolution

**Date:** March 1, 2026  
**Version:** 1.1 (Phase 1 updated: News Intelligence, LAN deployment)

This document describes how the infrastructure and dependencies evolve through each phase.

---

## 📐 Related Diagrams

| Diagram | File |
|---------|------|
| System Architecture (Docker services, dev/prod/future, LAN domain) | [`../diagrams/01-system-architecture.md`](../diagrams/01-system-architecture.md) |
| Feature Data Flow (market analysis, news, trade lifecycle, goals) | [`../diagrams/02-feature-data-flow.md`](../diagrams/02-feature-data-flow.md) |
| Database Schema (all Phase 1 tables, relationships) | [`../diagrams/03-database-schema.md`](../diagrams/03-database-schema.md) |

---

## 🎯 Core Principle

**Each phase builds on the previous one without breaking anything.**

- Phase 1 code continues to work unchanged
- Phase 2 adds new services/tables/tasks
- Phase 3 scales existing services
- Phase 4 adds automation layer

---

## 🟦 PHASE 1: Risk Management & Journal

### ✅ What's Included

```
User Flows:
├─ Create trading profile
├─ Log trades manually
├─ Multi-TP position management
├─ Close positions & calculate P&L
└─ Dashboard & analytics

Features:
├─ Profile management
├─ Trade journal with notes/tags
├─ Performance snapshots (daily)
├─ Risk calculator (fixed %)
└─ UI: Dashboard, Trades, Settings
```

### 📊 Database

**Tables Created:**
```
profiles
├─ id, name, market_type (CFD/Crypto), capital_start, capital_current
├─ risk_percentage_default, notes
└─ created_at, updated_at

trades
├─ id, profile_id, pair, direction, entry_price, stop_loss
├─ status (open/partial/closed), nb_take_profits
├─ risk_amount, potential_profit, realized_pnl
├─ notes, screenshots
└─ created_at, closed_at

positions
├─ id, trade_id, position_number (1/2/3)
├─ take_profit_price, lot_percentage
├─ status, exit_price, realized_pnl, exit_date
└─ created_at

strategies
├─ id, profile_id, name, description
└─ created_at

tags
├─ id, profile_id, name
└─ created_at

trade_tags
├─ id, trade_id, tag_id

performance_snapshots
├─ id, profile_id, snapshot_date
├─ capital_start, capital_current, pnl_absolute, pnl_percent
├─ win_count, loss_count, profit_factor, equity_curve
└─ created_at
```

**Indexes:**
```sql
CREATE INDEX idx_trades_profile_created ON trades(profile_id, created_at);
CREATE INDEX idx_positions_trade ON positions(trade_id);
CREATE INDEX idx_performance_profile_date ON performance_snapshots(profile_id, snapshot_date);
```

### 🐳 Docker Compose (Phase 1 - Dev — Steps 1–13, Mac local)

```yaml
# Steps 1–13: everything runs locally on Mac
# db service included — no Dell needed yet
# After Step 14.0 migration: db service removed, Mac points to Dell
version: '3.9'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: atd_dev
      POSTGRES_USER: atd
      POSTGRES_PASSWORD: dev_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build:
      context: .
      dockerfile: Dockerfile.backend
    command: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://atd:dev_password@db:5432/atd_dev
    depends_on:
      - db
    volumes:
      - ./src:/app/src

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    command: npm run dev
    ports:
      - "5173:5173"
    depends_on:
      - backend
    volumes:
      - ./frontend/src:/app/src

  adminer:
    image: adminer
    ports:
      - "8080:8080"
    depends_on:
      - db

volumes:
  postgres_data:
```

> **After Step 14.0 (migration to Dell):** the `db` and `adminer` services are removed from  
> `docker-compose.dev.yml`. `.env.dev` is updated to point to `192.168.1.50:5432/atd_dev`.  
> Mac no longer runs a local Postgres — Dell hosts both `atd_dev` and `atd_prod`.

### 🐳 Docker Compose (Phase 1 - Prod)

```yaml
# Phase 1 only: postgres + backend + frontend + caddy
# Images pulled from GHCR — never built on the Dell
# Redis / Celery → Phase 2+
version: '3.9'
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: atd_prod
      POSTGRES_USER: atd
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - /srv/atd/data/postgres:/var/lib/postgresql/data

  backend:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: gunicorn src.main:app -w 4 -k uvicorn.workers.UvicornWorker
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod

  frontend:
    image: ghcr.io/<org>/atd-frontend:${IMAGE_TAG:-latest}

  caddy:
    image: caddy:latest
    ports:
      - "80:80"

  # Note: No Redis, no Celery in Phase 1
```

### 📦 Dependencies (Phase 1)

```
Backend:
├─ fastapi, uvicorn, gunicorn
├─ sqlalchemy, psycopg[binary]
├─ redis, pydantic
├─ httpx                    ← async HTTP client for News Intelligence API calls
├─ cryptography             ← AES-256 for encrypted API key storage
├─ pytest, httpx (for testing)
└─ python-dotenv

Frontend:
├─ react, vite
├─ react-router-dom, zustand
├─ axios, recharts
├─ tailwindcss
└─ @testing-library/react (for testing)
```

### 🚀 Deployment (Phase 1)

```
DEV (Steps 1–13 — Mac local):
         http://localhost
         docker-compose.dev.yml  (db + backend + frontend + adminer, all on Mac)
         Vite dev server + uvicorn --reload
         No Caddy, no Celery, no Dell

DEV (after Step 14.0 — Mac → Dell migration):
         http://localhost  (backend + frontend still on Mac)
         docker-compose.dev.yml  (db service removed)
         .env.dev → DATABASE_URL points to Dell 192.168.1.50:5432/atd_dev

PROD:  http://alphatradingdesk.local  ← LAN, Dell OptiPlex Micro (D09U)
         docker-compose.prod.yml
         React static build + gunicorn + Caddy reverse proxy
         Ethernet cable → router (DHCP reservation → fixed IP 192.168.1.50)
         Static IP also set via netplan on Ubuntu Server 22.04 LTS
         mDNS via avahi-daemon:
           /etc/hostname: alphatradingdesk
           → resolves on Mac/iPhone/iPad automatically, zero router config

Future: GCE europe-west9 (not yet)
        Same compose stack, change domain, add TLS to Caddyfile
```

> **Full server setup procedure** (Ubuntu install, IP fixe, Docker, deploy, CI/CD):
> → [`phases/phase1/SERVER_SETUP.md`](../../../deployment/phases/phase1/SERVER_SETUP.md)

CI/CD (Phase 1):
```
GitHub Actions (cloud runner — ubuntu-latest):
  CI:  on every PR / push to develop
       └─ ruff + mypy + pytest  (backend)
       └─ eslint + type-check + vitest  (frontend)

  CD:  on merge to main (dormant until Step 14)
       ├─ docker build → push ghcr.io/<org>/atd-backend:vX.Y.Z
       │                       ghcr.io/<org>/atd-frontend:vX.Y.Z
       ├─ Create GitHub Release + changelog
       └─ SSH into Dell → deploy.sh vX.Y.Z
              └─ docker pull ghcr.io/…/atd-*:vX.Y.Z
              └─ docker compose up (no --build — Dell never builds)
              └─ alembic upgrade head
```

---

## 🟩 PHASE 2: Volatility Analysis

### ➕ What's Added

```
New Features:
├─ Volatility Index (VI) calculation (5 components)
├─ Multi-timeframe support (15m, 1h, 4h, 1d, 1w)
├─ Real-time VI scores (WebSocket)
├─ Volatility dashboard
├─ Risk adjustment based on market VI
└─ Market data fetching (Kraken, Binance)

New Scheduled Tasks:
└─ Calculate volatility (every 15 min via Celery Beat)
```

### 📊 Database Changes

**New Tables:**
```
market_volatility_snapshots (TimescaleDB hypertable)
├─ id, pair, timeframe (15m/1h/4h/1d/1w)
├─ vi_score, volume_component, obv_component, atr_component, price_component, ema_component
├─ btc_dominance, market_regime
├─ timestamp
└─ created_at

ohlcv_data (TimescaleDB hypertable)
├─ id, pair, timeframe
├─ open, high, low, close, volume
├─ timestamp
└─ created_at
```

**Modified Tables:**
```
trades:
├─ + market_vi_at_entry (volatility at trade entry)
└─ + pair_vi_at_entry

positions:
├─ + vi_adjusted_risk_amount
└─ (unchanged structure)
```

**Indexes:**
```sql
-- TimescaleDB handles time-series indexes automatically
CREATE INDEX idx_vi_snapshots_pair_timestamp 
  ON market_volatility_snapshots(pair, timestamp DESC);

CREATE INDEX idx_ohlcv_pair_timeframe_timestamp 
  ON ohlcv_data(pair, timeframe, timestamp DESC);
```

### 🐳 Docker Compose (Phase 2 - Prod)

```yaml
version: '3.9'
services:
  postgres:
    image: timescaledb/timescaledb-docker-ha:pg15-latest
    # ↑ Changed: Now uses TimescaleDB
    environment:
      POSTGRES_DB: atd_prod
      POSTGRES_USER: atd
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - /srv/atd/data/postgres:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD}

  backend:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: gunicorn src.main:app -w 4 -k uvicorn.workers.UvicornWorker
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - KRAKEN_API_KEY=${KRAKEN_API_KEY}
      - KRAKEN_API_SECRET=${KRAKEN_API_SECRET}

  celery_worker:
    # ↑ NEW: Background tasks for VI calculation
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: celery -A src.celery_app worker --loglevel=info
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - KRAKEN_API_KEY=${KRAKEN_API_KEY}

  celery_beat:
    # ↑ NEW: Scheduling daemon for periodic tasks
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: celery -A src.celery_app beat --loglevel=info
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

  frontend:
    image: ghcr.io/<org>/atd-frontend:${IMAGE_TAG:-latest}
    ports:
      - "80:80"
```

### 📦 Dependencies Added

```
Backend (new):
├─ celery[redis], celery-beat
├─ requests (Kraken/Binance API calls)
├─ numpy, pandas (calculations)
└─ django-celery-beat (scheduler UI - optional)

Frontend (new):
├─ recharts or chart.js (for VI charts)
└─ ws (WebSocket client)
```

### 🔌 External APIs Integrated

```
Kraken API:
├─ GET /0/public/Ticker → OHLCV data
└─ Rate limit: 15 req/sec

Binance API:
├─ GET /api/v3/klines → OHLCV data
└─ Rate limit: 1200 req/min
```

### 🚀 New Scheduled Tasks (Celery Beat)

```python
# celery_beat_schedule
{
    'calculate-volatility': {
        'task': 'src.tasks.volatility.calculate_all_pairs',
        'schedule': crontab(minute='*/15'),  # Every 15 min
        'kwargs': {'timeframes': ['15m', '1h', '4h', '1d', '1w']}
    },
}
```

---

## 🟨 PHASE 3: Watchlist Generation

### ➕ What's Added

```
New Features:
├─ Watchlist generation (4 styles: scalping, intraday, swing, position)
├─ Pair ranking by VI + liquidity + EMA
├─ Tiered classification (S, A, B, C)
├─ Export formats (JSON, TXT, CSV)
└─ Multiple generation schedules (weekly, daily, 4h, hourly)

New Scheduled Tasks:
├─ generate_watchlists_weekly (Mon 01:02 UTC)
├─ generate_watchlists_daily (00:05 UTC)
├─ generate_watchlists_4h (every 4 hours)
└─ generate_watchlists_hourly (every hour at :05)
```

### 📊 Database Changes

**New Tables:**
```
watchlist_snapshots
├─ id, style (scalping/intraday/swing/position)
├─ generation_timestamp, snapshot_date
├─ snapshot_data (JSON: array of {pair, vi, tier, rank})
└─ created_at

watchlist_pairs
├─ id, snapshot_id, pair, tier (S/A/B/C), rank
├─ vi_score, volume_24h, ema_signal
└─ created_at
```

**Modified Tables:**
```
(No changes to existing tables - only new tables)
```

### 🐳 Docker Compose (Phase 3 - Prod)

```yaml
version: '3.9'
services:
  # ... PostgreSQL (TimescaleDB), Redis (same as Phase 2)

  backend:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    # ... (same)
    depends_on:
      - postgres
      - redis
      - celery_worker
      - celery_beat

  celery_worker:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: celery -A src.celery_app worker -c 4 --loglevel=info
    # ↑ Now with concurrency (c=4) for Phase 3+ scaling
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

  celery_beat:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    # ... (same)

  frontend:
    image: ghcr.io/<org>/atd-frontend:${IMAGE_TAG:-latest}
    # ... (same)

  # ↓ OPTIONAL: Add reverse proxy + HTTPS (Caddy)
  caddy:
    image: caddy:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      - backend
      - frontend
```

### 📦 Dependencies Added

```
Backend (new):
├─ aiofiles (async file operations for exports)
└─ openpyxl (optional: Excel export)

Frontend (new):
├─ papaparse (CSV export)
└─ clsx (conditional CSS classes)
```

### 🚀 New Scheduled Tasks

```python
{
    'generate-watchlists-weekly': {
        'task': 'src.tasks.watchlist.generate_all_styles',
        'schedule': crontab(day_of_week=0, hour=1, minute=2),
        'kwargs': {'timeframe_focus': '1w'}
    },
    'generate-watchlists-daily': {
        'task': 'src.tasks.watchlist.generate_all_styles',
        'schedule': crontab(hour=0, minute=5),
        'kwargs': {'timeframe_focus': '1d'}
    },
    'generate-watchlists-4h': {
        'task': 'src.tasks.watchlist.generate_all_styles',
        'schedule': crontab(hour='*/4'),
        'kwargs': {'timeframe_focus': '4h'}
    },
    'generate-watchlists-hourly': {
        'task': 'src.tasks.watchlist.generate_all_styles',
        'schedule': crontab(minute=5),
        'kwargs': {'timeframe_focus': '1h'}
    },
}
```

---

## 🟪 PHASE 4: Auto-Trading & Automation

### ➕ What's Added

```
New Features:
├─ Signal detection (VI + EMA + risk conditions)
├─ Automatic position opening (Kraken API)
├─ Position management (adjust stops, close TPs)
├─ Capital sync from Kraken (every 5 min)
├─ Risk-based position sizing
├─ Trade notifications (WebSocket + Telegram)
└─ Order monitoring & fill tracking

New Scheduled Tasks:
├─ sync_kraken_balance (every 5 min)
├─ check_trading_signals (every 15 min)
├─ manage_open_positions (every 5 min)
└─ send_notifications (real-time)
```

### 📊 Database Changes

**New Tables:**
```
kraken_orders
├─ id, trade_id (FK), profile_id (FK)
├─ kraken_order_id, pair, direction, amount
├─ entry_price, stop_loss, take_profits (JSON)
├─ status (pending/open/closed/failed)
├─ fill_price, slippage, commission
├─ created_at, executed_at, closed_at

automation_settings
├─ id, profile_id (FK)
├─ enabled, market_vi_threshold, max_positions
├─ risk_per_trade, portfolio_risk_cap
├─ pair_whitelist (JSON array)
├─ strategies_enabled (JSON: {vi_ema: true, ...})
├─ kraken_api_key_encrypted, kraken_api_secret_encrypted
└─ updated_at

capital_sync_history
├─ id, profile_id (FK), timestamp
├─ kraken_balance, expected_balance, difference
└─ created_at
```

**Modified Tables:**
```
trades:
├─ + auto_generated (boolean: true if auto-traded)
├─ + signal_score (VI + EMA confidence)
└─ + slippage, commission

profiles:
├─ + auto_trading_enabled
├─ + last_capital_sync_at
└─ + kraken_last_balance_synced
```

### 🐳 Docker Compose (Phase 4 - Prod)

```yaml
version: '3.9'
services:
  postgres:
    image: timescaledb/timescaledb-docker-ha:pg15-latest
    # ... (same as Phase 2+)

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --maxmemory 1gb --maxmemory-policy allkeys-lru
    # ↑ Added memory management for Phase 4+ scaling

  backend:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: gunicorn src.main:app -w 4 -k uvicorn.workers.UvicornWorker
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - KRAKEN_API_KEY=${KRAKEN_API_KEY}
      - KRAKEN_API_SECRET=${KRAKEN_API_SECRET}
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}

  celery_worker:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: celery -A src.celery_app worker -c 8 --loglevel=info
    # ↑ Increased concurrency for more parallel tasks
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - KRAKEN_API_KEY=${KRAKEN_API_KEY}
      - KRAKEN_API_SECRET=${KRAKEN_API_SECRET}

  celery_beat:
    image: ghcr.io/<org>/atd-backend:${IMAGE_TAG:-latest}
    command: celery -A src.celery_app beat --loglevel=info
    environment:
      - DATABASE_URL=postgresql://atd:${DB_PASSWORD}@postgres:5432/atd_prod
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379/0

  celery_flower:
    # ↑ NEW: Optional monitoring dashboard for Celery
    image: mher/flower:2.0
    command: celery -A src.celery_app flower --port=5555
    ports:
      - "5555:5555"
    environment:
      - CELERY_BROKER_URL=redis://:${REDIS_PASSWORD}@redis:6379/0
      - CELERY_RESULT_BACKEND=redis://:${REDIS_PASSWORD}@redis:6379/0
    depends_on:
      - celery_worker

  frontend:
    image: ghcr.io/<org>/atd-frontend:${IMAGE_TAG:-latest}
    # ... (same)

  caddy:
    image: caddy:latest
    # ... (same as Phase 3)
    depends_on:
      - backend
      - frontend
      - celery_flower
```

### 📦 Dependencies Added

```
Backend (new):
├─ krakenex (Kraken API client)
├─ python-telegram-bot (Telegram notifications)
├─ cryptography (API key encryption)
└─ flower (optional: Celery monitoring)

Frontend (new):
├─ react-hook-form (automation settings form)
└─ date-fns (time formatting)
```

### 🚀 New Scheduled Tasks

```python
{
    'sync-kraken-balance': {
        'task': 'src.tasks.automation.sync_kraken_balance',
        'schedule': crontab(minute='*/5'),  # Every 5 min
    },
    'check-trading-signals': {
        'task': 'src.tasks.automation.check_trading_signals',
        'schedule': crontab(minute='*/15'),  # Every 15 min
    },
    'manage-open-positions': {
        'task': 'src.tasks.automation.manage_open_positions',
        'schedule': crontab(minute='*/5'),  # Every 5 min
    },
}
```

---

## 📊 Summary Table

| Aspect | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|--------|---------|---------|---------|---------|
| **DB** | PostgreSQL | + TimescaleDB | ↑ Same | ↑ Same |
| **Cache** | ❌ None | ✅ Redis | ↑ Same | ↑ Same |
| **Task Queue** | ❌ None | ✅ Celery + Beat | ↑ Scaled | ↑ Scaled |
| **External APIs** | ❌ None | ✅ Kraken/Binance (read) | ↑ Same | + Kraken (write) |
| **Docker Services** | 4 | 6 | 6-7 | 8-9 |
| **Frontend Pages** | 4 | +1 | +1 | +1 |
| **Backend Routes** | ~15 | +10 | +5 | +20 |

---

## 🔄 Migration Path

When moving from one phase to the next:

1. **Create new DB tables** (no schema changes to existing)
2. **Update dependencies** (via Poetry)
3. **Update Docker Compose** (add new services)
4. **Deploy** (no code changes to Phase 1 features)
5. **Test** (new features in parallel)

**Example: Phase 1 → Phase 2**
```bash
# 1. Create DB migrations for TimescaleDB setup
alembic revision --autogenerate -m "Add volatility tables"

# 2. Update pyproject.toml (add celery, numpy, etc)
poetry add celery redis numpy

# 3. Update docker-compose.yml
# Change postgres:15 → timescaledb/timescaledb-docker-ha:pg15
# Add celery_worker and celery_beat services

# 4. Deploy
docker-compose up -d

# 5. Run migrations
docker exec alphatrading-backend alembic upgrade head

# ✅ Phase 1 features continue working unchanged!
```

---

**Next Document:** → `DOCKER_SETUP.md` (detailed Docker Compose configurations)
