"""
Phase 3 — Risk Management API router.

Prefix: /api/risk
All endpoints added here incrementally as Phase 3 steps are implemented.

P3-3   GET /risk/pair-vi                    — Live Pair VI (cache-first, Kraken fallback)
P3-4   GET /risk/settings/{profile_id}      — Read risk settings (auto-init if absent)
       PUT /risk/settings/{profile_id}      — Update risk settings (deep-merge patch)
P3-5   GET /risk/budget                     — Concurrent risk budget (added in P3-5)
P3-6   GET /risk/advisor                    — Full Risk Advisor calculation (added in P3-6)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.risk_management.schemas import PairVIOut, RiskSettingsOut, RiskSettingsUpdateIn
from src.risk_management.service import get_live_pair_vi, get_risk_settings, update_risk_settings

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

