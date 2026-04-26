"""
Ritual Module — FastAPI router.

Prefix: /api/profiles/{profile_id}/ritual
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from src.core.database import get_db
from src.ritual import service
from src.ritual.schemas import (
    PinnedPairCreate,
    PinnedPairExtend,
    PinnedPairRead,
    RitualSettingsPatch,
    RitualSettingsRead,
    SessionComplete,
    SessionCreate,
    SessionRead,
    SmartWLResult,
    StepComplete,
    StepLogRead,
    StepRead,
    StepUpdate,
    WeeklyScoreRead,
)

router = APIRouter(prefix="/profiles/{profile_id}/ritual", tags=["ritual"])

DbDep = Annotated[Session, Depends(get_db)]


# ── Settings ─────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=RitualSettingsRead, summary="Get ritual settings")
def get_settings(profile_id: int, db: DbDep) -> RitualSettingsRead:
    """Return per-profile ritual config. Auto-creates with defaults on first call."""
    row = service.get_ritual_settings(profile_id, db)
    return RitualSettingsRead.model_validate(row)


@router.put("/settings", response_model=RitualSettingsRead, summary="Update ritual settings")
def update_settings(
    profile_id: int, payload: RitualSettingsPatch, db: DbDep
) -> RitualSettingsRead:
    """Deep-merge patch into config — keys not in patch are preserved."""
    row = service.update_ritual_settings(profile_id, payload.config, db)
    return RitualSettingsRead.model_validate(row)


# ── Step Templates ────────────────────────────────────────────────────────────

@router.get(
    "/steps/{session_type}",
    response_model=list[StepRead],
    summary="Get step templates for a session type",
)
def get_steps(profile_id: int, session_type: str, db: DbDep) -> list[StepRead]:
    """Return ordered step list. Auto-seeds defaults on first call per session type."""
    return service.get_steps(profile_id, session_type, db)


@router.patch(
    "/steps/{step_id}",
    response_model=StepRead,
    summary="Update a step template",
)
def update_step(
    profile_id: int, step_id: int, payload: StepUpdate, db: DbDep
) -> StepRead:
    return service.update_step(
        profile_id, step_id, payload.model_dump(exclude_none=True), db
    )


@router.post(
    "/steps/{session_type}/reset",
    response_model=list[StepRead],
    summary="Reset steps to defaults",
)
def reset_steps(profile_id: int, session_type: str, db: DbDep) -> list[StepRead]:
    """Delete and re-seed default steps for this session type."""
    return service.reset_steps(profile_id, session_type, db)


# ── Pinned Pairs ─────────────────────────────────────────────────────────────

@router.get(
    "/pinned",
    response_model=list[PinnedPairRead],
    summary="List active pinned pairs",
)
def list_pinned(
    profile_id: int,
    db: DbDep,
    include_expired: bool = Query(False),
) -> list[PinnedPairRead]:
    """Return active pinned pairs, optionally including expired ones."""
    return service.list_pinned(profile_id, db, include_expired=include_expired)


@router.post(
    "/pinned",
    response_model=PinnedPairRead,
    status_code=201,
    summary="Pin a pair",
)
def add_pinned(
    profile_id: int, payload: PinnedPairCreate, db: DbDep
) -> PinnedPairRead:
    """Pin a pair with automatic TTL based on timeframe."""
    return service.add_pinned(profile_id, payload, db)


@router.delete(
    "/pinned/{pin_id}",
    status_code=204,
    summary="Archive (remove) a pinned pair",
)
def remove_pinned(profile_id: int, pin_id: int, db: DbDep) -> None:
    service.remove_pinned(profile_id, pin_id, db)


@router.post(
    "/pinned/{pin_id}/extend",
    response_model=PinnedPairRead,
    summary="Extend a pinned pair's TTL",
)
def extend_pinned(
    profile_id: int, pin_id: int, payload: PinnedPairExtend, db: DbDep
) -> PinnedPairRead:
    """Extend TTL by N hours from current expiry (or NOW if already expired)."""
    return service.extend_pinned(profile_id, pin_id, payload, db)


# ── Sessions ─────────────────────────────────────────────────────────────────

@router.get(
    "/sessions",
    response_model=list[SessionRead],
    summary="List recent sessions",
)
def list_sessions(
    profile_id: int,
    db: DbDep,
    limit: int = Query(20, ge=1, le=100),
) -> list[SessionRead]:
    return service.list_sessions(profile_id, db, limit=limit)


@router.get(
    "/sessions/active",
    response_model=SessionRead | None,
    summary="Get current active session",
)
def get_active_session(profile_id: int, db: DbDep) -> SessionRead | None:
    return service.get_active_session(profile_id, db)


@router.post(
    "/sessions",
    response_model=SessionRead,
    status_code=201,
    summary="Start a new session",
)
def start_session(
    profile_id: int, payload: SessionCreate, db: DbDep
) -> SessionRead:
    """Start a session. Any previously in_progress session is auto-abandoned."""
    return service.start_session(profile_id, payload.session_type, db)


@router.post(
    "/sessions/{session_id}/steps/{step_log_id}/complete",
    response_model=StepLogRead,
    summary="Mark a step as done or skipped",
)
def complete_step(
    profile_id: int,
    session_id: int,
    step_log_id: int,
    payload: StepComplete,
    db: DbDep,
) -> StepLogRead:
    return service.complete_step(profile_id, session_id, step_log_id, payload, db)


@router.post(
    "/sessions/{session_id}/complete",
    response_model=SessionRead,
    summary="Complete a session",
)
def complete_session(
    profile_id: int, session_id: int, payload: SessionComplete, db: DbDep
) -> SessionRead:
    """Complete the session and compute discipline points."""
    return service.close_session(profile_id, session_id, payload, abandon=False, db=db)


@router.post(
    "/sessions/{session_id}/abandon",
    response_model=SessionRead,
    summary="Abandon a session",
)
def abandon_session(
    profile_id: int, session_id: int, db: DbDep
) -> SessionRead:
    return service.close_session(
        profile_id, session_id, payload=SessionComplete(outcome=None), abandon=True, db=db
    )


# ── Smart Watchlist ───────────────────────────────────────────────────────────

@router.post(
    "/smart-watchlist/generate",
    response_model=SmartWLResult,
    summary="Generate Smart Watchlist",
)
def generate_smart_watchlist(
    profile_id: int,
    db: DbDep,
    session_type: str = Query("trade_session"),
    top_n: int | None = Query(None, ge=5, le=100),
) -> SmartWLResult:
    """Compute cascade cross-TF scoring and return ranked watchlist."""
    return service.generate_smart_watchlist(profile_id, session_type, top_n, db)


@router.get(
    "/smart-watchlist/download",
    summary="Download Smart Watchlist as TradingView .txt",
)
def download_smart_watchlist(
    profile_id: int,
    db: DbDep,
    session_type: str = Query("trade_session"),
    top_n: int | None = Query(None, ge=5, le=100),
) -> Response:
    """Generate and download a TradingView-importable watchlist file."""
    result = service.generate_smart_watchlist(profile_id, session_type, top_n, db)
    now_str = datetime.now().strftime("%Y%m%d_%H%M")
    filename = f"ATD_TOP{result.top_n}_{now_str}_{result.broker_name}.txt"
    content = service.generate_watchlist_file(result)
    return Response(
        content=content,
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Discipline Score ──────────────────────────────────────────────────────────

@router.get(
    "/score",
    response_model=WeeklyScoreRead,
    summary="Current week discipline score",
)
def get_weekly_score(profile_id: int, db: DbDep) -> WeeklyScoreRead:
    return service.get_weekly_score(profile_id, db)


@router.get(
    "/score/history",
    response_model=list[WeeklyScoreRead],
    summary="Weekly score history",
)
def get_score_history(
    profile_id: int,
    db: DbDep,
    weeks: int = Query(8, ge=1, le=52),
) -> list[WeeklyScoreRead]:
    return service.get_weekly_score_history(profile_id, db, weeks=weeks)
