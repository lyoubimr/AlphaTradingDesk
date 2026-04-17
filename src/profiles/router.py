"""
Profiles router — CRUD endpoints.

Routes:
  GET    /api/profiles              → list all active profiles
  POST   /api/profiles              → create a new profile
  GET    /api/profiles/{id}         → get profile by id
  PUT    /api/profiles/{id}         → update profile (partial — only provided fields)
  DELETE /api/profiles/{id}         → soft-delete (status = 'deleted')

  GET    /api/profiles/{id}/strategies                      → list strategies for profile
  POST   /api/profiles/{id}/strategies                      → create strategy for profile
  PUT    /api/profiles/{id}/strategies/{sid}                → update strategy fields
  DELETE /api/profiles/{id}/strategies/{sid}                → soft-delete strategy
  POST   /api/profiles/{id}/strategies/{sid}/screenshots    → append screenshot
  DELETE /api/profiles/{id}/strategies/{sid}/screenshots/{b64} → remove screenshot
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile, status
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
    StrategyUpdate,
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


@router.post("/{profile_id}/recalculate-capital", response_model=ProfileOut)
def recalculate_capital(
    profile_id: int,
    db: Session = Depends(get_db),
) -> object:
    """Recompute capital_current from trade history (capital_start + Σ closed positions' PnL).

    Use after the full_close double-credit bug fix or any data migration.
    Safe to run multiple times (idempotent).
    """
    return service.recalculate_capital(db, profile_id)


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


@router.put(
    "/{profile_id}/strategies/{strategy_id}",
    response_model=StrategyOut,
)
def update_strategy(
    profile_id: int,
    strategy_id: int,
    data: StrategyUpdate,
    db: Session = Depends(get_db),
) -> object:
    """Update strategy fields (name, description, rules, emoji, color)."""
    return service.update_strategy(db, profile_id, strategy_id, data)


@router.post(
    "/{profile_id}/strategies/{strategy_id}/screenshots",
    response_model=StrategyOut,
)
def add_strategy_screenshot(
    profile_id: int,
    strategy_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> object:
    """Append a screenshot to a profile strategy's screenshot gallery."""
    return service.add_strategy_screenshot(db, profile_id, strategy_id, file)


@router.delete(
    "/{profile_id}/strategies/{strategy_id}/screenshots/{url_b64}",
    response_model=StrategyOut,
)
def remove_strategy_screenshot(
    profile_id: int,
    strategy_id: int,
    url_b64: str,
    db: Session = Depends(get_db),
) -> object:
    """Remove a screenshot from a profile strategy (base64url-encoded URL)."""
    import base64
    url = base64.urlsafe_b64decode(url_b64 + "==").decode("utf-8")
    return service.remove_strategy_screenshot(db, profile_id, strategy_id, url)
