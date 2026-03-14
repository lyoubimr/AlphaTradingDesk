"""
Phase 2 — KrakenClient (P2-4).

Data source: Kraken Futures public REST API (futures.kraken.com).
Used by: compute_pair_vi task to fetch OHLCV + order book for Kraken instruments.

Endpoints used
--------------
  GET /api/charts/v1/{tick_type}/{symbol}/{resolution}
                                    → OHLCV candles
  GET /derivatives/api/v3/tickers   → all tickers (24h stats)
  GET /derivatives/api/v3/orderbook?symbol=<sym>
                                    → L2 order book
  GET /derivatives/api/v3/instruments
                                    → all instruments metadata

Authentication
--------------
  None — all endpoints used here are public (no API key required).

Rate limits
-----------
  Kraken Futures does not publish a hard request-per-minute limit for public
  endpoints. In practice, ~10 req/s is safe. Phase 2 usage is well below that.

Timeframe mapping
-----------------
  ATD "15m" → Kraken resolution "15"  (minutes as string)
  ATD "1h"  → Kraken resolution "60"
  ATD "4h"  → Kraken resolution "240"
  ATD "1d"  → Kraken resolution "1440"
  ATD "1w"  → Kraken resolution "10080"

Symbol conventions
------------------
  Kraken Futures perpetuals: "PI_XBTUSD", "PI_ETHUSD", "PF_SOLUSD" …
  "PI_" prefix = inverse perpetual (BTC/ETH legacy)
  "PF_" prefix = linear perpetual (altcoins)
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_BASE_URL = "https://futures.kraken.com"

# ATD timeframe string → Kraken resolution (minutes as string)
_TF_MAP: dict[str, str] = {
    "1m": "1",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "4h": "240",
    "1d": "1440",
    "1w": "10080",
}

# Kraken chart tick type — "trade" gives OHLCV based on executed trades
_TICK_TYPE = "trade"


class KrakenClient:
    """Synchronous Kraken Futures public REST client.

    Usage:
        client = KrakenClient()
        try:
            candles = client.fetch_ohlcv("PI_XBTUSD", "15m", limit=100)
        finally:
            client.close()

    Or as a context manager:
        with KrakenClient() as client:
            candles = client.fetch_ohlcv("PI_XBTUSD", "15m")
    """

    def __init__(self, timeout: float = 10.0, base_url: str = _BASE_URL) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    # ── Context manager ───────────────────────────────────────────────────────

    def __enter__(self) -> "KrakenClient":
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

    @staticmethod
    def _to_resolution(timeframe: str) -> str:
        """Convert ATD timeframe string to Kraken resolution string."""
        resolution = _TF_MAP.get(timeframe)
        if resolution is None:
            raise ValueError(
                f"Unsupported timeframe '{timeframe}'. "
                f"Supported: {list(_TF_MAP.keys())}"
            )
        return resolution

    # ── Public interface (MarketDataClient) ───────────────────────────────────

    def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 100,
    ) -> list[dict]:
        """Fetch closed OHLCV candles from Kraken Futures charts API.

        Kraken returns candles oldest → newest. We slice to the last `limit`.

        Returns:
            List of dicts ordered oldest → newest:
            [{"t": <ms open time>, "o": float, "h": float,
              "l": float, "c": float, "v": float}]
        """
        resolution = self._to_resolution(timeframe)
        raw = self._get(
            f"/api/charts/v1/{_TICK_TYPE}/{symbol}/{resolution}",
            params={"count": limit},
        )
        # Kraken response: {"candles": [{"time": int(s), "open": str, ...}]}
        candles: list[dict] = raw.get("candles", [])
        return [
            {
                "t": int(c["time"]) * 1000,  # seconds → ms
                "o": float(c["open"]),
                "h": float(c["high"]),
                "l": float(c["low"]),
                "c": float(c["close"]),
                "v": float(c["volume"]),
            }
            for c in candles[-limit:]
        ]

    def fetch_ticker(self, symbol: str) -> dict:
        """Fetch 24h rolling ticker for one symbol.

        Returns:
            {"symbol": str, "last": float, "bid": float, "ask": float,
             "change_pct_24h": float, "quote_volume_24h": float}
        """
        raw = self._get("/derivatives/api/v3/tickers")
        tickers: list[dict] = raw.get("tickers", [])
        for t in tickers:
            if t.get("symbol") == symbol:
                last = float(t.get("last", 0) or 0)
                open24h = float(t.get("open24h", last) or last)
                change_pct = ((last - open24h) / open24h * 100) if open24h else 0.0
                return {
                    "symbol": symbol,
                    "last": last,
                    "bid": float(t.get("bid", 0) or 0),
                    "ask": float(t.get("ask", 0) or 0),
                    "change_pct_24h": round(change_pct, 4),
                    "quote_volume_24h": float(t.get("volumeQuote", 0) or 0),
                }
        raise ValueError(f"KrakenClient.fetch_ticker: symbol '{symbol}' not found")

    def fetch_all_tickers(self) -> list[dict]:
        """Fetch 24h tickers for all Kraken Futures symbols.

        Used by sync_instruments (P2-10) — one call for all volumes.

        Returns:
            List of ticker dicts (same schema as fetch_ticker).
        """
        raw = self._get("/derivatives/api/v3/tickers")
        result = []
        for t in raw.get("tickers", []):
            last = float(t.get("last", 0) or 0)
            open24h = float(t.get("open24h", last) or last)
            change_pct = ((last - open24h) / open24h * 100) if open24h else 0.0
            result.append(
                {
                    "symbol": t["symbol"],
                    "last": last,
                    "bid": float(t.get("bid", 0) or 0),
                    "ask": float(t.get("ask", 0) or 0),
                    "change_pct_24h": round(change_pct, 4),
                    "quote_volume_24h": float(t.get("volumeQuote", 0) or 0),
                }
            )
        return result

    def fetch_orderbook(self, symbol: str, depth: int = 20) -> dict:
        """Fetch L2 order book for one symbol.

        Returns:
            {"bids": [[price, qty], ...], "asks": [[price, qty], ...]}
        """
        raw = self._get(
            "/derivatives/api/v3/orderbook",
            params={"symbol": symbol},
        )
        book = raw.get("orderBook", raw)
        bids = [[float(entry["price"]), float(entry["qty"])] for entry in book.get("bids", [])[:depth]]
        asks = [[float(entry["price"]), float(entry["qty"])] for entry in book.get("asks", [])[:depth]]
        return {"bids": bids, "asks": asks}

    def fetch_all_symbols(self) -> list[dict]:
        """Fetch all Kraken Futures instruments.

        Filters to active perpetuals (tradeable=True, type contains "perpetual").
        Used by sync_instruments (P2-10).

        Returns:
            [{"symbol": str, "base": str, "quote": str,
              "is_active": bool, "quote_volume_24h": float}]
        """
        info = self._get("/derivatives/api/v3/instruments")
        instruments: list[dict] = info.get("instruments", [])

        # Get volumes for all symbols in one call
        volumes: dict[str, float] = {}
        try:
            tickers = self.fetch_all_tickers()
            volumes = {t["symbol"]: t["quote_volume_24h"] for t in tickers}
        except Exception:
            logger.warning("KrakenClient.fetch_all_symbols: volume fetch failed, defaulting to 0")

        result = []
        for inst in instruments:
            symbol = inst.get("symbol", "")
            is_active = inst.get("tradeable", False)
            inst_type: str = inst.get("type", "")
            if "perpetual" not in inst_type.lower():
                continue
            result.append(
                {
                    "symbol": symbol,
                    "base": inst.get("underlying", symbol),
                    "quote": inst.get("quoteCurrency", "USD"),
                    "is_active": bool(is_active),
                    "quote_volume_24h": volumes.get(symbol, 0.0),
                }
            )
        return result
