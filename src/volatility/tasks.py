"""
Volatility Engine — Celery tasks (Phase 2).

Progress
--------
  P2-3  Skeletons with schedule gate + DB session             DONE
  P2-5  compute_market_vi — BinanceClient + indicators        DONE
  P2-6  compute_pair_vi   — KrakenClient + indicators         DONE  ← this file
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
from src.core.models.broker import Broker, Instrument
from src.volatility.cache import cache_market_vi, cache_pair_vi
from src.volatility.indicators import compute_vi_score
from src.volatility.models import (
    MarketVIPair,
    MarketVISnapshot,
    VolatilitySnapshot,
    WatchlistSnapshot,
)
from src.volatility.schedule import (
    _load_settings,
    get_regime_thresholds,
    is_within_schedule,
    score_to_regime,
)

logger = logging.getLogger(__name__)

# Timeframe hierarchy for TF+1 column in watchlist
# Key = current TF, Value = next higher TF to look up in DB
_TF_SUPERIOR: dict[str, str] = {
    "15m": "1h",
    "1h": "4h",
    "4h": "1d",
    "1d": "1w",
    # 1w has no superior — column left empty
}


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


def _build_watchlist_pairs(
    pair_scores: dict[str, dict],
    tickers: dict[str, dict],
    sup_scores: dict[str, dict],
    thresholds: dict,
    timeframe: str,
) -> list[dict]:
    """Build the watchlist pairs list, ranked by vi_score (+ EMA boost).

    EMA boost: pairs with `ema_signal` in (breakout_up, above_all) get a
    small score boost for ranking only — the stored vi_score is unaffected.

    Args:
        pair_scores:  {symbol: compute_vi_score result}
        tickers:      {symbol: {"change_pct_24h": float, ...}}
        sup_scores:   latest vi_score + regime from the superior TF, keyed by symbol
        thresholds:   regime thresholds dict
        timeframe:    current computation TF (used for watchlist name)

    Returns:
        List of pair dicts sorted by rank_score DESC, each containing the
        7 watchlist columns: pair, vi_score, regime, ema_signal, change_24h,
        tf_sup_regime, tf_sup_vi (EMA fields come after change_24h).
    """
    _BOOST_SIGNALS = {"breakout_up", "above_all"}

    rows = []
    for symbol, res in pair_scores.items():
        vi = float(res["vi_score"])
        regime = score_to_regime(vi, thresholds)

        ema_signal: str = res.get("ema_signal", "mixed")
        ema_score: float = float(res.get("ema_score", 0.5))

        # Rank score: vi_score + small EMA boost (≤ 0.05) for directional signals
        rank_score = vi + (0.05 if ema_signal in _BOOST_SIGNALS else 0.0)

        ticker = tickers.get(symbol, {})
        change_24h = ticker.get("change_pct_24h", None)

        sup = sup_scores.get(symbol, {})
        tf_sup_regime = sup.get("regime")
        tf_sup_vi = sup.get("vi_score")

        # Alert: actionable conclusion derived from regime
        _REGIME_ALERT: dict[str, str] = {
            "EXTREME":  "warning_extreme",  # too hot — caution
            "ACTIVE":   "opportunity",      # high momentum — actionable
            "TRENDING": "setup_ready",      # sweet spot for trend-following
            "NORMAL":   "neutral",          # baseline — nothing special
            "CALM":     "low_activity",     # quiet market — low conviction
            "DEAD":     "caution_dead",     # no liquidity — avoid
        }
        alert = _REGIME_ALERT.get(regime, "neutral")

        rows.append(
            {
                "_rank": rank_score,
                "pair": symbol,
                "vi_score": round(vi, 3),
                "regime": regime,
                "alert": alert,
                "change_24h": round(change_24h, 4) if change_24h is not None else None,
                "ema_score": round(ema_score, 2),
                "ema_signal": ema_signal,
                "tf_sup_regime": tf_sup_regime,
                "tf_sup_vi": round(float(tf_sup_vi), 3) if tf_sup_vi is not None else None,
            }
        )

    rows.sort(key=lambda r: r["_rank"], reverse=True)
    # Strip internal rank key before storing
    for r in rows:
        del r["_rank"]
    return rows


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

    Pipeline (P2-6):
      1. Schedule gate
      2. Load per_pair settings (enabled indicators)
      3. Query active Kraken instruments from instruments table
      4. KrakenClient.fetch_ohlcv() + compute_vi_score() per pair
      5. Fetch all tickers for 24h change (one call)
      6. Load latest superior-TF snapshots for TF+1 watchlist column
      7. INSERT volatility_snapshots (one row per pair — hypertable)
      8. Rank pairs → build watchlist pairs list
      9. INSERT watchlist_snapshot
      10. Cache pair scores in Redis
    """
    db = _get_db()
    try:
        # ── 1. Schedule gate ──────────────────────────────────────────────
        if not is_within_schedule(db, "per_pair"):
            logger.debug("compute_pair_vi(%s): skipped (outside schedule)", timeframe)
            return {"status": "skipped", "reason": "outside_schedule", "timeframe": timeframe}

        # ── 2. Load settings ──────────────────────────────────────────────
        pp_cfg = _load_settings(db, "per_pair", None)
        enabled: dict = pp_cfg.get(
            "indicators",
            {"rvol": True, "mfi": True, "atr": True, "bb": True, "ema": True},
        )

        # ── 3. Resolve active Kraken instruments ──────────────────────────
        kraken_broker = (
            db.query(Broker)
            .filter(Broker.name.ilike("%kraken%"), Broker.status == "active")
            .first()
        )
        if kraken_broker is None:
            logger.warning("compute_pair_vi(%s): no active Kraken broker found", timeframe)
            return {"status": "skipped", "reason": "no_kraken_broker", "timeframe": timeframe}

        instruments_rows = (
            db.query(Instrument)
            .filter(
                Instrument.broker_id == kraken_broker.id,
                Instrument.is_active.is_(True),
            )
            .all()
        )
        if not instruments_rows:
            logger.warning("compute_pair_vi(%s): no active Kraken instruments", timeframe)
            return {"status": "skipped", "reason": "no_instruments", "timeframe": timeframe}

        symbols: list[str] = [i.symbol for i in instruments_rows]

        # ── 4. Fetch OHLCV + compute VI per pair ──────────────────────────
        from src.volatility.kraken_client import KrakenClient  # noqa: PLC0415

        pair_scores: dict[str, dict] = {}
        with KrakenClient() as client:
            # 5a. Tickers — one call for all (band 24h change cheaply)
            try:
                all_tickers_list = client.fetch_all_tickers()
                tickers: dict[str, dict] = {t["symbol"]: t for t in all_tickers_list}
            except Exception as ticker_exc:
                logger.warning("compute_pair_vi(%s): ticker fetch failed — %s", timeframe, ticker_exc)
                tickers = {}

            # OHLCV per pair
            for symbol in symbols:
                try:
                    candles = client.fetch_ohlcv(symbol, timeframe, limit=220)
                    result = compute_vi_score(candles, enabled)
                    pair_scores[symbol] = result
                except Exception as pair_exc:
                    logger.warning(
                        "compute_pair_vi(%s): pair %s failed — %s",
                        timeframe, symbol, pair_exc,
                    )

        if not pair_scores:
            logger.warning("compute_pair_vi(%s): no pair data computed", timeframe)
            return {"status": "skipped", "reason": "no_pair_data", "timeframe": timeframe}

        # ── 5. Regime thresholds ──────────────────────────────────────────
        thresholds = get_regime_thresholds(db)
        now = datetime.now(UTC)

        # ── 6. Load TF+1 snapshots for watchlist column ───────────────────
        sup_tf = _TF_SUPERIOR.get(timeframe)
        sup_scores: dict[str, dict] = {}
        if sup_tf:
            # Fetch the single most-recent snapshot for each pair at sup_tf
            # TimescaleDB: ORDER BY timestamp DESC LIMIT 1 per pair is efficient
            try:
                from sqlalchemy import func as sqlfunc  # noqa: PLC0415
                subq = (
                    db.query(
                        VolatilitySnapshot.pair,
                        sqlfunc.max(VolatilitySnapshot.timestamp).label("max_ts"),
                    )
                    .filter(VolatilitySnapshot.timeframe == sup_tf)
                    .group_by(VolatilitySnapshot.pair)
                    .subquery()
                )
                sup_rows = (
                    db.query(VolatilitySnapshot)
                    .join(
                        subq,
                        (VolatilitySnapshot.pair == subq.c.pair)
                        & (VolatilitySnapshot.timestamp == subq.c.max_ts),
                    )
                    .filter(VolatilitySnapshot.timeframe == sup_tf)
                    .all()
                )
                for row in sup_rows:
                    sup_scores[row.pair] = {
                        "vi_score": float(row.vi_score),
                        "regime": score_to_regime(float(row.vi_score), thresholds),
                    }
            except Exception as sup_exc:
                logger.warning("compute_pair_vi(%s): TF+1 lookup failed — %s", timeframe, sup_exc)

        # ── 7. INSERT volatility_snapshots (one per pair) ─────────────────
        for symbol, res in pair_scores.items():
            vi = round(float(res["vi_score"]), 3)
            components = {
                k: res[k]
                for k in ("rvol", "mfi", "atr", "bb_width", "ema_score", "ema_signal")
                if k in res
            }
            snapshot = VolatilitySnapshot(
                pair=symbol,
                timeframe=timeframe,
                timestamp=now,
                vi_score=Decimal(str(vi)),
                components=components,
            )
            db.add(snapshot)

        # ── 8. Build ranked watchlist pairs list ──────────────────────────
        watchlist_pairs = _build_watchlist_pairs(
            pair_scores, tickers, sup_scores, thresholds, timeframe
        )

        # Dominant regime = regime of the pair with highest vi_score
        top_vi = max(float(r["vi_score"]) for r in watchlist_pairs)
        dominant_regime = score_to_regime(top_vi, thresholds)

        # ── 9. INSERT watchlist_snapshot ──────────────────────────────────
        wl_name = f"ATD_Perps_{timeframe}"
        watchlist = WatchlistSnapshot(
            name=wl_name,
            timeframe=timeframe,
            regime=dominant_regime,
            pairs_count=len(watchlist_pairs),
            pairs=watchlist_pairs,
            generated_at=now,
        )
        db.add(watchlist)
        db.commit()

        logger.info(
            "compute_pair_vi(%s): %d pairs computed — dominant regime %s",
            timeframe, len(pair_scores), dominant_regime,
        )

        # ── 10. Cache pair scores in Redis ────────────────────────────────
        for symbol, res in pair_scores.items():
            vi = round(float(res["vi_score"]), 3)
            regime = score_to_regime(vi, thresholds)
            components = {k: res[k] for k in res if k != "vi_score"}
            cache_pair_vi(symbol, timeframe, vi, regime, components, now.isoformat())

        return {
            "status": "ok",
            "timeframe": timeframe,
            "pairs_computed": len(pair_scores),
            "dominant_regime": dominant_regime,
            "watchlist_pairs": len(watchlist_pairs),
        }

    except Exception as exc:
        db.rollback()
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

