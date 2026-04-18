"""Phase 4C — Review Tags Settings.

Config Table Pattern: one row per profile in review_tags_settings.
Default tags are hardcoded on the frontend; this table stores only the
user-defined CUSTOM tags added via profile settings or inline review panel.

config JSONB shape:
  {
    "custom_tags": [
      {
        "key":      "string",
        "label":    "string",
        "category": "execution" | "psychology" | "market",
        "positive": bool   // true = green badge (good), false = red badge (bad)
      }
    ]
  }
"""

from __future__ import annotations

import copy
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import BigInteger, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, Session, mapped_column
from sqlalchemy.sql import func

from src.core.database import Base

# ── Default config ─────────────────────────────────────────────────────────────

DEFAULT_REVIEW_TAGS_CONFIG: dict = {
    "custom_tags": [],
}

# ── ORM Model ─────────────────────────────────────────────────────────────────


class ReviewTagsSettings(Base):
    """Per-profile custom review tags configuration.

    profile_id IS the primary key — one row per profile.
    Auto-created with DEFAULT_REVIEW_TAGS_CONFIG on first GET.
    """

    __tablename__ = "review_tags_settings"

    profile_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("profiles.id", ondelete="CASCADE"),
        primary_key=True,
    )
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False), nullable=False, server_default=func.now()
    )


# ── Service helpers ────────────────────────────────────────────────────────────


def get_review_tags_settings(profile_id: int, db: Session) -> ReviewTagsSettings:
    """Return the ReviewTagsSettings row for a profile.

    Auto-creates with DEFAULT_REVIEW_TAGS_CONFIG on first access.
    """
    row = (
        db.query(ReviewTagsSettings)
        .filter(ReviewTagsSettings.profile_id == profile_id)
        .first()
    )
    if row is None:
        row = ReviewTagsSettings(
            profile_id=profile_id,
            config=copy.deepcopy(DEFAULT_REVIEW_TAGS_CONFIG),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_review_tags_settings(profile_id: int, config_patch: dict, db: Session) -> ReviewTagsSettings:
    """Deep-merge *config_patch* into the current settings for a profile.

    For the ``custom_tags`` list, the patch value fully replaces the stored value
    (last-write-wins list semantics — not element-level merge).
    """
    row = get_review_tags_settings(profile_id, db)
    merged = _merge(row.config, config_patch)
    row.config = merged
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def _merge(base: dict, patch: dict) -> dict:
    """Shallow-merge patch into base — lists are replaced, not appended."""
    result = copy.deepcopy(base)
    for key, value in patch.items():
        result[key] = value  # lists replaced wholesale (custom_tags)
    return result


def _validate_profile_exists(profile_id: int, db: Session) -> None:
    from src.core.models.broker import Profile  # local import to avoid circulars

    if not db.query(Profile).filter(Profile.id == profile_id).first():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile {profile_id} not found.",
        )
