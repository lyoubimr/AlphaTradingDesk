"""
Phase 2 — Live Prices backend proxy (P2-12).

Fetches real-time prices for display on the dashboard:
  - BTC/USD + ETH/USD  →  Kraken public spot ticker (no API key)
  - XAU/USD            →  metals.live (free, no key) — or Twelve Data if XAU_API_KEY is set

All results are cached in Redis for 30 seconds to avoid hammering external APIs.
XAU is cached separately for 5 minutes (Twelve Data free plan = 800 credits/day).

Redis key
---------
  atd:live_prices    →  JSON {btc, eth, xau, ...}  TTL 30s
  atd:xau_live_price →  float string               TTL 300s (5 min) — limits Twelve Data calls to ~288/day
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
_CACHE_KEY       = "atd:live_prices"
_CACHE_TTL       = 30    # secondes
_XAU_PRICE_KEY   = "atd:xau_live_price"  # separate cache for XAU — long TTL to spare Twelve Data credits
_XAU_PRICE_TTL   = 300   # 5 min → max 288 calls/day (free plan limit = 800)
_XAU_OPEN_KEY    = "atd:xau_daily_open"   # TTL 24h — base quotidienne XAU
_XAU_OPEN_TTL    = 86400  # 24h


def _get_redis() -> redis_lib.Redis:  # type: ignore[type-arg]
    return redis_lib.from_url(str(settings.redis_url), decode_responses=True)


def _fetch_btc_eth() -> dict[str, float | None]:
    """Fetch BTC/USD and ETH/USD spot price + today's opening price from Kraken.

    Kraken ticker fields used:
      c[0]  -> last trade price
      o     -> today's opening price (midnight UTC) — used to compute intraday change
    """
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
            return {"btc": None, "eth": None, "btc_open": None, "eth_open": None}
        result = data.get("result", {})
        # Clés internes Kraken : XXBTZUSD, XETHZUSD
        btc_entry = result.get("XXBTZUSD") or result.get("XBTUSD")
        eth_entry = result.get("XETHZUSD") or result.get("ETHUSD")
        btc      = float(btc_entry["c"][0]) if btc_entry else None
        eth      = float(eth_entry["c"][0]) if eth_entry else None
        btc_open = float(btc_entry["o"])    if btc_entry and btc_entry.get("o") else None
        eth_open = float(eth_entry["o"])    if eth_entry and eth_entry.get("o") else None
        return {"btc": btc, "eth": eth, "btc_open": btc_open, "eth_open": eth_open}
    except Exception as exc:
        logger.warning("prices: Kraken fetch failed — %s", exc)
        return {"btc": None, "eth": None, "btc_open": None, "eth_open": None}


def _fetch_xau() -> float | None:
    """
    Fetch XAU/USD price.

    Strategy (in order):
      1. Twelve Data — if XAU_API_KEY is set (more reliable, real-time)
      2. metals.live  — free, no key required, fallback / default
    """
    # ── Twelve Data (if key configured) ──────────────────────────────────────
    if settings.xau_api_key:
        # Check XAU-specific cache first — avoids burning Twelve Data credits every 30s
        try:
            r = _get_redis()
            cached_xau = r.get(_XAU_PRICE_KEY)
            if cached_xau is not None:
                return float(cached_xau)
        except Exception:
            pass

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
                xau_price = float(price)
                # Cache for 5 min to limit Twelve Data calls to ~288/day
                try:
                    _get_redis().setex(_XAU_PRICE_KEY, _XAU_PRICE_TTL, str(xau_price))
                except Exception:
                    pass
                return xau_price
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
    xau    = _fetch_xau()

    # ── Variation BTC / ETH depuis l'ouverture du jour (midnight UTC) ─────────
    btc_change_pct: float | None = None
    eth_change_pct: float | None = None
    if crypto["btc"] and crypto.get("btc_open") and crypto["btc_open"] > 0:
        btc_change_pct = round(
            (crypto["btc"] - crypto["btc_open"]) / crypto["btc_open"] * 100, 2
        )
    if crypto["eth"] and crypto.get("eth_open") and crypto["eth_open"] > 0:
        eth_change_pct = round(
            (crypto["eth"] - crypto["eth_open"]) / crypto["eth_open"] * 100, 2
        )

    # ── Variation XAU : base quotidienne stockée dans Redis (TTL 24h) ─────────
    xau_change_pct: float | None = None
    try:
        r_xau = _get_redis()
        xau_open_raw = r_xau.get(_XAU_OPEN_KEY)
        if xau is not None:
            if xau_open_raw is not None:
                xau_open = float(xau_open_raw)
                if xau_open > 0:
                    xau_change_pct = round((xau - xau_open) / xau_open * 100, 2)
            else:
                # Premier appel du jour — prix courant devient la référence
                r_xau.setex(_XAU_OPEN_KEY, _XAU_OPEN_TTL, str(xau))
                xau_change_pct = 0.0
    except Exception as exc:
        logger.warning("prices: XAU daily open tracking failed — %s", exc)

    payload: dict[str, Any] = {
        "btc":            crypto["btc"],
        "eth":            crypto["eth"],
        "xau":            xau,
        "btc_change_pct": btc_change_pct,
        "eth_change_pct": eth_change_pct,
        "xau_change_pct": xau_change_pct,
        "currency":       "USD",
        "currency_symbol": "$",
        "timestamp":      datetime.now(UTC).isoformat(),
        "cached":         False,
    }

    # ── Cache write ───────────────────────────────────────────────────────────
    try:
        r = _get_redis()
        # On stocke sans le flag "cached" pour l'ajouter à la lecture
        to_store = {k: v for k, v in payload.items() if k != "cached"}
        r.setex(_CACHE_KEY, _CACHE_TTL, json.dumps(to_store))
    except Exception as exc:
        logger.warning("prices: Redis write failed — %s", exc)

    return payload
