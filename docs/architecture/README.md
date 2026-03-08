# 🏗️ Architecture Documentation

AlphaTradingDesk is organized into two main architecture sections:

## 📋 Operational Architecture

**Location:** `/operational/`

Describes **what the system does** from a user and process perspective:
- User workflows for each phase
- Data models and transformations
- Scheduled tasks and automation
- API integration points
- Security and risk management

**Files:**
- `OPERATIONAL_FLOW.md` - Complete operational flow across all phases (1-4)

> **Phase 1 detailed scope:** See `/docs/phases/PHASE_1_SCOPE.md`

## 💻 Technical Architecture

**Location:** `/tech/`

Describes **how to build and run** the system:
- Technology stack rationale
- Infrastructure components
- Deployment and containerization
- Development setup
- CI/CD pipelines
- Database schema and migrations
- API specifications
- Testing strategy

**Files:**
- `TECH_STACK.md` - Tech stack selection and rationale
- `PHASES_INFRASTRUCTURE.md` - How infrastructure evolves through phases
- `DOCKER_SETUP.md` - Docker Compose for dev/prod
- `DATABASE.md` - PostgreSQL schema and migrations
- `API_SPEC.md` - REST API and WebSocket specifications
- `SCHEDULING.md` - Celery Beat scheduling system
- `CI_CD.md` - GitHub Actions workflows

---

## 🎯 How to Use

1. **Planning a new feature?** → Read `/operational/OPERATIONAL_FLOW.md`
2. **Setting up development?** → Read `/tech/DOCKER_SETUP.md` and `/tech/TECH_STACK.md`
3. **Adding a database table?** → Read `/tech/DATABASE.md`
4. **Creating an API endpoint?** → Read `/tech/API_SPEC.md`
5. **Understanding the build process?** → Read `/tech/CI_CD.md`

---

## 📊 Architecture Overview

```
┌─────────────────────────────────────────┐
│         React Frontend (Vite)            │
│  Dashboard │ Trades │ Watchlists │ ...   │
└──────────────────┬──────────────────────┘
                   │ HTTP/WebSocket
┌──────────────────▼──────────────────────┐
│         FastAPI Backend                  │
│  ├─ REST API                             │
│  ├─ WebSocket (real-time)                │
│  └─ Business Logic (risk, volatility)    │
└──────────────────┬──────────────────────┘
         ┌─────────┼─────────┐
         │         │         │
    ┌────▼────┐ ┌──▼─────┐ ┌─▼──────────┐
    │PostgreSQL│ │Redis   │ │Celery+Beat │
    │+ TS      │ │(cache) │ │(scheduling)│
    └──────────┘ └────────┘ └────────────┘
         │         
    External APIs
    ├─ Kraken
    ├─ Binance
    └─ Telegram
```

---

**Principle:** Architecture evolves through phases without breaking Phase 1 functionality.

Phase 1 → Phase 2 → Phase 3 → Phase 4
(Risk+Journal) + (Volatility) + (Watchlist) + (Auto-Trading)
