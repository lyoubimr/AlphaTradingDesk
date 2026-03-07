"""
Pydantic schemas for Stats endpoints.

Win-rate architecture — three independent levels:

  Strategy-level WR  (per strategy)
    Source : strategies.win_count / strategies.trades_count
    Scope  : only trades that used this specific strategy
    Updated: atomically on every full_close when strategy_id is set

  Profile-level WR   (per profile)
    Source : profiles.win_count / profiles.trades_count
    Scope  : ALL closed trades of this profile, regardless of strategy
    Updated: atomically on every full_close (always, no strategy required)

  Global WR          (cross-profile, frontend-computed)
    Source : computed in the frontend as mean of per-profile WR values
    Scope  : average of each profile's individual win rate
    Not stored anywhere — derived on the fly
"""

from __future__ import annotations

from pydantic import BaseModel


class ProfileWinRate(BaseModel):
    """
    Win-rate stats for a single profile.
    Source: profiles.trades_count / profiles.win_count (NOT strategy aggregation).
    These counters are updated atomically on every trade close, regardless of
    whether the trade had a strategy assigned.
    """

    profile_id: int
    profile_name: str
    trades_total: int  # profiles.trades_count
    wins_total: int  # profiles.win_count
    win_rate_pct: float | None  # None → min_trades threshold not reached yet
    has_data: bool  # True when trades_total >= MIN_TRADES_THRESHOLD


# Minimum closed trades before a profile's WR is considered reliable.
# Mirrors the strategy-level min_trades_for_stats logic.
MIN_PROFILE_TRADES = 5


class WinRateStats(BaseModel):
    """
    Full response for GET /api/stats/winrate.

    The global win rate is intentionally NOT included here.
    It is computed in the frontend as:
        global_wr = mean(p.win_rate_pct for p in profiles if p.has_data)
    This avoids double-computing and keeps the contract simple.
    """

    profiles: list[ProfileWinRate]
