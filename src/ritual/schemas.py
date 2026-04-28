"""
Ritual Module — Pydantic schemas.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ── Settings ─────────────────────────────────────────────────────────────────

class SmartFilterWeights(BaseModel):
    model_config = ConfigDict(extra="allow")
    w1W: float = Field(4.0, alias="1W")
    w1D: float = Field(3.0, alias="1D")
    w4H: float = Field(2.0, alias="4H")
    w1H: float = Field(1.0, alias="1H")
    w15m: float = Field(0.5, alias="15m")


class RitualSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    profile_id: int
    config: dict[str, Any]
    updated_at: datetime


class RitualSettingsPatch(BaseModel):
    config: dict[str, Any]


# ── Pinned Pairs ─────────────────────────────────────────────────────────────

TF_LITERAL = Literal["1W", "1D", "4H", "1H", "15m"]

TTL_HOURS: dict[str, int] = {
    "1W": 24 * 28,   # 4 weeks
    "1D": 24 * 14,   # 2 weeks
    "4H": 24 * 7,    # 7 days
    "1H": 24 * 3,    # 3 days
    "15m": 26,       # 26 hours
}


class PinnedPairCreate(BaseModel):
    pair: str = Field(..., min_length=2, max_length=30)
    timeframe: TF_LITERAL
    note: str | None = Field(None, max_length=500)
    source: Literal["watchlist", "manual"] = "watchlist"
    tv_symbol: str | None = None


class PinnedPairRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    profile_id: int
    pair: str
    tv_symbol: str | None
    timeframe: str
    note: str | None
    pinned_at: datetime
    expires_at: datetime
    status: str
    source: str
    # computed fields (not in DB)
    hours_remaining: float | None = None
    ttl_pct: float | None = None  # 0.0 → 1.0 — remaining fraction of original TTL
    is_suspended: bool = False  # True if suspended by open trade


class PinnedPairExtend(BaseModel):
    hours: int = Field(
        24,
        ge=-(24 * 28),
        le=24 * 28,
        description="Hours to add (positive) or subtract (negative) from TTL",
    )


# ── Steps ────────────────────────────────────────────────────────────────────

SessionType = Literal["weekly_setup", "trade_session", "weekend_review"]

SESSION_LABELS: dict[str, str] = {
    "weekly_setup": "Weekly Setup",
    "daily_prep": "Daily Prep",
    "trade_session": "Trade Session",
    "weekend_review": "Weekend Review",
}

SESSION_EMOJIS: dict[str, str] = {
    "weekly_setup": "📅",
    "daily_prep": "☀️",
    "trade_session": "🎯",
    "weekend_review": "📊",
}

STEP_EMOJIS: dict[str, str] = {
    "ai_brief": "🤖",
    "vi_check": "⚡",
    "pinned_review": "⭐",
    "smart_wl": "🔍",
    "tv_analysis": "📈",
    "pin_pairs": "📌",
    "outcome": "🏁",
    "market_analysis": "📊",
    "goals_review": "🎯",
    "analytics": "📉",
    "journal": "📓",
    "learning_note": "📝",
    "custom": "🔷",
    "weekly_notes": "🗒️",
}

MODULE_PATHS: dict[str, str] = {
    "volatility": "/volatility/market",
    "market_analysis": "/market-analysis",
    "goals": "/goals",
    "analytics": "/analytics",
    "trades": "/trades",
}


class StepRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    profile_id: int
    session_type: str
    position: int
    step_type: str
    label: str
    cadence_hours: int | None
    is_mandatory: bool
    linked_module: str | None
    est_minutes: int | None
    config: dict[str, Any]
    # computed
    emoji: str = ""
    module_path: str | None = None


class StepUpdate(BaseModel):
    label: str | None = None
    est_minutes: int | None = None
    is_mandatory: bool | None = None
    position: int | None = None
    config: dict[str, Any] | None = None


# ── Sessions ─────────────────────────────────────────────────────────────────

class SessionCreate(BaseModel):
    session_type: SessionType


class StepLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ritual_session_id: int
    step_id: int | None
    step_type: str
    position: int
    status: str
    completed_at: datetime | None
    output: dict[str, Any]
    # computed
    emoji: str = ""


class SessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    profile_id: int
    session_type: str
    started_at: datetime
    ended_at: datetime | None
    status: str
    outcome: str | None
    discipline_points: int
    notes: str | None
    step_logs: list[StepLogRead] = []
    # computed
    session_label: str = ""
    session_emoji: str = ""
    duration_minutes: float | None = None


class SessionComplete(BaseModel):
    outcome: str | None = Field(
        None,
        description="Required for trade_session: trade_opened | pairs_pinned | no_opportunity | vol_too_low",
    )
    notes: str | None = None


class StepComplete(BaseModel):
    status: Literal["done", "skipped"] = "done"
    output: dict[str, Any] = Field(default_factory=dict)


# ── Smart Watchlist ───────────────────────────────────────────────────────────

class PinnedTVEntry(BaseModel):
    tv_symbol: str
    display_name: str
    timeframe: str


class SmartWLPairEntry(BaseModel):
    pair: str
    tv_symbol: str
    display_name: str
    vi_score: float
    regime: str
    ema_signal: str
    score: float
    is_pinned: bool
    pin_note: str | None = None
    pin_id: int | None = None


class SmartWLResult(BaseModel):
    generated_at: str
    session_type: str
    top_n: int
    broker_name: str = ""
    timeframes: dict[str, list[SmartWLPairEntry]]
    market_analysis_pairs: list[str]
    pinned_tv: list[PinnedTVEntry] = []


# ── Weekly Score ──────────────────────────────────────────────────────────────

class WeeklyScoreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    profile_id: int
    week_start: date
    score: int
    max_score: int
    details: dict[str, Any]
    # computed
    pct: float = 0.0
    grade: str = ""


# ── Discipline event types (internal) ────────────────────────────────────────

DISCIPLINE_POINTS: dict[str, int] = {
    "weekly_setup_done": 20,
    "daily_prep_done": 10,
    "trade_session_done": 10,
    "no_opportunity": 10,   # discipline reward
    "weekend_review_done": 15,
    "vol_too_low_trade": -20,  # penalty
    "trade_outside_session": -15,  # penalty (future — Phase 5)
}

MAX_WEEKLY_SCORE = (
    DISCIPLINE_POINTS["weekly_setup_done"]
    + DISCIPLINE_POINTS["trade_session_done"] * 5
    + DISCIPLINE_POINTS["weekend_review_done"]
)  # = 20 + 50 + 15 = 85


# ── Default Config ────────────────────────────────────────────────────────────

DEFAULT_RITUAL_CONFIG: dict[str, Any] = {
    "trading_windows": [
        {"label": "Evening", "start": "20:00", "end": "23:00", "days": [0, 1, 2, 3, 4]},
    ],
    "vol_gate_weekend": True,
    "notif_best_hours": True,
    "notif_weekly_reminder": True,
    "market_analysis_pairs": [
        "CRYPTOCAP:BTC.D",
        "CRYPTOCAP:TOTAL",
        "CRYPTOCAP:TOTAL2",
        "CRYPTOCAP:USDT.D",
        "BINANCE:BTCUSDT",
        "BINANCE:ETHUSDT",
        "BINANCE:ETHBTC",
    ],
    "top_n": {
        "weekly_setup": 20,
        "trade_session": 10,
        "weekend_review": 20,
    },
    "smart_filter": {
        "weights": {"1W": 4.0, "1D": 3.0, "4H": 2.0, "1H": 1.0, "15m": 0.5},
        "trend_bonus": 1.2,
        "ema_bonus_threshold": 70,
        "ema_bonus_factor": 1.1,
    },
}


# ── Default Steps ─────────────────────────────────────────────────────────────

DEFAULT_STEPS: dict[str, list[dict]] = {
    "weekly_setup": [
        {
            "position": 1, "step_type": "market_analysis",
            "label": "Update Market Analysis", "est_minutes": 10,
            "is_mandatory": True, "linked_module": "market_analysis",
            "cadence_hours": None, "config": {},
        },
        {
            "position": 2, "step_type": "smart_wl",
            "label": "Generate Smart Watchlist (1W + 1D + 4H + 1H + 15m)",
            "est_minutes": 1, "is_mandatory": True, "linked_module": None,
            "cadence_hours": None, "config": {"timeframes": ["1W", "1D", "4H", "1H", "15m"]},
        },
        {
            "position": 3, "step_type": "tv_analysis",
            "label": "Analyse watchlist in TradingView", "est_minutes": 30,
            "is_mandatory": True, "linked_module": None,
            "cadence_hours": None, "config": {},
        },
        {
            "position": 4, "step_type": "goals_review", "label": "Review Weekly Goals",
            "est_minutes": 5, "is_mandatory": False, "linked_module": "goals",
            "cadence_hours": None, "config": {},
        },
    ],
    "trade_session": [
        {
            "position": 1, "step_type": "vi_check",
            "label": "Check Volatility Index", "est_minutes": 1,
            "is_mandatory": True, "linked_module": "volatility",
            "cadence_hours": None, "config": {},
        },
        {
            "position": 2, "step_type": "pinned_review",
            "label": "Review active pinned pairs", "est_minutes": 2,
            "is_mandatory": True, "linked_module": None,
            "cadence_hours": None, "config": {},
        },
        {
            "position": 3, "step_type": "smart_wl",
            "label": "Generate Smart Watchlist (1D + 4H + 1H + 15m)",
            "est_minutes": 1, "is_mandatory": True, "linked_module": None,
            "cadence_hours": None, "config": {"timeframes": ["1D", "4H", "1H", "15m"]},
        },
        {
            "position": 4, "step_type": "tv_analysis",
            "label": "Analyse watchlist in TradingView", "est_minutes": 20,
            "is_mandatory": True, "linked_module": None,
            "cadence_hours": None, "config": {},
        },
        {
            "position": 5, "step_type": "outcome", "label": "Session Outcome",
            "est_minutes": 1, "is_mandatory": True, "linked_module": None,
            "cadence_hours": None, "config": {},
        },
    ],
    "weekend_review": [
        {
            "position": 1, "step_type": "analytics",
            "label": "Review Analytics & Performance", "est_minutes": 15,
            "is_mandatory": True, "linked_module": "analytics",
            "cadence_hours": None, "config": {},
        },
        {
            "position": 2, "step_type": "journal",
            "label": "Review Trade Journal", "est_minutes": 10,
            "is_mandatory": True, "linked_module": "trades",
            "cadence_hours": None, "config": {},
        },
        {
            "position": 3, "step_type": "goals_review",
            "label": "Review Goals & Progress", "est_minutes": 5,
            "is_mandatory": True, "linked_module": "goals",
            "cadence_hours": None, "config": {},
        },
        {
            "position": 4, "step_type": "learning_note",
            "label": "Write learning note", "est_minutes": 5,
            "is_mandatory": False, "linked_module": None,
            "cadence_hours": None, "config": {},
        },
    ],
}
