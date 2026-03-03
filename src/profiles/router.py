"""
Profiles router — CRUD endpoints.

Routes:
  GET    /api/profiles              → list all active profiles
  POST   /api/profiles              → create a new profile
  GET    /api/profiles/{id}         → get profile by id
  PUT    /api/profiles/{id}         → update profile (partial — only provided fields)
  DELETE /api/profiles/{id}         → soft-delete (status = 'deleted')

  GET    /api/profiles/{id}/strategies   → list strategies for profile
  POST   /api/profiles/{id}/strategies   → create strategy for profile
  DELETE /api/profiles/{id}/strategies/{sid} → delete strategy
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.profiles import service
from src.profiles.schemas import (
    ProfileCreate,
    ProfileOut,
    ProfileUpdate,
    StrategyCreate,
    StrategyOut,
)

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("", response_model=list[ProfileOut])
def list_profiles(db: Session = Depends(get_db)) -> list:
    return service.get_all(db)


@router.post("", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
def create_profile(data: ProfileCreate, db: Session = Depends(get_db)) -> object:
    return service.create(db, data)


@router.get("/{profile_id}", response_model=ProfileOut)
def get_profile(profile_id: int, db: Session = Depends(get_db)) -> object:
    return service.get_by_id(db, profile_id)


@router.put("/{profile_id}", response_model=ProfileOut)
def update_profile(
    profile_id: int,
    data: ProfileUpdate,
    db: Session = Depends(get_db),
) -> object:
    return service.update(db, profile_id, data)


@router.delete("/{profile_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_profile(profile_id: int, db: Session = Depends(get_db)) -> Response:
    service.delete(db, profile_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Strategies ────────────────────────────────────────────────────────────────

@router.get("/{profile_id}/strategies", response_model=list[StrategyOut])
def list_strategies(profile_id: int, db: Session = Depends(get_db)) -> list:
    """List all active strategies for a profile."""
    return service.list_strategies(db, profile_id)


@router.post(
    "/{profile_id}/strategies",
    response_model=StrategyOut,
    status_code=status.HTTP_201_CREATED,
)
def create_strategy(
    profile_id: int,
    data: StrategyCreate,
    db: Session = Depends(get_db),
) -> object:
    """Create a new strategy for a profile."""
    return service.create_strategy(db, profile_id, data)


@router.delete(
    "/{profile_id}/strategies/{strategy_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_strategy(
    profile_id: int,
    strategy_id: int,
    db: Session = Depends(get_db),
) -> Response:
    """Soft-delete a strategy (sets status = 'archived')."""
    service.delete_strategy(db, profile_id, strategy_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
