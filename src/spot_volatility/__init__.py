"""Phase 7 — Spot Volatility Engine.

Computes VI scores for Kraken Spot pairs (4h / 1d / 1w).
On-demand compute (no Celery schedule) — triggered from the UI via POST /api/spot-volatility/run.

Data source: Kraken Spot public REST API (api.kraken.com/0/public).
Algorithm:   Reuses src.volatility.indicators (ATR + HV + RVOL + BB → score 0–1).
Storage:     spot_watchlist_snapshots (global — not per-profile).
Settings:    spot_volatility_settings (key='global', JSONB config).
"""
