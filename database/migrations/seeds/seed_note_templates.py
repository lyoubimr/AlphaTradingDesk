"""
Seed: note_templates table.

1 global default template (profile_id = NULL) with 6 post-trade questions.
This template is shown to all profiles unless they define a custom one.

questions field is JSONB:
  [{"key": str, "label": str, "type": "text"|"choice"|"rating", "options": [...]}]

Idempotent: skip if a global template named "Default Post-Trade Review" already exists.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from src.core.models.journal import NoteTemplate

logger = logging.getLogger(__name__)

DEFAULT_TEMPLATE_NAME = "Default Post-Trade Review"

DEFAULT_QUESTIONS = [
    {
        "key": "went_well",
        "label": "What went well?",
        "type": "text",
        "required": False,
    },
    {
        "key": "went_wrong",
        "label": "What went wrong?",
        "type": "text",
        "required": False,
    },
    {
        "key": "followed_plan",
        "label": "Did you follow your plan?",
        "type": "choice",
        "options": ["Yes", "Partially", "No"],
        "required": True,
    },
    {
        "key": "emotional_state",
        "label": "Emotional state during the trade",
        "type": "choice",
        "options": ["Calm", "Anxious", "FOMO", "Revenge", "Confident", "Uncertain"],
        "required": True,
    },
    {
        "key": "would_take_again",
        "label": "Would you take this trade again?",
        "type": "choice",
        "options": ["Yes", "No"],
        "required": True,
    },
    {
        "key": "free_notes",
        "label": "Additional notes",
        "type": "text",
        "required": False,
    },
]


def seed_note_templates(session: Session) -> None:
    """
    Insert the global default note template. Skip if already exists (idempotent).
    """
    existing = (
        session.query(NoteTemplate)
        .filter(
            NoteTemplate.name == DEFAULT_TEMPLATE_NAME,
            NoteTemplate.profile_id.is_(None),
        )
        .first()
    )
    if existing:
        logger.info("Note template '%s' already exists — skipped.", DEFAULT_TEMPLATE_NAME)
        return

    template = NoteTemplate(
        profile_id=None,
        name=DEFAULT_TEMPLATE_NAME,
        questions=DEFAULT_QUESTIONS,
        is_default=True,
    )
    session.add(template)
    session.flush()
    logger.info("Note template '%s' seeded.", DEFAULT_TEMPLATE_NAME)
