"""
Goals service — business logic for profile_goals CRUD and progress computation.

Key design decisions (Step 14):
  - style_id = NULL  → global goal (all styles, all trades of the profile)
  - style_id = X     → scoped goal (only trades of that style)
  - P&L computed on closed trades + partial-TP positions in the period window
  - circuit breaker (limit_hit) fires for period_type == 'outcome' only
  - avg_r computed from closed trades with risk_amount > 0
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from src.core.models.broker import Profile, TradingStyle
from src.core.models.goals import GoalOverrideLog, ProfileGoal
from src.core.models.trade import Position, Trade
from src.goals.schemas import (
    GoalCreate,
    GoalMatrixCreate,
    GoalOverrideCreate,
    GoalProgressItem,
    GoalUpdate,
)

# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_profile_or_404(db: Session, profile_id: int) -> Profile:
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")
    return profile


def _get_goal_by_id_or_404(db: Session, profile_id: int, goal_id: int) -> ProfileGoal:
    goal = db.query(ProfileGoal).filter(
        ProfileGoal.id == goal_id,
        ProfileGoal.profile_id == profile_id,
    ).first()
    if not goal:
        raise HTTPException(status_code=404, detail=f"Goal {goal_id} not found.")
    return goal


def _get_style_or_422(db: Session, style_id: int) -> TradingStyle:
    style = db.query(TradingStyle).filter(TradingStyle.id == style_id).first()
    if not style:
        raise HTTPException(status_code=422, detail=f"TradingStyle {style_id} not found.")
    return style


def _style_name(db: Session, style_id: int | None) -> str | None:
    if style_id is None:
        return None
    style = db.query(TradingStyle).filter(TradingStyle.id == style_id).first()
    return style.display_name if style else f"Style {style_id}"


def _period_window(period: str, ref: date) -> tuple[date, date]:
    """Return (start, end) inclusive for the period containing ref."""
    if period == "daily":
        return ref, ref
    if period == "weekly":
        start = ref - timedelta(days=ref.weekday())   # Monday
        return start, start + timedelta(days=6)       # Sunday
    if period == "monthly":
        start = ref.replace(day=1)
        if ref.month == 12:
            end = date(ref.year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(ref.year, ref.month + 1, 1) - timedelta(days=1)
        return start, end
    raise ValueError(f"Unknown period: {period}")


def _compute_period_data(
    db: Session,
    profile_id: int,
    style_id: int | None,
    capital: Decimal,
    period_start: date,
    period_end: date,
) -> tuple[Decimal, int, Decimal | None, list[dict]]:
    """
    Compute P&L for a period.

    style_id = None → all trades of the profile
    style_id = X    → only trades where trade.strategy.style_id == X

    Returns (pnl_pct, trade_count, avg_r, trades_list)
    """
    if capital == 0:
        return Decimal("0.0000"), 0, None, []

    start_dt = datetime(period_start.year, period_start.month, period_start.day, 0, 0, 0)
    end_dt   = datetime(period_end.year,   period_end.month,   period_end.day,   23, 59, 59)

    # Base query for closed trades in window
    closed_q = db.query(Trade).filter(
        Trade.profile_id == profile_id,
        Trade.status == "closed",
        Trade.closed_at >= start_dt,
        Trade.closed_at <= end_dt,
    )
    if style_id is not None:
        from src.core.models.trade import Strategy  # avoid circular at module level
        closed_q = closed_q.join(Strategy, Trade.strategy_id == Strategy.id).filter(
            Strategy.style_id == style_id
        )
    closed_trades = closed_q.all()

    closed_sum = sum((t.realized_pnl or Decimal("0")) for t in closed_trades)

    # Partial-TP positions in window
    partial_q = (
        db.query(Position)
        .join(Trade, Position.trade_id == Trade.id)
        .filter(
            Trade.profile_id == profile_id,
            Trade.status == "partial",
            Position.status == "closed",
            Position.exit_date >= start_dt,
            Position.exit_date <= end_dt,
        )
    )
    if style_id is not None:
        from src.core.models.trade import Strategy
        partial_q = partial_q.join(Strategy, Trade.strategy_id == Strategy.id).filter(
            Strategy.style_id == style_id
        )
    partial_positions = partial_q.all()
    partial_sum = sum((p.realized_pnl or Decimal("0")) for p in partial_positions)

    trade_count = len(closed_trades) + len(partial_positions)
    total_pnl = Decimal(str(closed_sum)) + Decimal(str(partial_sum))
    pnl_pct = (total_pnl / capital * 100).quantize(Decimal("0.0001"))

    # avg_r — closed trades only
    r_multiples = []
    for t in closed_trades:
        if t.risk_amount and t.risk_amount > 0 and t.realized_pnl is not None:
            r_multiples.append(
                (Decimal(str(t.realized_pnl)) / Decimal(str(t.risk_amount))).quantize(Decimal("0.01"))
            )
    avg_r: Decimal | None = None
    if r_multiples:
        avg_r = (sum(r_multiples, Decimal("0")) / len(r_multiples)).quantize(Decimal("0.01"))

    # Trades list for detail card (newest first, max 10)
    trades_list = sorted(
        [
            {
                "id": t.id,
                "pair": t.pair,
                "direction": t.direction,
                "realized_pnl": float(t.realized_pnl or 0),
                "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            }
            for t in closed_trades
        ],
        key=lambda x: x["closed_at"] or "",
        reverse=True,
    )[:10]

    return pnl_pct, trade_count, avg_r, trades_list


# ── Public service functions ──────────────────────────────────────────────────

def get_goals(db: Session, profile_id: int) -> list[dict]:
    """Return all goals with style_name populated."""
    _get_profile_or_404(db, profile_id)
    goals = (
        db.query(ProfileGoal)
        .filter(ProfileGoal.profile_id == profile_id)
        .order_by(ProfileGoal.style_id.nullsfirst(), ProfileGoal.period)
        .all()
    )
    result = []
    for g in goals:
        d = {
            "id": g.id,
            "profile_id": g.profile_id,
            "style_id": g.style_id,
            "style_name": _style_name(db, g.style_id),
            "period": g.period,
            "goal_pct": g.goal_pct,
            "limit_pct": g.limit_pct,
            "is_active": g.is_active,
            "avg_r_min": g.avg_r_min,
            "max_trades": g.max_trades,
            "period_type": g.period_type,
            "show_on_dashboard": g.show_on_dashboard,
            "created_at": g.created_at,
            "updated_at": g.updated_at,
        }
        result.append(d)
    return result


def create_goal(db: Session, profile_id: int, data: GoalCreate) -> dict:
    """Create a single goal. style_id=None = global."""
    _get_profile_or_404(db, profile_id)
    if data.style_id is not None:
        _get_style_or_422(db, data.style_id)

    # Check uniqueness manually (partial index in DB handles it, but give a nice error)
    q = db.query(ProfileGoal).filter(
        ProfileGoal.profile_id == profile_id,
        ProfileGoal.period == data.period,
    )
    if data.style_id is None:
        q = q.filter(ProfileGoal.style_id.is_(None))
    else:
        q = q.filter(ProfileGoal.style_id == data.style_id)
    existing = q.first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A goal already exists for this profile+style+period. Use PUT /goals/{existing.id} to update.",
        )

    goal = ProfileGoal(
        profile_id=profile_id,
        style_id=data.style_id,
        period=data.period,
        goal_pct=data.goal_pct,
        limit_pct=data.limit_pct,
        is_active=data.is_active,
        avg_r_min=data.avg_r_min,
        max_trades=data.max_trades,
        period_type=data.period_type,
        show_on_dashboard=data.show_on_dashboard,
    )
    db.add(goal)
    db.flush()
    db.refresh(goal)
    return _goal_to_dict(db, goal)


def create_goal_matrix(db: Session, profile_id: int, data: GoalMatrixCreate) -> list[dict]:
    """
    Create up to 3 goals at once from a matrix declaration.
    Enabled periods with goal_pct + limit_pct are created.
    Already-existing goals are updated (upsert).
    """
    _get_profile_or_404(db, profile_id)
    if data.style_id is not None:
        _get_style_or_422(db, data.style_id)

    created = []
    for period_name in ("daily", "weekly", "monthly"):
        entry = getattr(data, period_name)
        if not entry.enabled:
            continue
        if entry.goal_pct is None or entry.limit_pct is None:
            continue

        # Upsert
        q = db.query(ProfileGoal).filter(
            ProfileGoal.profile_id == profile_id,
            ProfileGoal.period == period_name,
        )
        if data.style_id is None:
            q = q.filter(ProfileGoal.style_id.is_(None))
        else:
            q = q.filter(ProfileGoal.style_id == data.style_id)
        existing = q.first()

        if existing:
            existing.goal_pct = entry.goal_pct
            existing.limit_pct = entry.limit_pct
            existing.avg_r_min = entry.avg_r_min
            existing.max_trades = entry.max_trades
            existing.period_type = entry.period_type
            existing.show_on_dashboard = data.show_on_dashboard
            existing.is_active = True
            db.flush()
            created.append(_goal_to_dict(db, existing))
        else:
            goal = ProfileGoal(
                profile_id=profile_id,
                style_id=data.style_id,
                period=period_name,
                goal_pct=entry.goal_pct,
                limit_pct=entry.limit_pct,
                is_active=True,
                avg_r_min=entry.avg_r_min,
                max_trades=entry.max_trades,
                period_type=entry.period_type,
                show_on_dashboard=data.show_on_dashboard,
            )
            db.add(goal)
            db.flush()
            db.refresh(goal)
            created.append(_goal_to_dict(db, goal))

    return created


def _goal_to_dict(db: Session, g: ProfileGoal) -> dict:
    return {
        "id": g.id,
        "profile_id": g.profile_id,
        "style_id": g.style_id,
        "style_name": _style_name(db, g.style_id),
        "period": g.period,
        "goal_pct": g.goal_pct,
        "limit_pct": g.limit_pct,
        "is_active": g.is_active,
        "avg_r_min": g.avg_r_min,
        "max_trades": g.max_trades,
        "period_type": g.period_type,
        "show_on_dashboard": g.show_on_dashboard,
        "created_at": g.created_at,
        "updated_at": g.updated_at,
    }


def update_goal(db: Session, profile_id: int, goal_id: int, data: GoalUpdate) -> dict:
    goal = _get_goal_by_id_or_404(db, profile_id, goal_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.flush()
    db.refresh(goal)
    return _goal_to_dict(db, goal)


def delete_goal(db: Session, profile_id: int, goal_id: int) -> None:
    goal = _get_goal_by_id_or_404(db, profile_id, goal_id)
    db.delete(goal)
    db.flush()


def get_progress(db: Session, profile_id: int) -> list[GoalProgressItem]:
    """Compute real-time progress for all active goals of a profile."""
    profile = _get_profile_or_404(db, profile_id)
    active_goals = (
        db.query(ProfileGoal)
        .filter(ProfileGoal.profile_id == profile_id, ProfileGoal.is_active.is_(True))
        .all()
    )

    today = date.today()
    items: list[GoalProgressItem] = []

    for goal in active_goals:
        period_start, period_end = _period_window(goal.period, today)
        pnl_pct, trade_count, avg_r, trades_list = _compute_period_data(
            db, profile_id, goal.style_id,
            profile.capital_current,
            period_start, period_end,
        )

        goal_progress = (
            (pnl_pct / goal.goal_pct * 100).quantize(Decimal("0.01"))
            if goal.goal_pct != 0 else Decimal("0.00")
        )

        # risk_progress is always computed from P&L — regardless of period_type.
        # Changing type from outcome → process does NOT erase accumulated losses.
        # limit_hit (circuit-breaker) only fires for 'outcome' goals by design.
        risk_progress = Decimal("0.00")
        if goal.limit_pct != 0 and pnl_pct < 0:
            risk_progress = max(
                Decimal("0.00"),
                (pnl_pct / goal.limit_pct * 100).quantize(Decimal("0.01")),
            )

        limit_hit = pnl_pct <= goal.limit_pct if goal.period_type == "outcome" else False
        avg_r_hit = (avg_r >= goal.avg_r_min) if goal.avg_r_min and avg_r else None
        max_trades_hit = (trade_count >= goal.max_trades) if goal.max_trades else None

        items.append(GoalProgressItem(
            goal_id=goal.id,
            style_id=goal.style_id,
            style_name=_style_name(db, goal.style_id),
            period=goal.period,
            period_start=period_start.isoformat(),
            period_end=period_end.isoformat(),
            pnl_pct=pnl_pct,
            goal_pct=goal.goal_pct,
            limit_pct=goal.limit_pct,
            goal_progress_pct=goal_progress,
            risk_progress_pct=risk_progress,
            goal_hit=pnl_pct >= goal.goal_pct,
            limit_hit=limit_hit,
            trade_count=trade_count,
            avg_r=avg_r,
            avg_r_min=goal.avg_r_min,
            avg_r_hit=avg_r_hit,
            max_trades_hit=max_trades_hit,
            period_type=goal.period_type,
            show_on_dashboard=goal.show_on_dashboard,
            trades=trades_list,
        ))

    return items


# ── Goal Override Log ─────────────────────────────────────────────────────────

def create_override(db: Session, profile_id: int, data: GoalOverrideCreate) -> GoalOverrideLog:
    _get_profile_or_404(db, profile_id)
    override = GoalOverrideLog(
        profile_id=profile_id,
        style_id=data.style_id,
        period=data.period,
        period_start=data.period_start,
        pnl_pct_at_override=data.pnl_pct_at_override,
        open_risk_pct=data.open_risk_pct,
        reason_text=data.reason_text,
        acknowledged=data.acknowledged,
    )
    db.add(override)
    db.commit()
    db.refresh(override)
    return override


def list_overrides(db: Session, profile_id: int) -> list[GoalOverrideLog]:
    _get_profile_or_404(db, profile_id)
    return (
        db.query(GoalOverrideLog)
        .filter(GoalOverrideLog.profile_id == profile_id)
        .order_by(GoalOverrideLog.overridden_at.desc())
        .all()
    )
