"""
Volatility Engine — Celery tasks (Phase 2).

All tasks are stubs until P2-3 (task implementation skeleton)
and P2-4 (BinanceClient + KrakenClient implementation).

Beat schedule is defined in src/core/celery_app.py.
Runtime schedule filtering (horaires d'exécution) is handled by
is_within_schedule() reading volatility_settings from DB.
"""

from src.core.celery_app import celery_app


@celery_app.task(name="src.volatility.tasks.compute_market_vi", bind=True, max_retries=3)
def compute_market_vi(self, timeframe: str) -> dict:  # type: ignore[override]
    """
    Compute Market Volatility Index for all configured Binance Futures pairs.
    Data source: Binance Futures public API (fapi.binance.com).
    Populated in P2-5 (BinanceClient) + P2-6 (indicator computation).
    """
    # TODO P2-5: implement
    return {"status": "stub", "timeframe": timeframe}


@celery_app.task(name="src.volatility.tasks.compute_pair_vi", bind=True, max_retries=3)
def compute_pair_vi(self, timeframe: str) -> dict:  # type: ignore[override]
    """
    Compute Per-Pair Volatility Index for all active Kraken instruments.
    Data source: Kraken Futures public API (futures.kraken.com).
    Populated in P2-7 (KrakenClient) + P2-8 (indicator computation).
    """
    # TODO P2-7: implement
    return {"status": "stub", "timeframe": timeframe}


@celery_app.task(name="src.volatility.tasks.sync_instruments")
def sync_instruments() -> dict:
    """
    Sync instrument catalog:
      - Kraken Futures pairs → upsert instruments (is_active=false for delisted)
      - Binance Futures top-100 by 24h quoteVolume → upsert market_vi_pairs
    Populated in P2-10.
    """
    # TODO P2-10: implement
    return {"status": "stub"}


@celery_app.task(name="src.volatility.tasks.cleanup_old_snapshots")
def cleanup_old_snapshots() -> dict:
    """
    Delete volatility_snapshots and market_vi_snapshots older than retention_days
    (read from volatility_settings). TimescaleDB chunk pruning via DROP CHUNKS.
    Populated in P2-11.
    """
    # TODO P2-11: implement
    return {"status": "stub"}
