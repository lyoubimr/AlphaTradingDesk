"""
Phase 3 — Risk Management service layer.

P3-3: Live Pair VI — cache-first fetch from Kraken.
P3-4: Risk Settings CRUD — get (auto-upsert) + update (deep-merge patch).
P3-5: Risk Budget — concurrent risk used vs ceiling.
P3-6: Risk Advisor — full orchestration (VI + MA + strategy + engine).
"""

from __future__ import annotations

import copy
import logging
from datetime import UTC, datetime
from decimal import Decimal

import httpx
from fastapi import HTTPException
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from src.core.models.broker import Profile
from src.core.models.market_analysis import MarketAnalysisIndicator, MarketAnalysisSession
from src.core.models.trade import Strategy, Trade
from src.risk_management.defaults import DEFAULT_RISK_CONFIG
from src.risk_management.engine import _deep_merge, compute_risk_multiplier
from src.risk_management.models import RiskSettings
from src.volatility.cache import cache_pair_vi, get_cached_market_vi, get_cached_pair_vi
from src.volatility.indicators import compute_vi_score
from src.volatility.kraken_client import KrakenClient
from src.volatility.models import MarketVISnapshot, VolatilitySnapshot
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
    2. DB fallback — latest volatility_snapshots row for this pair/TF.
       Used when cache is cold (dev / outside Celery schedule).
    3. Fetch live from Kraken Futures, compute VI, cache result, return source="live".

    Raises HTTPException(503) if Kraken is unreachable and both cache and DB are cold.
    """
    timeframe = timeframe.lower()  # normalise '1H' → '1h', '4H' → '4h', etc.
    # ── 1. Cache hit ──────────────────────────────────────────────────────────
    cached = get_cached_pair_vi(symbol, timeframe)
    if cached is not None:
        return _format_pair_vi(symbol, timeframe, cached, source="cache")

    # ── 2. DB fallback (cold cache — dev / outside Celery schedule) ───────────
    snap = (
        db.query(VolatilitySnapshot)
        .filter(
            VolatilitySnapshot.pair == symbol,
            VolatilitySnapshot.timeframe == timeframe,
        )
        .order_by(VolatilitySnapshot.timestamp.desc())
        .first()
    )
    if snap is not None:
        thresholds_db = get_regime_thresholds(db, profile_id=None)
        regime_db = score_to_regime(float(snap.vi_score), thresholds_db)
        payload_db = {
            "symbol": symbol,
            "vi_score": float(snap.vi_score),
            "regime": regime_db,
            "components": snap.components or {},
            "timestamp": snap.timestamp.isoformat(),
        }
        return _format_pair_vi(symbol, timeframe, payload_db, source="db")

    # ── 3. Live fetch ─────────────────────────────────────────────────────────
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

    # Live risk: actual capital at risk RIGHT NOW.
    # Uses current_risk for open/partial — BE trades (current_risk=0) are free.
    live_risk_used_amount = sum(
        float(t.current_risk or Decimal("0")) for t in active_trades if t.status in ("open", "partial")
    )
    # Pending risk: LIMIT orders not yet filled — reserved budget if they all trigger.
    pending_risk_amount = sum(
        float(t.risk_amount or Decimal("0")) for t in active_trades if t.status == "pending"
    )

    concurrent_used_pct = (live_risk_used_amount / capital * 100) if capital > 0 else 0.0
    budget_remaining_pct = max_concurrent - concurrent_used_pct
    budget_remaining_amount = budget_remaining_pct / 100 * capital

    # Worst-case budget: what remains if all pending LIMITs fill simultaneously.
    pending_risk_pct = (pending_risk_amount / capital * 100) if capital > 0 else 0.0
    budget_remaining_if_pending_fill_pct = budget_remaining_pct - pending_risk_pct
    budget_remaining_if_pending_fill_amount = budget_remaining_if_pending_fill_pct / 100 * capital

    # ── Risk settings ─────────────────────────────────────────────────────────
    settings = get_risk_settings(profile_id, db)
    config = _deep_merge(DEFAULT_RISK_CONFIG, settings.config)
    alert_cfg = config.get("alert_banner", {})
    alert_enabled: bool = bool(alert_cfg.get("enabled", True))
    alert_threshold_pct: float = float(alert_cfg.get("trigger_threshold_pct", 100.0))
    force_allowed: bool = bool(config.get("risk_guard", {}).get("force_allowed", True))

    # ── Alert flag ────────────────────────────────────────────────────────────
    # Fires when total exposure (live + all pending if filled) crosses the
    # alert threshold — conservative: warns before budget is actually hit.
    total_risk_used_pct = concurrent_used_pct + pending_risk_pct
    alert_risk_saturated = (
        alert_enabled
        and total_risk_used_pct >= (max_concurrent * alert_threshold_pct / 100)
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
        "pending_risk_pct": round(pending_risk_pct, 4),
        "pending_risk_amount": round(pending_risk_amount, 4),
        "budget_remaining_if_pending_fill_pct": round(budget_remaining_if_pending_fill_pct, 4),
        "budget_remaining_if_pending_fill_amount": round(budget_remaining_if_pending_fill_amount, 4),
        "alert_risk_saturated": alert_risk_saturated,
        "alert_threshold_pct": alert_threshold_pct,
        "force_allowed": force_allowed,
    }


# ── P3-6: Risk Advisor orchestration ─────────────────────────────────────────

def _resolve_ma_direction_match(
    ma_session_id: int | None,
    direction: str,
    db: Session,
    timeframe: str | None = None,
) -> str | None:
    """Return "aligned", "opposed", or None based on session bias vs direction.

    Resolves the timeframe tier (ltf/mtf/htf) from the market_analysis_indicators
    table (tv_timeframe → timeframe_level), then selects the matching bias field.
    Fallback chain: tier-specific → bias_composite_a → bias_htf_a.
    """
    if ma_session_id is None:
        return None
    session = (
        db.query(MarketAnalysisSession)
        .filter(MarketAnalysisSession.id == ma_session_id)
        .first()
    )
    if session is None:
        return None

    tier: str | None = None
    if timeframe:
        indicator = (
            db.query(MarketAnalysisIndicator.timeframe_level)
            .filter(sa_func.lower(MarketAnalysisIndicator.tv_timeframe) == timeframe.lower())
            .limit(1)
            .scalar()
        )
        tier = indicator  # "ltf" | "mtf" | "htf" | None

    if tier == "ltf":
        bias = session.bias_ltf_a or session.bias_composite_a or session.bias_htf_a
    elif tier == "mtf":
        bias = session.bias_mtf_a or session.bias_composite_a or session.bias_htf_a
    else:
        bias = session.bias_composite_a or session.bias_htf_a

    if bias is None:
        return None
    bias_lower = bias.lower()
    if direction == "long":
        return "aligned" if bias_lower == "bullish" else "opposed"
    if direction == "short":
        return "aligned" if bias_lower == "bearish" else "opposed"
    return None


def _resolve_strategy_stats(
    strategy_id: int | None,
    db: Session,
) -> tuple[float | None, bool]:
    """Return (win_rate, has_stats) for a strategy, or (None, False) if absent."""
    if strategy_id is None:
        return None, False
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if strategy is None:
        return None, False
    has_stats = strategy.trades_count >= strategy.min_trades_for_stats
    wr = (
        strategy.win_count / strategy.trades_count
        if strategy.trades_count > 0
        else None
    )
    return wr, has_stats


def orchestrate_risk_advisor(
    profile_id: int,
    pair: str,
    timeframe: str,
    direction: str,
    strategy_id: int | None,
    confidence: int | None,
    ma_session_id: int | None,
    db: Session,
) -> dict:
    """Full Risk Advisor orchestration — combines all P3-2 through P3-5 pieces.

    1. Load profile + risk settings
    2. Compute budget remaining (P3-5 logic)
    3. Resolve market VI regime (Redis, graceful miss → None)
    4. Resolve pair VI regime (cache → live Kraken, graceful miss → None)
    5. Resolve MA direction match (optional, via MA session bias)
    6. Resolve strategy win rate + has_stats (optional)
    7. Call compute_risk_multiplier() (P3-2 engine)
    8. Return dict matching RiskAdvisorOut

    Never raises on VI / cache failures — missing inputs default to neutral.
    Raises HTTPException(404) only if the profile is not found.
    """
    # ── 1. Profile ────────────────────────────────────────────────────────────
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found")

    capital = float(profile.capital_current)
    base_risk_pct = float(profile.risk_percentage_default)

    # ── 2. Settings (resolve effective config: DEFAULT + DB overlay) ──────────
    settings = get_risk_settings(profile_id, db)
    config = _deep_merge(DEFAULT_RISK_CONFIG, settings.config)
    force_allowed: bool = bool(config.get("risk_guard", {}).get("force_allowed", True))

    # ── 3. Budget remaining ───────────────────────────────────────────────────
    budget = get_risk_budget(profile_id, db)
    budget_remaining_pct: float = budget["budget_remaining_pct"]

    timeframe = timeframe.lower()  # normalise '1H' → '1h', '4H' → '4h', etc.
    pair   = pair.upper()          # normalise 'pf_xbtusd' → 'PF_XBTUSD'

    # ── 4. Market VI regime — always aggregated (cross-TF macro view) ────────
    # TF is irrelevant for market context; use the weighted cross-TF aggregate.
    market_vi_cached = get_cached_market_vi("aggregated")
    if market_vi_cached:
        market_vi_regime: str | None = market_vi_cached.get("regime")
    else:
        # Redis cold → fall back to latest aggregated DB snapshot
        row = (
            db.query(MarketVISnapshot)
            .filter(MarketVISnapshot.timeframe == "aggregated")
            .order_by(MarketVISnapshot.timestamp.desc())
            .first()
        )
        market_vi_regime = row.regime if row else None

    # ── 5. Pair VI regime (cache → live, graceful degradation) ───────────────
    pair_vi_regime: str | None = None
    try:
        pair_vi_data = get_live_pair_vi(pair, timeframe, db)
        pair_vi_regime = pair_vi_data.get("regime")
    except HTTPException:
        logger.warning(
            "orchestrate_risk_advisor: pair VI unavailable for %s/%s — neutral",
            pair, timeframe,
        )

    # ── 6. MA direction match ─────────────────────────────────────────────────
    ma_direction_match: str | None = _resolve_ma_direction_match(ma_session_id, direction, db, timeframe)

    # ── 7. Strategy stats ─────────────────────────────────────────────────────
    strategy_wr, strategy_has_stats = _resolve_strategy_stats(strategy_id, db)

    # ── 8. Confidence score (1-10 int, None if not provided) ──────────────────
    confidence_score: int | None = confidence

    # ── 9. Engine ─────────────────────────────────────────────────────────────
    result = compute_risk_multiplier(
        config,
        market_vi_regime=market_vi_regime,
        pair_vi_regime=pair_vi_regime,
        ma_direction_match=ma_direction_match,
        strategy_wr=strategy_wr,
        strategy_has_stats=strategy_has_stats,
        confidence_score=confidence_score,
        base_risk_pct=base_risk_pct,
        capital=capital,
        budget_remaining_pct=budget_remaining_pct,
        pending_risk_pct=budget["pending_risk_pct"],
    )

    return {
        "base_risk_pct": result.base_risk_pct,
        "adjusted_risk_pct": result.adjusted_risk_pct,
        "adjusted_risk_amount": result.adjusted_risk_amount,
        "multiplier": result.multiplier,
        "criteria": [
            {
                "name": c.name,
                "enabled": c.enabled,
                "value_label": c.value_label,
                "factor": c.factor,
                "weight": c.weight,
                "contribution": c.contribution,
            }
            for c in result.criteria
        ],
        "budget_remaining_pct": result.budget_remaining_pct,
        "budget_remaining_amount": result.budget_remaining_amount,
        "budget_blocking": result.budget_blocking,
        "suggested_risk_pct": result.suggested_risk_pct,
        "pending_risk_pct": result.pending_risk_pct,
        "pending_risk_amount": result.pending_risk_amount,
        "budget_remaining_if_pending_fill_pct": result.budget_remaining_if_pending_fill_pct,
        "budget_remaining_if_pending_fill_amount": result.budget_remaining_if_pending_fill_amount,
        "pending_budget_warning": result.pending_budget_warning,
        "force_allowed": force_allowed,
    }
