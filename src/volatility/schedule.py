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

    Returns:
        {"mort_max": 0.20, "calme_max": 0.40, "normal_max": 0.60, "actif_max": 0.80}
    """
    defaults = {
        "mort_max": 0.20,
        "calme_max": 0.40,
        "normal_max": 0.60,
        "actif_max": 0.80,
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
        MORT    : 0.00 – mort_max  (0.20)
        CALME   : mort_max – calme_max (0.40)
        NORMAL  : calme_max – normal_max (0.60)
        ACTIF   : normal_max – actif_max (0.80)
        EXTREME : actif_max – 1.00
    """
    if vi_score <= thresholds["mort_max"]:
        return "MORT"
    if vi_score <= thresholds["calme_max"]:
        return "CALME"
    if vi_score <= thresholds["normal_max"]:
        return "NORMAL"
    if vi_score <= thresholds["actif_max"]:
        return "ACTIF"
    return "EXTREME"
