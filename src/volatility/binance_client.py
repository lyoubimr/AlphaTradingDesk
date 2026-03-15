"""
Phase 2 — BinanceClient (P2-4).

Data source: Binance Futures public REST API (fapi.binance.com).
Used by: compute_market_vi task to fetch OHLCV for the ~50 selected pairs.

Endpoints used
--------------
  GET /fapi/v1/klines           → OHLCV candles
  GET /fapi/v1/ticker/24hr      → 24h ticker (single or all)
  GET /fapi/v1/depth            → L2 order book
  GET /fapi/v1/exchangeInfo     → all symbols metadata (for sync_instruments)

Authentication
--------------
  None — all endpoints used here are public (no API key required).

Rate limits (as of 2024)
------------------------
  IP weight: 2400 / minute
  klines:              weight 5 per request
  ticker/24hr (all):   weight 40 per request
  depth (limit≤20):    weight 2 per request
  exchangeInfo:        weight 40 per request

  BinanceClient stays well within limits for Phase 2 usage
  (5 TF × 50 pairs every 15 min ≈ 1000 klines calls / 15 min = ~67/min).

Timeframe mapping
-----------------
  ATD "15m" → Binance "15m"  (1:1 for standard intervals)
  Supported: 1m 3m 5m 15m 30m 1h 2h 4h 6h 8h 12h 1d 3d 1w 1M
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_BASE_URL = "https://fapi.binance.com"

# Binance klines column indices
_K_OPEN_TIME = 0
_K_OPEN = 1
_K_HIGH = 2
_K_LOW = 3
_K_CLOSE = 4
_K_VOLUME = 5


class BinanceClient:
    """Synchronous Binance Futures public REST client.

    Usage:
        client = BinanceClient()
        try:
            candles = client.fetch_ohlcv("BTCUSDT", "15m", limit=100)
        finally:
            client.close()

    Or as a context manager:
        with BinanceClient() as client:
            candles = client.fetch_ohlcv("BTCUSDT", "15m")
    """

    def __init__(self, timeout: float = 10.0, base_url: str = _BASE_URL) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    # ── Context manager ───────────────────────────────────────────────────────

    def __enter__(self) -> BinanceClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    # ── Private helpers ───────────────────────────────────────────────────────

    def _get(self, path: str, params: dict | None = None) -> Any:
        """Execute GET, raise on HTTP error, return parsed JSON."""
        response = self._client.get(path, params=params)
        response.raise_for_status()
        return response.json()

    # ── Public interface (MarketDataClient) ───────────────────────────────────

    def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 100,
    ) -> list[dict]:
        """Fetch closed OHLCV candles from Binance Futures.

        Returns:
            List of dicts ordered oldest → newest:
            [{"t": <ms open time>, "o": float, "h": float,
              "l": float, "c": float, "v": float}]
        """
        raw: list[list] = self._get(
            "/fapi/v1/klines",
            params={"symbol": symbol, "interval": timeframe, "limit": limit},
        )
        return [
            {
                "t": int(row[_K_OPEN_TIME]),
                "o": float(row[_K_OPEN]),
                "h": float(row[_K_HIGH]),
                "l": float(row[_K_LOW]),
                "c": float(row[_K_CLOSE]),
                "v": float(row[_K_VOLUME]),
            }
            for row in raw
        ]

    def fetch_ticker(self, symbol: str) -> dict:
        """Fetch 24h rolling ticker for one symbol.

        Returns:
            {"symbol": str, "last": float, "bid": float, "ask": float,
             "change_pct_24h": float, "quote_volume_24h": float}
        """
        raw = self._get("/fapi/v1/ticker/24hr", params={"symbol": symbol})
        return {
            "symbol": raw["symbol"],
            "last": float(raw["lastPrice"]),
            "bid": float(raw["bidPrice"]),
            "ask": float(raw["askPrice"]),
            "change_pct_24h": float(raw["priceChangePercent"]),
            "quote_volume_24h": float(raw["quoteVolume"]),
        }

    def fetch_all_tickers(self) -> list[dict]:
        """Fetch 24h tickers for all Binance Futures symbols (weight: 40).

        Used by sync_instruments (P2-10) — one call to get volumes for all pairs.

        Returns:
            List of ticker dicts (same schema as fetch_ticker).
        """
        raw_list: list[dict] = self._get("/fapi/v1/ticker/24hr")
        return [
            {
                "symbol": r["symbol"],
                "last": float(r["lastPrice"]),
                "bid": float(r["bidPrice"]),
                "ask": float(r["askPrice"]),
                "change_pct_24h": float(r["priceChangePercent"]),
                "quote_volume_24h": float(r["quoteVolume"]),
            }
            for r in raw_list
        ]

    def fetch_orderbook(self, symbol: str, depth: int = 20) -> dict:
        """Fetch L2 order book for one symbol.

        Returns:
            {"bids": [[price, qty], ...], "asks": [[price, qty], ...]}
        """
        raw = self._get("/fapi/v1/depth", params={"symbol": symbol, "limit": depth})
        return {
            "bids": [[float(p), float(q)] for p, q in raw["bids"]],
            "asks": [[float(p), float(q)] for p, q in raw["asks"]],
        }

    def fetch_all_symbols(self) -> list[dict]:
        """Fetch all USDT-margined Futures symbols from exchangeInfo (weight: 40).

        Filters to TRADING status only. Used by sync_instruments (P2-10).

        Returns:
            [{"symbol": str, "base": str, "quote": str,
              "is_active": bool, "quote_volume_24h": float}]
        """
        info = self._get("/fapi/v1/exchangeInfo")
        symbols = {
            s["symbol"]: s
            for s in info["symbols"]
            if s["status"] == "TRADING"
        }

        # Enrich with 24h volumes in a single call
        volumes: dict[str, float] = {}
        try:
            tickers = self.fetch_all_tickers()
            volumes = {t["symbol"]: t["quote_volume_24h"] for t in tickers}
        except Exception:
            logger.warning("BinanceClient.fetch_all_symbols: volume fetch failed, defaulting to 0")

        return [
            {
                "symbol": sym,
                "base": meta["baseAsset"],
                "quote": meta["quoteAsset"],
                "is_active": True,
                "quote_volume_24h": volumes.get(sym, 0.0),
            }
            for sym, meta in symbols.items()
        ]
