"""
Pydantic schemas for Goals & Risk Limits.

GoalCreate        — body for POST /api/profiles/{id}/goals
GoalUpdate        — body for PUT  /api/profiles/{id}/goals/{style_id}/{period}
GoalOut           — response shape for a single goal row
GoalProgress      — response shape for GET .../goals/progress (computed on request)
GoalOverrideCreate — body for POST /api/profiles/{id}/goal-overrides
GoalOverrideOut   — response shape for an override log entry
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Period = Literal["daily", "weekly", "monthly"]
PeriodType = Literal["outcome", "process", "review"]


class GoalCreate(BaseModel):
    style_id: int
    period: Period
    goal_pct: Decimal = Field(..., gt=0, description="Profit target % (positive)")
    limit_pct: Decimal = Field(..., lt=0, description="Max loss % (negative, e.g. -1.5)")
    is_active: bool = True
    # v2 fields (optional — backward compatible)
    avg_r_min: Decimal | None = Field(default=None, description="Min avg R target (e.g. 1.3)")
    max_trades: int | None = Field(default=None, ge=1, description="Max trades per period")
    period_type: PeriodType = "outcome"
    show_on_dashboard: bool = True


class GoalUpdate(BaseModel):
    """All fields optional — only provided fields are updated."""
    goal_pct: Decimal | None = Field(default=None, gt=0)
    limit_pct: Decimal | None = Field(default=None, lt=0)
    is_active: bool | None = None
    # v2 fields
    avg_r_min: Decimal | None = None
    max_trades: int | None = Field(default=None, ge=1)
    period_type: PeriodType | None = None
    show_on_dashboard: bool | None = None


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    style_id: int
    period: str
    goal_pct: Decimal
    limit_pct: Decimal
    is_active: bool
    # v2 fields
    avg_r_min: Decimal | None = None
    max_trades: int | None = None
    period_type: str = "outcome"
    show_on_dashboard: bool = True


class GoalProgressItem(BaseModel):
    """
    Progress toward a single goal (one style × one period).

    pnl_pct        — realized PnL % for the period (vs capital_current)
    goal_pct       — target % set in profile_goals
    limit_pct      — max loss % set in profile_goals  (negative)
    goal_progress  — pnl_pct / goal_pct × 100  (0–100+%)
    risk_progress  — pnl_pct / limit_pct × 100 (0–100+% — increases as losses accumulate)
    goal_hit       — True if pnl_pct >= goal_pct
    limit_hit      — True if pnl_pct <= limit_pct (only checked when period_type='outcome')
    trade_count    — number of closed/partial-TP events in the period (0 = no activity)
    avg_r          — average R-multiple of closed trades in this period (None if no trades)
    avg_r_hit      — True if avg_r >= avg_r_min (None if avg_r_min not set)
    max_trades_hit — True if trade_count >= max_trades (None if max_trades not set)
    period_type    — 'outcome' | 'process' | 'review'
    show_on_dashboard — whether this goal appears on the dashboard
    """
    style_id: int
    style_name: str
    period: str
    period_start: str          # ISO date string  e.g. "2026-03-02"
    period_end: str            # ISO date string
    pnl_pct: Decimal
    goal_pct: Decimal
    limit_pct: Decimal
    goal_progress_pct: Decimal  # how far toward the goal (0–100+)
    risk_progress_pct: Decimal  # how far toward the limit (0–100+)
    goal_hit: bool
    limit_hit: bool
    trade_count: int = 0        # trades (closed + partial TP) in this period
    # v2 fields
    avg_r: Decimal | None = None
    avg_r_hit: bool | None = None
    max_trades_hit: bool | None = None
    period_type: str = "outcome"
    show_on_dashboard: bool = True


# ── Goal Override Log ─────────────────────────────────────────────────────────

class GoalOverrideCreate(BaseModel):
    """Body for POST /api/profiles/{id}/goal-overrides."""
    style_id: int
    period: Period
    period_start: date
    reason_text: str = Field(..., min_length=20, description="Mandatory reason (min 20 chars)")
    pnl_pct_at_override: Decimal | None = None
    open_risk_pct: Decimal | None = None
    acknowledged: bool = True


class GoalOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    style_id: int
    period: str
    period_start: date
    pnl_pct_at_override: Decimal | None
    open_risk_pct: Decimal | None
    reason_text: str
    acknowledged: bool
    overridden_at: datetime
