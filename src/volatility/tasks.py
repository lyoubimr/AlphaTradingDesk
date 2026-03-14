"""
Volatility Engine — Celery tasks (Phase 2).

Task skeleton (P2-3):
  Each task opens a DB session, checks is_within_schedule(), then runs
  the compute logic (populated in P2-5 through P2-10).

  On skip:  returns {"status": "skipped", "reason": "..."}
  On error: retries up to max_retries with exponential backoff
  On success: returns {"status": "ok", "timeframe": tf, ...}

Beat schedule is defined in src/core/celery_app.py.
"""

from __future__ import annotations

import logging

from celery.exceptions import MaxRetriesExceededError
from sqlalchemy.orm import Session

from src.core.celery_app import celery_app
from src.core.database import get_session_factory
from src.volatility.schedule import is_within_schedule, score_to_regime

logger = logging.getLogger(__name__)


def _get_db() -> Session:
    """Open a raw SQLAlchemy session for use inside Celery tasks.

    Tasks are not FastAPI request handlers — they don't use Depends(get_db).
    The session must be explicitly closed after use (see try/finally in each task).
    """
    return get_session_factory()()


@celery_app.task(
    name="src.volatility.tasks.compute_market_vi",
    bind=True,
    max_retries=3,
    default_retry_delay=60,  # 60s between retries
)
def compute_market_vi(self, timeframe: str) -> dict:  # type: ignore[override]
    """Compute Market Volatility Index (Binance Futures).

    P2-3: skeleton with schedule check + DB session.
    P2-5: BinanceClient.fetch_ohlcv() call.
    P2-6: indicator computation (RVOL, MFI, ATR, BB, EMA Score).
    P2-9: INSERT market_vi_snapshots + Redis cache.
    """
    db = _get_db()
    try:
        if not is_within_schedule(db, "market_vi"):
            logger.debug("compute_market_vi(%s): skipped (outside schedule)", timeframe)
            return {"status": "skipped", "reason": "outside_schedule", "timeframe": timeframe}

        # ── TODO P2-5: fetch OHLCV from Binance for selected pairs ────────
        # from src.volatility.binance_client import BinanceClient
        # client = BinanceClient()
        # pairs = db.query(MarketVIPair).filter_by(is_selected=True).all()
        # ...

        # ── TODO P2-6: compute indicators + aggregate Market VI score ─────

        # ── TODO P2-9: persist snapshot + cache in Redis ──────────────────

        logger.info("compute_market_vi(%s): stub — no data fetched yet", timeframe)
        return {"status": "stub", "timeframe": timeframe}

    except Exception as exc:
        logger.exception("compute_market_vi(%s): error — %s", timeframe, exc)
        try:
            raise self.retry(exc=exc, countdown=60 * (self.request.retries + 1))
        except MaxRetriesExceededError:
            return {"status": "error", "timeframe": timeframe, "error": str(exc)}
    finally:
        db.close()


@celery_app.task(
    name="src.volatility.tasks.compute_pair_vi",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def compute_pair_vi(self, timeframe: str) -> dict:  # type: ignore[override]
    """Compute Per-Pair Volatility Index (Kraken Futures).

    P2-3: skeleton with schedule check + DB session.
    P2-7: KrakenClient.fetch_ohlcv() call.
    P2-8: indicator computation per pair.
    P2-9: INSERT volatility_snapshots + generate watchlist_snapshot.
    """
    db = _get_db()
    try:
        if not is_within_schedule(db, "per_pair"):
            logger.debug("compute_pair_vi(%s): skipped (outside schedule)", timeframe)
            return {"status": "skipped", "reason": "outside_schedule", "timeframe": timeframe}

        # ── TODO P2-7: fetch OHLCV + orderbook from Kraken ───────────────
        # from src.volatility.kraken_client import KrakenClient
        # client = KrakenClient()
        # instruments = db.query(Instrument).filter_by(is_active=True, broker_id=KRAKEN_ID).all()
        # ...

        # ── TODO P2-8: compute indicators per pair ────────────────────────

        # ── TODO P2-9: persist snapshots + watchlist generation ───────────

        logger.info("compute_pair_vi(%s): stub — no data fetched yet", timeframe)
        return {"status": "stub", "timeframe": timeframe}

    except Exception as exc:
        logger.exception("compute_pair_vi(%s): error — %s", timeframe, exc)
        try:
            raise self.retry(exc=exc, countdown=60 * (self.request.retries + 1))
        except MaxRetriesExceededError:
            return {"status": "error", "timeframe": timeframe, "error": str(exc)}
    finally:
        db.close()


@celery_app.task(
    name="src.volatility.tasks.sync_instruments",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def sync_instruments(self) -> dict:  # type: ignore[override]
    """Sync instrument catalog from Kraken + Binance.

    Kraken: upsert all active pairs into instruments table.
           Delisted pairs → is_active=False (never DELETE, historical trades reference them).
    Binance: upsert top-100 by 24h quoteVolume into market_vi_pairs.
             Pre-select top-50 if not yet configured.

    P2-3: skeleton.
    P2-10: full implementation.
    """
    db = _get_db()
    try:
        # ── TODO P2-10: Kraken pairs upsert ──────────────────────────────
        # ── TODO P2-10: Binance top-100 upsert ───────────────────────────
        logger.info("sync_instruments: stub — no sync yet")
        return {"status": "stub"}

    except Exception as exc:
        logger.exception("sync_instruments: error — %s", exc)
        try:
            raise self.retry(exc=exc, countdown=120)
        except MaxRetriesExceededError:
            return {"status": "error", "error": str(exc)}
    finally:
        db.close()


@celery_app.task(
    name="src.volatility.tasks.cleanup_old_snapshots",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def cleanup_old_snapshots(self) -> dict:  # type: ignore[override]
    """Delete snapshots older than volatility_settings.per_pair.retention_days.

    Uses TimescaleDB drop_chunks() for hypertables — much faster than DELETE.
    Falls back to DELETE for watchlist_snapshots (regular table).

    P2-3: skeleton.
    P2-11: full implementation.
    """
    db = _get_db()
    try:
        # ── TODO P2-11: read retention_days from settings ─────────────────
        # ── TODO P2-11: SELECT drop_chunks('volatility_snapshots', NOW()-INTERVAL %s) ──
        # ── TODO P2-11: SELECT drop_chunks('market_vi_snapshots', ...) ────
        # ── TODO P2-11: DELETE FROM watchlist_snapshots WHERE generated_at < ... ──
        logger.info("cleanup_old_snapshots: stub — no cleanup yet")
        return {"status": "stub"}

    except Exception as exc:
        logger.exception("cleanup_old_snapshots: error — %s", exc)
        try:
            raise self.retry(exc=exc, countdown=300)
        except MaxRetriesExceededError:
            return {"status": "error", "error": str(exc)}
    finally:
        db.close()

