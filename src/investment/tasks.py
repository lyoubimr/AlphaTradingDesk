"""
Investment Celery tasks — Phase 7.

Beat schedule entry (in src/core/celery_app.py):
  sync-spot-instruments: daily at 02:30 UTC
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

from src.core.celery_app import celery_app
from src.core.database import get_session_factory

logger = logging.getLogger(__name__)


def _get_db():
    return get_session_factory()()


@celery_app.task(
    name="src.investment.tasks.sync_spot_instruments",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def sync_spot_instruments(self) -> dict:  # type: ignore[override]
    """Daily sync of Kraken spot pairs (AssetPairs) into the instruments table."""
    from src.investment import service

    db = _get_db()
    try:
        result = service.sync_spot_instruments(db)
        logger.info("sync_spot_instruments: synced %d pairs", result["synced"])
        return {"status": "ok", **result}
    except HTTPException as exc:
        logger.error(
            "sync_spot_instruments: HTTP error %d — %s",
            exc.status_code,
            exc.detail,
        )
        return {"status": "error", "error": exc.detail}
    except Exception as exc:
        logger.exception("sync_spot_instruments: unexpected failure — %s", exc)
        try:
            raise self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            return {"status": "error", "error": str(exc)}
    finally:
        db.close()
