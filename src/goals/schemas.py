"""
Pydantic schemas for Goals & Risk Limits.

GoalCreate   — body for POST /api/profiles/{id}/goals
GoalUpdate   — body for PUT  /api/profiles/{id}/goals/{style_id}/{period}
GoalOut      — response shape for a single goal row
GoalProgress — response shape for GET .../goals/progress (computed on request)
"""
from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Period = Literal["daily", "weekly", "monthly"]


class GoalCreate(BaseModel):
    style_id: int
    period: Period
    goal_pct: Decimal = Field(..., gt=0, description="Profit target % (positive)")
    limit_pct: Decimal = Field(..., lt=0, description="Max loss % (negative, e.g. -1.5)")
    is_active: bool = True


class GoalUpdate(BaseModel):
    """All fields optional — only provided fields are updated."""
    goal_pct: Decimal | None = Field(default=None, gt=0)
    limit_pct: Decimal | None = Field(default=None, lt=0)
    is_active: bool | None = None


class GoalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    style_id: int
    period: str
    goal_pct: Decimal
    limit_pct: Decimal
    is_active: bool


class GoalProgressItem(BaseModel):
    """
    Progress toward a single goal (one style × one period).

    pnl_pct        — realized PnL % for the period (vs capital_current)
    goal_pct       — target % set in profile_goals
    limit_pct      — max loss % set in profile_goals  (negative)
    goal_progress  — pnl_pct / goal_pct × 100  (0–100+%)
    risk_progress  — pnl_pct / limit_pct × 100 (0–100+% — increases as losses accumulate)
    goal_hit       — True if pnl_pct >= goal_pct
    limit_hit      — True if pnl_pct <= limit_pct
    trade_count    — number of closed/partial-TP events in the period (0 = no activity)
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
