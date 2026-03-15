"""
Phase 2 — MarketDataClient Protocol (P2-4).

Defines the shared interface that BinanceClient and KrakenClient both implement.
Tasks import only this Protocol — they never depend on a concrete client directly.
That keeps tests injectable and Phase 3+ clients swappable without touching tasks.

Data types
----------
OHLCV row:   {"t": int (ms epoch), "o": float, "h": float, "l": float,
              "c": float, "v": float}
Ticker:      {"symbol": str, "last": float, "bid": float, "ask": float,
              "change_pct_24h": float, "quote_volume_24h": float}
OrderBook:   {"bids": [[price, qty], ...], "asks": [[price, qty], ...]}
Symbol info: {"symbol": str, "base": str, "quote": str, "is_active": bool,
              "quote_volume_24h": float}
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class MarketDataClient(Protocol):
    """Interface every market-data client must satisfy.

    All methods are synchronous — Celery tasks run in a thread pool,
    not an async event loop. httpx.Client (not AsyncClient) is used.
    """

    def fetch_ohlcv(
        self,
        symbol: str,
        timeframe: str,
        limit: int = 100,
    ) -> list[dict]:
        """Return the last `limit` closed OHLCV candles for `symbol`.

        Args:
            symbol:    Exchange-native symbol string (e.g. "BTCUSDT", "PI_XBTUSD").
            timeframe: Candle interval (e.g. "15m", "1h", "4h", "1d", "1w").
            limit:     Number of candles to fetch (max varies by exchange).

        Returns:
            List of OHLCV dicts ordered oldest → newest:
            [{"t": <ms>, "o": float, "h": float, "l": float, "c": float, "v": float}]
        """
        ...

    def fetch_ticker(self, symbol: str) -> dict:
        """Return current ticker snapshot for one symbol.

        Returns:
            {"symbol": str, "last": float, "bid": float, "ask": float,
             "change_pct_24h": float, "quote_volume_24h": float}
        """
        ...

    def fetch_orderbook(self, symbol: str, depth: int = 20) -> dict:
        """Return current L2 order book for one symbol.

        Args:
            depth: Number of bid/ask levels to return.

        Returns:
            {"bids": [[price, qty], ...], "asks": [[price, qty], ...]}
        """
        ...

    def fetch_all_symbols(self) -> list[dict]:
        """Return all tradeable symbols on this exchange.

        Used by sync_instruments task (P2-10) to upsert the instruments table.

        Returns:
            [{"symbol": str, "base": str, "quote": str,
              "is_active": bool, "quote_volume_24h": float}]
        """
        ...

    def close(self) -> None:
        """Release the underlying HTTP connection pool."""
        ...
