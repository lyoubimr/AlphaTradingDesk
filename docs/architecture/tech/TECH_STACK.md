# 💻 Tec## 📐 Related Diagrams

| Diagram | File |
|---------|------|
| System Architecture (Docker services, dev/prod/future, LAN domain) | [`../diagrams/01-system-architecture.md`](../diagrams/01-system-architecture.md) |
| Feature Data Flow (market analysis, news, trade lifecycle, goals) | [`../diagrams/02-feature-data-flow.md`](../diagrams/02-feature-data-flow.md) |
| Database Schema (all Phase 1 tables, relationships) | [`../diagrams/03-database-schema.md`](../diagrams/03-database-schema.md) |TradingDesk

**Date:** March 1, 2026  
**Version:** 1.1 (News Intelligence Integration, LAN deployment — alphatradingdesk.local)  
**Status:** Approved for Phase 1+

---

## � Related Diagrams

| Diagram | File |
|---------|------|
| System Arc**Workflow:**
```
Phase 1:
  CI  (on every PR / push to develop)
  └─ GitHub cloud runner: ruff + mypy + pytest + eslint + vitest

  CD  (on merge to main — dormant until Step 14)
  ├─ GitHub cloud runner: docker build → push ghcr.io/…/atd:vX.Y.Z
  └─ SSH into Dell: docker pull + docker compose up (no build on server)

Migration path (zero pipeline rework):
  Dell today → GCE tomorrow → Kube later
  Only the SSH target changes in GitHub Secrets.
```ocker services, dev/prod/future, LAN domain) | [`../diagrams/01-system-architecture.md`](../diagrams/01-system-architecture.md) |
| Feature Data Flow (market analysis, news, trade lifecycle, goals) | [`../diagrams/02-feature-data-flow.md`](../diagrams/02-feature-data-flow.md) |
| Database Schema (all Phase 1 tables, relationships) | [`../diagrams/03-database-schema.md`](../diagrams/03-database-schema.md) |

---

## �📦 Stack Overview

```
Frontend:        React 18 + Vite                    ← Phase 1
Backend:         FastAPI (Python 3.11+)              ← Phase 1
Database:        PostgreSQL 15+                      ← Phase 1
TimescaleDB:     (extension on PostgreSQL)           ← Phase 2+ (time-series hypertables)
Cache:           Redis 7+                            ← Phase 2+ (not needed in Phase 1)
Task Queue:      Celery 5+ + Redis                   ← Phase 2+ (no background tasks in Phase 1)
Scheduling:      Celery Beat                         ← Phase 2+ (no scheduled tasks in Phase 1)
Container:       Docker + Docker Compose             ← Phase 1
CI/CD:           GitHub Actions                      ← Phase 1 (CI + CD; CD dormant until Step 14)
Container Registry: GHCR (ghcr.io)                  ← Phase 1 (free, private, GitHub-native)
Monitoring:      Prometheus + Grafana                ← Phase 2+
```

---

## 🎯 Selection Rationale

### Frontend: React + Vite

**Why React?**
- ✅ Rich ecosystem (state management, UI components)
- ✅ WebSocket support for real-time updates
- ✅ Component reusability for trading UI (charts, forms, tables)
- ✅ Team familiarity (standard in trading platforms)

**Why Vite over Create React App?**
- ✅ 10x faster build times
- ✅ Instant HMR (Hot Module Replacement)
- ✅ Smaller bundle size
- ✅ Better for rapid iteration

**Key Libraries:**
```json
{
  "react": "^18.2.0",
  "vite": "^5.0.0",
  "react-router-dom": "^6.x",
  "zustand": "^4.x",              // State management
  "tanstack/react-query": "^5.x", // Server state
  "recharts": "^2.x",             // Charts for volatility/equity
  "axios": "^1.x",                // HTTP client
  "react-hot-toast": "^2.x",      // Notifications
  "tailwindcss": "^3.x"           // Styling
}
```

---

### Backend: FastAPI

**Why FastAPI?**
- ✅ Modern async/await (native async DB driver support)
- ✅ Automatic API documentation (Swagger)
- ✅ Type hints for safety and IDE support
- ✅ Fast performance (near Node.js speed)
- ✅ Easy WebSocket integration
- ✅ Large ecosystem (SQLAlchemy, Pydantic)

**Why Python?**
- ✅ Perfect for fintech/trading logic
- ✅ Easy NumPy/Pandas integration for volatility calculations
- ✅ Celery is Python-native (better integration than Node)
- ✅ Data science libraries available (Phase 2+)

**Key Libraries:**
```
fastapi==0.104.x
uvicorn==0.24.x              # ASGI server
sqlalchemy==2.0.x            # ORM
psycopg[binary]==3.1.x       # PostgreSQL driver
celery==5.3.x                # Task queue
redis==5.0.x                 # Cache + message broker
websockets==12.x             # WebSocket support
pydantic==2.x                # Data validation
python-dotenv==1.0.x         # Environment variables
pytest==7.x                  # Testing
httpx==0.25.x                # Async HTTP client
cryptography==42.x           # AES-256 encryption for API keys (News Intelligence)
```

