# 📐 Phase 1.5 — Post-Phase 1 Scope

**Date:** March 13, 2026  
**Version:** 0.1  
**Status:** Draft — validated for planning

> This document captures the immediate post-Phase 1 work that should be
> completed before starting full Phase 2 volatility analysis.

> Goal: improve data quality, operator autonomy, and UX reliability without
> changing the core Phase 1 business model.

---

## 🎯 Phase 1.5 Objectives

```
1. Instrument Catalog Expansion
2. Manual Instrument Creation in Trade Flow
3. Strategy & Trade Image Reliability + Capture UX
4. Market Analysis Generic Builder
```

Phase 1.5 is a **stabilization + autonomy phase**:

- Improve broker instrument coverage, especially Kraken
- Remove friction when an instrument is missing
- Make market analysis configuration editable from the UI
- Fix image upload/display reliability before adding richer capture flows

---

## 1. Instrument Catalog Expansion

### Scope

- Expand Kraken instrument seeds to cover most tradable pairs relevant to the desk
- Expand Vantage seeds selectively:
  - Crypto majors
  - Main indices
  - Main commodities
- Keep seed maintenance scripts separate from app runtime logic
- Keep seeds idempotent and version-controlled
- Validate all additions first in dev

### Non-goals

- No live broker API dependency at app startup
- No automatic production sync during deploy
- No hidden background refresh job in Phase 1.5

### Target outcome

- New Trade instrument dropdown is complete for common usage
- Seed data remains deterministic, testable, and portable

---

## 2. Manual Instrument Creation in Trade Flow

### Scope

- Add a quick-create action directly from the New Trade instrument picker
- Allow adding a missing broker instrument without leaving the trade form
- Refresh the dropdown and auto-select the newly created instrument

### Rules

- Must use the existing broker-linked instrument model
- New instruments remain broker-specific
- Created rows must be marked as custom (`is_predefined = false`)

### Target outcome

- Missing pair no longer blocks trade journaling
- User keeps full autonomy even if seeds lag behind broker catalog changes

---

## 3. Strategy & Trade Image Reliability + Capture UX

### Scope

- Fix broken image serving/display first
- Cover both image families already present in the product:
  - strategy images
  - trade images (entry / close snapshots)
- Then improve operator workflow with:
  - direct screenshot capture
  - optional paste-from-clipboard support

### Target outcome

- Uploaded images display reliably in dev and prod
- Strategy charts and trade snapshots become faster to attach than manual file export/import

---

## 4. Market Analysis Generic Builder

### Scope

- Move beyond simple enable/disable toggles
- Allow managing market analysis content from the UI:
  - modules
  - questions / indicators
  - answer labels
  - score mapping
  - display order
  - default enabled state

### Rule

- Preserve the current scoring principle wherever possible
- Avoid rewriting the scoring engine unless schema limitations require it

### Target outcome

- Market analysis becomes data-driven and operator-editable
- New analysis flows can be created without code edits for every text change

---

## ✅ Exit Criteria for Phase 1.5

- Kraken seed coverage is significantly expanded and validated in dev
- Vantage coverage includes the most important crypto, indices, and commodities
- New Trade supports manual instrument creation inline
- Strategy and trade images are stable in prod and easy to capture/upload
- Market analysis configuration is editable from the UI beyond toggles
