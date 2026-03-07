"""
Profile service — business logic layer.

Keeps routers thin: all DB queries and validation rules live here.
"""

from __future__ import annotations

import os
import uuid

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.models.broker import Broker, Profile
from src.core.models.trade import Strategy
from src.profiles.schemas import ProfileCreate, ProfileUpdate, StrategyCreate, StrategyUpdate

# Allowed image MIME types for strategy uploads
_ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024  # 5 MB


def _strategies_upload_dir() -> str:
    path = os.path.join(settings.uploads_dir, "strategies")
    os.makedirs(path, exist_ok=True)
    return path


def _get_or_404(db: Session, profile_id: int) -> Profile:
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile {profile_id} not found.",
        )
    return profile


def _validate_broker(db: Session, broker_id: int, market_type: str) -> None:
    """
    Ensure the broker exists, is active, and matches the profile's market_type.

    Rules:
      - Crypto profile → broker.market_type must be 'Crypto'
      - CFD profile    → broker.market_type must be 'CFD'
    """
    broker = db.query(Broker).filter(Broker.id == broker_id).first()
    if not broker:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Broker {broker_id} not found.",
        )
    if broker.status != "active":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Broker '{broker.name}' is not active.",
        )
    if broker.market_type != market_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Broker '{broker.name}' is a {broker.market_type} broker "
                f"but the profile market_type is {market_type}. They must match."
            ),
        )


def get_all(db: Session) -> list[Profile]:
    """Return all non-deleted profiles, most recent first."""
    return (
        db.query(Profile)
        .filter(Profile.status != "deleted")
        .order_by(Profile.created_at.desc())
        .all()
    )


def get_by_id(db: Session, profile_id: int) -> Profile:
    return _get_or_404(db, profile_id)


def create(db: Session, data: ProfileCreate) -> Profile:
    if data.broker_id is not None:
        _validate_broker(db, data.broker_id, data.market_type)

    profile = Profile(
        name=data.name,
        market_type=data.market_type,
        broker_id=data.broker_id,
        currency=data.currency,
        capital_start=data.capital_start,
        capital_current=data.capital_start,  # starts equal to capital_start
        risk_percentage_default=data.risk_percentage_default,
        max_concurrent_risk_pct=data.max_concurrent_risk_pct,
        min_pnl_pct_for_stats=data.min_pnl_pct_for_stats,
        description=data.description,
        notes=data.notes,
        status="active",
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


def update(db: Session, profile_id: int, data: ProfileUpdate) -> Profile:
    profile = _get_or_404(db, profile_id)

    # If broker_id changes, re-validate against the (possibly new) market_type
    new_market_type = data.market_type or profile.market_type
    new_broker_id = data.broker_id if "broker_id" in data.model_fields_set else profile.broker_id

    if new_broker_id is not None:
        _validate_broker(db, new_broker_id, new_market_type)

    # Apply only the fields explicitly provided in the request body
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)

    db.commit()
    db.refresh(profile)
    return profile


def delete(db: Session, profile_id: int) -> None:
    """Soft-delete: set status = 'deleted'. Data is never physically removed."""
    profile = _get_or_404(db, profile_id)
    profile.status = "deleted"
    db.commit()


# ── Strategy helpers ──────────────────────────────────────────────────────────


def list_strategies(db: Session, profile_id: int) -> list[Strategy]:
    """Return strategies visible to a profile.

    Includes:
    - Global strategies (profile_id IS NULL) — shared across all profiles
    - Profile-specific strategies (profile_id = profile_id)

    Both ordered by name.
    """
    _get_or_404(db, profile_id)
    from sqlalchemy import or_

    return (
        db.query(Strategy)
        .filter(
            or_(Strategy.profile_id == profile_id, Strategy.profile_id.is_(None)),
            Strategy.status == "active",
        )
        .order_by(Strategy.name)
        .all()
    )


def create_strategy(db: Session, profile_id: int, data: StrategyCreate) -> Strategy:
    """Create a new strategy for a profile (profile-specific, not global)."""
    _get_or_404(db, profile_id)
    strategy = Strategy(
        profile_id=profile_id,
        name=data.name,
        description=data.description,
        rules=data.rules,
        emoji=data.emoji,
        color=data.color,
        image_url=data.image_url,
        status="active",
    )
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    return strategy


def update_strategy(
    db: Session, profile_id: int, strategy_id: int, data: StrategyUpdate
) -> Strategy:
    """Update strategy fields (PATCH semantics — only provided fields)."""
    _get_or_404(db, profile_id)
    strategy = (
        db.query(Strategy)
        .filter(Strategy.id == strategy_id, Strategy.profile_id == profile_id)
        .first()
    )
    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Strategy {strategy_id} not found for profile {profile_id}.",
        )
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(strategy, field, value)
    db.commit()
    db.refresh(strategy)
    return strategy


def delete_strategy(db: Session, profile_id: int, strategy_id: int) -> None:
    """Soft-delete a strategy (status = 'archived')."""
    _get_or_404(db, profile_id)
    strategy = (
        db.query(Strategy)
        .filter(Strategy.id == strategy_id, Strategy.profile_id == profile_id)
        .first()
    )
    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Strategy {strategy_id} not found for profile {profile_id}.",
        )
    strategy.status = "archived"
    db.commit()


def _get_strategy_or_404(db: Session, profile_id: int, strategy_id: int) -> Strategy:
    _get_or_404(db, profile_id)
    strategy = (
        db.query(Strategy)
        .filter(Strategy.id == strategy_id, Strategy.profile_id == profile_id)
        .first()
    )
    if not strategy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Strategy {strategy_id} not found for profile {profile_id}.",
        )
    return strategy


def upload_strategy_image(
    db: Session, profile_id: int, strategy_id: int, file: UploadFile
) -> Strategy:
    """
    Save the uploaded image to disk, set image_url on the strategy.

    URL format: /uploads/strategies/<filename>
    Proxied through Vite in dev, served via StaticFiles mount in all envs.
    """
    strategy = _get_strategy_or_404(db, profile_id, strategy_id)

    # Validate MIME type
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported file type '{file.content_type}'. Allowed: jpeg, png, webp, gif.",
        )

    # Read + size check
    content = file.file.read()
    if len(content) > _MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"File too large ({len(content) // 1024} KB). Maximum is 5 MB.",
        )

    # Build a unique filename: strategy_<id>_<uuid>.<ext>
    ext = (file.filename or "upload").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
        ext = "jpg"
    filename = f"strategy_{strategy_id}_{uuid.uuid4().hex[:8]}.{ext}"

    # Delete old file if exists
    if strategy.image_url:
        old_filename = strategy.image_url.rsplit("/", 1)[-1]
        old_path = os.path.join(_strategies_upload_dir(), old_filename)
        if os.path.isfile(old_path):
            os.remove(old_path)

    # Write new file
    dest = os.path.join(_strategies_upload_dir(), filename)
    with open(dest, "wb") as f:
        f.write(content)

    strategy.image_url = f"/uploads/strategies/{filename}"
    db.commit()
    db.refresh(strategy)
    return strategy


def delete_strategy_image(db: Session, profile_id: int, strategy_id: int) -> Strategy:
    """Remove the strategy image: delete file from disk + set image_url = null."""
    strategy = _get_strategy_or_404(db, profile_id, strategy_id)

    if strategy.image_url:
        filename = strategy.image_url.rsplit("/", 1)[-1]
        path = os.path.join(_strategies_upload_dir(), filename)
        if os.path.isfile(path):
            os.remove(path)
        strategy.image_url = None
        db.commit()
        db.refresh(strategy)

    return strategy
