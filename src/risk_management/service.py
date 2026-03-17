"""
Phase 3 — Risk Management service layer.

P3-3: Live Pair VI — cache-first fetch from Kraken.
P3-4: Risk Settings CRUD — get (auto-upsert) + update (deep-merge patch).
Further functions (P3-5 Budget, P3-6 Advisor) added in later steps.
"""

from __future__ import annotations

import copy
import logging
from datetime import UTC, datetime

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.core.models.broker import Profile
from src.core.models.trade import Trade
from src.risk_management.defaults import DEFAULT_RISK_CONFIG
from src.risk_management.engine import _deep_merge
from src.risk_management.models import RiskSettings
from src.volatility.cache import cache_pair_vi, get_cached_pair_vi
from src.volatility.indicators import compute_vi_score
from src.volatility.kraken_client import KrakenClient
from src.volatility.schedule import get_regime_thresholds, score_to_regime

logger = logging.getLogger(__name__)

# 200-EMA convergence coverage — mirrors compute_pair_vi task.
_OHLCV_LIMIT = 220


# ── P3-3: Live Pair VI ────────────────────────────────────────────────────────

def get_live_pair_vi(symbol: str, timeframe: str, db: Session) -> dict:
    """Return VI data for a Kraken pair, using Redis cache or a live fetch.

    Strategy:
    1. Check Redis cache (key: atd:pair_vi:{symbol}:{timeframe}).
       If present → return with source="cache".
    2. Fetch live from Kraken Futures, compute VI, cache result, return source="live".

    Raises HTTPException(503) if Kraken is unreachable and the cache is cold.
    """
    # ── 1. Cache hit ──────────────────────────────────────────────────────────
    cached = get_cached_pair_vi(symbol, timeframe)
    if cached is not None:
        return _format_pair_vi(symbol, timeframe, cached, source="cache")

    # ── 2. Live fetch ─────────────────────────────────────────────────────────
    try:
        with KrakenClient() as client:
            candles = client.fetch_ohlcv(symbol, timeframe, limit=_OHLCV_LIMIT)
    except (httpx.HTTPError, httpx.TimeoutException, ValueError) as exc:
        logger.warning(
            "get_live_pair_vi(%s %s): Kraken fetch failed — %s", symbol, timeframe, exc
        )
        raise HTTPException(
            status_code=503,
            detail=f"Kraken data unavailable for {symbol}/{timeframe}: {exc}",
        ) from exc

    vi_result = compute_vi_score(candles)
    thresholds = get_regime_thresholds(db, profile_id=None)
    regime = score_to_regime(vi_result["vi_score"], thresholds)
    now_iso = datetime.now(UTC).isoformat()

    # Strip vi_score from components dict before caching.
    components = {k: v for k, v in vi_result.items() if k != "vi_score"}

    cache_pair_vi(
        symbol, timeframe,
        vi_result["vi_score"], regime,
        components, now_iso,
    )

    payload = {
        "symbol": symbol,
        "vi_score": vi_result["vi_score"],
        "regime": regime,
        "components": components,
        "timestamp": now_iso,
    }
    return _format_pair_vi(symbol, timeframe, payload, source="live")


# ── Internal helpers ──────────────────────────────────────────────────────────

def _format_pair_vi(symbol: str, timeframe: str, data: dict, source: str) -> dict:
    """Normalise a cache or live dict into the PairVIOut shape."""
    components = data.get("components", {})
    return {
        "pair": symbol,
        "timeframe": timeframe,
        "vi_score": float(data.get("vi_score", 0.0)),
        "regime": data.get("regime", "UNKNOWN"),
        "ema_score": components.get("ema_score"),
        "ema_signal": components.get("ema_signal"),
        "source": source,
        "computed_at": data.get("timestamp", ""),
    }


# ── P3-4: Risk Settings CRUD ──────────────────────────────────────────────────

