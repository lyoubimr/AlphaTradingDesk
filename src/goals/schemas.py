"""
Pydantic schemas for Goals & Risk Limits.

GoalCreate        — body for POST /api/profiles/{id}/goals  (single goal)
GoalMatrixCreate  — body for POST /api/profiles/{id}/goals/matrix  (up to 3 periods at once)
GoalUpdate        — body for PUT  /api/profiles/{id}/goals/{goal_id}
GoalOut           — response shape for a single goal row
GoalProgressItem  — response shape for GET .../goals/progress (computed on request)
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Period = Literal["daily", "weekly", "monthly"]
PeriodType = Literal["outcome", "process"]  # 'review' removed — Phase 2+


class GoalCreate(BaseModel):
    # NULL style_id = global goal (all styles).  Pass null/omit for global.
    style_id: int | None = Field(default=None, description="NULL = all styles (global goal)")
    period: Period
    goal_pct: Decimal = Field(..., gt=0, description="Profit target % (positive)")
    limit_pct: Decimal = Field(..., lt=0, description="Max loss % (negative, e.g. -1.5)")
    is_active: bool = True
    avg_r_min: Decimal | None = Field(default=None, description="Min avg R target (e.g. 2.0)")
    max_trades: int | None = Field(default=None, ge=1)
    period_type: PeriodType = "outcome"
    show_on_dashboard: bool = True


class GoalPeriodEntry(BaseModel):
    """One period's data inside a matrix declaration."""

    enabled: bool = False
    goal_pct: Decimal | None = Field(default=None, gt=0)
    limit_pct: Decimal | None = Field(default=None, lt=0)
    avg_r_min: Decimal | None = None
    max_trades: int | None = Field(default=None, ge=1)
    period_type: PeriodType = "outcome"


class GoalMatrixCreate(BaseModel):
    """Create up to 3 goals at once (daily / weekly / monthly) for one style."""

    style_id: int | None = Field(default=None, description="NULL = all styles (global)")
    show_on_dashboard: bool = True
    daily: GoalPeriodEntry = GoalPeriodEntry()
    weekly: GoalPeriodEntry = GoalPeriodEntry()
    monthly: GoalPeriodEntry = GoalPeriodEntry()


class GoalUpdate(BaseModel):
    """All fields optional — only provided fields are updated."""

    goal_pct: Decimal | None = Field(default=None, gt=0)
    limit_pct: Decimal | None = Field(default=None, lt=0)
    is_active: bool | None = None
    avg_r_min: Decimal | None = None
    max_trades: int | None = Field(default=None, ge=1)
    period_type: PeriodType | None = None
    show_on_dashboard: bool | None = None


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    style_id: int | None = None  # None = global goal
    style_name: str | None = None  # populated by service layer
    period: str
    goal_pct: Decimal
    limit_pct: Decimal
    is_active: bool
    avg_r_min: Decimal | None = None
    max_trades: int | None = None
    period_type: str = "outcome"
    show_on_dashboard: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None


class GoalProgressItem(BaseModel):
    """Live progress toward a single goal for the current period."""

    goal_id: int
    style_id: int | None = None  # None = global
    style_name: str | None = None  # None when global (all styles)
    period: str
    period_start: str  # ISO date "2026-03-02"
    period_end: str
    pnl_pct: Decimal
    goal_pct: Decimal
    limit_pct: Decimal
    goal_progress_pct: Decimal  # 0–100+
    risk_progress_pct: Decimal  # 0–100+
    goal_hit: bool
    limit_hit: bool
    trade_count: int = 0
    avg_r: Decimal | None = None
    avg_r_min: Decimal | None = None  # goal's minimum Avg R target (copied from ProfileGoal)
    avg_r_hit: bool | None = None
    max_trades_hit: bool | None = None
    period_type: str = "outcome"
    show_on_dashboard: bool = True
    # Recent trades in this period (for detail card)
    trades: list[dict] = []


# ── Goal Override Log ─────────────────────────────────────────────────────────


class GoalOverrideCreate(BaseModel):
    style_id: int | None = None
    period: Period
    period_start: date
    reason_text: str = Field(..., min_length=20)
    pnl_pct_at_override: Decimal | None = None
    open_risk_pct: Decimal | None = None
    acknowledged: bool = True


class GoalOverrideOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    period: str
    period_start: date
    pnl_pct_at_override: Decimal | None
    open_risk_pct: Decimal | None
    reason_text: str
    acknowledged: bool
    overridden_at: datetime
