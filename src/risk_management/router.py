"""
Phase 3 — Risk Management API router.

Prefix: /api/risk
All endpoints added here incrementally as Phase 3 steps are implemented.

P3-3   GET /risk/pair-vi                    — Live Pair VI (cache-first, Kraken fallback)
P3-4   GET /risk/settings/{profile_id}      — Read risk settings (auto-init if absent)
       PUT /risk/settings/{profile_id}      — Update risk settings (deep-merge patch)
P3-5   GET /risk/budget/{profile_id}        — Concurrent risk budget
P3-6   GET /risk/advisor                    — Full Risk Advisor calculation
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.risk_management.schemas import (
    PairVIOut,
    RiskAdvisorOut,
    RiskBudgetOut,
    RiskSettingsOut,
    RiskSettingsUpdateIn,
)
from src.risk_management.service import (
    get_live_pair_vi,
    get_risk_budget,
    get_risk_settings,
    orchestrate_risk_advisor,
    update_risk_settings,
)

router = APIRouter(prefix="/risk", tags=["risk"])


# ── P3-3: Live Pair VI ────────────────────────────────────────────────────────

@router.get("/pair-vi", response_model=PairVIOut)
def live_pair_vi(
    pair: str = Query(..., description="Kraken Futures symbol, e.g. PF_XBTUSD"),
    timeframe: str = Query(
        ...,
        description="ATD timeframe string: 15m | 1h | 4h | 1d | 1w",
    ),
    db: Session = Depends(get_db),
) -> PairVIOut:
    """Return VI score + regime for a Kraken Futures pair.

    Checks Redis cache first (TTL is timeframe-driven by the volatility module).
    Falls back to a live Kraken fetch when the cache is cold (e.g. pair not in
    the regular watchlist, or first request of the session).

    Used by the New Trade form to show the Risk Advisor breakdown in real time
    when the trader selects or changes a pair.
    """
    data = get_live_pair_vi(pair, timeframe, db)
    return PairVIOut(**data)


# ── P3-4: Risk Settings CRUD ──────────────────────────────────────────────────

@router.get("/settings/{profile_id}", response_model=RiskSettingsOut)
def read_risk_settings(
    profile_id: int,
    db: Session = Depends(get_db),
) -> RiskSettingsOut:
    """Return the Dynamic Risk settings for a profile.

    If no settings row exists yet (first ever call for this profile), one is
    created automatically with sensible defaults (DEFAULT_RISK_CONFIG) so the
    caller always receives a valid config without any prior setup step.
    """
    row = get_risk_settings(profile_id, db)
    return RiskSettingsOut(profile_id=row.profile_id, config=row.config)


@router.put("/settings/{profile_id}", response_model=RiskSettingsOut)
def write_risk_settings(
    profile_id: int,
    body: RiskSettingsUpdateIn,
    db: Session = Depends(get_db),
) -> RiskSettingsOut:
    """Deep-merge a partial or full config patch into the profile settings.

    Only keys present in the request body overwrite existing values.  All
    other keys keep their current DB values.  This allows the UI to send only
    the changed section (e.g. just ``criteria.market_vi``) without resetting
    unrelated settings.
    """
    row = update_risk_settings(profile_id, body.config, db)
    return RiskSettingsOut(profile_id=row.profile_id, config=row.config)


# ── P3-5: Risk Budget ─────────────────────────────────────────────────────────

@router.get("/budget/{profile_id}", response_model=RiskBudgetOut)
def read_risk_budget(
    profile_id: int,
    db: Session = Depends(get_db),
) -> RiskBudgetOut:
    """Return the concurrent risk budget for a profile.

    Shows how much of the ``max_concurrent_risk_pct`` ceiling is already
    consumed by open/partial/pending trades, and how much budget remains.

    Also returns the ``alert_risk_saturated`` flag (true when the trader has
    crossed the configurable alert threshold while a pending trade is waiting),
    and ``force_allowed`` so the UI can decide whether to surface a hard block.
    """
    data = get_risk_budget(profile_id, db)
    return RiskBudgetOut(**data)


# ── P3-6: Risk Advisor ────────────────────────────────────────────────────────

@router.get("/advisor", response_model=RiskAdvisorOut)
def read_risk_advisor(
    profile_id: int = Query(..., description="Profile ID"),
    pair: str = Query(..., description="Kraken Futures symbol, e.g. PF_XBTUSD"),
    timeframe: str = Query(..., description="ATD timeframe: 15m | 1h | 4h | 1d | 1w"),
    direction: str = Query(..., description="Trade direction: long | short"),
    strategy_id: int | None = Query(None, description="Strategy ID (optional)"),
    confidence: int | None = Query(None, ge=0, le=100, description="Trader confidence 0–100 (optional)"),
    ma_session_id: int | None = Query(None, description="Market Analysis session ID (optional)"),
    db: Session = Depends(get_db),
) -> RiskAdvisorOut:
    """Full Risk Advisor — orchestrates all P3-2 to P3-5 inputs.

    Resolves market VI regime (Redis), pair VI regime (cache → Kraken),
    MA direction match (session bias vs trade direction), strategy win
    rate, trader confidence, and the remaining risk budget — then runs
    ``compute_risk_multiplier()`` to produce the full breakdown.

    All optional inputs default to neutral (factor = 1.0) when absent.
    Never fails on Redis/Kraken unavailability — degrades gracefully.
    """
    data = orchestrate_risk_advisor(
        profile_id=profile_id,
        pair=pair,
        timeframe=timeframe,
        direction=direction,
        strategy_id=strategy_id,
        confidence=confidence,
        ma_session_id=ma_session_id,
        db=db,
    )
    return RiskAdvisorOut(**data)

