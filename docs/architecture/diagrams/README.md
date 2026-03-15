# 📐 Architecture Diagrams — AlphaTradingDesk

**Version:** 1.1 — Phase 1 + Phase 2
**Date:** 14 mars 2026

All diagrams use [Mermaid](https://mermaid.js.org/) flowchart syntax and are renderable in VS Code (with the Mermaid Preview extension), GitHub, and any Mermaid-compatible viewer.

---

## Diagram Index

| # | File | Phase | What it shows |
|---|------|-------|---------------|
| 01 | [`01-system-architecture.md`](./01-system-architecture.md) | P1 | Docker services layout · Dev vs Prod vs Future environments · LAN domain resolution |
| 02 | [`02-feature-data-flow.md`](./02-feature-data-flow.md) | P1 | Feature flow : Market Analysis → Trade Form → Trade Lifecycle → Goals/Risk |
| 03 | [`03-database-schema.md`](./03-database-schema.md) | P1 | Tables Phase 1 et relations FK |
| 04 | [`04-phase2-system-architecture.md`](./04-phase2-system-architecture.md) | P2 | Stack Phase 2 : TimescaleDB + Redis + Celery Worker + Beat · Flux Beat→Worker→DB |
| 05 | [`05-phase2-volatility-dataflow.md`](./05-phase2-volatility-dataflow.md) | P2 | Data flow Volatility Engine : sources → calcul indicateurs → DB → API → UI · Agregation Market VI · Watchlist 7 cols |
| 06 | [`06-phase2-database-schema.md`](./06-phase2-database-schema.md) | P2 | 5 nouvelles tables Phase 2 (hypertables TimescaleDB · volatility_settings · notification_settings) + relations avec Phase 1 |

---

## Quick Reference

### Environments
- **DEV:** `http://localhost:5173` (Vite) + `http://localhost:8000` (uvicorn)
- **PROD:** `http://alphatradingdesk.local` (Caddy, LAN mDNS)
- **FUTURE:** Same compose stack on GCE `europe-west9` with TLS

### Key Modules (Phase 1)
1. **Market Analysis** — Crypto & Gold, 3 scores per asset (HTF/MTF/LTF)
2. **News Intelligence** — Optional Perplexity/Grok proxy, AES-256 key storage
3. **Trade Journal** — Full lifecycle, BE logic, live risk tracking
4. **Goals & Risk** — Daily/Weekly/Monthly, style-aware, limits + override

### Key Modules (Phase 2)
5. **Market VI** — Score global du marche via Binance Futures (~50 paires configurables)
6. **Per-Pair VI** — 317 paires Kraken, 5 indicateurs, 5 TF, 5 regimes
7. **Watchlist** — 7 colonnes, tri par VI+EMA, export DL TV format, 1W lundi 01:00 UTC
8. **Alerting** — Telegram multi-bots, Market VI + Watchlists, cooldown configurable

---

## Related Docs

| Doc | Path |
|-----|------|
| Phase 2 Scope | [`../../deployment/phases/phase2/pre-implement-phase2.md`](../../deployment/phases/phase2/pre-implement-phase2.md) |
| Phase 2 Implementation Plan | [`../../deployment/phases/phase2/implement-phase2.md`](../../deployment/phases/phase2/implement-phase2.md) |
| Full Phase 2 Design Draft | [`../../phases/PHASE_2_VOLATILITY_DRAFT.md`](../../phases/PHASE_2_VOLATILITY_DRAFT.md) |
| Full Phase 1 Spec | [`../../deployment/phases/phase1/pre-implement-phase1.md`](../../deployment/phases/phase1/pre-implement-phase1.md) |
| Docker Setup | [`../tech/DOCKER_SETUP.md`](../tech/DOCKER_SETUP.md) |
| Phases Infrastructure | [`../tech/PHASES_INFRASTRUCTURE.md`](../tech/PHASES_INFRASTRUCTURE.md) |
| Database Schema (full) | [`../tech/DATABASE.md`](../tech/DATABASE.md) |
