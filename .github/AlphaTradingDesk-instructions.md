# 🏦 AlphaTradingDesk - Project Instructions

**Project:** AlphaTradingDesk  
**Date:** March 1, 2026  
**Version:** 2.0 (stack corrected: FastAPI + React; win-rate rule added)  
**Status:** Phase 1 — Risk Management & Journal

---

## 📚 Reference Documents — ALWAYS LOAD BOTH

> **⚠️ These two files MUST be loaded at the start of every session:**

| File | Purpose |
|------|---------|
| `/Users/mohamedredalyoubi/Projects/Trading/.ai-instructions.md` | General AI collaboration rules (language, workflow, code style) |
| `/Users/mohamedredalyoubi/Projects/Trading/AlphaTradingDesk/.github/AlphaTradingDesk-instructions.md` | **This file** — project-specific rules, stack, phase scope |

**Project-Specific Docs (read when relevant):**

| File | Purpose |
|------|---------|
| `docs/deployment/phases/phase1/pre-implement-phase1.md` | Full Phase 1 scope — single source of truth |
| `docs/deployment/phases/phase1/implement-phase1.md` | Step-by-step implementation plan |
| `docs/architecture/tech/DATABASE.md` | Full database schema (canonical) |
| `docs/architecture/tech/TECH_STACK.md` | Stack with phase tags |
| `docs/architecture/tech/CI_CD.md` | CI/CD — Phase 1 CI only, CD dormant |
| `docs/architecture/diagrams/` | System, data flow, and DB diagrams (Mermaid) |

---

## 🎯 Project Context

### What is AlphaTradingDesk?

Multi-asset trading platform (LAN web app, runs on Dell server):

| Phase | Scope | Status |
|-------|-------|--------|
| **Phase 1** | Risk Management + Trade Journal + Goals + Market Analysis | 🟢 Active |
| Phase 2 | Volatility Analysis (VI scores) | ⏳ Pending |
| Phase 3 | Watchlist Generation | ⏳ Pending |
| Phase 4 | Automation / Kraken execution | ⏳ Pending |

### Deployment Environment

```
DEV:   Mac (development machine)
         → uvicorn --reload :8000  +  Vite dev server :5173

PROD:  Dell server (Ubuntu Server — always-on, LAN)
         → http://alphatradingdesk.local
         → Docker Compose prod stack
         → Deployed via GitHub Actions cloud runner: build → push GHCR → SSH → docker pull + up (Step 14)
```

---

## 🏗️ Architecture Principles

### 1. Phased Development

**Rule: Never build Phase 2+ features in Phase 1.**

```
Phase 1: Risk + Journal  ← WE ARE HERE
   ↓
Phase 2: Volatility
   ↓
Phase 3: Watchlist
   ↓
Phase 4: Automation
```

### 2. Database-First

All configuration → Database (not JSON files).  
UI → Database → Code (never manual file editing).

### 3. Clean Separation

```
src/
├── core/             → Models, database (shared across phases)
├── risk_management/  → Phase 1
├── volatility/       → Phase 2 (do not touch yet)
├── watchlist/        → Phase 3 (do not touch yet)
```

---

## 💻 Tech Stack (Phase 1)

> **Full stack with phase tags:** see `docs/architecture/tech/TECH_STACK.md`

### Phase 1 — what's actually running

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Vite |
| Backend | FastAPI (Python 3.11+) |
| ORM | SQLAlchemy 2.0 |
| Database | PostgreSQL 15+ |
| Container | Docker + Docker Compose |
| CI | GitHub Actions (pytest + ruff on PR) |
| CD | Dormant — activates at Step 14 of `implement-phase1.md` |

### Phase 2+ only (do NOT add to Phase 1)

| Technology | Reason deferred |
|-----------|-----------------|
| Redis | No caching needed in Phase 1 |
| Celery | No background tasks in Phase 1 |
| Celery Beat | No scheduled tasks in Phase 1 |
| TimescaleDB hypertables | Only for OHLCV / VI time-series (Phase 2+) |
| Prometheus + Grafana | Monitoring (Phase 2+) |

---

## 🗄️ Database Schema

**Canonical reference:** `docs/architecture/tech/DATABASE.md`

**Phase 1 tables:**
```
profiles                   - Trading profiles (CFD, Crypto)
trades                     - Trade entries
positions                  - Multi-TP positions
strategies                 - Strategy metadata + stats counters
tags                       - Trade categorization
trade_tags                 - Junction table
performance_snapshots      - Daily P&L history
brokers                    - Broker catalog
instruments                - Instruments per broker
trading_styles             - scalping / day_trading / swing / position
profile_goals              - Goals + limits per profile × style × period
goal_progress_log          - Daily goal snapshots
note_templates             - Post-trade note templates
sessions                   - Trading session catalog (UTC)
market_analysis_modules    - Crypto / Gold / Forex / Indices
market_analysis_indicators - HTF/MTF/LTF indicator catalog
profile_indicator_config   - Per-profile indicator ON/OFF
market_analysis_sessions   - Completed analysis sessions
market_analysis_answers    - Per-indicator answers
news_provider_config       - Per-profile encrypted API key + prompt
user_preferences           - Timezone, TF list, news toggle
```

**Phase 2+ tables (do not create in Phase 1):**
```
market_volatility_snapshots  - VI scores (TimescaleDB hypertable)
ohlcv_data                   - OHLCV (TimescaleDB hypertable)
watchlist_snapshots          - Phase 3
kraken_orders                - Phase 4
```

---

