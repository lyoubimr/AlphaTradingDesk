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

    id: int | None = None  # snapshot DB id (None for legacy Redis-only responses)
    timeframe: str
    regime: str
    pairs_count: int
    pairs: list[WatchlistPairOut]
    generated_at: datetime


class WatchlistMetaOut(BaseModel):
    """Lightweight watchlist metadata (no pairs payload) — used for the history tree."""

    id: int
    timeframe: str
    name: str
    regime: str
    pairs_count: int
    generated_at: datetime


# ── Settings schemas ──────────────────────────────────────────────────────────

_DEFAULT_MARKET_VI: dict = {
    "pairs": [],
    "weights": {},
    "tf_weights": {
        "weekday": {"15m": 0.25, "1h": 0.40, "4h": 0.25, "1d": 0.10},
        "weekend": {"15m": 0.75, "1h": 0.25, "4h": 0.00, "1d": 0.00},
    },
    "active_hours_start": "00:00",
    "active_hours_end": "23:59",
    "weekdays_only": False,
    "rolling_window": 20,
    "enabled": True,
}

_DEFAULT_PER_PAIR: dict = {
    "indicators": {"rvol": True, "mfi": True, "atr": True, "bb": True, "ema": True},
    "retention_days": 30,
    "active_hours_start": "00:00",
    "active_hours_end": "23:59",
    "enabled": True,
}

_DEFAULT_REGIMES: dict = {
    "dead_max": 0.17,
    "calm_max": 0.33,
    "normal_max": 0.50,
    "trending_max": 0.67,
    "active_max": 0.83,
}


class TFComponentOut(BaseModel):
    """Single timeframe contribution in an aggregated Market VI response."""

    tf: str
    vi_score: float
    regime: str
    weight: float


class AggregatedMarketVIOut(BaseModel):
    """Response for GET /api/volatility/market/aggregated."""

    vi_score: float
    regime: str
    timestamp: str  # ISO-8601
    is_weekend: bool
    tf_components: list[TFComponentOut]


class VolatilitySettingsOut(BaseModel):
    """Response for GET /api/volatility/settings/{profile_id}."""

    profile_id: int
    market_vi: dict
    per_pair: dict
    regimes: dict
    updated_at: datetime


class VolatilitySettingsPatch(BaseModel):
    """Body for PUT /api/volatility/settings/{profile_id}.

    All fields are optional — only provided fields are merged into the existing config.
    """

    market_vi: dict | None = None
    per_pair: dict | None = None
    regimes: dict | None = None


class NotificationSettingsOut(BaseModel):
    """Response for GET /api/volatility/notifications/{profile_id}."""

    profile_id: int
    bots: list
    market_vi_alerts: dict
    watchlist_alerts: dict
    updated_at: datetime


class NotificationSettingsPatch(BaseModel):
    """Body for PUT /api/volatility/notifications/{profile_id}.

    All fields optional — only provided fields are merged.
    """

    bots: list | None = None
    market_vi_alerts: dict | None = None
    watchlist_alerts: dict | None = None
