"""
Pydantic schemas for the Market Analysis API — Step 7.

ModuleOut               GET /api/market-analysis/modules
IndicatorOut            GET /api/market-analysis/modules/{id}/indicators
IndicatorConfigItem     GET/PUT /api/profiles/{id}/indicator-config
SessionCreate           POST /api/market-analysis/sessions
AnswerIn                answer inside SessionCreate
SessionOut              response for session endpoints
AnswerOut               answer row in SessionOut
StalenessItem           GET /api/profiles/{id}/market-analysis/staleness
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Bias = Literal["bullish", "neutral", "bearish"]


# ── Modules ───────────────────────────────────────────────────────────────────


class ModuleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    is_dual: bool
    asset_a: str | None
    asset_b: str | None
    is_active: bool
    sort_order: int


# ── Indicators ────────────────────────────────────────────────────────────────


class IndicatorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    module_id: int
    key: str
    label: str
    asset_target: str  # 'a', 'b', 'single'
    tv_symbol: str
    tv_timeframe: str
    timeframe_level: str  # 'htf', 'mtf', 'ltf'
    score_block: str  # 'trend' | 'momentum' | 'participation'
    question: str
    tooltip: str | None
    answer_bullish: str
    answer_partial: str
    answer_bearish: str
    default_enabled: bool
    sort_order: int


class IndicatorUpdate(BaseModel):
    """
    Partial update for PATCH /api/market-analysis/indicators/{id}.
    Only UI-text fields are patchable.
    Immutable fields (key, module_id, asset_target, tv_symbol, tv_timeframe,
    timeframe_level, sort_order) are rejected silently — not in this schema.
    """

    label: str | None = Field(default=None, min_length=1, max_length=200)
    question: str | None = Field(default=None, min_length=1)
    tooltip: str | None = None  # explicitly None = clear tooltip
    answer_bullish: str | None = Field(default=None, min_length=1, max_length=200)
    answer_partial: str | None = Field(default=None, min_length=1, max_length=200)
    answer_bearish: str | None = Field(default=None, min_length=1, max_length=200)
    default_enabled: bool | None = None


# ── Indicator config (per-profile toggles) ────────────────────────────────────


class IndicatorConfigItem(BaseModel):
    """One toggle row — used in both GET response and PUT body."""

    indicator_id: int
    enabled: bool


class IndicatorConfigOut(BaseModel):
    """Full GET /api/profiles/{id}/indicator-config response."""

    profile_id: int
    configs: list[IndicatorConfigItem]


# ── Session (save completed analysis) ─────────────────────────────────────────


class AnswerIn(BaseModel):
    """One answer supplied by the frontend."""

    indicator_id: int
    # 0 = bearish, 1 = neutral/partial, 2 = bullish
    score: int = Field(..., ge=0, le=2)
    answer_label: str = Field(..., min_length=1)


class SessionCreate(BaseModel):
    """Body for POST /api/market-analysis/sessions."""

    profile_id: int
    module_id: int
    answers: list[AnswerIn] = Field(..., min_length=1)
    notes: str | None = None
    analyzed_at: datetime | None = None  # defaults to now() server-side


class AnswerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    indicator_id: int
    score: int
    answer_label: str


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    module_id: int

    # Scores — asset A (BTC / Gold / …)
    score_htf_a: Decimal | None
    score_mtf_a: Decimal | None
    score_ltf_a: Decimal | None
    bias_htf_a: str | None
    bias_mtf_a: str | None
    bias_ltf_a: str | None

    # Scores — asset B (Alts — NULL for single-asset modules)
    score_htf_b: Decimal | None
    score_mtf_b: Decimal | None
    score_ltf_b: Decimal | None
    bias_htf_b: str | None
    bias_mtf_b: str | None
    bias_ltf_b: str | None

    # v2 decomposed scores — asset A
    score_trend_a: Decimal | None = None
    score_momentum_a: Decimal | None = None
    score_participation_a: Decimal | None = None
    score_composite_a: Decimal | None = None
    bias_composite_a: str | None = None

    # v2 decomposed scores — asset B
    score_trend_b: Decimal | None = None
    score_momentum_b: Decimal | None = None
    score_participation_b: Decimal | None = None
    score_composite_b: Decimal | None = None
    bias_composite_b: str | None = None

    notes: str | None
    analyzed_at: datetime
    created_at: datetime

    answers: list[AnswerOut] = []


class SessionListItem(BaseModel):
    """Slim version for the history list — no answers."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    module_id: int
    score_htf_a: Decimal | None
    score_mtf_a: Decimal | None
    score_ltf_a: Decimal | None
    bias_htf_a: str | None
    bias_mtf_a: str | None
    bias_ltf_a: str | None
    score_htf_b: Decimal | None
    score_mtf_b: Decimal | None
    score_ltf_b: Decimal | None
    bias_htf_b: str | None
    bias_mtf_b: str | None
    bias_ltf_b: str | None
    # v2 decomposed scores (slim — composite only)
    score_composite_a: Decimal | None = None
    bias_composite_a: str | None = None
    score_composite_b: Decimal | None = None
    bias_composite_b: str | None = None
    notes: str | None
    analyzed_at: datetime


# ── Staleness ─────────────────────────────────────────────────────────────────


class StalenessItem(BaseModel):
    """Freshness status for one module."""

    module_id: int
    module_name: str
    last_analyzed_at: datetime | None
    days_old: int | None  # None if no session exists yet
    is_stale: bool  # True if days_old > 7 (or no session at all)


# ── Trade Conclusion (v2) ─────────────────────────────────────────────────────


class TradeConclusion(BaseModel):
    """
    Actionable trade recommendation derived from decomposed MA scores.
    Returned by GET /api/market-analysis/sessions/{id}/conclusion.
    """

    emoji: str  # "🟢" | "⚠️" | "🔴" | "⚡" | "🟡"
    label: str  # "Trend Following — Full Size"
    detail: str  # 1-sentence explanation
    trade_types: list[str]  # e.g. ["swing", "position"]
    size_advice: str  # "normal (100%)" | "reduced (50%)"
    color: str  # "green" | "amber" | "red" | "neutral"
