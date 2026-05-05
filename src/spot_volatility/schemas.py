"""
Pydantic schemas for Spot Volatility Engine endpoints.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


# ── Watchlist schemas (ISO with contracts WatchlistOut) ───────────────────────

class SpotWatchlistPairOut(BaseModel):
    """Single pair row in a spot watchlist snapshot."""

    pair: str
    vi_score: float
    regime: str
    alert: str | None
    change_24h: float | None
    ema_score: float
    ema_signal: str
    tf_sup_regime: str | None
    tf_sup_vi: float | None


class SpotWatchlistOut(BaseModel):
    """Response for GET /api/spot-volatility/watchlist/{timeframe}."""

    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    timeframe: str
    regime: str
    pairs_count: int
    pairs: list[SpotWatchlistPairOut]
    generated_at: datetime


class SpotWatchlistMetaOut(BaseModel):
    """Lightweight metadata (no pairs payload) — used for the history tree."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    timeframe: str
    name: str
    regime: str
    pairs_count: int
    generated_at: datetime


# ── Settings schemas ──────────────────────────────────────────────────────────

# Default Kraken Spot pairs — curated top-25 by liquidity in USD
DEFAULT_SPOT_PAIRS: list[str] = [
    "XBTUSD", "ETHUSD", "SOLUSD", "AVAXUSD", "XRPUSD",
    "ADAUSD", "DOTUSD", "LINKUSD", "MATICUSD", "LTCUSD",
    "BCHUSD", "ATOMUSD", "ALGOUSD", "XLMUSD", "NEARUSD",
    "INJUSD", "RUNEUSD", "DOGEUSD", "TRXUSD", "UNIUSD",
    "AAVEUSD", "BNBUSD", "FILUSD", "TIAUSD", "SUIUSD",
]

DEFAULT_SPOT_CONFIG: dict = {
    "pairs": DEFAULT_SPOT_PAIRS,
    "top_n": 25,
    "enabled": True,
    "indicators": {
        "rvol": True,
        "mfi":  True,
        "atr":  True,
        "bb":   True,
        "ema":  True,
    },
    "retention_days": 60,
}


class SpotVolatilitySettingsOut(BaseModel):
    """Response for GET/PUT /api/spot-volatility/settings."""

    model_config = ConfigDict(from_attributes=True)

    key: str
    config: dict
    updated_at: datetime


class SpotVolatilitySettingsPatch(BaseModel):
    config: dict


# ── Run request/response ──────────────────────────────────────────────────────

class SpotRunRequest(BaseModel):
    timeframe: str  # "4h" | "1d" | "1w"


class SpotRunResponse(BaseModel):
    status: str
    timeframe: str
    pairs_computed: int
    snapshot_id: int | None = None
