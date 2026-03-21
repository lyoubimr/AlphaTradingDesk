# 🪵 Phase 4B — Logging Architecture

**Version:** 1.0
**Date:** 21 mars 2026
**Phase:** 4B — DevOps Logging (structlog + Loki + Grafana)

---

## Overview

Phase 4B ajoute un stack d'observabilité complet dans un repo séparé (`AlphaTradingDesk-monitoring`).  
Tous les containers du main stack sont observés — backend, frontend, db, nginx, redis.

---

## Architecture générale

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart TD
    subgraph DELL["🖥️ Dell — Ubuntu Server"]
        subgraph MAIN["docker compose (apps)"]
            BE["atd-backend\n(FastAPI + structlog)"]
            FE["atd-frontend\n(nginx)"]
            DB["atd-db\n(PostgreSQL)"]
            REDIS["atd-redis"]
            NGINX["atd-nginx\n(reverse proxy)"]
        end

        subgraph MONITORING["docker compose (atd-monitoring)"]
            PROMTAIL["atd-promtail\nLog shipper"]
            LOKI["atd-loki\nLog storage"]
            GRAFANA["atd-grafana\nDashboards + Alerts"]
            PROXY["atd-grafana-proxy\nnginx TLS :3000"]
        end

        DOCKER_SOCK["/var/run/docker.sock"]
        DOCKER_LOGS["/var/lib/docker/containers/*/\n*-json.log"]
        CERTS["/srv/atd/certs/\natd.crt + atd.key"]
    end

    subgraph CLIENT["👤 Utilisateur (LAN / Tailscale)"]
        BROWSER["Browser\nhttps://alphatradingdesk:3000"]
    end

    %% Log flow
    BE -- "JSON logs\n(stdout)" --> DOCKER_LOGS
    FE -- "access logs\n(stdout)" --> DOCKER_LOGS
    DB -- "stdout" --> DOCKER_LOGS
    REDIS -- "stdout" --> DOCKER_LOGS
    NGINX -- "access logs\n(stdout)" --> DOCKER_LOGS

    DOCKER_SOCK -- "container discovery" --> PROMTAIL
    DOCKER_LOGS -- "tail log files" --> PROMTAIL
    PROMTAIL -- "push (HTTP)\nloki/api/v1/push" --> LOKI
    LOKI -- "query (LogQL)" --> GRAFANA
    GRAFANA -- "HTTP :3000" --> PROXY
    CERTS -- "ssl_certificate" --> PROXY
    PROXY -- "HTTPS :3000" --> BROWSER
```

---

## Pipeline de logs — détail

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph FASTAPI["FastAPI (atd-backend)"]
        CODE["logging.getLogger(__name__)\n.info('message')"]
        STDLIB["stdlib logging\n(ProcessorFormatter)"]
        STRUCTLOG["structlog\nJSONRenderer (prod)"]
    end

    subgraph DOCKER["Docker"]
        STDOUT["stdout\n(container log driver)"]
        JSONFILE["/var/lib/docker/containers/\nXXX-json.log\n{log: '{...}', stream: 'stdout', time: '...'}"]
    end

    subgraph PROMTAIL_PIPE["Promtail pipeline"]
        TAIL["tail log file"]
        PARSE1["stage: json\nextract 'log' field"]
        TS["stage: timestamp\n(RFC3339Nano)"]
        OUTPUT["stage: output\n(log = message)"]
        PARSE2["stage: json (nested)\nextract level, logger, message"]
        LABELS["stage: labels\nlevel=, logger=, stream="]
    end

    LOKI_STORE[("Loki\n(TSDB index\n+ chunks)")]

    CODE --> STDLIB --> STRUCTLOG
    STRUCTLOG -- "{'level':'info','message':'...','timestamp':'...'}" --> STDOUT
    STDOUT --> JSONFILE
    JSONFILE --> TAIL --> PARSE1 --> TS --> OUTPUT --> PARSE2 --> LABELS
    LABELS -- "HTTP push\nwith labels:\nproject=apps\ncontainer=atd-backend\nlevel=info" --> LOKI_STORE
```

---

## Labels Loki indexés

| Label | Source | Exemple |
|-------|--------|---------|
| `project` | `com.docker.compose.project` | `apps` |
| `container` | nom du container | `atd-backend`, `atd-frontend` |
| `service` | `com.docker.compose.service` | `backend`, `frontend` |
| `level` | extrait du JSON structlog | `info`, `warning`, `error` |
| `logger` | extrait du JSON structlog | `src.trades.router` |
| `stream` | stdout / stderr | `stdout` |

---

## Réseau Docker

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
flowchart LR
    subgraph NET_MONITORING["network: monitoring (bridge)"]
        PROMTAIL2["atd-promtail"]
        LOKI2["atd-loki\n:3100"]
        GRAFANA2["atd-grafana\n:3000 (interne)"]
        PROXY2["atd-grafana-proxy\n:3000 (exposé)"]
    end

    subgraph NET_APPS["network: apps_default (external)"]
        BE2["atd-backend"]
        FE2["atd-frontend"]
    end

    PROMTAIL2 -- "http://loki:3100" --> LOKI2
    LOKI2 -- "query" --> GRAFANA2
    GRAFANA2 -- "http://grafana:3000" --> PROXY2

    %% Promtail est aussi attaché à apps_default pour la discovery
    PROMTAIL2 -.->|"Docker socket\n(pas réseau)"| BE2
```

> Promtail n'est **pas** connecté au réseau `apps_default` via TCP — il accède aux logs via le **socket Docker** monté en bind mount (`/var/run/docker.sock`), pas via le réseau.

---

## Rétention et persistance

| Données | Stockage | Survie |
|---------|----------|--------|
| Logs bruts | Named volume `atd-monitoring_loki_data` | Restart / redeploy |
| Rétention max | Configurée à **31 jours** dans `loki.yml` | Purge auto par compactor |
| Dashboards | Bind mount `~/monitoring/config/grafana/` | Sync avec git via CI |
| Config Grafana | Named volume `atd-monitoring_grafana_data` | Restart / redeploy |

---

## Repos impliqués

| Repo | Rôle |
|------|------|
| `AlphaTradingDesk` | `src/core/logging_config.py` — structlog JSON en prod |
| `AlphaTradingDesk-monitoring` | Stack Loki + Promtail + Grafana + CI/CD deploy |

---

## CI/CD deploy flow

```mermaid
%%{init: {"flowchart": {"htmlLabels": false}} }%%
sequenceDiagram
    participant DEV as Developer
    participant GH as GitHub Actions
    participant DELL as Dell (Ubuntu)

    DEV->>GH: push → main (AlphaTradingDesk-monitoring)
    GH->>GH: Checkout + Tailscale connect
    GH->>DELL: SSH — docker run alpine chown ~/monitoring/
    GH->>DELL: SCP — config/ + docker-compose.monitoring.yml
    GH->>DELL: SSH — docker compose pull + up -d
    DELL-->>GH: ✅ containers restarted
```
