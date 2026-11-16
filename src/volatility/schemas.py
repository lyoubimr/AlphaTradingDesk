"""
Pydantic schemas for Volatility Engine endpoints (P2-9).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class MarketVIOut(BaseModel):
    """Response for GET /api/volatility/market/{timeframe}."""

    timeframe: str
    vi_score: float
    regime: str
    timestamp: str  # ISO-8601
    components: dict[str, float] = {}  # {symbol: vi_score} for all Binance pairs


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


class EmaSetupOut(BaseModel):
    """One breakout/retest opportunity on a timeframe's reference EMA."""

    pair: str
    timeframe: str  # "1D" | "4H" | "1H" — same labels as pinned pairs
    signal: str
    tier: Literal["prime", "fresh", "retest"]
    direction: Literal["long", "short"]
    vi_score: float
    regime: str
    change_24h: float | None = None
    ema_ref_period: int
    pin_id: int | None = None  # active pin of this pair+timeframe, if any
    since: datetime | None = None  # start of the unbroken run of this setup in the history window
    path: list[str] = []  # distinct signals seen in the window, oldest first (e.g. breakout → retest)


class EmaSetupHistoryOut(BaseModel):
    """A setup seen earlier in the history window that is no longer active."""

    pair: str
    timeframe: str  # "1D" | "4H" | "1H"
    direction: Literal["long", "short"]
    best_tier: Literal["prime", "fresh", "retest"]
    latest_signal: str  # last signal it showed as a setup
    path: list[str]
    first_seen: datetime
    last_seen: datetime
    times_seen: int
    outcome: Literal["holding", "failed", "neutral", "unknown"]
    current_signal: str | None = None  # the pair's signal in the latest snapshot
    pin_id: int | None = None


class EmaSetupsTimeframeOut(BaseModel):
    timeframe: str  # "1D" | "4H" | "1H"
    generated_at: datetime | None = None
    age_minutes: int | None = None
    is_stale: bool = True
    total: int = 0  # setups found before the top-N cut
    prime_total: int = 0
    setups: list[EmaSetupOut] = []
    history_hours: int = 0
    earlier_total: int = 0  # earlier setups found before the history cut
    earlier: list[EmaSetupHistoryOut] = []


class EmaSetupsOut(BaseModel):
    """Response for GET /api/volatility/ema-setups."""

    profile_id: int
    is_spot: bool
    prime_total: int  # prime setups across all returned timeframes
    timeframes: list[EmaSetupsTimeframeOut]


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
    "pairs_count": 50,
    "enabled": True,
    "retention_days": 90,  # market_vi_snapshots + watchlist_snapshots retention
    "indicator_weights": {"rvol": 0.35, "mfi": 0.10, "atr": 0.35, "bb_width": 0.20},
}

_DEFAULT_PER_PAIR: dict = {
    "indicators": {"rvol": True, "mfi": True, "atr": True, "bb": True, "ema": True},
    "indicator_weights": {"rvol": 0.35, "mfi": 0.10, "atr": 0.35, "bb_width": 0.20},
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
    execution_alerts: dict
    updated_at: datetime


class NotificationSettingsPatch(BaseModel):
    """Body for PUT /api/volatility/notifications/{profile_id}.

    All fields optional — only provided fields are merged.
    """

    bots: list | None = None
    market_vi_alerts: dict | None = None
    watchlist_alerts: dict | None = None
    execution_alerts: dict | None = None
