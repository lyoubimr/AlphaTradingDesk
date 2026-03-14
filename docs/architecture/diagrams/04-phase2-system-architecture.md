# 🏗️ Phase 2 — System Architecture

**Version:** 1.0
**Date:** 14 mars 2026
**Phase:** 2 — Volatility Engine

---

## Services Overview (Phase 2)

Phase 2 ajoute 3 nouveaux services au stack existant :
- **Redis** — broker Celery + cache scores live
- **Celery Worker** — exécute les tâches de calcul VI
- **Celery Beat** — planificateur (déclencheur cron)

TimescaleDB est activé comme **extension** du PostgreSQL existant (pas un nouveau conteneur).

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph EXTERNAL["`**External APIs** (public, no auth)`"]
        binance["`**Binance Futures**
        fapi.binance.com
        Market VI data`"]
        kraken["`**Kraken Futures**
        futures.kraken.com
        Per-Pair VI data`"]
    end

    subgraph DOCKER["`**Docker Compose** — alphatradingdesk.local`"]
        subgraph FRONTEND["`Frontend Layer`"]
            caddy["`**Caddy** :80
            reverse proxy`"]
            react["`**React** + Nginx
            static SPA`"]
        end

        subgraph BACKEND["`Backend Layer`"]
            api["`**FastAPI** / Gunicorn
            :8000`"]
        end

        subgraph WORKERS["`Worker Layer (Phase 2)`"]
            worker["`**Celery Worker**
            compute_market_vi
            compute_pair_vi
            sync_instruments
            cleanup_snapshots`"]
            beat["`**Celery Beat**
            scheduler cron
            triggers every 15m/1h/4h/1d/1W`"]
        end

        subgraph DATA["`Data Layer`"]
            pg[("**TimescaleDB** :5432
            PostgreSQL + hypertables
            Phase 1 tables +
            volatility_snapshots
            market_vi_snapshots
            watchlist_snapshots
            volatility_settings
            notification_settings")]
            redis[("**Redis** :6379
            Celery broker
            + result backend
            + live score cache")]
        end

        adminer["`**Adminer** :8080
        DB GUI`"]
    end

    browser["`Browser / iPhone`"]

    browser -->|HTTP| caddy
    caddy -->|"/* SPA"| react
    caddy -->|"/api/*"| api
    api --> pg
    api --> redis
    beat -->|enqueue tasks| redis
    redis -->|dequeue| worker
    worker -->|fetch OHLCV + tickers| binance
    worker -->|fetch OHLCV + orderbook| kraken
    worker -->|write snapshots| pg
    adminer --> pg
```

---

## Dev vs Prod (Phase 2)

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph DEV["`**DEV** — localhost (Mac)`"]
        direction TB
        vite["`Vite :5173 HMR`"]
        uvi["`uvicorn --reload :8000`"]
        w_dev["`celery worker (local)`"]
        b_dev["`celery beat (local)`"]
        pg_dev[("TimescaleDB :5432")]
        red_dev[("Redis :6379")]
        uvi --> pg_dev
        uvi --> red_dev
        b_dev --> red_dev
        red_dev --> w_dev
    end

    subgraph PROD["`**PROD** — alphatradingdesk.local (Dell)`"]
        direction TB
        caddy_p["`Caddy :80`"]
        gunicorn_p["`gunicorn :8000`"]
        w_p["`celery worker (container)`"]
        b_p["`celery beat (container)`"]
        pg_p[("TimescaleDB :5432")]
        red_p[("Redis :6379")]
        caddy_p --> gunicorn_p
        gunicorn_p --> pg_p
        gunicorn_p --> red_p
        b_p --> red_p
        red_p --> w_p
    end

    DEV -.->|même codebase, même config env| PROD
```

---

## Flux Beat → Worker → DB

```mermaid
%%{init: {"sequenceDiagram": {"mirrorActors": false}} }%%
sequenceDiagram
    participant Beat as Celery Beat
    participant Redis
    participant Worker as Celery Worker
    participant API_EXT as API externe (Binance/Kraken)
    participant DB as TimescaleDB

    Beat->>Redis: enqueue task(timeframe="15m") [crontab */15]
    Redis->>Worker: dequeue
    Worker->>DB: SELECT volatility_settings WHERE profile_id=...
    alt Hors fenêtre horaire
        Worker-->>Redis: result {"status": "skipped"}
    else Dans la fenêtre
        Worker->>API_EXT: fetch_ohlcv(symbols, tf="15m")
        API_EXT-->>Worker: OHLCV data
        Worker->>Worker: compute RVOL + MFI + ATR + BB + EMA Score
        Worker->>DB: INSERT INTO volatility_snapshots (pair, tf, vi_score, components)
        Worker->>Redis: cache SET "vi:current:market" score TTL=900s
        Worker-->>Redis: result {"status": "ok", "pairs": 50}
    end
```
</content>
</invoke>