def get_risk_settings(profile_id: int, db: Session) -> RiskSettings:
    """Return the RiskSettings row for a profile.

    If no row exists yet (first call for this profile), one is created with
    DEFAULT_RISK_CONFIG so callers can always assume a row is present.
    The returned object is already committed and refreshed.
    """
    row = db.query(RiskSettings).filter(RiskSettings.profile_id == profile_id).first()
    if row is None:
        row = RiskSettings(
            profile_id=profile_id,
            config=copy.deepcopy(DEFAULT_RISK_CONFIG),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_risk_settings(profile_id: int, config_patch: dict, db: Session) -> RiskSettings:
    """Deep-merge *config_patch* into the current settings for a profile.

    Only the keys present in *config_patch* overwrite existing values; all
    other keys are kept.  Uses the same ``_deep_merge`` semantics as the risk
    engine: the current DB config acts as the base and the patch as the
    override layer.

    Returns the updated, committed RiskSettings row.
    """
    row = get_risk_settings(profile_id, db)
    merged = _deep_merge(row.config, config_patch)
    row.config = merged  # triggers JSONB column change
    row.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    db.refresh(row)
    return row


# ── P3-5: Risk Budget ─────────────────────────────────────────────────────────

_ACTIVE_STATUSES = ("open", "partial", "pending")


def get_risk_budget(profile_id: int, db: Session) -> dict:
    """Compute the concurrent risk budget for a profile.

    Returns a dict matching ``RiskBudgetOut``:
    - Sums ``risk_amount`` of all open/partial/pending trades.
    - Derives ``budget_remaining_pct`` and ``budget_remaining_amount``.
    - Reads ``alert_threshold_pct`` + ``force_allowed`` from risk_settings.
    - Evaluates ``alert_risk_saturated`` flag.

    Raises HTTPException(404) if the profile does not exist.
    """
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found")

    capital = float(profile.capital_current)
    risk_pct_default = float(profile.risk_percentage_default)
    max_concurrent = float(profile.max_concurrent_risk_pct)

    # ── Active trades ─────────────────────────────────────────────────────────
    active_trades = (
        db.query(Trade)
        .filter(Trade.profile_id == profile_id, Trade.status.in_(_ACTIVE_STATUSES))
        .all()
    )
    open_count = sum(1 for t in active_trades if t.status in ("open", "partial"))
    pending_count = sum(1 for t in active_trades if t.status == "pending")
    risk_used_amount = sum(float(t.risk_amount) for t in active_trades)

    concurrent_used_pct = (risk_used_amount / capital * 100) if capital > 0 else 0.0
    budget_remaining_pct = max_concurrent - concurrent_used_pct
    budget_remaining_amount = budget_remaining_pct / 100 * capital

    # ── Risk settings ─────────────────────────────────────────────────────────
    settings = get_risk_settings(profile_id, db)
    config = _deep_merge(DEFAULT_RISK_CONFIG, settings.config)
    alert_cfg = config.get("alert_banner", {})
    alert_enabled: bool = bool(alert_cfg.get("enabled", True))
    alert_threshold_pct: float = float(alert_cfg.get("trigger_threshold_pct", 100.0))
    force_allowed: bool = bool(config.get("risk_guard", {}).get("force_allowed", True))

    # ── Alert flag ────────────────────────────────────────────────────────────
    # Triggered when the used budget crosses alert_threshold_pct % of the max
    # ceiling AND there is at least one pending trade waiting to be opened.
    alert_risk_saturated = (
        alert_enabled
        and concurrent_used_pct >= (max_concurrent * alert_threshold_pct / 100)
        and pending_count > 0
    )

    return {
        "profile_id": profile_id,
        "capital_current": capital,
        "risk_pct_default": risk_pct_default,
        "max_concurrent_risk_pct": max_concurrent,
        "concurrent_risk_used_pct": round(concurrent_used_pct, 4),
        "budget_remaining_pct": round(budget_remaining_pct, 4),
        "budget_remaining_amount": round(budget_remaining_amount, 4),
        "open_trades_count": open_count,
        "pending_trades_count": pending_count,
        "alert_risk_saturated": alert_risk_saturated,
        "alert_threshold_pct": alert_threshold_pct,
        "force_allowed": force_allowed,
    }
