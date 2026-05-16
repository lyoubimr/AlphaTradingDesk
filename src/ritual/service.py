"""
Ritual Module — Service layer.

Handles:
  - Settings CRUD (JSONB pattern with auto-init)
  - Pinned pairs management + TTL + suspension + extend
  - Step template seeding + CRUD
  - Session lifecycle (start → steps → complete/abandon)
  - Smart Watchlist scoring algorithm
  - Discipline score computation
"""

from __future__ import annotations

import io

# ── Internal helpers ──────────────────────────────────────────────────────────
import logging
from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Profile
from src.core.models.trade import Trade
from src.ritual.models import (
    RitualPinnedPair,
    RitualSession,
    RitualSettings,
    RitualStep,
    RitualStepLog,
    RitualWeeklyScore,
)
from src.ritual.schemas import (
    DEFAULT_RITUAL_CONFIG,
    DEFAULT_STEPS,
    DISCIPLINE_POINTS,
    MAX_WEEKLY_SCORE,
    MAX_WEEKLY_SCORE_SPOT,
    MODULE_PATHS,
    SESSION_EMOJIS,
    SESSION_LABELS,
    STEP_EMOJIS,
    TTL_HOURS,
    PinnedPairCreate,
    PinnedPairExtend,
    PinnedPairRead,
    PinnedTVEntry,
    SessionComplete,
    SessionRead,
    SmartWLPairEntry,
    SmartWLResult,
    StepComplete,
    StepLogRead,
    StepRead,
    WeeklyScoreRead,
)
from src.spot_volatility.models import SpotWatchlistSnapshot
from src.volatility.models import WatchlistSnapshot

logger = logging.getLogger(__name__)

_ACTIVE_TRADE_STATUSES = ("pending", "open", "partial", "runner")

# ── Live EMA refresh — staleness thresholds ───────────────────────────────────
# If the latest watchlist snapshot is older than these bounds, we refetch live
# candles for the top candidates and recompute only the EMA signal/score.
# Thresholds mirror the Celery beat cadence so we refresh exactly once per cycle.
_TF_STALE_SECONDS: dict[str, int] = {
    "15m": 15 * 60,
    "1h":  60 * 60,
    "4h":  4 * 60 * 60,
    "1d":  24 * 60 * 60,
    "1w":  7 * 24 * 60 * 60,
}
# Local copies of TF params — avoids importing tasks.py (pulls in Celery)
_TF_EMA_REF_LOCAL: dict[str, int]           = {"15m": 55, "1h": 99, "4h": 200, "1d": 99, "1w": 55}
_TF_CANDLE_LIMIT_LOCAL: dict[str, int]      = {"15m": 700, "1h": 500, "4h": 500, "1d": 500, "1w": 220}
_TF_BREAKOUT_LOOKBACK_LOCAL: dict[str, int] = {"15m": 30, "1h": 24, "4h": 15, "1d": 10, "1w": 7}
def _refresh_vi_scores(
    pairs_data: list[dict],
    timeframe: str,
    is_spot: bool,
    top_n_candidates: int,
) -> dict[str, dict]:
    """Fetch live candles for top N×3 candidates and recompute full VI score.

    Returns {symbol: {"vi_score": float, "ema_signal": str, "ema_score": float}}.
    Falls back silently to empty dict on any error — caller uses snapshot values.
    """
    candidates = sorted(
        pairs_data, key=lambda x: float(x.get("vi_score", 0)), reverse=True
    )[: top_n_candidates * 3]
    if not candidates:
        return {}

    tf_key = timeframe.lower()
    ema_ref   = _TF_EMA_REF_LOCAL.get(tf_key, 50)
    limit     = _TF_CANDLE_LIMIT_LOCAL.get(tf_key, 500)
    bo_lookback = _TF_BREAKOUT_LOOKBACK_LOCAL.get(tf_key, 15)

    refreshed: dict[str, dict] = {}
    try:
        if is_spot:
            from src.spot_volatility.kraken_spot_client import KrakenSpotClient  # noqa: PLC0415
            client_cls = KrakenSpotClient
        else:
            from src.volatility.kraken_client import KrakenClient  # noqa: PLC0415
            client_cls = KrakenClient  # type: ignore[assignment]

        from src.volatility.indicators import compute_vi_score  # noqa: PLC0415

        with client_cls() as client:
            for entry in candidates:
                symbol = entry.get("pair", "")
                if not symbol:
                    continue
                try:
                    candles = client.fetch_ohlcv(symbol, tf_key, limit=limit)
                    result = compute_vi_score(
                        candles, None, ema_ref,
                        None, None, bo_lookback,
                    )
                    refreshed[symbol] = {
                        "vi_score": float(result.get("vi_score", entry.get("vi_score", 0.0))),
                        "ema_signal": result.get("ema_signal", entry.get("ema_signal", "")),
                        "ema_score": float(result.get("ema_score", entry.get("ema_score", 0.0))),
                    }
                except Exception as pair_exc:  # noqa: BLE001
                    logger.debug("_refresh_vi_scores: %s/%s failed — %s", symbol, tf_key, pair_exc)
    except Exception as exc:  # noqa: BLE001
        logger.warning("_refresh_vi_scores: client error for %s — %s", tf_key, exc)

    return refreshed


