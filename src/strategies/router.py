"""Global strategies router.

Routes:
  GET    /api/strategies                     → list all active strategies (global + optionally profile)
  POST   /api/strategies                     → create a global strategy (profile_id = NULL)
  PUT    /api/strategies/{id}                → update a global strategy
  DELETE /api/strategies/{id}                → archive a global strategy
  POST   /api/strategies/{id}/screenshots    → append screenshot to global strategy gallery
  DELETE /api/strategies/{id}/screenshots/{url_b64} → remove screenshot

Profile-specific strategies remain under /api/profiles/{id}/strategies.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.core.models.trade import Strategy
from src.profiles import service as profile_service
from src.profiles.schemas import StrategyCreate, StrategyOut, StrategyUpdate

router = APIRouter(prefix="/strategies", tags=["strategies"])


def _get_global_strategy_or_404(db: Session, strategy_id: int) -> Strategy:
    s = db.query(Strategy).filter(
        Strategy.id == strategy_id,
        Strategy.profile_id.is_(None),
    ).first()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Global strategy {strategy_id} not found.",
        )
    return s


@router.get("", response_model=list[StrategyOut])
def list_strategies(
    profile_id: int | None = Query(
        default=None,
        description="If provided, returns global strategies + strategies of this profile.",
    ),
    db: Session = Depends(get_db),
) -> list:
    """
    List all active strategies.

    Without profile_id → global strategies only (profile_id IS NULL).
    With    profile_id → global strategies + profile-specific strategies of that profile.

    Ordered by: global first (profile_id IS NULL), then alphabetically by name.
    """
    q = db.query(Strategy).filter(Strategy.status == "active")
    if profile_id is not None:
        q = q.filter(
            or_(Strategy.profile_id.is_(None), Strategy.profile_id == profile_id)
        )
    else:
        q = q.filter(Strategy.profile_id.is_(None))

    strategies = q.order_by(Strategy.profile_id.is_(None).desc(), Strategy.name).all()
    return profile_service.enrich_strategies_disciplined(db, strategies)


@router.post("", response_model=StrategyOut, status_code=status.HTTP_201_CREATED)
def create_global_strategy(
    data: StrategyCreate,
    db: Session = Depends(get_db),
) -> object:
    """
    Create a global strategy (profile_id = NULL).
    Global strategies are shared across all profiles.
    """
    strategy = Strategy(
        profile_id=None,  # global — not tied to any profile
        name=data.name,
        description=data.description,
        rules=data.rules,
        emoji=data.emoji,
        color=data.color,
        status="active",
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.put("/{strategy_id}", response_model=StrategyOut)
def update_global_strategy(
    strategy_id: int,
    data: StrategyUpdate,
    db: Session = Depends(get_db),
) -> object:
    """Update a global strategy (PATCH semantics)."""
    strategy = _get_global_strategy_or_404(db, strategy_id)
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(strategy, field, value)
    db.commit()
    db.refresh(strategy)
    return strategy


@router.delete("/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def archive_global_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
) -> Response:
    """Archive (soft-delete) a global strategy."""
    strategy = _get_global_strategy_or_404(db, strategy_id)
    strategy.status = "archived"
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{strategy_id}/screenshots", response_model=StrategyOut)
def add_global_strategy_screenshot(
    strategy_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> object:
    """Append a screenshot to a global strategy's screenshot gallery."""
    return profile_service.add_global_strategy_screenshot(db, strategy_id, file)


@router.delete("/{strategy_id}/screenshots/{url_b64}", response_model=StrategyOut)
def remove_global_strategy_screenshot(
    strategy_id: int,
    url_b64: str,
    db: Session = Depends(get_db),
) -> object:
    """Remove a screenshot from a global strategy (base64url-encoded URL)."""
    import base64
    url = base64.urlsafe_b64decode(url_b64 + "==").decode("utf-8")
    return profile_service.remove_global_strategy_screenshot(db, strategy_id, url)
