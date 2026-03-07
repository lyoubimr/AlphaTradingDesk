"""
Market Analysis router — Step 7 / Step 13-B (v2 conclusion).

Routes:
  GET  /api/market-analysis/modules
  GET  /api/market-analysis/modules/{module_id}/indicators
  PATCH /api/market-analysis/indicators/{id}
  POST /api/market-analysis/sessions
  GET  /api/market-analysis/sessions              (global — no profile filter required)
  GET  /api/market-analysis/sessions/{session_id}
  GET  /api/market-analysis/sessions/{session_id}/conclusion  ← v2
  GET  /api/market-analysis/staleness             (global — last session per module)

  GET  /api/profiles/{profile_id}/indicator-config
  PUT  /api/profiles/{profile_id}/indicator-config
  GET  /api/profiles/{profile_id}/market-analysis/staleness  (profile-scoped, kept for compat)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.market_analysis import service
from src.market_analysis.schemas import (
    IndicatorConfigItem,
    IndicatorConfigOut,
    IndicatorOut,
    IndicatorUpdate,
    ModuleOut,
    SessionCreate,
    SessionListItem,
    SessionOut,
    StalenessItem,
    TradeConclusion,
)

# Two routers: one for /market-analysis, one for /profiles (extended)
ma_router = APIRouter(prefix="/market-analysis", tags=["market-analysis"])
profiles_ma_router = APIRouter(prefix="/profiles", tags=["market-analysis"])


# ── Modules ───────────────────────────────────────────────────────────────────


@ma_router.get("/modules", response_model=list[ModuleOut])
def list_modules(db: Session = Depends(get_db)) -> list:
    """List all active analysis modules (Crypto, Gold, …)."""
    return service.list_modules(db)


@ma_router.get("/modules/{module_id}/indicators", response_model=list[IndicatorOut])
def list_indicators(module_id: int, db: Session = Depends(get_db)) -> list:
    """Return all indicators for a given module (read-only catalogue)."""
    return service.list_indicators(db, module_id)


@ma_router.get("/modules/{module_id}/thresholds")
def get_module_thresholds(module_id: int, db: Session = Depends(get_db)) -> dict:
    """Return v2 score thresholds for a module (from DB, not hardcoded)."""
    bullish, bearish = service.get_thresholds_public(db, module_id)
    return {"bullish": int(bullish), "bearish": int(bearish)}


@ma_router.patch("/indicators/{indicator_id}", response_model=IndicatorOut)
def patch_indicator(
    indicator_id: int,
    data: IndicatorUpdate,
    db: Session = Depends(get_db),
) -> object:
    """
    Partial update of UI-text fields for an indicator.
    Only label, question, tooltip, answer_*, and default_enabled can be changed.
    Immutable fields (key, module_id, tv_symbol, etc.) are ignored.
    """
    return service.patch_indicator(db, indicator_id, data)


# ── Sessions ──────────────────────────────────────────────────────────────────


@ma_router.post(
    "/sessions",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_session(data: SessionCreate, db: Session = Depends(get_db)) -> object:
    """
    Save a completed analysis session.
    Scores and biases are computed server-side from the submitted answers.
    """
    return service.create_session(db, data)


@ma_router.get("/sessions", response_model=list[SessionListItem])
def list_sessions(
    profile_id: int | None = Query(default=None, description="Filter by profile"),
    module_id: int | None = Query(default=None, description="Filter by module"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list:
    """Return analysis history (most recent first)."""
    return service.list_sessions(
        db, profile_id=profile_id, module_id=module_id, offset=offset, limit=limit
    )


@ma_router.get("/sessions/{session_id}", response_model=SessionOut)
def get_session(session_id: int, db: Session = Depends(get_db)) -> object:
    """Return a session with all its answers."""
    return service.get_session(db, session_id)


@ma_router.get("/sessions/{session_id}/conclusion", response_model=TradeConclusion)
def get_conclusion(session_id: int, db: Session = Depends(get_db)) -> object:
    """
    Return an actionable trade conclusion derived from the v2 decomposed scores
    of the specified session.

    Requires score_composite_a to be populated (sessions created after Step 13
    migration). Returns 404 if the session doesn't exist, 422 if v2 scores are
    not available (old session without decomposed scoring).
    """
    return service.get_session_conclusion(db, session_id)


@ma_router.get("/staleness", response_model=list[StalenessItem])
def get_staleness_global(db: Session = Depends(get_db)) -> list:
    """
    Global staleness — last analysis date per active module regardless of profile.
    is_stale = True if no session exists OR last session is older than 7 days.
    Used on the Market Analysis overview page (not profile-scoped).
    """
    return service.get_staleness_global(db)


# ── Profile indicator config ──────────────────────────────────────────────────


@profiles_ma_router.get(
    "/{profile_id}/indicator-config",
    response_model=IndicatorConfigOut,
)
def get_indicator_config(profile_id: int, db: Session = Depends(get_db)) -> object:
    """
    Return per-profile indicator toggles.
    If never configured, returns all indicators with their default_enabled value.
    """
    pid, configs = service.get_indicator_config(db, profile_id)
    return IndicatorConfigOut(profile_id=pid, configs=configs)


@profiles_ma_router.put(
    "/{profile_id}/indicator-config",
    response_model=IndicatorConfigOut,
)
def save_indicator_config(
    profile_id: int,
    items: list[IndicatorConfigItem],
    db: Session = Depends(get_db),
) -> object:
    """
    Upsert indicator toggles for this profile.
    Send the full list — missing indicators keep their current/default value.
    """
    pid, configs = service.save_indicator_config(db, profile_id, items)
    return IndicatorConfigOut(profile_id=pid, configs=configs)


# ── Staleness ─────────────────────────────────────────────────────────────────


@profiles_ma_router.get(
    "/{profile_id}/market-analysis/staleness",
    response_model=list[StalenessItem],
)
def get_staleness(profile_id: int, db: Session = Depends(get_db)) -> list:
    """
    For each active module, return the last analysis date and staleness flag.
    is_stale = True if no session exists OR last session is older than 7 days.
    """
    return service.get_staleness(db, profile_id)