def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _deep_merge(base: dict, patch: dict) -> dict:
    """Recursively merge patch into base — base keys not in patch are preserved."""
    result = deepcopy(base)
    for key, val in patch.items():
        if isinstance(val, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def _display_name(pair: str) -> str:
    """Derive a short human-readable label from a Kraken pair symbol.

    'PF_ORCAUSD' → 'ORCA'   'PI_XBTUSD' → 'XBT'
    'XBT/USD'    → 'XBT'    'ETH/USDT'  → 'ETH'
    """
    p = pair.upper()
    if p.startswith(("PF_", "PI_")):
        p = p[3:]
    if "/" in p:
        return p.split("/")[0]
    for suffix in ("USDT", "USD", "BTC", "ETH"):
        if p.endswith(suffix) and len(p) > len(suffix):
            return p[: -len(suffix)]
    return p


def _to_tv_symbol(pair: str, exchange: str = "KRAKEN") -> str:
    """Convert ATD pair format to TradingView symbol.

    'XBT/USD'    → 'KRAKEN:XBTUSD'
    'ETH/BTC'    → 'KRAKEN:ETHBTC'
    'PF_ORCAUSD' → 'KRAKEN:ORCAUSD.PM'  (Kraken perpetual — .PM suffix)
    'PI_XBTUSD'  → 'KRAKEN:XBTUSD.PM'   (Kraken perpetual — .PM suffix)
    """
    p = pair.upper()
    if p.startswith(("PF_", "PI_")):
        return f"KRAKEN:{p[3:]}.PM"  # strip PF_/PI_ prefix, add .PM suffix
    clean = p.replace("/", "").replace("-", "").replace(".", "")
    return f"{exchange}:{clean}"


def _get_profile_or_404(db: Session, profile_id: int) -> Profile:
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")
    return profile


def _has_open_trade(db: Session, profile_id: int, pair: str) -> bool:
    """Return True if there is an active trade (incl. pending limit orders) for this pair."""
    return bool(
        db.query(Trade)
        .filter(
            Trade.profile_id == profile_id,
            Trade.pair == pair,
            Trade.status.in_(_ACTIVE_TRADE_STATUSES),
        )
        .first()
    )


def _monday_of(dt: date) -> date:
    return dt - timedelta(days=dt.weekday())


def _month_start(dt: date) -> date:
    return dt.replace(day=1)


def _enrich_step(step: RitualStep) -> StepRead:
    data = StepRead.model_validate(step)
    data.emoji = STEP_EMOJIS.get(step.step_type, "🔷")
    if step.linked_module:
        data.module_path = MODULE_PATHS.get(step.linked_module)
    return data


def _enrich_step_log(log: RitualStepLog) -> StepLogRead:
    data = StepLogRead.model_validate(log)
    data.emoji = STEP_EMOJIS.get(log.step_type, "🔷")
    return data


def _enrich_session(session: RitualSession) -> SessionRead:
    data = SessionRead.model_validate(session)
    data.session_label = SESSION_LABELS.get(session.session_type, session.session_type)
    data.session_emoji = SESSION_EMOJIS.get(session.session_type, "📋")
    if session.ended_at and session.started_at:
        delta = session.ended_at - session.started_at
        data.duration_minutes = round(delta.total_seconds() / 60, 1)
    data.step_logs = [_enrich_step_log(log) for log in session.step_logs]
    return data


def _enrich_pinned(pin: RitualPinnedPair, db: Session) -> PinnedPairRead:
    data = PinnedPairRead.model_validate(pin)
    now = _utcnow()

    # Ensure expires_at is timezone-aware for comparison
    expires = pin.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    pinned_at = pin.pinned_at
    if pinned_at.tzinfo is None:
        pinned_at = pinned_at.replace(tzinfo=UTC)

    total_ttl = (expires - pinned_at).total_seconds()
    remaining = (expires - now).total_seconds()
    data.hours_remaining = round(max(remaining, 0) / 3600, 2)
    data.ttl_pct = round(max(remaining, 0) / total_ttl, 3) if total_ttl > 0 else 0.0
    data.is_suspended = _has_open_trade(db, pin.profile_id, pin.pair)
    return data


# ── Settings ──────────────────────────────────────────────────────────────────

def get_ritual_settings(profile_id: int, db: Session) -> RitualSettings:
    """Return settings row, auto-creating with defaults if absent."""
    _get_profile_or_404(db, profile_id)
    row = db.query(RitualSettings).filter_by(profile_id=profile_id).first()
    if row is None:
        row = RitualSettings(
            profile_id=profile_id, config=deepcopy(DEFAULT_RITUAL_CONFIG)
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_ritual_settings(
    profile_id: int, patch: dict[str, Any], db: Session
) -> RitualSettings:
    row = get_ritual_settings(profile_id, db)
    row.config = _deep_merge(row.config, patch)
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


# ── Step templates ────────────────────────────────────────────────────────────

def _seed_steps(profile_id: int, db: Session) -> None:
    """Seed default step templates for a profile — skips positions that already exist."""
    # Build set of (session_type, position) already in DB for this profile
    existing = {
        (r.session_type, r.position)
        for r in db.query(RitualStep.session_type, RitualStep.position)
        .filter_by(profile_id=profile_id)
        .all()
    }
    for session_type, steps in DEFAULT_STEPS.items():
        for step_dict in steps:
            if (session_type, step_dict["position"]) in existing:
                continue  # already seeded, skip to avoid UniqueViolation
            db.add(RitualStep(profile_id=profile_id, session_type=session_type, **step_dict))
    db.commit()


def _sync_step_labels(profile_id: int, session_type: str, rows: list, db: Session) -> None:
    """Silently update step labels/configs that differ from current DEFAULT_STEPS.

    Also inserts any new step positions that exist in DEFAULT_STEPS but not yet
    in the DB (e.g. when a new step is added to an existing session template).
    """
    defaults = DEFAULT_STEPS.get(session_type, [])
    default_by_pos: dict[int, dict] = {d["position"]: d for d in defaults}
    existing_positions = {row.position for row in rows}
    changed = False

    # Update labels/configs/step_type of existing rows
    for row in rows:
        default = default_by_pos.get(row.position)
        if not default:
            continue
        if row.step_type != default["step_type"]:
            row.step_type = default["step_type"]
            changed = True
        if row.label != default["label"]:
            row.label = default["label"]
            changed = True
        default_config = default.get("config", {})
        if row.config != default_config:
            row.config = default_config
            changed = True

    # Insert new steps for positions not yet in DB
    for pos, default in default_by_pos.items():
        if pos not in existing_positions:
            db.add(RitualStep(profile_id=profile_id, session_type=session_type, **default))
            changed = True

    if changed:
        db.commit()


def get_steps(
    profile_id: int, session_type: str, db: Session
) -> list[StepRead]:
    _get_profile_or_404(db, profile_id)
    rows = (
        db.query(RitualStep)
        .filter_by(profile_id=profile_id, session_type=session_type)
        .order_by(RitualStep.position)
        .all()
    )
    if not rows:
        _seed_steps(profile_id, db)
        rows = (
            db.query(RitualStep)
            .filter_by(profile_id=profile_id, session_type=session_type)
            .order_by(RitualStep.position)
            .all()
        )
    _sync_step_labels(profile_id, session_type, rows, db)
    return [_enrich_step(s) for s in rows]


def update_step(
    profile_id: int, step_id: int, payload: dict[str, Any], db: Session
) -> StepRead:
    step = (
        db.query(RitualStep)
        .filter_by(id=step_id, profile_id=profile_id)
        .first()
    )
    if not step:
        raise HTTPException(status_code=404, detail=f"Step {step_id} not found.")
    for field, value in payload.items():
        if value is not None and hasattr(step, field):
            setattr(step, field, value)
    db.commit()
    db.refresh(step)
    return _enrich_step(step)


def reset_steps(profile_id: int, session_type: str, db: Session) -> list[StepRead]:
    """Delete and re-seed default steps for this session type."""
    _get_profile_or_404(db, profile_id)
    db.query(RitualStep).filter_by(
        profile_id=profile_id, session_type=session_type
    ).delete()
    db.commit()
    steps_data = DEFAULT_STEPS.get(session_type, [])
    for step_dict in steps_data:
        step = RitualStep(
            profile_id=profile_id, session_type=session_type, **step_dict
        )
        db.add(step)
    db.commit()
    return get_steps(profile_id, session_type, db)


# ── Pinned Pairs ──────────────────────────────────────────────────────────────

def _expire_stale_pins(profile_id: int, db: Session) -> None:
    """Mark expired pins as 'expired' unless TTL is suspended by an open trade."""
    now = _utcnow()
    stale = (
        db.query(RitualPinnedPair)
        .filter(
            RitualPinnedPair.profile_id == profile_id,
            RitualPinnedPair.status == "active",
            RitualPinnedPair.expires_at <= now,
        )
        .all()
    )
    changed = False
    for pin in stale:
        if not _has_open_trade(db, profile_id, pin.pair):
            pin.status = "expired"
            changed = True
    if changed:
        db.commit()


def list_pinned(
    profile_id: int, db: Session, include_expired: bool = False
) -> list[PinnedPairRead]:
    _get_profile_or_404(db, profile_id)
    _expire_stale_pins(profile_id, db)

    q = db.query(RitualPinnedPair).filter_by(profile_id=profile_id)
    if not include_expired:
        q = q.filter(RitualPinnedPair.status == "active")
    rows = q.order_by(RitualPinnedPair.timeframe, RitualPinnedPair.pinned_at.desc()).all()
    return [_enrich_pinned(pin, db) for pin in rows]


def add_pinned(
    profile_id: int, payload: PinnedPairCreate, db: Session
) -> PinnedPairRead:
    _get_profile_or_404(db, profile_id)
    ttl_h = TTL_HOURS.get(payload.timeframe, 24)
    now = _utcnow()
    tv_symbol = payload.tv_symbol or _to_tv_symbol(payload.pair)
    pin = RitualPinnedPair(
        profile_id=profile_id,
        pair=payload.pair.upper(),
        tv_symbol=tv_symbol,
        timeframe=payload.timeframe,
        note=payload.note,
        source=payload.source,
        pinned_at=now,
        expires_at=now + timedelta(hours=ttl_h),
        status="active",
    )
    db.add(pin)
    db.commit()
    db.refresh(pin)
    return _enrich_pinned(pin, db)


def remove_pinned(profile_id: int, pin_id: int, db: Session) -> None:
    pin = (
        db.query(RitualPinnedPair)
        .filter_by(id=pin_id, profile_id=profile_id)
        .first()
    )
    if not pin:
        raise HTTPException(status_code=404, detail=f"Pinned pair {pin_id} not found.")
    pin.status = "archived"
    db.commit()


def extend_pinned(
    profile_id: int, pin_id: int, payload: PinnedPairExtend, db: Session
) -> PinnedPairRead:
    pin = (
        db.query(RitualPinnedPair)
        .filter_by(id=pin_id, profile_id=profile_id)
        .first()
    )
    if not pin:
        raise HTTPException(status_code=404, detail=f"Pinned pair {pin_id} not found.")
    now = _utcnow()
    expires = pin.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if payload.hours >= 0:
        base = max(expires, now)
        pin.expires_at = base + timedelta(hours=payload.hours)
    else:
        # Reduce: subtract directly from current expiry, floor at now + 1h
        pin.expires_at = max(expires + timedelta(hours=payload.hours), now + timedelta(hours=1))
    if pin.status == "expired":
        pin.status = "active"
    db.commit()
    db.refresh(pin)
    return _enrich_pinned(pin, db)


def generate_pinned_tv_export(profile_id: int, db: Session) -> bytes:
    """Build a TradingView-importable .txt from active pinned pairs only.

    - No smart WL pre-generation required — pure DB read.
    - Groups pins by canonical TF order: 1W > 1D > 4H > 1H > 15m.
    - Falls back to _to_tv_symbol(pair) when tv_symbol is not set.
    - Returns an info message (not empty) when no active pins exist.
    """
    _CANONICAL = ["1W", "1D", "4H", "1H", "15m"]
    _TF_EMOJI = {"1W": "🟣", "1D": "🔵", "4H": "⏳", "1H": "🟢", "15m": "⚡"}

    pins = (
        db.query(RitualPinnedPair)
        .filter_by(profile_id=profile_id, status="active")
        .order_by(RitualPinnedPair.timeframe, RitualPinnedPair.pinned_at.desc())
        .all()
    )

    # Market indices section: read from ritual_settings config (same field used by smart WL).
    # Falls back to DEFAULT_RITUAL_CONFIG values if the profile has never customised them.
    settings_row = get_ritual_settings(profile_id, db)
    cfg = settings_row.config if isinstance(settings_row.config, dict) else {}
    market_indices: list[str] = cfg.get(
        "market_analysis_pairs",
        DEFAULT_RITUAL_CONFIG["market_analysis_pairs"],
    )

    buf = io.StringIO()
    # Always prepend the market indices section
    buf.write("###📊 Market###\n")
    for sym in market_indices:
        buf.write(f"{sym}\n")
    buf.write("\n")

    if not pins:
        return buf.getvalue().encode()

    by_tf: dict[str, list[str]] = {}
    for pin in pins:
        symbol = pin.tv_symbol or _to_tv_symbol(pin.pair)
        by_tf.setdefault(pin.timeframe, []).append(symbol)

    for tf in _CANONICAL:
        if tf not in by_tf:
            continue
        emoji = _TF_EMOJI.get(tf, "📌")
        buf.write(f"###{emoji} {tf}###\n")
        for sym in by_tf[tf]:
            buf.write(f"{sym}\n")
        buf.write("\n")

    return buf.getvalue().encode()


# ── Sessions ─────────────────────────────────────────────────────────────────

def list_sessions(
    profile_id: int, db: Session, limit: int = 20
) -> list[SessionRead]:
    _get_profile_or_404(db, profile_id)
    rows = (
        db.query(RitualSession)
        .filter_by(profile_id=profile_id)
        .order_by(RitualSession.started_at.desc())
        .limit(limit)
        .all()
    )
    return [_enrich_session(s) for s in rows]


def get_active_session(profile_id: int, db: Session) -> SessionRead | None:
    """Return the current in_progress session if any."""
    row = (
        db.query(RitualSession)
        .filter_by(profile_id=profile_id, status="in_progress")
        .order_by(RitualSession.started_at.desc())
        .first()
    )
    return _enrich_session(row) if row else None


def start_session(
    profile_id: int, session_type: str, db: Session
) -> SessionRead:
    _get_profile_or_404(db, profile_id)

    # Abandon any stale in_progress sessions for this profile
    stale = (
        db.query(RitualSession)
        .filter_by(profile_id=profile_id, status="in_progress")
        .all()
    )
    for s in stale:
        s.status = "abandoned"
        s.ended_at = _utcnow()
    if stale:
        db.commit()

    # Create session
    session = RitualSession(
        profile_id=profile_id,
        session_type=session_type,
        status="in_progress",
    )
    db.add(session)
    db.flush()  # get session.id

    # Seed step logs from step templates
    steps = (
        db.query(RitualStep)
        .filter_by(profile_id=profile_id, session_type=session_type)
        .order_by(RitualStep.position)
        .all()
    )
    if not steps:
        _seed_steps(profile_id, db)
        steps = (
            db.query(RitualStep)
            .filter_by(profile_id=profile_id, session_type=session_type)
            .order_by(RitualStep.position)
            .all()
        )

    for step in steps:
        log = RitualStepLog(
            ritual_session_id=session.id,
            step_id=step.id,
            step_type=step.step_type,
            position=step.position,
            status="pending",
        )
        db.add(log)

    db.commit()
    db.refresh(session)
    return _enrich_session(session)


def complete_step(
    profile_id: int,
    session_id: int,
    step_log_id: int,
    payload: StepComplete,
    db: Session,
) -> StepLogRead:
    session = (
        db.query(RitualSession)
        .filter_by(id=session_id, profile_id=profile_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail="Session is not in progress.")

    log = (
        db.query(RitualStepLog)
        .filter_by(id=step_log_id, ritual_session_id=session_id)
        .first()
    )
    if not log:
        raise HTTPException(status_code=404, detail=f"Step log {step_log_id} not found.")

    log.status = payload.status
    log.completed_at = _utcnow()
    log.output = payload.output or {}
    db.commit()
    db.refresh(log)
    return _enrich_step_log(log)


def close_session(
    profile_id: int,
    session_id: int,
    payload: SessionComplete,
    abandon: bool,
    db: Session,
) -> SessionRead:
    session = (
        db.query(RitualSession)
        .filter_by(id=session_id, profile_id=profile_id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found.")
    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail="Session is not in progress.")

    now = _utcnow()
    session.ended_at = now
    session.status = "abandoned" if abandon else "completed"
    session.notes = payload.notes

    if not abandon:
        # Validate outcome for trade_session
        if session.session_type == "trade_session" and not payload.outcome:
            raise HTTPException(
                status_code=422,
                detail="outcome is required to complete a trade_session.",
            )
        session.outcome = payload.outcome
        # Compute and record discipline points
        pts = _compute_discipline_points(session, payload, db)
        session.discipline_points = pts
        profile = _get_profile_or_404(db, profile_id)
        is_spot = getattr(profile, "account_type", "contracts") == "spot"
        _update_weekly_score(profile_id, pts, session, db, is_spot=is_spot)

    db.commit()
    db.refresh(session)
    return _enrich_session(session)


# ── Discipline Score ──────────────────────────────────────────────────────────

def _compute_discipline_points(
    session: RitualSession, payload: SessionComplete, db: Session
) -> int:
    stype = session.session_type
    outcome = payload.outcome

    if stype == "weekly_setup":
        return DISCIPLINE_POINTS["weekly_setup_done"]
    if stype == "trade_session":
        base = DISCIPLINE_POINTS["trade_session_done"]
        if outcome in ("no_opportunity", "pairs_pinned"):
            base += DISCIPLINE_POINTS["no_opportunity"]
        elif outcome == "vol_too_low":
            base += DISCIPLINE_POINTS["vol_too_low_trade"]
        return base
    if stype == "weekend_review":
        return DISCIPLINE_POINTS["weekend_review_done"]
    if stype == "weekend_trading":
        return DISCIPLINE_POINTS["weekend_trading_done"]
    if stype == "spot_monthly":
        return DISCIPLINE_POINTS["spot_monthly_done"]
    if stype == "spot_weekly":
        return DISCIPLINE_POINTS["spot_weekly_done"]
    return 0


def _update_weekly_score(
    profile_id: int,
    points: int,
    session: RitualSession,
    db: Session,
    *,
    is_spot: bool = False,
) -> None:
    today = session.started_at.date() if hasattr(session.started_at, "date") else date.today()
    period_start = _month_start(today) if is_spot else _monday_of(today)
    max_score = MAX_WEEKLY_SCORE_SPOT if is_spot else MAX_WEEKLY_SCORE

    row = (
        db.query(RitualWeeklyScore)
        .filter_by(profile_id=profile_id, week_start=period_start)
        .first()
    )
    if not row:
        row = RitualWeeklyScore(
            profile_id=profile_id,
            week_start=period_start,
            score=0,
            max_score=max_score,
            details={
                "sessions": {
                    "weekly_setup": 0,
                    "trade_session": 0,
                    "weekend_review": 0,
                    "weekend_trading": 0,
                    "spot_monthly": 0,
                    "spot_weekly": 0,
                },
                "bonuses": {"no_opportunity": 0, "pairs_pinned": 0},
                "penalties": {"vol_too_low_trade": 0},
                "points_breakdown": [],
            },
        )
        db.add(row)

    row.score = max(0, row.score + points)
    details = deepcopy(row.details)
    details["sessions"][session.session_type] = (
        details["sessions"].get(session.session_type, 0) + 1
    )
    if session.outcome in ("no_opportunity", "pairs_pinned"):
        key = session.outcome
        details["bonuses"][key] = (
            details["bonuses"].get(key, 0) + 1
        )
    if session.outcome == "vol_too_low":
        details["penalties"]["vol_too_low_trade"] = (
            details["penalties"].get("vol_too_low_trade", 0) + 1
        )
    details["points_breakdown"].append(
        {
            "label": f"{SESSION_LABELS.get(session.session_type, session.session_type)}"
            + (f" — {session.outcome}" if session.outcome else ""),
            "points": points,
            "at": session.ended_at.isoformat() if session.ended_at else None,
        }
    )
    row.details = details
    db.commit()


def get_weekly_score(profile_id: int, db: Session) -> WeeklyScoreRead:
    profile = _get_profile_or_404(db, profile_id)
    is_spot = getattr(profile, "account_type", "contracts") == "spot"
    period_start = _month_start(date.today()) if is_spot else _monday_of(date.today())
    period = "month" if is_spot else "week"
    row = (
        db.query(RitualWeeklyScore)
        .filter_by(profile_id=profile_id, week_start=period_start)
        .first()
    )
    if not row:
        return WeeklyScoreRead(
            id=0,
            profile_id=profile_id,
            week_start=period_start,
            score=0,
            max_score=MAX_WEEKLY_SCORE_SPOT if is_spot else MAX_WEEKLY_SCORE,
            details={},
            pct=0.0,
            grade="—",
            period=period,
        )
    data = WeeklyScoreRead.model_validate(row)
    data.pct = round(row.score / row.max_score * 100, 1) if row.max_score > 0 else 0.0
    data.grade = _grade(data.pct)
    data.period = period
    return data


def get_weekly_score_history(
    profile_id: int, db: Session, weeks: int = 8
) -> list[WeeklyScoreRead]:
    profile = _get_profile_or_404(db, profile_id)
    is_spot = getattr(profile, "account_type", "contracts") == "spot"
    period = "month" if is_spot else "week"
    rows = (
        db.query(RitualWeeklyScore)
        .filter_by(profile_id=profile_id)
        .order_by(RitualWeeklyScore.week_start.desc())
        .limit(weeks)
        .all()
    )
    result = []
    for row in rows:
        data = WeeklyScoreRead.model_validate(row)
        data.pct = round(row.score / row.max_score * 100, 1) if row.max_score > 0 else 0.0
        data.grade = _grade(data.pct)
        data.period = period
        result.append(data)
    return result


def _grade(pct: float) -> str:
    if pct >= 90:
        return "S"
    if pct >= 75:
        return "A"
    if pct >= 55:
        return "B"
    if pct >= 35:
        return "C"
    return "D"


# ── Smart Watchlist ───────────────────────────────────────────────────────────

def generate_smart_watchlist(
    profile_id: int,
    session_type: str,
    top_n: int | None,
    db: Session,
) -> SmartWLResult:
    """Compute the Smart Watchlist based on cascade cross-TF scoring.

    Algorithm:
      score(pair, TF) = TF_weight × vi_score × trend_bonus × ema_bonus
      cascade_score(pair) = Σ score(pair, TF) across all TFs where pair appears

    Pinned pairs are injected at the top of their TF section regardless of score.
    """
    _profile = _get_profile_or_404(db, profile_id)
    settings_row = get_ritual_settings(profile_id, db)
    cfg = settings_row.config

    # Determine timeframes from step config
    steps = (
        db.query(RitualStep)
        .filter_by(profile_id=profile_id, session_type=session_type)
        .all()
    )
    smart_step = next(
        (s for s in steps if s.step_type in ("smart_wl", "watchlist_htf_spot")), None
    )
    if smart_step and smart_step.config.get("timeframes"):
        tfs: list[str] = smart_step.config["timeframes"]
    else:
        tfs = {
            "weekly_setup": ["1W", "1D", "4H", "1H", "15m"],
            "trade_session": ["1D", "4H", "1H", "15m"],
            "weekend_review": ["1D", "4H"],
            "weekend_trading": ["1H", "15m"],
            "spot_monthly": ["1W", "1D", "4H"],
            "spot_weekly": ["1D", "4H"],
        }.get(session_type, ["4H", "1H"])

    if top_n is None:
        _default_top_n = DEFAULT_RITUAL_CONFIG.get("top_n", {}).get(session_type, 20)
        top_n = cfg.get("top_n", {}).get(session_type, _default_top_n)

    sf = cfg.get("smart_filter", {})
    weights: dict[str, float] = sf.get(
        "weights", {"1W": 4.0, "1D": 3.0, "4H": 2.0, "1H": 1.0, "15m": 0.5}
    )
    trend_bonus: float = sf.get("trend_bonus", 1.2)
    ema_bonus_threshold: float = sf.get("ema_bonus_threshold", 0.70)
    ema_bonus_factor: float = sf.get("ema_bonus_factor", 1.1)

    pair_scores: dict[str, float] = {}
    pair_tf_data: dict[str, dict[str, dict]] = {}
    tf_pairs: dict[str, list[str]] = {}

    # Determine data source from profile account_type — not session_type.
    # This allows weekend_review to use spot data for spot profiles.
    _is_spot_session = getattr(_profile, "account_type", "contracts") == "spot"

    for tf in tfs:
        # Normalize to lowercase — snapshots store TFs in lowercase (e.g. "4h", "1h")
        # but step configs may use uppercase (e.g. "4H", "1H").
        snapshot: SpotWatchlistSnapshot | WatchlistSnapshot | None
        if _is_spot_session:
            snapshot = (
                db.query(SpotWatchlistSnapshot)
                .filter(SpotWatchlistSnapshot.timeframe == tf.lower())
                .order_by(SpotWatchlistSnapshot.generated_at.desc())
                .first()
            )
        else:
            snapshot = (
                db.query(WatchlistSnapshot)
                .filter(WatchlistSnapshot.timeframe == tf.lower())
                .order_by(WatchlistSnapshot.generated_at.desc())
                .first()
            )
        if not snapshot:
            continue

        # Live EMA refresh when snapshot is older than the TF beat cadence
        _stale_secs = _TF_STALE_SECONDS.get(tf.lower(), 900)
        _snap_dt = snapshot.generated_at
        if _snap_dt.tzinfo is None:
            _snap_dt = _snap_dt.replace(tzinfo=UTC)
        _snap_age = (_utcnow() - _snap_dt).total_seconds()
        _live_vi: dict[str, dict] = {}
        if _snap_age > _stale_secs:
            logger.info(
                "SmartWL: %s snapshot is %.0fs old (threshold %ds) — refreshing VI live",
                tf, _snap_age, _stale_secs,
            )
            _live_vi = _refresh_vi_scores(snapshot.pairs, tf, _is_spot_session, top_n)

        tf_pairs[tf] = []
        tf_w = weights.get(tf, 1.0)

        for entry in snapshot.pairs:
            pair: str = entry.get("pair", "")
            if not pair:
                continue
            # Use live-refreshed VI + EMA if available, else fall back to snapshot value
            _live = _live_vi.get(pair, {})
            vi: float = float(_live.get("vi_score", entry.get("vi_score", 0)))
            ema_signal: str = _live.get("ema_signal") or entry.get("ema_signal", "")
            ema_score: float = float(_live.get("ema_score", entry.get("ema_score", 0)))

            # Cascade contribution
            # Cascade bonus hierarchy:
            #   ×1.30 — retest_after_breakout: wick confirmed retest AFTER a recent breakout
            #            → best setup: breakout + pullback + hold (Contracts: both dirs; Spot: long)
            #   ×1.20 — trend_bonus: strong directional signal (breakout, above_all, below_all)
            #   ×1.0  — standalone retest_up/retest_down: wick touched EMA but no recent BO
            #            → no bonus, ambiguous context
            contribution = tf_w * vi
            _long_signal = ema_signal in ("breakout_up", "above_all")
            _short_signal = (not _is_spot_session) and ema_signal in ("breakdown_down", "below_all")
            _retest_conf_long = ema_signal == "retest_after_breakout_up"
            _retest_conf_short = (not _is_spot_session) and ema_signal == "retest_after_breakdown_down"
            if _retest_conf_long or _retest_conf_short:
                contribution *= 1.3  # ×1.30 — breakout + confirmed retest (best)
            elif _long_signal or _short_signal:
                contribution *= trend_bonus  # ×1.20
            if ema_score >= ema_bonus_threshold:
                contribution *= ema_bonus_factor

            pair_scores[pair] = pair_scores.get(pair, 0.0) + contribution

            if pair not in pair_tf_data:
                pair_tf_data[pair] = {}
            pair_tf_data[pair][tf] = {
                "vi_score": vi,
                "regime": entry.get("regime", ""),
                "ema_signal": ema_signal,
                "ema_score": ema_score,
            }
            tf_pairs[tf].append(pair)

    # Expire stale pins then get active ones
    _expire_stale_pins(profile_id, db)
    active_pins = (
        db.query(RitualPinnedPair)
        .filter_by(profile_id=profile_id, status="active")
        .all()
    )
    pinned_map: dict[str, RitualPinnedPair] = {p.pair: p for p in active_pins}

    # Get broker name for filename
    broker_name = "Kraken"
    if _profile and _profile.broker_id:
        broker = db.query(Broker).filter_by(id=_profile.broker_id).first()
        if broker:
            broker_name = broker.name.replace(" ", "")

    result_tfs: dict[str, list[SmartWLPairEntry]] = {}
    for tf in tfs:
        tf_pair_list = tf_pairs.get(tf, [])
        tf_data = pair_tf_data

        scored: list[SmartWLPairEntry] = []
        for p in tf_pair_list:
            tf_info = tf_data.get(p, {}).get(tf, {})
            pin = pinned_map.get(p)
            # Only treat as pinned in the TF it was actually pinned on.
            # Without this check, a pair pinned on 4H gets is_pinned=True on
            # ALL TFs → rank=0 everywhere → dedup always picks the first TF
            # in iteration order (1D), ignoring where it was actually pinned.
            is_pinned_here = pin is not None and pin.timeframe.upper() == tf.upper()
            scored.append(
                SmartWLPairEntry(
                    pair=p,
                    tv_symbol=_to_tv_symbol(p),
                    display_name=_display_name(p),
                    vi_score=round(float(tf_info.get("vi_score", 0)), 3),
                    regime=tf_info.get("regime", ""),
                    ema_signal=tf_info.get("ema_signal", ""),
                    score=round(pair_scores.get(p, 0.0), 3),
                    is_pinned=is_pinned_here,
                    pin_note=pin.note if (is_pinned_here and pin is not None) else None,
                    pin_id=pin.id if (is_pinned_here and pin is not None) else None,
                )
            )

        # Composite score = cascade_score × regime_multiplier
        # Multiplicative approach: regime adjusts cascade proportionally.
        # Unlike tuple-sort (regime, cascade), this lets a very strong cascade
        # ACTIVE pair beat a weak cascade TRENDING pair — which is correct.
        # TRENDING/NORMAL get a boost; EXTREME/DEAD get penalised.
        _REGIME_MULTIPLIER: dict[str, float] = {
            "TRENDING": 1.30,
            "NORMAL":   1.10,
            "ACTIVE":   0.90,
            "CALM":     0.80,
            "EXTREME":  0.60,
            "DEAD":     0.30,
        }
        pinned_entries = [e for e in scored if e.is_pinned]
        rest = sorted(
            [e for e in scored if not e.is_pinned],
            key=lambda x: x.score * _REGIME_MULTIPLIER.get(x.regime, 1.0),
            reverse=True,
        )
        # Keep ALL sorted candidates pre-dedup so that pairs "stolen" by a
        # better TF during dedup can be replaced by lower-ranked candidates.
        # top_n is enforced AFTER dedup below.
        result_tfs[tf] = pinned_entries + rest

    # ── Dedup: each pair appears in exactly one TF section ───────────────────
    # Strategy: assign each pair to the TF where it ranks best (lowest index
    # in per-TF cascade_score sort).  Ties go to the first TF in `tfs` order
    # (i.e. the higher timeframe, since tfs is ordered high → low).
    #
    # Why NOT "highest TF wins": ALL Kraken pairs appear in ALL TF snapshots,
    # so "highest TF wins" would send every pair to 1W/1D and leave lower TFs
    # completely empty.
    #
    # Cascade sort (replacing former vi_score sort) already prevents shorter-TF
    # monopolisation: a pair hot on 1H but weak on 1D/4H has a low cascade
    # score and therefore ranks low on all TF sections, not just on 1H.
    #
    # "Best rank per TF" naturally distributes pairs: a pair that is
    # particularly hot on 4H (rank #2) vs mediocre on 1D (rank #12) goes to 4H.
    pair_best_tf: dict[str, str] = {}
    pair_best_rank: dict[str, int] = {}

    for tf, entries in result_tfs.items():
        for rank, e in enumerate(entries):
            if e.pair not in pair_best_rank or rank < pair_best_rank[e.pair]:
                pair_best_rank[e.pair] = rank
                pair_best_tf[e.pair] = tf

    # Apply top_n AFTER dedup: each TF now has a full sorted candidate list,
    # so trimming here guarantees up to top_n pairs per TF even after dedup
    # has redistributed pairs across TFs.
    result_tfs = {
        tf: [e for e in entries if pair_best_tf.get(e.pair) == tf][:top_n]
        for tf, entries in result_tfs.items()
    }

    user_pairs: list[str] = cfg.get("market_analysis_pairs", [])
    default_pairs: list[str] = DEFAULT_RITUAL_CONFIG["market_analysis_pairs"]
    if not user_pairs:
        market_pairs = default_pairs
    else:
        # Merge: keep user order, append any new default pairs not yet present
        seen = set(user_pairs)
        market_pairs = user_pairs + [p for p in default_pairs if p not in seen]

    # Build pinned_tv list for TV file (all active pins, sorted canonical TF order)
    _TF_ORDER = ["1W", "1D", "4H", "1H", "15m"]
    pinned_tv: list[PinnedTVEntry] = [
        PinnedTVEntry(
            tv_symbol=pin.tv_symbol or _to_tv_symbol(pin.pair),
            display_name=_display_name(pin.pair),
            timeframe=pin.timeframe,
        )
        for pin in sorted(active_pins, key=lambda p: _TF_ORDER.index(p.timeframe) if p.timeframe in _TF_ORDER else 99)
    ]

    # Enforce ≤ 100 TV file lines, accounting for all sections:
    #   market section     : 1 header + len(market_pairs) + 1 blank
    #   pinned section(s)  : n_pinned_tfs × (1 header + 1 blank) + n_pins
    #   WL TF sections     : _n_active_tfs × (1 header + 1 blank) + total_WL_pairs
    n_pins = len(active_pins)
    n_pinned_tfs = len({p.timeframe for p in active_pins}) if active_pins else 0
    _n_active_tfs = max(sum(1 for pairs in result_tfs.values() if pairs), 1)
    _overhead = (
        2 + len(market_pairs)            # market section
        + n_pins + n_pinned_tfs * 2      # pinned sections
        + _n_active_tfs * 2              # WL TF section headers + blanks
    )
    _tv_cap = max(1, (100 - _overhead) // _n_active_tfs)
    if _tv_cap < top_n:
        result_tfs = {tf: pairs[:_tv_cap] for tf, pairs in result_tfs.items()}

    return SmartWLResult(
        generated_at=_utcnow().isoformat(),
        session_type=session_type,
        top_n=top_n,
        broker_name=broker_name,
        timeframes=result_tfs,
        market_analysis_pairs=market_pairs,
        pinned_tv=pinned_tv,
    )


def generate_watchlist_file(result: SmartWLResult) -> bytes:
    """Build the TradingView-importable .txt watchlist file.

    Sections (in order):
      1. 📊 Market Analysis    — macro context pairs (BTC.D, TOTAL, etc.)
      2. 📌 Pinned [TF]        — one section per TF for active pinned pairs
      3. [emoji] [TF]          — deduped WL pairs (pinned symbols excluded)

    Dedup rule for WL sections:
      • weekly_setup / weekend_review → highest TF wins  (1W > 1D > 4H > 1H > 15m)
      • trade_session                 → hottest TF wins  argmax(vi_score per TF)
    """
    buf = io.StringIO()

    # ── TF metadata ──────────────────────────────────────────────────────────
    _CANONICAL = ["1W", "1D", "4H", "1H", "15m"]
    _TF_EMOJI = {
        "1W":  "🟣",
        "1D":  "🔵",
        "4H":  "⏳",
        "1H":  "🟢",
        "15m": "⚡",
    }

    # ── 1. Market Analysis section ───────────────────────────────────────────
    buf.write("###📊 Market###\n")
    for sym in result.market_analysis_pairs:
        buf.write(f"{sym}\n")
    buf.write("\n")

    # ── 2. Pinned sections (one per TF, top of the watchlist) ────────────────
    pinned_seen: set[str] = set()   # track pinned symbols → exclude from WL sections
    if result.pinned_tv:
        by_tf: dict[str, list[str]] = {}
        for pin_entry in result.pinned_tv:
            by_tf.setdefault(pin_entry.timeframe, []).append(pin_entry.tv_symbol)
            pinned_seen.add(pin_entry.tv_symbol)
        for tf in _CANONICAL:
            if tf not in by_tf:
                continue
            emoji = _TF_EMOJI.get(tf, "📌")
            buf.write(f"###📌 Pinned {emoji} {tf}###\n")
            for sym in by_tf[tf]:
                buf.write(f"{sym}\n")
            buf.write("\n")

    # ── 3. WL sections — deduped, pinned symbols already excluded ────────────
    # Build {tv_symbol: {tf: vi_score}} lookup for trade_session argmax
    sym_tf_vi: dict[str, dict[str, float]] = {}
    for tf, entries in result.timeframes.items():
        for entry in entries:
            sym_tf_vi.setdefault(entry.tv_symbol, {})[tf] = entry.vi_score

    if result.session_type == "trade_session":
        def _best_tf(sym: str) -> str:
            tfs = sym_tf_vi.get(sym, {})
            return max(tfs, key=lambda t: tfs[t]) if tfs else _CANONICAL[-1]
    else:
        def _best_tf(sym: str) -> str:  # type: ignore[misc]
            tfs = sym_tf_vi.get(sym, {})
            for tf in _CANONICAL:
                if tf in tfs:
                    return tf
            return _CANONICAL[-1]

    seen: set[str] = set(pinned_seen)  # start with pinned already excluded
    sectioned: dict[str, list[str]] = {tf: [] for tf in _CANONICAL}
    for tf in _CANONICAL:
        for entry in result.timeframes.get(tf, []):
            sym = entry.tv_symbol
            if sym in seen:
                continue
            seen.add(sym)
            sectioned[_best_tf(sym)].append(sym)

    for tf in _CANONICAL:
        symbols = sectioned.get(tf, [])
        if not symbols:
            continue
        emoji = _TF_EMOJI.get(tf, "📈")
        buf.write(f"###{emoji} {tf}###\n")
        for sym in symbols:
            buf.write(f"{sym}\n")
        buf.write("\n")

    return buf.getvalue().encode("utf-8")



