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

# Fallback list used only when DB has no synced instruments at all
# (e.g. first boot before sync-spot-instruments has run)
DEFAULT_SPOT_PAIRS: list[str] = [
    "XBTUSD", "ETHUSD", "SOLUSD", "AVAXUSD", "XRPUSD",
    "ADAUSD", "DOTUSD", "LINKUSD", "LTCUSD", "BCHUSD",
    "ATOMUSD", "DOGEUSD", "TRXUSD", "UNIUSD", "AAVEUSD",
    "BNBUSD", "FILUSD", "SUIUSD",
]

DEFAULT_SPOT_CONFIG: dict = {
    # use_all_synced=True → pairs are resolved dynamically from the instruments
    # table (all active USD/USDT spot pairs for the Kraken broker).
    # Set to False and populate "pairs" to pin a custom list instead.
    "use_all_synced": True,
    "pairs": [],          # ignored when use_all_synced is True
    # top_n > 0: keep only top N pairs ranked by 24h USD volume (pre-filter).
    # 0 = no limit (compute all synced pairs — can be slow).
    "top_n": 100,
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
