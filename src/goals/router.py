"""
Goals router — nested under /api/profiles/{profile_id}/goals.

Routes:
  GET    /api/profiles/{id}/goals               → list all goals (with style_name)
  POST   /api/profiles/{id}/goals               → create a single goal
  POST   /api/profiles/{id}/goals/matrix        → create up to 3 goals at once
  PUT    /api/profiles/{id}/goals/{goal_id}     → update a goal by id
  DELETE /api/profiles/{id}/goals/{goal_id}     → delete a goal by id
  GET    /api/profiles/{id}/goals/progress      → computed real-time progress

  POST   /api/profiles/{id}/goal-overrides      → log a circuit-breaker override
  GET    /api/profiles/{id}/goal-overrides       → override history
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.goals import service
from src.goals.schemas import (
    GoalCreate,
    GoalMatrixCreate,
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
    result = service.create_goal(db, profile_id, data)
    db.commit()
    return result


@router.post("/goals/matrix", response_model=list[GoalOut], status_code=status.HTTP_201_CREATED)
def create_goal_matrix(
    profile_id: int,
    data: GoalMatrixCreate,
    db: Session = Depends(get_db),
) -> list:
    """Create up to 3 goals at once (daily/weekly/monthly) for one style. Upserts existing."""
    result = service.create_goal_matrix(db, profile_id, data)
    db.commit()
    return result


@router.put("/goals/{goal_id}", response_model=GoalOut)
def update_goal(
    profile_id: int,
    goal_id: int,
    data: GoalUpdate,
    db: Session = Depends(get_db),
) -> object:
    result = service.update_goal(db, profile_id, goal_id, data)
    db.commit()
    return result


@router.delete("/goals/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    profile_id: int,
    goal_id: int,
    db: Session = Depends(get_db),
) -> Response:
    service.delete_goal(db, profile_id, goal_id)
    db.commit()
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
    return service.create_override(db, profile_id, data)


@router.get("/goal-overrides", response_model=list[GoalOverrideOut])
def list_overrides(profile_id: int, db: Session = Depends(get_db)) -> list:
    return service.list_overrides(db, profile_id)