---

### Database: PostgreSQL + TimescaleDB

> **Phase 1:** Plain **PostgreSQL 15+** only. TimescaleDB hypertables
> (`market_volatility_snapshots`, `ohlcv_data`) are **Phase 2+** additions.
> The extension can be installed from day one, but no hypertables are created yet.

**Why PostgreSQL?**
- ✅ ACID compliance (critical for financial data)
- ✅ JSON support (flexible configuration storage)
- ✅ Full-text search (future: trade journal search)
- ✅ Row-level security (future: multi-user setup)
- ✅ Mature, well-tested

**Why TimescaleDB?**
- ✅ Built on PostgreSQL (no lock-in)
- ✅ Optimized for time-series data (OHLCV, volatility snapshots)
- ✅ Automatic compression (keeps storage small)
- ✅ Fast aggregations (needed for analytics)

**Schema Principles:**
- Immutable historical data (no updates to OHLCV)
- Versioned configurations (audit trail)
- Soft deletes for trades (never lose data)
- Normalized design (3NF minimum)

**Key Tables (Phase 1):**
```
profiles              - User trading accounts
trades               - Trade entries with OHLC info
positions            - Multi-TP position tracking
strategies           - Strategy metadata
tags                 - Trade categorization
trade_tags           - Junction table
performance_snapshots - Daily P&L history
brokers              - Broker catalog (pre-seeded + custom)
instruments          - Instrument catalog per broker (~70 rows)
trading_styles       - scalping / day_trading / swing / position
profile_goals        - Goals + limits per profile × style × period
goal_progress_log    - Daily goal snapshots
note_templates       - Post-trade note question templates
sessions             - Trading session catalog (UTC times)
market_analysis_modules    - Crypto / Gold / Forex / Indices
market_analysis_indicators - Indicator catalog per module (HTF/MTF/LTF)
profile_indicator_config   - Per-profile ON/OFF per indicator
market_analysis_sessions   - Completed analysis sessions (3-TF scores + news context)
market_analysis_answers    - Per-indicator answers per session
news_provider_config       - Per-profile: provider, encrypted API key, prompt template
user_preferences     - Timezone, TF list, news intelligence toggle
```

**Future Tables (Phase 2+):**
```
market_volatility_snapshots  - VI scores per pair (TimescaleDB hypertable)
ohlcv_data                   - Market OHLC data (TimescaleDB hypertable)
watchlist_snapshots          - Watchlist generations (Phase 3)
kraken_orders                - Order tracking (Phase 4)
```

---

### Cache: Redis _(Phase 2+ — not used in Phase 1)_

> **Phase 1:** No Redis. The FastAPI app queries PostgreSQL directly. No caching layer needed at this scale.
> Redis is introduced in **Phase 2** alongside Celery for task queuing and VI-score caching.

**Why Redis?**
- ✅ Sub-millisecond access (critical for volatility UI)
- ✅ Message broker for Celery
- ✅ Session management
- ✅ Rate limiting
- ✅ Simple key-value interface

**Usage:**
```
cache:volatility:XV:15m      → Latest VI score
cache:ohlcv:BTC/USD:1h       → Latest OHLC bar
session:{user_id}            → User session
ratelimit:api:{user_id}      → Rate limit counter
```

---

### Task Queue: Celery + Redis _(Phase 2+ — not used in Phase 1)_

> **Phase 1:** No Celery, no background tasks, no scheduling.
> All trade operations are synchronous (user-triggered). Celery is introduced in
> **Phase 2** for volatility calculation and in **Phase 4** for automated trading.

**Why Celery?**
- ✅ Distributed task processing
- ✅ Native Python integration
- ✅ Scheduling (Celery Beat) for periodic tasks
- ✅ Retry logic and error handling
- ✅ Worker scaling for Phase 3+

**Why Redis as broker?**
- ✅ Simple setup (single dependency)
- ✅ Good for MVP/Phase 1 (can scale to RabbitMQ later)
- ✅ Doubles as cache layer

**Scheduled Tasks:**
```
Phase 2:
├─ calculate_volatility       (every 15 min)
└─ generate_watchlists        (multiple schedules)

Phase 3:
└─ refresh_watchlist_rankings (per-style schedule)

Phase 4:
├─ sync_kraken_balance        (every 5 min)
├─ check_trading_signals      (every 15 min)
├─ manage_open_positions      (every 5 min)
└─ send_notifications         (real-time)
```

---

### Containerization: Docker + Docker Compose

**Why Docker?**
- ✅ Consistent dev/prod environment
- ✅ Easy local testing
- ✅ Ready for Kubernetes scaling (Phase 3+)
- ✅ Isolated services (PostgreSQL, Redis, app)

**Docker Compose Strategy:**

