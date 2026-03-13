# 📋 Phase 1.5 — Pre-Implementation Notes

**Date:** March 13, 2026  
**Version:** 0.1  
**Status:** Draft

> This document explains the implementation approach for Phase 1.5 before any
> coding work begins.

---

## Why Phase 1.5 Exists

Phase 1 shipped the end-to-end product and production deployment.

However, four practical gaps remain:

- instrument coverage is still incomplete
- missing instruments still require technical intervention
- strategy and trade image upload/display workflow is fragile
- market analysis is only partially configurable

Phase 1.5 addresses these gaps without opening the broader Phase 2 scope.

---

## Implementation Principles

### 1. Deterministic data first

Broker instruments must remain seedable and reproducible.

That means:

- broker APIs may be used for inventory research or seed generation support
- broker APIs must not become a runtime dependency of the app

### 2. UI autonomy over hardcoded config

If a trader can safely configure something from the UI, prefer that over a
seed-only or code-only workflow.

### 3. Reliability before convenience

For strategy and trade images, first make upload/display reliable everywhere.
Only then add screenshot capture shortcuts.

### 4. No accidental Phase 2 scope creep

Phase 1.5 improves existing Phase 1 features. It does not introduce:

- volatility engine work
- watchlist generation
- broker execution integration

---

## Expected Deliverables

- expanded instrument seed catalog
- broker catalog support scripts for seed preparation
- inline custom instrument creation in New Trade
- fixed strategy and trade image serving in prod
- screenshot capture workflow for strategy and trade images
- first generic market analysis builder iteration
