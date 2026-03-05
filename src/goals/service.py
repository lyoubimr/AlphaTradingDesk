"""
Goals service — business logic for profile_goals CRUD and progress computation.

Progress is computed on request (no background job in Phase 1):
  - reads closed trades AND partial trades with booked profits in the period window
  - sums realized_pnl (closed) + closed-position pnl (partial) / capital_current → pnl_pct
  - compares against goal_pct and limit_pct
  - periods with goal_pct=0 AND limit_pct=0 are skipped (not a valid goal)

P&L sources:
  • status='closed'  → Trade.realized_pnl    (full trade closed, filtered by closed_at)
  • status='partial' → sum(Position.realized_pnl WHERE exit_date in window)  (partial TP hit)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.core.models.broker import Profile, TradingStyle
from src.core.models.goals import ProfileGoal
from src.core.models.trade import Position, Trade
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


def _compute_pnl_pct_and_count(
    db: Session,
    profile_id: int,
    capital: Decimal,
    period_start: date,
    period_end: date,
) -> tuple[Decimal, int]:
    """
    Sum all realized P&L within [period_start, period_end] for a profile
    and count the number of trade events (closed trades + partial-TP positions).

    Returns (pnl_pct, trade_count):
      - pnl_pct    — % of capital_current (Decimal, 4 decimal places)
      - trade_count — int (0 means no activity this period → show greyed row in UI)
    """
    if capital == 0:
        return Decimal("0.0000"), 0

    start_dt = datetime(period_start.year, period_start.month, period_start.day, 0, 0, 0)
    end_dt   = datetime(period_end.year,   period_end.month,   period_end.day,   23, 59, 59)

    # ① Fully closed trades in window
    closed_rows = (
        db.query(Trade.realized_pnl)
        .filter(
            Trade.profile_id == profile_id,
            Trade.status == "closed",
            Trade.closed_at >= start_dt,
            Trade.closed_at <= end_dt,
        )
        .all()
    )
    closed_sum = sum((r[0] or Decimal("0")) for r in closed_rows)

    # ② Partial-TP profits — positions closed within the window
    #    belonging to a trade that is still 'partial'.
    partial_rows = (
        db.query(Position.realized_pnl)
        .join(Trade, Position.trade_id == Trade.id)
        .filter(
            Trade.profile_id == profile_id,
            Trade.status == "partial",
            Position.status == "closed",
            Position.exit_date >= start_dt,
            Position.exit_date <= end_dt,
        )
        .all()
    )
    partial_sum = sum((r[0] or Decimal("0")) for r in partial_rows)

    trade_count = len(closed_rows) + len(partial_rows)
    total_pnl = Decimal(str(closed_sum)) + Decimal(str(partial_sum))
    pnl_pct = (total_pnl / capital * 100).quantize(Decimal("0.0001"))
    return pnl_pct, trade_count


# Keep old name as alias for backward compatibility (used nowhere else but safer)
def _compute_pnl_pct(
    db: Session,
    profile_id: int,
    capital: Decimal,
    period_start: date,
    period_end: date,
) -> Decimal:
    pnl, _ = _compute_pnl_pct_and_count(db, profile_id, capital, period_start, period_end)
    return pnl


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
    """
    Create a new goal, or upsert if one already exists for the same
    (profile_id, style_id, period) tuple.

    If an existing goal is found (active or inactive):
      - update goal_pct, limit_pct with the new values
      - re-activate it (is_active=True)
    This prevents the UI from being blocked by a previously deactivated goal.
    """
    _get_profile_or_404(db, profile_id)
    _get_style_or_422(db, data.style_id)

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
        # Upsert: update values + reactivate
        existing.goal_pct = data.goal_pct
        existing.limit_pct = data.limit_pct
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing

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


def delete_goal(db: Session, profile_id: int, style_id: int, period: str) -> None:
    """Permanently delete a goal row."""
    goal = _get_goal_or_404(db, profile_id, style_id, period)
    db.delete(goal)
    db.commit()


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

        pnl_pct, trade_count = _compute_pnl_pct_and_count(
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

        # Progress toward risk limit (0–100+% scale: 100% = limit breached).
        # Both pnl_pct and limit_pct are negative when losing, so the ratio is positive.
        # When pnl_pct is positive (profit) the ratio would be negative → clamp to 0:
        # there is zero risk-limit consumption when you're in profit.
        if goal.limit_pct != 0 and pnl_pct < 0:
            risk_progress = max(
                Decimal("0.00"),
                (pnl_pct / goal.limit_pct * 100).quantize(Decimal("0.01")),
            )
        else:
            risk_progress = Decimal("0.00")

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
                trade_count=trade_count,
            )
        )

    return items
