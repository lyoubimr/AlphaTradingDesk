"""
Volatility Engine — Celery tasks (Phase 2).

Progress
--------
  P2-3  Skeletons with schedule gate + DB session             DONE
  P2-5  compute_market_vi — BinanceClient + indicators        DONE  ← this file
  P2-6  compute_pair_vi   — KrakenClient + indicators         TODO
  P2-10 sync_instruments  — Kraken + Binance upsert           TODO
  P2-11 cleanup_old_snapshots — TimescaleDB drop_chunks       TODO

On skip:  returns {"status": "skipped", "reason": "..."}
On error: retries up to max_retries with exponential backoff
On success: returns {"status": "ok", "timeframe": tf, ...}

Beat schedule is defined in src/core/celery_app.py.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal

from celery.exceptions import MaxRetriesExceededError
from sqlalchemy.orm import Session

from src.core.celery_app import celery_app
from src.core.database import get_session_factory
from src.volatility.cache import cache_market_vi
from src.volatility.indicators import compute_vi_score
from src.volatility.models import MarketVIPair, MarketVISnapshot
from src.volatility.schedule import (
    _load_settings,
    get_regime_thresholds,
    is_within_schedule,
    score_to_regime,
)

logger = logging.getLogger(__name__)


def _get_db() -> Session:
    """Open a raw SQLAlchemy session for use inside Celery tasks.

    Tasks are not FastAPI request handlers — they don't use Depends(get_db).
    The session must be explicitly closed after use (see try/finally in each task).
    """
    return get_session_factory()()


# ── Weight helper ────────────────────────────────────────────────────────────

def _build_weights(symbols: list[str], configured: dict) -> dict[str, float]:
    """Resolve final per-pair weights, normalised to sum = 1.0.

    Symbols present in `configured` (e.g. {"BTCUSDT": 0.30, "ETHUSDT": 0.20})
    keep their values.  All remaining symbols share the leftover weight equally.
    The result is always normalised to sum = 1.0 to guard against misconfiguration.
    """
    if not symbols:
        return {}
    total_configured = sum(float(configured.get(s, 0.0)) for s in symbols)
    remaining = max(1.0 - total_configured, 0.0)
    unconfigured = [s for s in symbols if s not in configured]
    share = remaining / len(unconfigured) if unconfigured else 0.0
    weights = {
        s: float(configured[s]) if s in configured else share for s in symbols
    }
    total = sum(weights.values())
    if total > 0:
        weights = {s: w / total for s, w in weights.items()}
    return weights


# ── Tasks ─────────────────────────────────────────────────────────────────────

@celery_app.task(
    name="src.volatility.tasks.compute_market_vi",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def compute_market_vi(self, timeframe: str) -> dict:  # type: ignore[override]
    """Compute Market Volatility Index (Binance Futures).

    Pipeline (P2-5):
      1. Load volatility_settings.market_vi config (enabled indicators, weights)
      2. Query market_vi_pairs WHERE is_selected=True
      3. BinanceClient.fetch_ohlcv(symbol, timeframe, limit=220) for each pair
      4. compute_vi_score(candles, enabled) → per-pair components + vi_score
      5. Weighted average → market_vi (float 0–1)
      6. score_to_regime() → regime label
      7. INSERT market_vi_snapshots (TimescaleDB hypertable)
      8. cache_market_vi() → Redis TTL
    """
    db = _get_db()
    try:
        # ── 1. Schedule gate ──────────────────────────────────────────────
        if not is_within_schedule(db, "market_vi"):
            logger.debug("compute_market_vi(%s): skipped (outside schedule)", timeframe)
            return {"status": "skipped", "reason": "outside_schedule", "timeframe": timeframe}

        # ── 2. Load settings ──────────────────────────────────────────────
        mv_cfg = _load_settings(db, "market_vi", None)
        enabled: dict = mv_cfg.get(
            "indicators", {"rvol": True, "mfi": True, "atr": True, "bb": True, "ema": True}
        )
        configured_weights: dict = mv_cfg.get("weights", {})

        # ── 3. Resolve selected pairs ─────────────────────────────────────
        pairs_rows = (
            db.query(MarketVIPair)
            .filter(MarketVIPair.is_selected.is_(True))
            .order_by(MarketVIPair.volume_rank)
            .all()
        )
        if not pairs_rows:
            # sync_instruments hasn't run yet — fallback top rows by rank
            pairs_rows = (
                db.query(MarketVIPair)
                .order_by(MarketVIPair.volume_rank)
                .limit(50)
                .all()
            )
        symbols: list[str] = [p.symbol for p in pairs_rows] or [
            "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"
        ]

        # ── 4. Fetch OHLCV + compute per-pair VI ──────────────────────────
        # Import here to avoid circular import in module-level headers
        from src.volatility.binance_client import BinanceClient  # noqa: PLC0415

        pair_scores: dict[str, dict] = {}
        with BinanceClient() as client:
            for symbol in symbols:
                try:
                    # 220 candles: covers EMA-200 convergence + 20-bar RVOL window
                    candles = client.fetch_ohlcv(symbol, timeframe, limit=220)
                    result = compute_vi_score(candles, enabled)
                    pair_scores[symbol] = result
                except Exception as pair_exc:
                    logger.warning(
                        "compute_market_vi(%s): pair %s failed — %s",
                        timeframe, symbol, pair_exc,
                    )

        if not pair_scores:
            logger.warning("compute_market_vi(%s): no pair data computed", timeframe)
            return {"status": "skipped", "reason": "no_pair_data", "timeframe": timeframe}

        # ── 5. Weighted average ───────────────────────────────────────────
        weights = _build_weights(list(pair_scores.keys()), configured_weights)
        total_w = sum(weights.get(s, 0.0) for s in pair_scores)
        if total_w <= 0:
            total_w = float(len(pair_scores))
            weights = {s: 1.0 for s in pair_scores}
        market_vi = sum(
            pair_scores[s]["vi_score"] * weights.get(s, 0.0) for s in pair_scores
        ) / total_w
        market_vi = round(float(market_vi), 3)

        # ── 6. Regime ─────────────────────────────────────────────────────
        thresholds = get_regime_thresholds(db)
        regime = score_to_regime(market_vi, thresholds)

        # ── 7. Persist snapshot ───────────────────────────────────────────
        components = {s: round(float(v["vi_score"]), 3) for s, v in pair_scores.items()}
        now = datetime.now(UTC)
        snapshot = MarketVISnapshot(
            timeframe=timeframe,
            timestamp=now,
            vi_score=Decimal(str(market_vi)),
            regime=regime,
            components=components,
        )
        db.add(snapshot)
        db.commit()

        logger.info(
            "compute_market_vi(%s): %.3f (%s) — %d/%d pairs computed",
            timeframe, market_vi, regime, len(pair_scores), len(symbols),
        )

        # ── 8. Redis cache ────────────────────────────────────────────────
        cache_market_vi(timeframe, market_vi, regime, now.isoformat())

        return {
            "status": "ok",
            "timeframe": timeframe,
            "vi_score": market_vi,
            "regime": regime,
            "pairs_computed": len(pair_scores),
            "pairs_total": len(symbols),
        }

    except Exception as exc:
        db.rollback()
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