**Phase 1 (dev):**
```yaml
services:
  postgres      # Database
  backend       # FastAPI app (uvicorn --reload)
  frontend      # React + Vite dev server
# redis, celery_worker → Phase 2+
```

**Phase 1 (prod — Dell server):**
```yaml
services:
  postgres      # Database
  backend       # Gunicorn + FastAPI
  frontend      # Nginx static
# redis, celery_worker → Phase 2+
```

**Phase 2+ (prod):**
```yaml
services:
  postgres          # Database
  redis             # Cache + Celery broker
  backend           # Uvicorn + FastAPI (scaled)
  celery_worker     # Background tasks (scaled)
  celery_beat       # Scheduling daemon
  frontend          # Nginx static
  caddy             # Reverse proxy + HTTPS
  prometheus        # Metrics (optional)
  grafana           # Dashboards (optional)
```

---

### CI/CD: GitHub Actions

**Why GitHub Actions?**
- ✅ Native GitHub integration
- ✅ Free for public repos
- ✅ YAML-based (easy to maintain)
- ✅ Matrix builds (test multiple Python versions)

**Workflow:**
```
Phase 1:
  CI  (on every PR / push to develop)
  └─ GitHub cloud runner: ruff + mypy + pytest (backend)
  └─ GitHub cloud runner: eslint + type-check + vitest (frontend)

  CD  (on merge to main — dormant until Step 14)
  ├─ GitHub cloud runner: docker build → push ghcr.io/…/atd-backend:vX.Y.Z
  │                                       push ghcr.io/…/atd-frontend:vX.Y.Z
  └─ SSH into Dell: docker pull + docker compose up (no --build on server)

Migration path (zero pipeline rework):
  Dell today → GCE tomorrow → Kube later
  Only the SSH target changes in GitHub Secrets.
```

---

## 🌐 Environments

```
DEV:   http://localhost
         → Vite dev server (:5173) + uvicorn --reload (:8000)
         → docker-compose.dev.yml
         → No Caddy, ports exposed directly
         → Runs on Mac (development machine)

PROD:  http://alphatradingdesk.local  (LAN, all devices on same WiFi/network)
         → React static build served by Caddy
         → gunicorn + UvicornWorker behind Caddy
         → docker-compose.prod.yml
         → Runs on Dell server (Ubuntu Server — always-on)
         → mDNS via Avahi (Ubuntu) — hostname "alphatradingdesk"

FUTURE CLOUD: GCE europe-west9, same compose stack, add TLS to Caddyfile
              Domain: alphatradingdesk.com — zero code changes needed
```

---

## 🔄 Version Management

**Python:** 3.11+ (async/await stability + match statements)

**Major dependencies pinned:**
```
fastapi>=0.104.0,<0.105.0    # Critical: API compatibility
sqlalchemy~=2.0               # Moderate: works with 2.x
celery~=5.3                   # Moderate: Celery 6.x changes significantly
redis~=5.0                    # Minor: Redis client is stable
```

**Minor versions auto-update:** Poetry allows patch updates only by default.

---

## 📊 Performance Considerations

### Backend
- Async endpoints for I/O-bound operations (DB queries, API calls)
- Connection pooling (SQLAlchemy defaults: 10 connections)
- Response caching for frequently accessed data (VI scores, watchlists)

### Database
- Indexes on: `(profile_id, created_at)`, `(pair, timestamp)`
- TimescaleDB compression for historical data
- Connection limit: 50-100 concurrent (via PgBouncer if needed in Phase 3+)

### Frontend
- Code splitting (per route)
- Lazy loading for charts
- WebSocket for real-time updates (not polling)

---

## 🔐 Security

### API Authentication
- JWT tokens (via FastAPI OAuth2)
- Refresh tokens with expiration (1 hour)
- HTTPS only (enforced in prod)

### Database
- No hardcoded credentials (environment variables)
- Encrypted API keys storage (in settings table)
- Row-level security (future: multi-user)

### Secrets Management
```
.env (dev):          ← Local only, NOT in git
.env.production      ← Docker secrets (prod)
GitHub Secrets       ← CI/CD variables
```

---

## 📈 Scalability Path

**Phase 1-2:**
- Single backend instance
- Single Redis instance
- PostgreSQL with connection pooling

**Phase 3+:**
- Multiple backend instances (load balanced)
- Redis cluster
- PostgreSQL read replicas
- Kubernetes orchestration

**No changes needed** to code for scaling! Just Docker Compose configuration.

---

## 🎓 Learning Resources

- **FastAPI:** https://fastapi.tiangolo.com/
- **SQLAlchemy:** https://docs.sqlalchemy.org/
- **Celery:** https://docs.celeryproject.io/
- **PostgreSQL:** https://www.postgresql.org/docs/
- **TimescaleDB:** https://docs.timescale.com/
- **React + Vite:** https://vitejs.dev/ + https://react.dev/

---

**Next Document:** → `PHASES_INFRASTRUCTURE.md` (how infra evolves)