## 💼 Business Logic

### Multi-TP (Multiple Take Profits)

```python
# User perspective: 1 trade with 3 TPs
trade = Trade(pair='BTC/USD', tps=[100, 110, 120], percentages=[30, 40, 30])

# Database: 1 trade → 3 positions
Position(trade_id=1, tp=100, lot_pct=30)
Position(trade_id=1, tp=110, lot_pct=40)
Position(trade_id=1, tp=120, lot_pct=30)
```

### Risk Calculation (Fixed Fractional)

```python
risk_amount = capital_current * (risk_pct / 100)
lot_size = risk_amount / abs(entry_price - stop_loss)
```

`capital_current` is used (not start capital) — risk scales with P&L.

### Capital Auto-Update on Close

```python
with session.begin():
    trade.realized_pnl = sum(p.realized_pnl for p in positions)
    trade.status = 'closed'
    profile.capital_current += trade.realized_pnl
    # Also increment strategy counters:
    strategy.trades_count += 1
    if trade.realized_pnl > 0:
        strategy.win_count += 1
```

### ⚠️ Strategy Win Rate — Minimum Trade Rule

> A strategy's win rate is **only valid once `trades_count >= min_trades_for_stats`**
> (default **5**).

| `trades_count` | Win rate display | Used in risk logic? |
|:-:|:-:|:-:|
| 0 – 4 | `N/A` | ❌ No (treated as neutral) |
| ≥ 5 | `win_count / trades_count × 100 %` | ✅ Yes |

- `trades_count` and `win_count` live in the `strategies` table.
- Both are incremented **in the same transaction** as the trade close.
- All analytics endpoints return `null` / `N/A` below the threshold.
- See `DATABASE.md` → §"Business Logic: Strategy Win Rate Minimum" for migration SQL.

---

## 🚫 What NOT to Do (Phase 1)

| ❌ Do NOT | Reason |
|-----------|--------|
| Add Redis / Celery | Phase 2+ only |
| Create TimescaleDB hypertables | Phase 2+ only |
| Add VI calculation | Phase 2+ |
| Add Kraken API integration | Phase 4 |
| Add cron / LaunchDaemons | Phase 4 |
| Build multi-user auth | Post-Phase 1 |
| Use Streamlit | Old prototype — not this project. Stack is FastAPI + React. |

---

## ✅ Phase 1 Build Checklist

1. [ ] Database setup + Alembic migrations
2. [ ] Seed data: brokers, instruments, trading_styles, note_templates, sessions
3. [ ] Profiles CRUD
4. [ ] Broker & Instrument config
5. [ ] Trade form (entry, SL, TPs, lot size, leverage, margin)
6. [ ] Multi-TP setup (50/50, 33/33/34, custom)
7. [ ] Close position (P&L, structured notes)
8. [ ] Goals & Risk Limits system
9. [ ] Market Analysis questionnaire module
10. [ ] Economic Calendar widget (Feature 3b)
11. [ ] News Intelligence integration (Feature 4)
12. [ ] Trade Journal (list, detail, tags, screenshots)
13. [ ] Performance Analytics (win rate, profit factor, equity curve)
14. [ ] Configuration UI (profiles, tags, strategies)
15. [ ] CI pipeline (pytest + ruff on PR)

See `implement-phase1.md` for the full step-by-step plan.

---

## 🧪 Testing Strategy

**Must test:**
- Risk calculation (lot size formula)
- Multi-TP logic (position splitting)
- Capital auto-update on trade close
- Strategy stats increment (trades_count, win_count)
- Win rate threshold enforcement (N/A below 5 trades)
- Performance metrics (win rate, profit factor)

**Fixture pattern:**
```python
# tests/fixtures/sample_data.py
profile_cfd    = Profile(name='Vantage CFD', market_type='CFD', ...)
strategy_new   = Strategy(trades_count=2, win_count=1, ...)  # below threshold
strategy_valid = Strategy(trades_count=7, win_count=5, ...)  # above threshold
trade_open     = Trade(status='open', ...)
trade_closed   = Trade(status='closed', realized_pnl=150.0, ...)
```

---

## 📊 Phase 1 Success Criteria

MVP is done when:

1. ✅ User can create a trading profile
2. ✅ User can open a trade (entry, SL, 1-3 TPs, lot size calculated)
3. ✅ User can close a trade (P&L auto-computed, capital updated)
4. ✅ User can view trade history + performance analytics
5. ✅ User can add notes, tags, and screenshots to trades
6. ✅ Goals & risk limits enforce trade blocking when limit hit
7. ✅ Market Analysis questionnaire saves sessions + scores
8. ✅ Strategy win rate shows N/A until 5 trades
9. ✅ All data persists in PostgreSQL (no data loss)
10. ✅ CI pipeline green on every PR

---

## 💡 Development Tips

### Use Transactions

```python
with session.begin():
    trade.status = 'closed'
    profile.capital_current += trade.realized_pnl
    strategy.trades_count += 1
    if trade.realized_pnl > 0:
        strategy.win_count += 1
    session.add_all([trade, profile, strategy])
# Auto-commit or rollback — never partial state
```

### Input Validation

```python
if trade.direction == 'long' and trade.stop_loss >= trade.entry_price:
    raise ValueError("SL must be below entry for long trades")

if sum(tp_percentages) != 100:
    raise ValueError("TP percentages must sum to 100%")
```

---

**Last Updated:** 2026-03-01  
**Phase:** 1 — Risk Management & Journal  
**Status:** 🟢 Active Development
