"""
Phase 2 — Live Prices backend proxy (P2-12).

Fetches real-time prices for display on the dashboard:
  - BTC/USD + ETH/USD  →  Kraken public spot ticker (no API key)
  - XAU/USD            →  metals.live (free, no key) — or Twelve Data if XAU_API_KEY is set

All results are cached in Redis for 30 seconds to avoid hammering external APIs.
Failures are silent — missing prices are returned as None.

Redis key
---------
  atd:live_prices   →  JSON {btc, eth, xau, currency, currency_symbol, timestamp}  TTL 30s
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Any

import httpx
import redis as redis_lib

from src.core.config import settings

logger = logging.getLogger(__name__)

_KRAKEN_SPOT_URL = "https://api.kraken.com/0/public/Ticker"
_METALS_LIVE_URL = "https://metals.live/api/latest"   # free, no API key
_TWELVE_DATA_URL = "https://api.twelvedata.com/price"  # optional, requires XAU_API_KEY
_CACHE_KEY = "atd:live_prices"
_CACHE_TTL = 30  # seconds


def _get_redis() -> redis_lib.Redis:  # type: ignore[type-arg]
    return redis_lib.from_url(str(settings.redis_url), decode_responses=True)


def _fetch_btc_eth() -> dict[str, float | None]:
    """Fetch BTC/USD and ETH/USD last price from Kraken public spot ticker."""
    try:
        resp = httpx.get(
            _KRAKEN_SPOT_URL,
            params={"pair": "XBTUSD,ETHUSD"},
            timeout=5.0,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("error"):
            logger.warning("prices: Kraken error — %s", data["error"])
            return {"btc": None, "eth": None}
        result = data.get("result", {})
        # Kraken internal keys: XXBTZUSD, XETHZUSD
        btc_entry = result.get("XXBTZUSD") or result.get("XBTUSD")
        eth_entry = result.get("XETHZUSD") or result.get("ETHUSD")
        btc = float(btc_entry["c"][0]) if btc_entry else None
        eth = float(eth_entry["c"][0]) if eth_entry else None
        return {"btc": btc, "eth": eth}
    except Exception as exc:
        logger.warning("prices: Kraken fetch failed — %s", exc)
        return {"btc": None, "eth": None}


def _fetch_xau() -> float | None:
    """
    Fetch XAU/USD price.

    Strategy (in order):
      1. Twelve Data — if XAU_API_KEY is set (more reliable, real-time)
      2. metals.live  — free, no key required, fallback / default
    """
    # ── Twelve Data (if key configured) ──────────────────────────────────────
    if settings.xau_api_key:
        try:
            resp = httpx.get(
                _TWELVE_DATA_URL,
                params={"symbol": "XAU/USD", "apikey": settings.xau_api_key},
                timeout=5.0,
            )
            resp.raise_for_status()
            data = resp.json()
            price = data.get("price")
            if price is not None:
                return float(price)
            logger.warning("prices: Twelve Data returned no price — %s", data)
        except Exception as exc:
            logger.warning("prices: Twelve Data failed, falling back to metals.live — %s", exc)

    # ── metals.live (free, no key) ────────────────────────────────────────────
    try:
        resp = httpx.get(_METALS_LIVE_URL, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        # Response is a list of dicts: [{"gold": 2945.8, "silver": 33.1, ...}]
        if isinstance(data, list) and data:
            gold = data[0].get("gold")
        else:
            gold = data.get("gold")  # type: ignore[union-attr]
        if gold is not None:
            return float(gold)
        logger.warning("prices: metals.live returned no gold price — %s", data)
    except Exception as exc:
        logger.warning("prices: metals.live fetch failed — %s", exc)

    return None


def get_live_prices() -> dict[str, Any]:
    """
    Return live prices for BTC, ETH, and XAU.

    Checks Redis cache first (TTL 30s). On miss, fetches from external APIs,
    writes to cache, and returns the result.

    Return shape:
        {
            "btc": float | None,
            "eth": float | None,
            "xau": float | None,
            "timestamp": str (ISO 8601 UTC),
            "cached": bool,
        }
    """
    # ── Cache check ───────────────────────────────────────────────────────────
    try:
        r = _get_redis()
        raw = r.get(_CACHE_KEY)
        if raw is not None:
            cached = json.loads(raw)
            cached["cached"] = True
            return cached
    except Exception as exc:
        logger.warning("prices: Redis read failed — %s", exc)

    # ── Fetch ─────────────────────────────────────────────────────────────────
    crypto = _fetch_btc_eth()
    xau = _fetch_xau()

    payload: dict[str, Any] = {
        "btc": crypto["btc"],
        "eth": crypto["eth"],
        "xau": xau,
        "currency": "USD",
        "currency_symbol": "$",
        "timestamp": datetime.now(UTC).isoformat(),
        "cached": False,
    }

    # ── Cache write ───────────────────────────────────────────────────────────
    try:
        r = _get_redis()
        # Store without the "cached" key so we can add it on read
        to_store = {k: v for k, v in payload.items() if k != "cached"}
        r.setex(_CACHE_KEY, _CACHE_TTL, json.dumps(to_store))
    except Exception as exc:
        logger.warning("prices: Redis write failed — %s", exc)

    return payload
