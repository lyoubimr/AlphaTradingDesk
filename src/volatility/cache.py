"""
Phase 2 — Redis cache helpers for live VI scores (P2-5).

Keys
----
  atd:market_vi:{timeframe}          → latest Market VI snapshot (JSON)
  atd:pair_vi:{symbol}:{timeframe}   → latest per-pair VI snapshot (JSON)

TTLs are set slightly longer than the task interval so a UI read just
before the next compute cycle still gets a fresh-enough value.

All functions fail silently — a Redis outage must never break a task.
"""

from __future__ import annotations

import json
import logging

import redis as redis_lib

from src.core.config import settings

logger = logging.getLogger(__name__)

# TTL per ATD timeframe string (seconds)
_TTL_MAP: dict[str, int] = {
    "15m":  960,    # 16 min
    "1h":   3900,   # 65 min
    "4h":   15300,  # 255 min
    "1d":   87300,  # 24 h 15 min
    "1w":   612000, # 7 d + 30 min
}
_DEFAULT_TTL = 1800  # 30 min — fallback for unknown timeframes


def _get_redis() -> redis_lib.Redis:  # type: ignore[type-arg]
    return redis_lib.from_url(str(settings.redis_url), decode_responses=True)


# ── Market VI ─────────────────────────────────────────────────────────────────

def cache_market_vi(
    timeframe: str,
    vi_score: float,
    regime: str,
    timestamp: str,
    components: dict | None = None,
) -> None:
    """Write the latest Market VI snapshot to Redis."""
    try:
        r = _get_redis()
        key = f"atd:market_vi:{timeframe}"
        payload = json.dumps(
            {
                "vi_score": vi_score,
                "regime": regime,
                "timestamp": timestamp,
                "components": components or {},
            }
        )
        r.setex(key, _TTL_MAP.get(timeframe, _DEFAULT_TTL), payload)
    except Exception:
        logger.warning("cache_market_vi(%s): Redis write failed — non-critical", timeframe)


def get_cached_market_vi(timeframe: str) -> dict | None:
    """Return the cached Market VI snapshot, or None on miss / error."""
    try:
        r = _get_redis()
        raw = r.get(f"atd:market_vi:{timeframe}")
        return json.loads(raw) if raw is not None else None
    except Exception:
        logger.warning("get_cached_market_vi(%s): Redis read failed", timeframe)
        return None


# ── Per-pair VI ───────────────────────────────────────────────────────────────

def cache_pair_vi(
    symbol: str,
    timeframe: str,
    vi_score: float,
    regime: str,
    components: dict,
    timestamp: str,
) -> None:
    """Write the latest per-pair VI snapshot to Redis."""
    try:
        r = _get_redis()
        key = f"atd:pair_vi:{symbol}:{timeframe}"
        payload = json.dumps(
            {
                "symbol": symbol,
                "vi_score": vi_score,
                "regime": regime,
                "components": components,
                "timestamp": timestamp,
            }
        )
        r.setex(key, _TTL_MAP.get(timeframe, _DEFAULT_TTL), payload)
    except Exception:
        logger.warning(
            "cache_pair_vi(%s %s): Redis write failed — non-critical", symbol, timeframe
        )


def get_cached_pair_vi(symbol: str, timeframe: str) -> dict | None:
    """Return the cached per-pair VI snapshot, or None on miss / error."""
    try:
        r = _get_redis()
        raw = r.get(f"atd:pair_vi:{symbol}:{timeframe}")
        return json.loads(raw) if raw is not None else None
    except Exception:
        logger.warning(
            "get_cached_pair_vi(%s %s): Redis read failed", symbol, timeframe
        )
        return None
