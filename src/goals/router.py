"""
Goals router — nested under /api/profiles/{profile_id}/goals.

Routes:
  GET    /api/profiles/{id}/goals                        → list all goals
  POST   /api/profiles/{id}/goals                        → create a goal
  PUT    /api/profiles/{id}/goals/{style_id}/{period}    → update a goal
  GET    /api/profiles/{id}/goals/progress               → computed progress
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.goals import service
from src.goals.schemas import GoalCreate, GoalOut, GoalProgressItem, GoalUpdate

router = APIRouter(
    prefix="/profiles/{profile_id}/goals",
    tags=["goals"],
)


@router.get("", response_model=list[GoalOut])
def list_goals(profile_id: int, db: Session = Depends(get_db)) -> list:
    return service.get_goals(db, profile_id)


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(
    profile_id: int,
    data: GoalCreate,
    db: Session = Depends(get_db),
) -> object:
    return service.create_goal(db, profile_id, data)


@router.put("/{style_id}/{period}", response_model=GoalOut)
def update_goal(
    profile_id: int,
    style_id: int,
    period: str,
    data: GoalUpdate,
    db: Session = Depends(get_db),
) -> object:
    return service.update_goal(db, profile_id, style_id, period, data)


@router.get("/progress", response_model=list[GoalProgressItem])
def get_progress(profile_id: int, db: Session = Depends(get_db)) -> list:
    return service.get_progress(db, profile_id)
