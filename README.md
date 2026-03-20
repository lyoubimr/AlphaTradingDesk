# 📈 AlphaTradingDesk

> A self-hosted, multi-asset trading platform — risk management, trade journal, goals and market analysis.  
> Runs on your LAN. Your data stays yours.

---

## 🗺️ What is this?

**AlphaTradingDesk** is a personal trading operations platform designed to run 24/7 on a local server (a Dell OptiPlex in a home lab). It replaces spreadsheets and scattered notes with a structured, database-backed system for serious retail traders.

| Module | What it does |
|--------|-------------|
| 🎯 **Risk Management** | Fixed-fractional position sizing — enter capital, risk %, entry & SL → get exact lot size |
| 📒 **Trade Journal** | Log trades with entry/exit, multi-TP, screenshots, strategies, R-multiples |
| 📊 **Goals** | Set monthly/quarterly/annual targets — P&L, win rate, R targets — tracked automatically |
| 🔍 **Market Analysis** | Pre-session structured analysis (HTF bias, LTF score, confluences) |
| 📐 **Strategies** | Define and version your trading setups — stats auto-compute once enough trades exist |
| 🤝 **Brokers** | Track which broker/account each trade goes through |
| 📈 **Volatility** | Per-pair + market-wide VI scores (H1/H4/D1), watchlist generation |
| 🛡️ **Dynamic Risk** | Risk engine + advisor + guard — adjusts exposure based on market conditions |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│  Mac  (dev)                          │
│  Vite :5173 + uvicorn :8000 --reload │
└──────────────┬──────────────────────┘
               │  git push → PR → merge
               ▼
┌─────────────────────────────────────┐
│  GitHub Actions (CI/CD)              │
│  → test (ruff + mypy + pytest +      │
│    eslint + vitest)                  │
│  → build Docker images               │
│  → push to GHCR                      │
│  → SSH deploy to Dell via Tailscale  │
└──────────────┬──────────────────────┘
               │  SSH via Tailscale
               ▼
┌─────────────────────────────────────┐
│  Dell OptiPlex (Ubuntu 24.04)        │
│  https://alphatradingdesk (Tailscale)│
│  Docker Compose — never builds       │
└─────────────────────────────────────┘
```

**Stack:**

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript |
| Backend | FastAPI (Python 3.11) |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 + Alembic |
| Container | Docker + Docker Compose |
| CI/CD | GitHub Actions + GHCR |
| Tunnel | Tailscale (GitHub runner → Dell LAN) |

**Related repositories:**

| Repo | Purpose |
|------|---------|
| [AlphaTradingDesk-ops](https://github.com/lyoubimr/AlphaTradingDesk-ops) | Prod scripts, deployment docs, `docker-compose.prod.yml` |
| [AlphaTradingDesk-monitoring](https://github.com/lyoubimr/AlphaTradingDesk-monitoring) | Loki + Promtail + Grafana observability stack |

---

## 🚀 Getting started (dev)

### Prerequisites

- Python 3.11 + [Poetry](https://python-poetry.org/)
- Node 20 + npm
- Docker Desktop (or Docker Engine)

### 1 — Clone & install

```bash
git clone https://github.com/lyoubimr/AlphaTradingDesk.git
cd AlphaTradingDesk

# Backend
poetry install

# Frontend
cd frontend && npm install && cd ..
```

### 2 — Environment

```bash
cp .env.example .env.dev
# Edit .env.dev — set POSTGRES_PASSWORD at minimum
```

### 3 — Start the stack

```bash
make dev          # starts Postgres + backend + frontend via Docker Compose
# OR individually:
make backend      # uvicorn --reload :8000
make frontend     # vite dev :5173
```

### 4 — Run tests

```bash
make test         # ruff + mypy + pytest + eslint + vitest
# Or:
APP_ENV=test .venv/bin/pytest tests/ -q
cd frontend && npm test
```

See `make help` for all available commands.

---

## 📦 Deployment (production)

Production runs on a self-hosted Dell server — Docker Compose, images pulled from GHCR, never built on the server.

- Prod scripts and `docker-compose.prod.yml` → **[AlphaTradingDesk-ops](https://github.com/lyoubimr/AlphaTradingDesk-ops)**
- Server provisioning guide → `AlphaTradingDesk-ops/docs/deployment/phases/phase1/SERVER_SETUP.md`

Quick summary:
1. Provision the server → `scripts/prod/setup-server.sh` (in ops repo)
2. Set GitHub Secrets: `DELL_HOST`, `DELL_USER`, `DELL_SSH_KEY`, `TAILSCALE_AUTHKEY`
3. Merge a `feat:` or `fix:` PR to `main` → CD builds images, deploys automatically

---

## 🔄 Git workflow

| Branch | Purpose |
|--------|---------|
| `main` | Production — protected, CD triggers on every merge |
| `develop` | Integration — all PRs target here first |
| `feat/<name>` | Feature branches — branch from `develop` |
| `fix/<name>` | Bug fix branches |

```
feat/my-feature  ──►  develop  ──►  main
                    (CI runs)    (CI + CD)
