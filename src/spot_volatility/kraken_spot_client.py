"""
Phase 7 — KrakenSpotClient.

Data source: Kraken Spot public REST API (api.kraken.com).
Used by: compute_spot_watchlist service to fetch OHLCV for Spot pairs.

Endpoints used
--------------
  GET /0/public/OHLC     → OHLCV candles (interval in minutes)
  GET /0/public/Ticker   → 24h ticker (one or many pairs)

Authentication
--------------
  None — all endpoints used here are public (no API key required).

Rate limits (Kraken Spot — public endpoints)
-------------------------------------------
  REST:  ~15 requests / 45 seconds (public tier)
  OHLC:  safe to call ~10/s for a few dozen pairs without issues.

Timeframe mapping (Spot)
------------------------
  ATD "4h" → interval 240   (minutes)
  ATD "1d" → interval 1440
  ATD "1w" → interval 10080

Note: Kraken OHLC result is keyed by the *canonical* pair name (e.g. XXBTZUSD
for XBTUSD, XETHZUSD for ETHUSD). Newer pairs match the input (SOLUSD, etc.).
This client reads the *first* key in the result map to handle both conventions.

OHLC row format: [time, open, high, low, close, vwap, volume, count]
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.kraken.com"

# ATD timeframe string → Kraken OHLC interval (minutes)
_TF_MAP: dict[str, int] = {
    "4h":  240,
    "1d":  1440,
    "1w":  10080,
}

# OHLC row column indices
_K_TIME   = 0
_K_OPEN   = 1
_K_HIGH   = 2
_K_LOW    = 3
_K_CLOSE  = 4
_K_VOLUME = 6  # index 5 = vwap, 6 = volume (native units), 7 = count


class KrakenSpotClient:
    """Synchronous Kraken Spot public REST client.

    Usage:
        with KrakenSpotClient() as client:
            candles = client.fetch_ohlcv("XBTUSD", "4h", limit=500)
            tickers = client.fetch_all_tickers(["XBTUSD", "ETHUSD"])
    """

    def __init__(self, timeout: float = 15.0, base_url: str = _BASE_URL) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    def __enter__(self) -> KrakenSpotClient:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        self._client.close()

    def _get(self, path: str, params: dict | None = None) -> Any:
        """Execute GET, raise on HTTP error, return parsed JSON."""
        response = self._client.get(path, params=params)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def _to_interval(timeframe: str) -> int:
        """Convert ATD timeframe string to Kraken Spot interval (minutes)."""
        interval = _TF_MAP.get(timeframe)
        if interval is None:
            raise ValueError(
                f"Unsupported timeframe '{timeframe}'. "
                f"Supported: {list(_TF_MAP.keys())}"
            )
        return interval

    def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 220,
    ) -> list[dict]:
        """Fetch closed OHLCV candles from Kraken Spot.

        Kraken returns up to 720 candles at a time (oldest → newest).
        We slice to the last `limit` candles.

        Returns:
            List of dicts ordered oldest → newest:
            [{"t": <ms open time>, "o": float, "h": float,
              "l": float, "c": float, "v": float}]
        """
        interval = self._to_interval(timeframe)
        raw = self._get(
            "/0/public/OHLC",
            params={"pair": symbol, "interval": interval},
        )
        # We may get Kraken API errors in the response body
        errors = raw.get("error", [])
        if errors:
            raise ValueError(f"Kraken OHLC error for {symbol}: {errors}")

        result: dict = raw.get("result", {})
        # Remove the 'last' key (timestamp of last closed candle) — not a candle row
        candle_key = next((k for k in result if k != "last"), None)
        if candle_key is None:
            return []

        rows: list[list] = result[candle_key]
        candles = [
            {
                "t": int(row[_K_TIME]) * 1000,  # seconds → ms
                "o": float(row[_K_OPEN]),
                "h": float(row[_K_HIGH]),
                "l": float(row[_K_LOW]),
                "c": float(row[_K_CLOSE]),
                "v": float(row[_K_VOLUME]),
            }
            for row in rows
        ]
        return candles[-limit:]

    def fetch_all_tickers(self, symbols: list[str]) -> dict[str, dict]:
        """Fetch 24h rolling ticker for a list of Spot symbols.

        Sends one request with comma-separated pairs for efficiency.

        Returns:
            {original_symbol: {"last": float, "change_pct_24h": float, ...}}
            Keyed by input symbol (not Kraken canonical name).
        """
        if not symbols:
            return {}

        # Kraken Ticker accepts comma-separated pairs
        raw = self._get(
            "/0/public/Ticker",
            params={"pair": ",".join(symbols)},
        )
        errors = raw.get("error", [])
        if errors:
            logger.warning("Kraken Spot Ticker errors: %s", errors)

        result: dict = raw.get("result", {})

        # Build a lookup from canonical name → (last, change_pct_24h)
        canonical_data: dict[str, dict] = {}
        for canon_key, ticker in result.items():
            try:
                last = float(ticker["c"][0])   # c = last trade price info [price, lot]
                open_price = float(ticker["o"]) # o = today's opening price
                change_pct = ((last - open_price) / open_price * 100) if open_price else 0.0
                bid = float(ticker["b"][0]) if "b" in ticker else last
                ask = float(ticker["a"][0]) if "a" in ticker else last
                canonical_data[canon_key] = {
                    "last": last,
                    "bid": bid,
                    "ask": ask,
                    "change_pct_24h": round(change_pct, 4),
                }
            except (KeyError, IndexError, ValueError) as exc:
                logger.debug("Kraken Spot ticker parse error for %s: %s", canon_key, exc)

        # Map input symbols → data using fuzzy matching on canonical names
        # E.g. input "XBTUSD" may match canonical "XXBTZUSD", "XBTUSD"
        output: dict[str, dict] = {}
        for sym in symbols:
            # Direct match first
            if sym in canonical_data:
                output[sym] = canonical_data[sym]
                continue
            # Fuzzy: find canonical key that contains the base part of the pair
            sym_upper = sym.upper()
            for canon_key, cdata in canonical_data.items():
                canon_upper = canon_key.upper()
                # Strip X/Z prefixes Kraken adds: XXBTZUSD → XBTUSD
                stripped = canon_upper.lstrip("X").replace("ZUSD", "USD").replace("ZEUR", "EUR")
                if stripped == sym_upper or canon_upper == sym_upper:
                    output[sym] = cdata
                    break
        return output
