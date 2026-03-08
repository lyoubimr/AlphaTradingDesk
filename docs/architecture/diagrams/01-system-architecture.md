# 🏗️ System Architecture — AlphaTradingDesk

**Version:** 1.1 — Phase 1  
**Date:** March 1, 2026

---

## Docker Services Overview

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph LAN["`**LAN** — alphatradingdesk.local`"]
        subgraph FE["`Frontend Layer`"]
            caddy["`**Caddy** :80
            reverse proxy`"]
            react["`**React** + Nginx
            static SPA`"]
        end
        subgraph BE["`Backend Layer`"]
            api["`**FastAPI** / Gunicorn
            :8000`"]
            news["`/api/news-brief
            news proxy`"]
        end
        subgraph DATA["`Data Layer`"]
            pg[("PostgreSQL :5432")]
            redis[("Redis :6379")]
        end
        browser["`Browser / Mobile`"]
    end

    browser -->|HTTP| caddy
    caddy -->|"/* SPA"| react
    caddy -->|"/api/*"| api
    api --> news
    api --> pg
    api --> redis
    news --> pg
```

---

## Dev vs Prod vs Future

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph DEV["`**DEV** — localhost`"]
        direction TB
        vite["`Vite dev server :5173
        hot reload`"]
        uvicorn["`uvicorn --reload
        :8000`"]
        pg_dev[("PostgreSQL :5432")]
        redis_dev[("Redis :6379")]
        adminer["`Adminer :8080
        DB GUI`"]
        vite --> uvicorn
        uvicorn --> pg_dev
        uvicorn --> redis_dev
    end

    subgraph PROD["`**PROD** — alphatradingdesk.local`"]
        direction TB
        caddy_p["`Caddy :80
        reverse proxy`"]
        nginx_p["`React static
        nginx`"]
        gunicorn_p["`gunicorn + UvicornWorker
        :8000`"]
        pg_p[("PostgreSQL :5432")]
        redis_p[("Redis :6379")]
        caddy_p -->|"/* SPA"| nginx_p
        caddy_p -->|"/api/*"| gunicorn_p
        gunicorn_p --> pg_p
        gunicorn_p --> redis_p
    end

    subgraph FUTURE["`**FUTURE** — GCE europe-west9`"]
        direction TB
        note["`Same compose stack
        Change domain + add TLS
        Zero code changes`"]
    end

    DEV -.->|same codebase| PROD
    PROD -.->|lift & shift| FUTURE
```

---

## LAN Domain Resolution — mDNS / Bonjour

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    mac["`**Mac** — alphatradingdesk
    Docker running`"]
    router["`WiFi Router`"]
    iphone["`iPhone`"]
    laptop["`Laptop`"]
    ipad["`iPad`"]

    mac -->|"broadcasts alphatradingdesk.local via mDNS/Bonjour"| router
    router --> iphone
    router --> laptop
    router --> ipad
    iphone -->|"http://alphatradingdesk.local"| mac
    laptop -->|"http://alphatradingdesk.local"| mac
    ipad -->|"http://alphatradingdesk.local"| mac
```
