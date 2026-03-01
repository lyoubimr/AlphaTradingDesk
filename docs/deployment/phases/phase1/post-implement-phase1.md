# ✅ Phase 1 — Post-Implementation Checklist

**Date:** March 1, 2026  
**Version:** 1.0  
**Status:** To be done after `implement-phase1.md` is complete

> This document covers what to do **after** Phase 1 is implemented and running locally.

---

## 1. 🧪 Testing & Validation

### Functional tests (manual)

```
Trade lifecycle:
  □ Open a Market trade (Kraken) → check position size calculation
  □ Open a Limit trade → status = PENDING → mark as filled → status = OPEN
  □ Partial close (TP1) → SL moved to BE → risk = $0 → goals bar updated
  □ Full close → realized PnL editable → goals bar updated
  □ Post-trade note → structured template filled → saved to DB

Goals & limits:
  □ Configure goals for Swing: weekly goal +2%, weekly limit -1.5%
  □ Close trades to reach 80% of limit → WARNING badge appears
  □ Close more → BLOCKED → override button works
  □ Daily period NOT enforced for Swing (no bar shown)

Market Analysis:
  □ Run Crypto analysis → dual scores computed correctly
  □ Run Gold analysis → single score computed correctly
  □ Toggle Q7 (OTHERS) OFF → max score recalculates → bias unchanged logic
  □ Wait (or manually set last_analysis date) → staleness banner appears at day 8
  □ Staleness banner color: yellow at 7d → orange at 14d
  □ Badge in trade form shows correct bias + adjusted risk%

Broker/Instruments:
  □ Kraken profile → only Kraken perps in dropdown
  □ Vantage profile → only Vantage CFDs in dropdown
  □ Favourites: pin 5 instruments → appear at top of dropdown
  □ Add custom instrument → appears in dropdown immediately

Sessions (CFD — Vantage):
  □ Sessions widget shows correct OPEN/CLOSED based on current UTC time
  □ London/NY overlap highlighted
  □ Trade auto-tagged with correct session at entry
```

### Automated tests (pytest)

```
Priority:
  □ Position size calculation (Crypto + CFD) — pure functions, easy to unit test
  □ Goal progress computation (% toward goal, % toward limit, active periods logic)
  □ Market analysis score computation (score_a, score_b, bias label)
  □ Staleness check (days_old > 7 → is_stale = true)
  □ Partial close: remaining_qty, risk recalc, BE logic
```

---

## 2. 🐛 Known Likely Issues (fix before declaring done)

```
□ Goal progress: make sure trades opened on a Monday don't bleed into previous week
□ Partial close: ensure cumulative partial closes don't over-reduce position qty
□ CFD margin check: verify formula with a real Vantage trade scenario
□ Instrument dropdown: search by display_name AND symbol (e.g. "Gold" AND "XAUUSD")
□ Market analysis: if ALL indicators for a group toggled OFF → show "No active indicators"
  error, block saving
□ Staleness banner: dismiss button (user can hide it for the session, reappears next day)
```

---

## 3. 📝 Documentation update after Phase 1

```
□ Write docs/phases/phase1/LESSONS_LEARNED.md
   → What was harder than expected
   → What was simpler than expected
   → Any architecture change made during implementation (document why)

□ Update API_SPEC.md if any route changed during implementation

□ Update DATABASE.md with final schema (if anything changed from pre-implement)

□ Write README.md at project root:
   → What AlphaTradingDesk is
   → How to set up dev environment (Docker Compose)
   → How to run migrations + seed
   → How to run tests
```

---

## 4. 🚀 Deployment (optional, before Phase 2)

```
If you want to use Phase 1 for real before Phase 2:

□ Set up a simple VPS or cloud instance (Hetzner, DigitalOcean, etc.)
□ Docker Compose prod (different from dev — no hot reload, HTTPS, env vars from secrets)
□ Domain name + HTTPS (Let's Encrypt via Traefik or Nginx)
□ Daily PostgreSQL backup script (cron → dump → S3 or local)
□ Enable GitHub Actions CI/CD → auto-deploy on push to main (optional)

Priority: only do this if you plan to use it daily before Phase 2.
Otherwise: run locally and come back to this after Phase 2.
```

---

## 5. 📊 Phase 1 Self-Assessment (fill after 2–4 weeks of real use)

```
After using Phase 1 in real trading for a few weeks:

□ Is the Goals widget actually useful in the dashboard? (too complex? too simple?)
□ Does the Market Analysis module change how you trade? (or is it ignored?)
□ Is the Staleness banner annoying or useful?
□ Which analysis questions feel vague or hard to answer?
   → Mark them for refinement in Phase 2
□ Is the trade form fast enough? Any friction points?
□ Are the partial close + BE logic flows intuitive?
□ Any instruments missing from the catalog?
□ Is the structured post-trade note useful? Which questions feel unnecessary?

→ Write down notes in: docs/phases/phase1/USER_FEEDBACK.md
```

---

## 6. 🔭 What comes next — Phase 2 preview

```
Phase 2 priorities (based on current plan):

1. Volatility module
   → Integrate volatility calculation (from CryptoRiskSuite)
   → Volatility-adjusted goals: if VI = high_risk → goal × 0.7
   → Volatility badge on dashboard

2. Market Analysis — Deferred modules
   → Forex (DXY, yield differential, pair trend, session bias)
   → Indices (VIX, yields, DXY, breadth, HYG)
   → Universal Overlay (risk-on/risk-off macro score)
   → Requires dedicated deep research session per module

3. Performance analytics
   → Equity curve (proper historical)
   → Win rate by session / strategy / style / instrument
   → Expectancy, drawdown analysis
   → Heatmap by day/hour

4. Goal progress background job
   → Replace on-load computation with a lightweight scheduler
   → Midnight snapshot → goal_progress_log populated automatically

5. Minor Phase 1 improvements (from self-assessment feedback)
```

---

**Previous:** ← `implement-phase1.md`  
**Next:** → Start Phase 2 planning session