```

Commit format: `<type>(<scope>): <description>`
Types: `feat` · `fix` · `chore` · `docs` · `refactor` · `test` · `ci` · `db` · `perf`

A `feat:` or `fix:` commit → new semver release + deploy.
`docs:` / `ci:` / `test:` / `db:` → CI only, no deploy.

---

## 📁 Project structure

```
AlphaTradingDesk/
├── src/                    # FastAPI backend
│   ├── core/               # Config, DB, deps, logging
│   ├── profiles/           # Trader profiles
│   ├── trades/             # Trade journal
│   ├── risk_management/    # Lot size calculator + dynamic risk engine
│   ├── strategies/         # Trading setups
│   ├── goals/              # Performance goals
│   ├── market_analysis/    # Pre-session analysis
│   ├── volatility/         # VI scores + market volatility
│   ├── watchlist/          # Watchlist generation
│   └── brokers/            # Broker management
├── frontend/               # React + Vite + TypeScript
│   └── src/
│       ├── pages/          # Dashboard, Trades, Goals, MA, Risk...
│       ├── components/     # Shared UI components
│       └── hooks/          # React Query hooks
├── database/
│   └── migrations/         # Alembic migrations + seeds
├── tests/                  # pytest
├── scripts/
│   └── entrypoint.sh       # Docker entrypoint (runs migrations + starts uvicorn)
├── docs/                   # Architecture + analysis docs
├── docker-compose.dev.yml  # Dev stack
├── Dockerfile.backend
├── frontend/Dockerfile
├── Makefile
└── pyproject.toml
```

---

## 🗺️ Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Risk + Trade Journal + Goals + Market Analysis | ✅ v1.0.0 |
| **Phase 2** | Volatility Index scores + Watchlists | ✅ v2.0.3 |
| **Phase 3** | Dynamic Risk Management | ✅ v3.0.0 |
| **Phase 4A** | Mobile UX — responsive + bottom nav | 🔄 In progress |
| **Phase 4B** | DevOps Logging — structlog + Loki/Grafana | 🔄 In progress |
| Phase 5 | Trade Automation / Kraken execution | ⏳ Planned |

---

## 📄 License

[MIT](LICENSE) — self-host freely, contribute openly.

**AlphaTradingDesk** is a personal trading operations platform designed to run 24/7 on a local server (a Dell OptiPlex in a home lab). It replaces spreadsheets and scattered notes with a structured, database-backed system for serious retail traders.

| Module | What it does |
|--------|-------------|
| 🎯 **Risk Management** | Fixed-fractional position sizing — enter capital, risk %, entry & SL → get exact lot size |
| 📒 **Trade Journal** | Log trades with entry/exit, multi-TP, screenshots, strategies, R-multiples |
| 📊 **Goals** | Set monthly/quarterly/annual targets — P&L, win rate, R targets — tracked automatically |
| 🔍 **Market Analysis** | Pre-session structured analysis (HTF bias, LTF score, confluences) |
| 📐 **Strategies** | Define and version your trading setups — stats auto-compute once enough trades exist |
| 🤝 **Brokers** | Track which broker/account each trade goes through |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────┐
│  Mac  (dev)                          │
│  Vite :5173 + uvicorn :8000 --reload │
└──────────────┬──────────────────────┘
               │  git push → PR → merge
               ▼
┌─────────────────────────────────────┐
│  GitHub Actions (CI/CD)              │
│  → build Docker images               │
│  → push to GHCR                      │
│  → SSH deploy to Dell                │
└──────────────┬──────────────────────┘
               │  SSH via Tailscale
               ▼
┌─────────────────────────────────────┐
│  Dell OptiPlex (Ubuntu 24.04, LAN)   │
│  http://alphatradingdesk.local       │
│  Docker Compose — never builds       │
└─────────────────────────────────────┘
```

