"""
Phase 3 — Risk Management service layer.

P3-3: Live Pair VI — cache-first fetch from Kraken.
Further functions (P3-4 Settings, P3-5 Budget, P3-6 Advisor) added in later steps.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.volatility.cache import cache_pair_vi, get_cached_pair_vi
from src.volatility.indicators import compute_vi_score
from src.volatility.kraken_client import KrakenClient
from src.volatility.schedule import get_regime_thresholds, score_to_regime

logger = logging.getLogger(__name__)

# 200-EMA convergence coverage — mirrors compute_pair_vi task.
_OHLCV_LIMIT = 220


# ── P3-3: Live Pair VI ────────────────────────────────────────────────────────

def get_live_pair_vi(symbol: str, timeframe: str, db: Session) -> dict:
    """Return VI data for a Kraken pair, using Redis cache or a live fetch.

    Strategy:
    1. Check Redis cache (key: atd:pair_vi:{symbol}:{timeframe}).
       If present → return with source="cache".
    2. Fetch live from Kraken Futures, compute VI, cache result, return source="live".

    Raises HTTPException(503) if Kraken is unreachable and the cache is cold.
    """
    # ── 1. Cache hit ──────────────────────────────────────────────────────────
    cached = get_cached_pair_vi(symbol, timeframe)
    if cached is not None:
        return _format_pair_vi(symbol, timeframe, cached, source="cache")

    # ── 2. Live fetch ─────────────────────────────────────────────────────────
    try:
        with KrakenClient() as client:
            candles = client.fetch_ohlcv(symbol, timeframe, limit=_OHLCV_LIMIT)
    except (httpx.HTTPError, httpx.TimeoutException, ValueError) as exc:
        logger.warning(
            "get_live_pair_vi(%s %s): Kraken fetch failed — %s", symbol, timeframe, exc
        )
        raise HTTPException(
            status_code=503,
            detail=f"Kraken data unavailable for {symbol}/{timeframe}: {exc}",
        ) from exc

    vi_result = compute_vi_score(candles)
    thresholds = get_regime_thresholds(db, profile_id=None)
    regime = score_to_regime(vi_result["vi_score"], thresholds)
    now_iso = datetime.now(UTC).isoformat()

    # Strip vi_score from components dict before caching.
    components = {k: v for k, v in vi_result.items() if k != "vi_score"}

    cache_pair_vi(
        symbol, timeframe,
        vi_result["vi_score"], regime,
        components, now_iso,
    )

    payload = {
        "symbol": symbol,
        "vi_score": vi_result["vi_score"],
        "regime": regime,
        "components": components,
        "timestamp": now_iso,
    }
    return _format_pair_vi(symbol, timeframe, payload, source="live")


# ── Internal helpers ──────────────────────────────────────────────────────────

def _format_pair_vi(symbol: str, timeframe: str, data: dict, source: str) -> dict:
    """Normalise a cache or live dict into the PairVIOut shape."""
    components = data.get("components", {})
    return {
        "pair": symbol,
        "timeframe": timeframe,
        "vi_score": float(data.get("vi_score", 0.0)),
        "regime": data.get("regime", "UNKNOWN"),
        "ema_score": components.get("ema_score"),
        "ema_signal": components.get("ema_signal"),
        "source": source,
        "computed_at": data.get("timestamp", ""),
    }
