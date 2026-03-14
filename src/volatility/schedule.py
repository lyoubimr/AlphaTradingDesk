"""
Phase 2 — Schedule filtering for Celery tasks.

Beat fires tasks at maximum frequency (crontab in celery_app.py).
At runtime, each task calls is_within_schedule() to decide whether
to actually run or skip gracefully.

The UI writes to volatility_settings.market_vi / per_pair JSONB.
is_within_schedule() reads those fields without any JSON schema
enforcement — missing keys fall back to safe defaults (always run).
"""

from __future__ import annotations

from datetime import UTC, datetime, time

from sqlalchemy.orm import Session

from src.volatility.models import VolatilitySettings


# ── Defaults (used when DB has no settings row or key is missing) ─────────────
_DEFAULT_MARKET_VI: dict = {
    "enabled": True,
    "active_hours_start": "00:00",
    "active_hours_end": "23:59",
    "weekdays_only": False,
}

_DEFAULT_PER_PAIR: dict = {
    "enabled": True,
    "active_hours_start": "00:00",
    "active_hours_end": "23:59",
    "weekdays_only": False,
}


def _parse_time(s: str) -> time:
    """Parse 'HH:MM' string to datetime.time. Returns midnight on bad input."""
    try:
        h, m = s.split(":")
        return time(int(h), int(m))
    except Exception:
        return time(0, 0)


def is_within_schedule(db: Session, component: str, profile_id: int | None = None) -> bool:
    """Return True if the task should execute right now.

    Args:
        db:           SQLAlchemy session.
        component:    'market_vi' or 'per_pair'
        profile_id:   When provided, use this profile's settings.
                      When None, use the first active settings row found
                      (Market VI is global — not per-profile).

    Decision logic:
      1. enabled == False → skip
      2. weekdays_only == True and today is Sat/Sun → skip
      3. now_utc outside [active_hours_start, active_hours_end] → skip
      4. Otherwise → run
    """
    cfg = _load_settings(db, component, profile_id)
    now_utc = datetime.now(UTC)

    if not cfg.get("enabled", True):
        return False

    if cfg.get("weekdays_only", False) and now_utc.weekday() >= 5:
        return False

    start = _parse_time(cfg.get("active_hours_start", "00:00"))
    end = _parse_time(cfg.get("active_hours_end", "23:59"))
    current = now_utc.time().replace(second=0, microsecond=0)

    # Handle overnight windows (e.g. 22:00 → 06:00) not needed in Phase 2
    # — all windows are within the same day. Keep it simple.
    return start <= current <= end


def _load_settings(db: Session, component: str, profile_id: int | None) -> dict:
    """Load the component config dict from DB, falling back to defaults."""
    defaults = _DEFAULT_MARKET_VI if component == "market_vi" else _DEFAULT_PER_PAIR

    try:
        query = db.query(VolatilitySettings)
        if profile_id is not None:
            query = query.filter(VolatilitySettings.profile_id == profile_id)
        row = query.first()

        if row is None:
            return defaults

        raw: dict = getattr(row, component, {}) or {}
        # Merge with defaults so missing keys don't crash callers
        return {**defaults, **raw}

    except Exception:
        # Never crash a task because of a settings read failure
        return defaults


def get_regime_thresholds(db: Session, profile_id: int | None = None) -> dict:
    """Return regime percentile thresholds from settings.

    6-band layout (each band ~0.167):
        DEAD      [0.00 – dead_max]      default 0.17
        CALM      [dead_max – calm_max]  default 0.33
        NORMAL    [calm_max – normal_max]  default 0.50
        TRENDING  [normal_max – trending_max]  default 0.67  ← best R:R zone
        ACTIVE    [trending_max – active_max]  default 0.83
        EXTREME   [active_max – 1.00]

    Returns:
        {"dead_max": 0.17, "calm_max": 0.33, "normal_max": 0.50,
         "trending_max": 0.67, "active_max": 0.83}
    """
    defaults = {
        "dead_max": 0.17,
        "calm_max": 0.33,
        "normal_max": 0.50,
        "trending_max": 0.67,
        "active_max": 0.83,
    }
    try:
        query = db.query(VolatilitySettings)
        if profile_id is not None:
            query = query.filter(VolatilitySettings.profile_id == profile_id)
        row = query.first()
        if row is None or not row.regimes:
            return defaults
        return {**defaults, **row.regimes}
    except Exception:
        return defaults


def score_to_regime(vi_score: float, thresholds: dict) -> str:
    """Map a VI score (0.0–1.0) to a regime label.

    Regime boundaries (configurable, defaults):
        DEAD     : 0.00 – dead_max      (0.17)
        CALM     : dead_max – calm_max  (0.33)
        NORMAL   : calm_max – normal_max (0.50)
        TRENDING : normal_max – trending_max (0.67)  ← directional move, best R:R
        ACTIVE   : trending_max – active_max (0.83)
        EXTREME  : active_max – 1.00
    """
    if vi_score <= thresholds["dead_max"]:
        return "DEAD"
    if vi_score <= thresholds["calm_max"]:
        return "CALM"
    if vi_score <= thresholds["normal_max"]:
        return "NORMAL"
    if vi_score <= thresholds["trending_max"]:
        return "TRENDING"
    if vi_score <= thresholds["active_max"]:
        return "ACTIVE"
    return "EXTREME"