**Stack:**

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript |
| Backend | FastAPI (Python 3.11) |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 + Alembic |
| Container | Docker + Docker Compose |
| CI/CD | GitHub Actions + GHCR |
| Tunnel | Tailscale (GitHub runner → LAN) |

---

## 🚀 Getting started (dev)

### Prerequisites

- Python 3.11 + [Poetry](https://python-poetry.org/)
- Node 20 + npm
- Docker Desktop (or Docker Engine)

### 1 — Clone & install

```bash
git clone https://github.com/<your-org>/AlphaTradingDesk.git
cd AlphaTradingDesk

# Backend
poetry install

# Frontend
cd frontend && npm install && cd ..
```

### 2 — Environment

```bash
cp .env.example .env.dev
# Edit .env.dev — set POSTGRES_PASSWORD at minimum
```

### 3 — Start the stack

```bash
make dev          # starts Postgres + backend + frontend via Docker Compose
# OR individually:
make backend      # uvicorn --reload :8000
make frontend     # vite dev :5173
```

### 4 — Run tests

```bash
make test         # ruff + mypy + pytest + eslint + vitest
# Or:
APP_ENV=test .venv/bin/pytest tests/ -q
cd frontend && npm test
```

See `make help` for all available commands.

---

## 📦 Deployment (production)

Production runs on a self-hosted Dell server — Docker Compose, images pulled from GHCR, never built on the server.

Full step-by-step guide: **[`docs/deployment/phases/phase1/SERVER_SETUP.md`](docs/deployment/phases/phase1/SERVER_SETUP.md)**

Quick summary:
1. Provision the server → `scripts/prod/setup-server.sh`
2. Set 4 GitHub Secrets (`DELL_HOST`, `DELL_USER`, `DELL_SSH_KEY`, `TAILSCALE_AUTHKEY`)
3. Merge a `feat:` PR to `main` → CD builds images, deploys automatically

---

## 🔄 Git workflow

| Branch | Purpose |
|--------|---------|
| `main` | Production — protected, CD triggers on every merge |
| `develop` | Integration — all PRs target here first |
| `feat/<name>` | Feature branches — branch from `develop` |
| `fix/<name>` | Bug fix branches |

```
feat/my-feature  ──►  develop  ──►  main
                    (CI runs)    (CI + CD)
```

Commit format: `<type>(<scope>): <description>`  
Types: `feat` · `fix` · `chore` · `docs` · `refactor` · `test` · `ci` · `db` · `perf`

A `feat:` or `fix:` commit in the PR → new semver release + deploy.  
`docs:` / `chore:` / `test:` → CI only, no deploy.

---

## 📁 Project structure

```
AlphaTradingDesk/
├── src/                    # FastAPI backend
│   ├── core/               # Config, DB, deps
│   ├── profiles/           # Trader profiles
│   ├── trades/             # Trade journal
│   ├── risk_management/    # Lot size calculator
│   ├── strategies/         # Trading setups
│   ├── goals/              # Performance goals
│   ├── market_analysis/    # Pre-session analysis
│   └── brokers/            # Broker management
├── frontend/               # React + Vite + TypeScript
│   └── src/
│       ├── pages/          # Dashboard, Trades, Goals, MA, Risk...
│       ├── components/     # Shared UI components
│       └── hooks/          # React Query hooks
├── database/
│   └── migrations/         # Alembic migrations + seeds
├── tests/                  # pytest — 119 tests
├── scripts/prod/           # Server provisioning + deploy scripts
├── docs/                   # Architecture, deployment docs
├── docker-compose.dev.yml  # Dev stack
├── Dockerfile.backend
├── frontend/Dockerfile
├── Makefile
└── pyproject.toml
```

---

## 🗺️ Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Risk + Trade Journal + Goals + Market Analysis | 🟢 Active |
| Phase 2 | Volatility Index scores | ⏳ Planned |
| Phase 3 | Watchlist generation | ⏳ Planned |
| Phase 4 | Kraken API automation | ⏳ Planned |

---

## 📄 License

[MIT](LICENSE) — self-host freely, contribute openly.
