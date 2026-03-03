"""
Stats router — aggregated performance metrics.

Routes:
  GET /api/stats/winrate
    → Win-rate stats per profile, sourced from profiles.trades_count / win_count.
    → These counters are updated atomically on every trade close, regardless of
      whether the trade had a strategy assigned.

    Three win-rate levels exist in the app:
      1. Strategy WR  — strategies.win_count / trades_count  (per strategy)
      2. Profile WR   — profiles.win_count  / trades_count  (per profile, all trades)
      3. Global WR    — computed in frontend: mean(profile.win_rate_pct)

    This endpoint only returns level 2 (profile WR).
    Level 1 is exposed via GET /api/profiles/{id}/strategies.
    Level 3 is derived in the frontend.

  Query params:
    profile_id (optional) : if supplied, restrict to that profile only.

Usage:
  GET /api/stats/winrate              → all active profiles
  GET /api/stats/winrate?profile_id=3 → profile 3 only
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.core.models.broker import Profile
from src.stats.schemas import MIN_PROFILE_TRADES, ProfileWinRate, WinRateStats

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/winrate", response_model=WinRateStats)
def get_winrate_stats(
    profile_id: int | None = Query(default=None, description="Filter to a single profile"),
    db: Session = Depends(get_db),
) -> WinRateStats:
    """
    Return profile-level win-rate stats.

    Source: profiles.trades_count and profiles.win_count.
    These are incremented atomically on every full_close, so they include
    all closed trades regardless of strategy assignment.

    The global WR (average across all profiles) is intentionally computed
    in the frontend to keep this endpoint simple and cacheable.
    """
    q = db.query(Profile).filter(Profile.status != "deleted")
    if profile_id is not None:
        q = q.filter(Profile.id == profile_id)
    profiles = q.order_by(Profile.id).all()

    result: list[ProfileWinRate] = []
    for p in profiles:
        has_data = p.trades_count >= MIN_PROFILE_TRADES
        win_rate_pct: float | None = None
        if has_data and p.trades_count > 0:
            win_rate_pct = round(p.win_count / p.trades_count * 100, 1)

        result.append(
            ProfileWinRate(
                profile_id=p.id,
                profile_name=p.name,
                trades_total=p.trades_count,
                wins_total=p.win_count,
                win_rate_pct=win_rate_pct,
                has_data=has_data,
            )
        )

    return WinRateStats(profiles=result)

