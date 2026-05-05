"""
Phase 7 — Spot Volatility Celery tasks.

Scheduled tasks:
  spot-vi-1d  : daily at 01:00 UTC  (timeframe='1d')
  spot-vi-1w  : weekly Mon at 02:00 UTC (timeframe='1w')
  spot-vi-4h  : on-demand only — triggered via POST /api/spot-volatility/run

The 4h timeframe is kept on-demand because:
  - Closing events happen every 4h.
  - User controls exactly when to refresh (before a session).
  - Background compute is only useful for always-fresh snapshots needed
    by daily/weekly HTF ritual steps.

cleanup-spot-snapshots: daily at 03:30 UTC — removes old spot_watchlist_snapshots
  rows older than `retention_days` (default 60).

All tasks respect the `enabled` flag in spot_volatility_settings.config.
If enabled=False, the task exits immediately with status='skipped'.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from celery.exceptions import MaxRetriesExceededError

from src.core.celery_app import celery_app
from src.core.database import get_session_factory
from src.spot_volatility import service
from src.spot_volatility.models import SpotWatchlistSnapshot

logger = logging.getLogger(__name__)


def _get_db():  # type: ignore[return]
    """Open a raw SQLAlchemy session for Celery tasks (no FastAPI DI)."""
    return get_session_factory()()


# ── Compute Task ──────────────────────────────────────────────────────────────

@celery_app.task(
    name="src.spot_volatility.tasks.compute_spot_watchlist",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def compute_spot_watchlist(self, timeframe: str) -> dict:  # type: ignore[override]
    """Compute Spot Volatility watchlist for the given timeframe.

    Pipeline (delegates to service.compute_spot_watchlist):
      1. Load global spot_volatility_settings — check `enabled` gate
      2. _resolve_pairs: query instruments DB (use_all_synced) + volume pre-filter (top_n)
      3. KrakenSpotClient.fetch_ohlcv() per pair + compute_vi_score()
      4. KrakenSpotClient.fetch_all_tickers() — 24h change + superior TF snapshot
      5. INSERT spot_watchlist_snapshots row

    Args:
        timeframe: '1d' | '1w'  (4h is intentionally excluded from beat schedule)
    """
    db = _get_db()
    try:
        # ── 1. Enabled gate ───────────────────────────────────────────────
        settings_row = service.get_settings(db)
        cfg = settings_row.config
        if not cfg.get("enabled", True):
            logger.info("compute_spot_watchlist(%s): skipped (enabled=False in settings)", timeframe)
            return {"status": "skipped", "reason": "disabled", "timeframe": timeframe}

        # ── 2-5. Delegate to service ──────────────────────────────────────
        start = datetime.now(tz=UTC)
        snapshot = service.compute_spot_watchlist(timeframe, db)
        elapsed = (datetime.now(tz=UTC) - start).total_seconds()

        logger.info(
            "compute_spot_watchlist(%s): %d pairs — dominant regime %s — %.1fs",
            timeframe,
            snapshot.pairs_count,
            snapshot.regime,
            elapsed,
        )
        return {
            "status": "ok",
            "timeframe": timeframe,
            "pairs_computed": snapshot.pairs_count,
            "dominant_regime": snapshot.regime,
            "elapsed_s": round(elapsed, 1),
        }

    except Exception as exc:
        db.rollback()
        logger.exception("compute_spot_watchlist(%s): error — %s", timeframe, exc)
        try:
            raise self.retry(exc=exc, countdown=120 * (self.request.retries + 1))
        except MaxRetriesExceededError:
            return {"status": "error", "timeframe": timeframe, "error": str(exc)}
    finally:
        db.close()


# ── Cleanup Task ──────────────────────────────────────────────────────────────

@celery_app.task(
    name="src.spot_volatility.tasks.cleanup_old_spot_snapshots",
    bind=False,
)
def cleanup_old_spot_snapshots() -> dict:
    """Delete spot_watchlist_snapshots rows older than retention_days.

    Runs daily at 03:30 UTC (staggered after contracts cleanup at 03:00).
    retention_days defaults to 60 if not set in spot_volatility_settings.
    """
    db = _get_db()
    try:
        settings_row = service.get_settings(db)
        retention_days: int = int(settings_row.config.get("retention_days", 60))
        cutoff = datetime.now(tz=UTC) - timedelta(days=retention_days)

        deleted = (
            db.query(SpotWatchlistSnapshot)
            .filter(SpotWatchlistSnapshot.generated_at < cutoff)
            .delete(synchronize_session=False)
        )
        db.commit()
        logger.info(
            "cleanup_old_spot_snapshots: deleted %d rows older than %s (%d days)",
            deleted,
            cutoff.date().isoformat(),
            retention_days,
        )
        return {"status": "ok", "deleted": deleted, "retention_days": retention_days}

    except Exception as exc:
        db.rollback()
        logger.exception("cleanup_old_spot_snapshots: error — %s", exc)
        return {"status": "error", "error": str(exc)}
    finally:
        db.close()
