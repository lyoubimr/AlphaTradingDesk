"""
Phase 6A — Pydantic schemas for the Analytics module.

PerformanceReport   — full 15-metric analytics bundle
AnalyticsSettingsOut / AnalyticsSettingsUpdate  — AI + display prefs
AIKeysStatusOut     — which providers have keys configured (never exposes raw keys)
AIKeysUpdateIn      — plain-text keys provided by the user (encrypted before storage)
AIGenerateOut       — result of a manual AI generation request
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# ── Sub-models for PerformanceReport ─────────────────────────────────────────

class KPISummary(BaseModel):
    """Top-level KPI cards."""
    disciplined_wr: float | None = None      # WR excluding BE + strategy_broken trades
    raw_wr: float | None = None              # WR including all trades
    expectancy: float | None = None          # avg_win * wr − avg_loss * (1 − wr)
    profit_factor: float | None = None       # gross_profit / abs(gross_loss)
    current_streak: int = 0                  # >0 = win streak, <0 = loss streak
    best_win_streak: int = 0
    worst_loss_streak: int = 0
    total_trades: int = 0
    disciplined_trades: int = 0              # total_trades − strategy_broken − BE
    avg_win_pnl: float | None = None
    avg_loss_pnl: float | None = None


class EquityPoint(BaseModel):
    date: str                  # ISO date string (YYYY-MM-DD)
    trade_id: int
    pnl: float                 # this trade's realized_pnl
    cumulative_pnl: float      # running total


class WRByStat(BaseModel):
    """Generic WR breakdown row — used for strategy, session, pair."""
    label: str
    trades: int
    wins: int
    losses: int
    wr_pct: float | None = None
    avg_pnl: float | None = None
    total_pnl: float = 0.0
    avg_pnl_pct: float | None = None  # avg realized_pnl / risk_amount * 100 (R-multiple %)


class WRByHour(BaseModel):
    hour: int                  # 0–23 UTC
    trades: int
    wins: int
    wr_pct: float | None = None


class TPHitRate(BaseModel):
    tp_number: int             # 1, 2, 3
    total: int                 # trades with this TP defined
    hits: int                  # positions that reached 'closed'
    hit_rate_pct: float | None = None


class DrawdownPoint(BaseModel):
    date: str
    cumulative_pnl: float
    peak_pnl: float
    drawdown_pct: float        # negative — e.g. -12.3 means 12.3% drawdown


class TradeTypeRow(BaseModel):
    trade_type: str            # "scalp" | "intraday" | "swing"
    count: int
    wins: int
    wr_pct: float | None = None
    avg_pnl: float | None = None


class RRScatterPoint(BaseModel):
    trade_id: int
    planned_rr: float | None   # potential_profit / risk_amount
    actual_rr: float | None    # realized_pnl / risk_amount
    is_win: bool
    pair: str


class DirectionRow(BaseModel):
    direction: str             # "long" | "short"
    trades: int
    wins: int
    wr_pct: float | None = None
    total_pnl: float = 0.0


class TagFrequency(BaseModel):
    tag: str
    count: int
    pct: float                 # percentage among winners / losers with this tag


class RepeatError(BaseModel):
    tag: str
    error_count: int
    last_seen: str | None = None   # ISO date of most-recent trade with this tag


class ReviewRateOut(BaseModel):
    total_closed: int
    reviewed_count: int
    review_rate_pct: float


class VIBucket(BaseModel):
    """Trade performance bucketed by VI score at entry time.

    Pair VI buckets  : Dead / Calm / Normal / Trending / Active / Extreme
    Market VI buckets: DEAD / CALM / NORMAL / TRENDING / ACTIVE / EXTREME (regime field)
    """
    bucket: str            # regime name
    trades: int
    wr_pct: float | None = None
    avg_pnl: float | None = None   # average realized_pnl in dollars
    avg_vi: float | None = None   # average VI score in bucket (0–1)


# ── Main response model ───────────────────────────────────────────────────────

class PerformanceReport(BaseModel):
    profile_id: int
    period: str                            # "30d" | "90d" | "180d" | "all"
    generated_at: str                      # ISO datetime

    # ── 1. KPI summary
    kpi: KPISummary

    # ── 2. Equity curve
    equity_curve: list[EquityPoint]

    # ── 3. WR by strategy
    wr_by_strategy: list[WRByStat]

    # ── 4. WR by session
    wr_by_session: list[WRByStat]

    # ── 5. WR by hour (UTC)
    wr_by_hour: list[WRByHour]

    # ── 6. Pair leaderboard
    pair_leaderboard: list[WRByStat]

    # ── 7. TP hit rates
    tp_hit_rates: list[TPHitRate]

    # ── 8. Max drawdown curve
    drawdown: list[DrawdownPoint]

    # ── 9. Trade type distribution
    trade_type_dist: list[TradeTypeRow]

    # ── 10. Real vs planned R:R scatter
    rr_scatter: list[RRScatterPoint]

    # ── 11. Direction bias
    direction_bias: list[DirectionRow]

    # ── 12–13. Tag frequency on winners / losers
    top_tags_winners: list[TagFrequency]
    top_tags_losers: list[TagFrequency]

    # ── 14. Repeat errors (tags that appear most on losing trades)
    repeat_errors: list[RepeatError]

    # ── 15. Review rate
    review_rate: ReviewRateOut

    # ── 16. Volatility correlation — pair VI (6 buckets by vi_score threshold)
    vi_correlation: list[VIBucket] = Field(default_factory=list)

    # ── 17. Volatility correlation — market VI (by regime field on market_vi_snapshots)
    vi_correlation_market: list[VIBucket] = Field(default_factory=list)

    # ── AI narrative (None if not generated yet / disabled)
    ai_summary: str | None = None
    ai_generated_at: str | None = None


# ── Analytics settings ────────────────────────────────────────────────────────

DEFAULT_ANALYTICS_CONFIG: dict = {
    "ai_enabled": False,
    "ai_provider": "openai",
    "ai_model": "gpt-4o-mini",
    "ai_refresh": "daily",          # "per_trade" | "daily" | "manual"
    "ai_refresh_hours": 24,
}


class AnalyticsSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    profile_id: int
    config: dict


class AnalyticsSettingsUpdateIn(BaseModel):
    ai_enabled: bool | None = None
    ai_provider: str | None = Field(default=None, pattern="^(openai|anthropic|perplexity|groq|gemini)$")
    ai_model: str | None = None
    ai_refresh: str | None = Field(default=None, pattern="^(per_trade|daily|manual)$")
    ai_refresh_hours: int | None = Field(default=None, ge=1, le=720)


# ── AI keys ───────────────────────────────────────────────────────────────────

class AIKeysStatusOut(BaseModel):
    """Never exposes raw or encrypted keys — only which providers are configured."""
    profile_id: int
    openai_configured: bool
    anthropic_configured: bool
    perplexity_configured: bool
    groq_configured: bool
    gemini_configured: bool


class AIKeysUpdateIn(BaseModel):
    """Plain-text keys submitted by the user — encrypted before storage."""
    openai_key: str | None = None       # None = keep existing | "" = clear
    anthropic_key: str | None = None
    perplexity_key: str | None = None
    groq_key: str | None = None
    gemini_key: str | None = None


# ── AI generation ─────────────────────────────────────────────────────────────

class AIGenerateOut(BaseModel):
    summary: str
    provider: str
    model: str
    tokens_used: int | None = None
    generated_at: str
