# AlphaTradingDesk — Architecture Overview

**Phase:** 1 · **Version:** 1.0.0 · **Updated:** 2026-03

---

## Architecture Globale

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  MAC (dev)                                                                    │
│                                                                               │
│  /Projects/Trading/AlphaTradingDesk/                                         │
│  ├── src/              → code FastAPI (Python 3.11)                          │
│  ├── frontend/src/     → code React 19 + TypeScript                          │
│  ├── database/         → migrations Alembic + seeds                          │
│  ├── docker-compose.dev.yml  → stack locale (4 containers)                  │
│  └── Makefile          → point d'entrée unique pour toutes les opérations    │
│                                                                               │
│  Dev URLs:  http://localhost:5173  (React Vite HMR)                          │
│             http://localhost:8000  (FastAPI uvicorn --reload)                │
│             http://localhost:8080  (Adminer DB GUI)                          │
│                                                                               │
│  Commit + push develop → CI (lint + tests) ─────────────────────────────┐   │
└────────────────────────────────────────────────────────────────┬────────┘   │
                         PR: develop → main + merge              │             │
                                        ▼                        ▼             │
┌──────────────────────────────────────────────────────────────────────────────┤
│  GITHUB ACTIONS (cloud runner — ubuntu-latest)                                │
│                                                                               │
│  CI  (atd-test.yml)    → ruff · mypy · pytest · eslint · tsc · vitest       │
│                           + docker build (pas de push) — ~2–3 min            │
│                                                                               │
│  CD  (atd-deploy.yml)  → calcul semver (Conventional Commits)                │
│                        → docker build backend + push ghcr.io/.../atd-backend│
│                        → docker build frontend + push ghcr.io/.../atd-frontend│
│                        → scp scripts/prod/*.sh → Dell ~/apps/ (chmod +x)    │
│                        → GitHub Release + changelog auto                     │
│                        → Tailscale join network                              │
│                        → SSH Dell 100.x.x.x → ~/apps/deploy.sh vX.Y.Z      │
│                           ~4–6 min de merge à live                           │
└──────────────────────────────────────────┬────────────────────────────────────┘
                              SSH via Tailscale (100.x.x.x)
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  DELL OptiPlex Micro (Ubuntu 24.04 LTS — always-on, LAN)                     │
│  IP fixe: 192.168.1.100  ·  MAC: 18:66:DA:13:01:9D  ·  Tailscale: 100.x.x.x│
│                                                                               │
│  ~/apps/docker-compose.prod.yml  ← 3 containers (db + backend + frontend)   │
│                                                                               │
│  deploy.sh vX.Y.Z:                                                           │
│    docker pull atd-backend:vX.Y.Z  ← depuis GHCR (images pré-buildées)     │
│    docker pull atd-frontend:vX.Y.Z                                           │
│    docker compose up -d (rolling restart, DB untouched)                      │
│    alembic upgrade head (auto dans entrypoint)                               │
│                                                                               │
│  https://alphatradingdesk.local  (HTTP → HTTPS redirect via Nginx)           │
│                                                                               │
│  Données persistantes (bind mounts sur /srv/atd/) :                          │
│    /srv/atd/data/postgres/   → DB PostgreSQL                                 │
│    /srv/atd/data/uploads/    → fichiers uploadés                             │
│    /srv/atd/certs/           → cert TLS auto-signé (10 ans)                  │
│    /srv/atd/backups/         → pg_dump rolling (6h) + weekly (dim. 03:00)   │
│    /srv/atd/logs/            → logs app + cron                               │
└──────────────────────────────────────────────────────────────────────────────┘

Règles invariantes :
  ✅ Dell ne git clone jamais — pull uniquement des images depuis GHCR
  ✅ Dell ne docker build jamais — toutes les builds sur les runners GitHub
  ✅ Les données survivent à TOUT via bind mounts (/srv/atd/)
  ✅ Secrets : GitHub Secrets (CI/CD) + ~/apps/.env (runtime)
  ✅ Aucune valeur spécifique à l'environnement dans le code source
```

---

## Stack Technique — Phase 1

| Couche | Techno | Version | Pourquoi |
|--------|--------|---------|----------|
| Frontend | React + Vite + TypeScript | 19 / 8 / 5 | Vite = ESM natif (10–100x plus rapide que Webpack), HMR instantané |
| CSS | Tailwind CSS v4 | 4 | CSS utilitaire, zéro fichier CSS custom, themes via CSS variables |
| Backend | FastAPI | 0.115+ | ASGI async, OpenAPI auto, validation Pydantic, plus rapide que Flask |
| Python | Python 3.11 | 3.11 | Perf gains vs 3.10, compatibilité libs trading Phase 2+ |
| ORM | SQLAlchemy 2.0 | 2.0 | Async, mapped columns typés, transactions explicites |
| Schemas | Pydantic v2 | 2 | 10x plus rapide que v1 (core Rust), séparé des modèles ORM |
| DB | PostgreSQL | 16 | ACID, JSON natif, MVCC, supérieur à MySQL sur les features |
| Migrations | Alembic | latest | Outil officiel SQLAlchemy, autogenerate, versioning schéma |
| Runtime server | uvicorn | latest | ASGI, --reload en dev, exec en prod (PID 1) |
| Deps Python | Poetry | 1.8+ | Lock file déterministe, venv projet-local (.venv/) |
| Container | Docker Engine | 25+ | Reproductibilité, isolation, même env dev/CI/prod |
| Orchestration | Docker Compose | v2 | Gestion multi-containers, suffisant pour 1 serveur Phase 1–4 |
| CI/CD | GitHub Actions | - | Natif GitHub, gratuit, GITHUB_TOKEN auto, marketplace riche |
| Registry | GHCR | - | Intégré GitHub, auth GITHUB_TOKEN, tags semver, gratuit |
| Tunnel | Tailscale | - | VPN mesh P2P — GitHub runners ne peuvent pas atteindre 192.168.1.x |
| Reverse proxy | Nginx | stable-alpine | Sert le SPA statique + proxifie /api/ → backend + TLS |

**Phase 2+ — ne pas ajouter en Phase 1 :**
> Redis · Celery · TimescaleDB hypertables · Prometheus/Grafana · Kraken API · Streamlit

---

## Structure du Projet

```
AlphaTradingDesk/
├── src/                        → backend Python (FastAPI)
│   ├── main.py                 → app entry, routers, CORS, upload dir
│   ├── core/
│   │   ├── config.py           → Settings (pydantic-settings)
│   │   ├── database.py         → engine, session, get_db(), normalise_url
│   │   └── models/             → SQLAlchemy ORM models
│   ├── risk_management/        → Phase 1
│   ├── trades/                 → router + service + schemas
│   ├── strategies/
│   ├── goals/
│   ├── market_analysis/
│   ├── profiles/
│   ├── brokers/
│   └── stats/
│
├── frontend/                   → React 19 + TypeScript
│   ├── src/
│   │   ├── main.tsx            → entry, providers, Router
│   │   ├── App.tsx             → routes React Router v6
│   │   ├── lib/api.ts          → tous les appels fetch vers le backend
│   │   ├── types/api.ts        → types TypeScript des objets backend
│   │   ├── context/            → ThemeContext + ProfileContext
│   │   ├── pages/              → Dashboard, Trades, Goals, MarketAnalysis, Settings
│   │   └── components/         → composants réutilisables
│   ├── Dockerfile              → multi-stage prod (node builder → nginx)
│   ├── Dockerfile.dev          → dev (node + Vite HMR)
│   └── nginx.conf              → SPA routing + /api/ proxy + HTTPS
│
├── database/
│   └── migrations/
│       ├── versions/           → fichiers Alembic horodatés
│       ├── seeds/              → seed_all.py + seed_*.py (idempotents)
│       └── env.py              → config Alembic (lit DATABASE_URL)
│
├── scripts/
│   ├── entrypoint.sh           → wait DB → alembic upgrade → seed → uvicorn
│   └── prod/                   → scripts auto-synchonisés sur le Dell par CI/CD
│       ├── deploy.sh
│       ├── backup-db.sh
│       ├── setup-cron.sh
│       ├── healthcheck.sh
│       ├── setup-ssl.sh
│       └── update-server.sh
│
├── .github/workflows/
│   ├── atd-test.yml            → CI (lint + tests + build)
│   └── atd-deploy.yml          → CD (build + push GHCR + deploy Dell)
│
├── Dockerfile.backend          → image backend prod
├── docker-compose.dev.yml      → stack dev locale
├── alembic.ini                 → config Alembic
├── pyproject.toml              → dépendances Python + outils
├── Makefile                    → toutes les commandes dev/CI/DB
└── docs/
    └── devops_doc/             → cette documentation
        ├── 00-OVERVIEW.md      ← vous êtes ici
        ├── 01-DATABASE.md
        ├── 02-BACKEND.md
        ├── 03-FRONTEND.md
        ├── 04-DEV-ENV.md
        ├── 05-CICD.md
        └── 06-PROD-DEPLOY.md
```

---

## Flux de Données — Request lifecycle (prod)

```
Browser (alphatradingdesk.local)
  │  HTTPS :443
  ▼
Nginx (frontend container)
  ├── GET /                    → sert dist/index.html (SPA)
  ├── GET /assets/*.js|css     → sert dist/assets/* (statiques)
  └── GET /api/*               → proxy_pass http://backend:8000/api/*
                                     │
                                     ▼
                               FastAPI (backend container :8000)
                                 │  Depends(get_db) → Session SQLAlchemy
                                 ▼
                               PostgreSQL (db container :5432)
                                 → /srv/atd/data/postgres/ (bind mount)
```

## Flux de Données — Upload fichier

```
Browser → POST /api/trades/{id}/screenshot (multipart)
  → FastAPI → sauvegarde /app/uploads/{profile}/{file}
  → /app/uploads = bind mount → /srv/atd/data/uploads/ sur le host Dell
  → URL retournée : /api/uploads/{profile}/{file}
  → Nginx sert ce chemin via proxy_pass /api/ → backend
```

---

## Environnements et Variables

| APP_ENV | Fichier chargé | Usage |
|---------|---------------|-------|
| `dev` (défaut) | `.env.dev` | Dev local Mac |
| `test` | `.env.test` | CI / pytest |
| `prod` | pas de fichier | Docker prod Dell (vars injectées par env_file: dans compose) |

**Priorité pydantic-settings** (la plus haute gagne) :
```
Variable OS réelle  >  fichier .env  >  valeur par défaut Settings
```

**DATABASE_URL :**
- Dans tous les fichiers `.env` : `postgresql://user:pass@host:5432/db` (pas de driver suffix)
- `database.py` (`_normalise_db_url`) le réécrit en `postgresql+psycopg://` **au runtime uniquement**
- Ne jamais écrire `postgresql+psycopg://` hors de `database.py`

---

## Commits Convention

```
<type>(<scope>): <description>  — impératif, ≤ 72 chars, sans point final

feat(trades): add screenshot upload endpoint     → MINOR release → deploy
fix(config): correct CORS allowed origins        → PATCH release → deploy
chore: update dependencies                       → PATCH release → deploy
refactor(service): simplify lot size calc        → PATCH release → deploy
docs: update SERVER_SETUP.md                     → no release, no deploy
test: add risk calculation tests                 → no release, no deploy
ci: fix test workflow                            → no release, no deploy
db: add market_analysis migration                → no release, no deploy
```

> Forcer un déploiement d'un changement docs/test : inclure un `fix:` dans la même PR.
