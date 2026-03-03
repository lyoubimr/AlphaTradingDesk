"""
Goals service — business logic for profile_goals CRUD and progress computation.

Progress is computed on request (no background job in Phase 1):
  - reads closed trades for the active period window
  - sums realized_pnl / capital_current → pnl_pct
  - compares against goal_pct and limit_pct
  - periods with goal_pct=0 AND limit_pct=0 are skipped (not a valid goal)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.core.models.broker import Profile, TradingStyle
from src.core.models.goals import ProfileGoal
from src.core.models.trade import Trade
from src.goals.schemas import GoalCreate, GoalProgressItem, GoalUpdate

# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_profile_or_404(db: Session, profile_id: int) -> Profile:
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile {profile_id} not found.",
        )
    return profile


def _get_goal_or_404(db: Session, profile_id: int, style_id: int, period: str) -> ProfileGoal:
    goal = (
        db.query(ProfileGoal)
        .filter(
            ProfileGoal.profile_id == profile_id,
            ProfileGoal.style_id == style_id,
            ProfileGoal.period == period,
        )
        .first()
    )
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Goal not found for profile={profile_id}, style={style_id}, period={period}.",
        )
    return goal


def _get_style_or_422(db: Session, style_id: int) -> TradingStyle:
    style = db.query(TradingStyle).filter(TradingStyle.id == style_id).first()
    if not style:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"TradingStyle {style_id} not found.",
        )
    return style


def _period_window(period: str, ref: date) -> tuple[date, date]:
    """
    Return (start, end) inclusive date range for the given period,
    relative to the reference date (today by default).

    daily   → same day
    weekly  → Monday → Sunday of ref's ISO week
    monthly → 1st → last day of ref's month
    """
    if period == "daily":
        return ref, ref
    if period == "weekly":
        start = ref - timedelta(days=ref.weekday())       # Monday
        end = start + timedelta(days=6)                   # Sunday
        return start, end
    if period == "monthly":
        start = ref.replace(day=1)
        # last day: go to next month day 1 then subtract 1 day
        if ref.month == 12:
            end = date(ref.year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(ref.year, ref.month + 1, 1) - timedelta(days=1)
        return start, end
    raise ValueError(f"Unknown period: {period}")


def _compute_pnl_pct(
    db: Session,
    profile_id: int,
    capital: Decimal,
    period_start: date,
    period_end: date,
) -> Decimal:
    """
    Sum realized_pnl of all closed trades within [period_start, period_end]
    for the given profile, then express as % of capital_current.

    Returns Decimal("0.00") if no closed trades in the window.
    """
    # Convert dates to datetime bounds for TIMESTAMP column comparison
    start_dt = datetime(period_start.year, period_start.month, period_start.day, 0, 0, 0)
    end_dt = datetime(period_end.year, period_end.month, period_end.day, 23, 59, 59)

    result = (
        db.query(func.coalesce(func.sum(Trade.realized_pnl), Decimal("0")))
        .filter(
            Trade.profile_id == profile_id,
            Trade.status == "closed",
            Trade.closed_at >= start_dt,
            Trade.closed_at <= end_dt,
        )
        .scalar()
    )
    pnl = Decimal(str(result)) if result is not None else Decimal("0")
    if capital == 0:
        return Decimal("0.00")
    return (pnl / capital * 100).quantize(Decimal("0.0001"))


# ── Public service functions ──────────────────────────────────────────────────

def get_goals(db: Session, profile_id: int) -> list[ProfileGoal]:
    """Return all goals for a profile (active and inactive)."""
    _get_profile_or_404(db, profile_id)
    return (
        db.query(ProfileGoal)
        .filter(ProfileGoal.profile_id == profile_id)
        .order_by(ProfileGoal.style_id, ProfileGoal.period)
        .all()
    )


def create_goal(db: Session, profile_id: int, data: GoalCreate) -> ProfileGoal:
    _get_profile_or_404(db, profile_id)
    _get_style_or_422(db, data.style_id)

    # Enforce unique (profile_id, style_id, period) — return 409 if already exists
    existing = (
        db.query(ProfileGoal)
        .filter(
            ProfileGoal.profile_id == profile_id,
            ProfileGoal.style_id == data.style_id,
            ProfileGoal.period == data.period,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A goal already exists for profile={profile_id}, "
                f"style={data.style_id}, period={data.period}. Use PUT to update it."
            ),
        )

    goal = ProfileGoal(
        profile_id=profile_id,
        style_id=data.style_id,
        period=data.period,
        goal_pct=data.goal_pct,
        limit_pct=data.limit_pct,
        is_active=data.is_active,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


def update_goal(
    db: Session,
    profile_id: int,
    style_id: int,
    period: str,
    data: GoalUpdate,
) -> ProfileGoal:
    goal = _get_goal_or_404(db, profile_id, style_id, period)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)

    db.commit()
    db.refresh(goal)
    return goal


def get_progress(db: Session, profile_id: int) -> list[GoalProgressItem]:
    """
    Compute real-time progress for all active goals of a profile.

    For each active ProfileGoal:
      1. Determine the period window (today's daily / this week / this month)
      2. Sum realized_pnl of closed trades in that window
      3. Express as % of profile.capital_current
      4. Compute goal_progress_pct and risk_progress_pct
    """
    profile = _get_profile_or_404(db, profile_id)

    active_goals: list[ProfileGoal] = (
        db.query(ProfileGoal)
        .filter(ProfileGoal.profile_id == profile_id, ProfileGoal.is_active.is_(True))
        .all()
    )

    today = date.today()
    items: list[GoalProgressItem] = []

    for goal in active_goals:
        period_start, period_end = _period_window(goal.period, today)

        pnl_pct = _compute_pnl_pct(
            db,
            profile_id,
            profile.capital_current,
            period_start,
            period_end,
        )

        # Progress toward goal (positive scale: 100% = goal reached)
        goal_progress = (
            (pnl_pct / goal.goal_pct * 100).quantize(Decimal("0.01"))
            if goal.goal_pct != 0
            else Decimal("0.00")
        )

        # Progress toward risk limit (positive scale: 100% = limit breached)
        # limit_pct is negative, pnl_pct is negative when losing
        risk_progress = (
            (pnl_pct / goal.limit_pct * 100).quantize(Decimal("0.01"))
            if goal.limit_pct != 0
            else Decimal("0.00")
        )

        items.append(
            GoalProgressItem(
                style_id=goal.style_id,
                style_name=goal.style.display_name,
                period=goal.period,
                period_start=period_start.isoformat(),
                period_end=period_end.isoformat(),
                pnl_pct=pnl_pct,
                goal_pct=goal.goal_pct,
                limit_pct=goal.limit_pct,
                goal_progress_pct=goal_progress,
                risk_progress_pct=risk_progress,
                goal_hit=pnl_pct >= goal.goal_pct,
                limit_hit=pnl_pct <= goal.limit_pct,
            )
        )

    return items
