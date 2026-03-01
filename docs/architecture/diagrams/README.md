# 📐 Architecture Diagrams — AlphaTradingDesk

**Version:** 1.0 — Phase 1  
**Date:** March 1, 2026

All diagrams use [Mermaid](https://mermaid.js.org/) flowchart syntax and are renderable in VS Code (with the Mermaid Preview extension), GitHub, and any Mermaid-compatible viewer.

---

## Diagram Index

| # | File | What it shows |
|---|------|---------------|
| 01 | [`01-system-architecture.md`](./01-system-architecture.md) | Docker services layout · Dev vs Prod vs Future environments · LAN domain resolution (mDNS/Bonjour) |
| 02 | [`02-feature-data-flow.md`](./02-feature-data-flow.md) | Full Phase 1 feature flow: Market Analysis → Trade Form → Trade Lifecycle → Goals/Risk · News Intelligence backend proxy · 3-TF score model (Crypto/Gold) |
| 03 | [`03-database-schema.md`](./03-database-schema.md) | All Phase 1 DB tables and foreign-key relationships · News Intelligence tables zoom-in |

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

---

## Related Docs

| Doc | Path |
|-----|------|
| Full Phase 1 Spec | [`../../deployment/phases/phase1/pre-implement-phase1.md`](../../deployment/phases/phase1/pre-implement-phase1.md) |
| Tech Stack | [`../tech/TECH_STACK.md`](../tech/TECH_STACK.md) |
| Docker Setup | [`../tech/DOCKER_SETUP.md`](../tech/DOCKER_SETUP.md) |
| Phases Infrastructure | [`../tech/PHASES_INFRASTRUCTURE.md`](../tech/PHASES_INFRASTRUCTURE.md) |
| Database Schema (full) | [`../tech/DATABASE.md`](../tech/DATABASE.md) |
