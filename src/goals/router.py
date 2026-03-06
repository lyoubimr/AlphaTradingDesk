"""
Goals router — nested under /api/profiles/{profile_id}/goals.

Routes:
  GET    /api/profiles/{id}/goals                        → list all goals
  POST   /api/profiles/{id}/goals                        → create or upsert a goal
  PUT    /api/profiles/{id}/goals/{style_id}/{period}    → update a goal
  DELETE /api/profiles/{id}/goals/{style_id}/{period}    → delete a goal
  GET    /api/profiles/{id}/goals/progress               → computed progress

  POST   /api/profiles/{id}/goal-overrides               → log a circuit-breaker override
  GET    /api/profiles/{id}/goal-overrides               → override history
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.goals import service
from src.goals.schemas import (
    GoalCreate,
    GoalOut,
    GoalOverrideCreate,
    GoalOverrideOut,
    GoalProgressItem,
    GoalUpdate,
)

router = APIRouter(
    prefix="/profiles/{profile_id}",
    tags=["goals"],
)


# ── Goals CRUD ────────────────────────────────────────────────────────────────

@router.get("/goals", response_model=list[GoalOut])
def list_goals(profile_id: int, db: Session = Depends(get_db)) -> list:
    return service.get_goals(db, profile_id)


@router.post("/goals", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(
    profile_id: int,
    data: GoalCreate,
    db: Session = Depends(get_db),
) -> object:
    """Create a new goal, or upsert if one already exists for the same style+period."""
    return service.create_goal(db, profile_id, data)


@router.put("/goals/{style_id}/{period}", response_model=GoalOut)
def update_goal(
    profile_id: int,
    style_id: int,
    period: str,
    data: GoalUpdate,
    db: Session = Depends(get_db),
) -> object:
    return service.update_goal(db, profile_id, style_id, period, data)


@router.delete("/goals/{style_id}/{period}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    profile_id: int,
    style_id: int,
    period: str,
    db: Session = Depends(get_db),
) -> Response:
    """Permanently delete a goal."""
    service.delete_goal(db, profile_id, style_id, period)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/goals/progress", response_model=list[GoalProgressItem])
def get_progress(profile_id: int, db: Session = Depends(get_db)) -> list:
    return service.get_progress(db, profile_id)


# ── Goal Override Log ─────────────────────────────────────────────────────────

@router.post("/goal-overrides", response_model=GoalOverrideOut, status_code=status.HTTP_201_CREATED)
def create_override(
    profile_id: int,
    data: GoalOverrideCreate,
    db: Session = Depends(get_db),
) -> object:
    """Log a circuit-breaker override. reason_text is mandatory (min 20 chars)."""
    return service.create_override(db, profile_id, data)


@router.get("/goal-overrides", response_model=list[GoalOverrideOut])
def list_overrides(profile_id: int, db: Session = Depends(get_db)) -> list:
    """Return override history for a profile (newest first)."""
    return service.list_overrides(db, profile_id)
