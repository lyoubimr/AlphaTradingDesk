"""
Pydantic schemas for Volatility Engine endpoints (P2-9).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel


class MarketVIOut(BaseModel):
    """Response for GET /api/volatility/market/{timeframe}."""

    timeframe: str
    vi_score: float
    regime: str
    timestamp: str  # ISO-8601


class PairVIOut(BaseModel):
    """Single pair entry for GET /api/volatility/pairs/{timeframe}."""

    pair: str
    timeframe: str
    vi_score: float
    regime: str
    components: dict
    timestamp: str  # ISO-8601


class PairsVIOut(BaseModel):
    """Response for GET /api/volatility/pairs/{timeframe}."""

    timeframe: str
    pairs: list[PairVIOut]
    count: int


class WatchlistPairOut(BaseModel):
    """Single pair row in a watchlist snapshot."""

    pair: str
    vi_score: float
    regime: str
    alert: str | None
    change_24h: float | None
    ema_score: float
    ema_signal: str
    tf_sup_regime: str | None
    tf_sup_vi: float | None


class WatchlistOut(BaseModel):
    """Response for GET /api/volatility/watchlist/{timeframe}."""

    timeframe: str
    regime: str
    pairs_count: int
    pairs: list[WatchlistPairOut]
    generated_at: datetime
