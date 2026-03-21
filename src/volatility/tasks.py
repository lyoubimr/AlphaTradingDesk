"""
Volatility Engine — Celery tasks (Phase 2).

Progress
--------
  P2-3  Skeletons with schedule gate + DB session             DONE
  P2-5  compute_market_vi — BinanceClient + indicators        DONE
  P2-6  compute_pair_vi   — KrakenClient + indicators         DONE  ← this file
  P2-7  sync_instruments  — Kraken + Binance upsert           DONE  ← this file
  P2-8  cleanup_old_snapshots — TimescaleDB drop_chunks       DONE  ← this file

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
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from src.core.celery_app import celery_app
from src.core.database import get_session_factory
from src.core.models.broker import Broker, Instrument
from src.volatility.cache import cache_market_vi, cache_pair_vi, get_cached_market_vi
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


def _first_bot_token(bots: list) -> str | None:
    return bots[0].get("bot_token") if bots else None


def _first_chat_id(bots: list) -> str | None:
    return bots[0].get("chat_id") if bots else None


def _resolve_bot(bots: list, bot_name: str | None) -> tuple[str | None, str | None]:
    """Return (bot_token, chat_id) for the named bot, or the first bot as fallback."""
    if bot_name:
        for b in bots:
            if b.get("bot_name") == bot_name:
                return b.get("bot_token"), b.get("chat_id")
    # fallback: first bot in list
    if bots:
        return bots[0].get("bot_token"), bots[0].get("chat_id")
    return None, None


# Timeframe hierarchy for TF+1 column in watchlist
# Key = current TF, Value = next higher TF to look up in DB
_TF_SUPERIOR: dict[str, str] = {
    "15m": "1h",
    "1h": "4h",
    "4h": "1d",
    "1d": "1w",
    # 1w has no superior — column left empty
}

# Ordered list of timeframes used in cross-TF aggregation
_TF_AGG_ORDER = ["15m", "1h", "4h", "1d"]

# Reference EMA per TF for crossover/retest signal detection (fallback defaults)
# Spec: 15m→EMA55 / 1h→EMA99 / 4h→EMA200 / 1d→EMA99 / 1w→EMA55
#
# Standard EMA set used throughout: 10 · 21 · 55 · 99 · 200
# Why these choices (convergence with available candle limits):
#   EMA200 on 4h  — requires limit=500 (500×4h = 83 days); Binance/Kraken have data ✓
#   EMA99  on 1d  — converges with limit=220 (~1.2% residual, acceptable)
#   EMA55  on 1w  — Fibonacci EMA, ~13 months, classic weekly trend reference;
#                   converges with 220 bars (residual <0.1%); EMA50w=1yr too slow
#
# Overridable per-profile via per_pair settings: {"ema_ref_periods": {"15m": 55, ...}}
_TF_EMA_REF: dict[str, int] = {
    "15m": 55,
    "1h":  99,
    "4h": 200,
    "1d":  99,
    "1w":  55,
}

# Candle limit per TF — EMA200 on 4h requires 500 candles for <1% convergence bias.
# All other TFs converge within 220 candles for their respective ema_ref periods.
_TF_CANDLE_LIMIT: dict[str, int] = {
    "15m": 220,
    "1h":  220,
    "4h":  500,   # EMA200: (1 - 2/201)^500 ≈ 0.7% residual vs 11% at 220
    "1d":  220,
    "1w":  220,
}

# Celery beat fires at :00/:15/:30/:45 — task may arrive up to 4min later.
# 5min grace absorbs dispatch + execution delay without widening the window too much.
_INTERVAL_GRACE_MIN = 5

# EMA ranking boost — pairs with clear directional EMA signals rank slightly higher.
# Affects ranking only; stored vi_score is unmodified.
_EMA_RANK_BOOST_SIGNALS: frozenset[str] = frozenset({"breakout_up", "above_all"})
_EMA_RANK_BOOST = 0.05

# Actionable alert label derived from regime — stable mapping, not business config.
_REGIME_ALERT: dict[str, str] = {
    "EXTREME":  "warning_extreme",  # too hot — caution
    "ACTIVE":   "opportunity",      # high momentum — actionable
    "TRENDING": "setup_ready",      # sweet spot for trend-following
    "NORMAL":   "neutral",          # baseline — nothing special
    "CALM":     "low_activity",     # quiet market — low conviction
    "DEAD":     "caution_dead",     # no liquidity — avoid
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
    rows = []
    for symbol, res in pair_scores.items():
        vi = float(res["vi_score"])
        regime = score_to_regime(vi, thresholds)

        ema_signal: str = res.get("ema_signal", "mixed")
        ema_score: float = float(res.get("ema_score", 0.5))

        # Rank score: vi_score + small EMA boost for directional signals
        rank_score = vi + (_EMA_RANK_BOOST if ema_signal in _EMA_RANK_BOOST_SIGNALS else 0.0)

        ticker = tickers.get(symbol, {})
        change_24h = ticker.get("change_pct_24h", None)

        sup = sup_scores.get(symbol, {})
        tf_sup_regime = sup.get("regime")
        tf_sup_vi = sup.get("vi_score")

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

    rows.sort(key=lambda r: float(r["_rank"]), reverse=True)  # type: ignore[arg-type]
    # Strip internal rank key before storing
    for r in rows:
        del r["_rank"]
    return rows


# ── Aggregated score helper ───────────────────────────────────────────────────

def _update_aggregated_score(db: Session, mv_cfg: dict) -> None:
    """Compute and persist the cross-TF aggregated Market VI score.

    Reads each TF score from Redis cache (written by compute_market_vi),
    applies weekday or weekend weights from settings, normalises the weighted
    sum, and writes the result back to both DB (timeframe='aggregated') and
    Redis (key atd:market_vi:aggregated).

    Requires at least one TF to have data in Redis — returns silently otherwise.
    """

    is_weekend = datetime.now(UTC).weekday() >= 5
    day_key = "weekend" if is_weekend else "weekday"
    tf_weights_cfg: dict = mv_cfg.get("tf_weights", {})
    weights: dict = tf_weights_cfg.get(
        day_key,
        # fallback if tf_weights missing entirely — should not happen with schedule.py defaults
        {"15m": 0.75, "1h": 0.25, "4h": 0.00, "1d": 0.00} if is_weekend
        else {"15m": 0.25, "1h": 0.40, "4h": 0.25, "1d": 0.10},
    )

    total_w = 0.0
    weighted_sum = 0.0
    for tf in _TF_AGG_ORDER:
        w = float(weights.get(tf, 0.0))
        if w <= 0:
            continue
        cached = get_cached_market_vi(tf)
        if cached is None:
            continue
        weighted_sum += w * float(cached["vi_score"])
        total_w += w

    if total_w <= 0:
        logger.debug("_update_aggregated_score: no TF data in Redis yet — skip")
        return

    agg_score = round(weighted_sum / total_w, 3)
    thresholds = get_regime_thresholds(db)
    agg_regime = score_to_regime(agg_score, thresholds)
    now = datetime.now(UTC)

    # Persist — timeframe='aggregated' fits the composite PK with no migration
    snap = MarketVISnapshot(
        timeframe="aggregated",
        timestamp=now,
        vi_score=Decimal(str(agg_score)),
        regime=agg_regime,
        components={},
    )
    db.add(snap)
    db.commit()

    # Cache so the endpoint can serve it from Redis
    cache_market_vi("aggregated", agg_score, agg_regime, now.isoformat())

    logger.info(
        "_update_aggregated_score: %.3f (%s) — %s weights applied",
        agg_score, agg_regime, day_key,
    )


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
        indicator_weights: dict = mv_cfg.get("indicator_weights", {})

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
                    ema_ref = (mv_cfg.get("ema_ref_periods") or {}).get(timeframe) or _TF_EMA_REF.get(timeframe, 50)
                    retest_tol = (mv_cfg.get("ema_retest_tolerance") or {}).get(timeframe)
                    limit = _TF_CANDLE_LIMIT.get(timeframe, 220)
                    candles = client.fetch_ohlcv(symbol, timeframe, limit=limit)
                    result = compute_vi_score(candles, enabled, ema_ref, indicator_weights, retest_tol)
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
        cache_market_vi(timeframe, market_vi, regime, now.isoformat(), components)
        # ── 9. Cross-TF aggregated score (fail-silent) ────────────────────
        try:
            _update_aggregated_score(db, mv_cfg)
        except Exception as agg_exc:
            logger.warning("compute_market_vi(%s): aggregated score error — %s", timeframe, agg_exc)
        # ── 10. Telegram alert (fail-silent) ──────────────────────────────
        try:
            from src.volatility.models import NotificationSettings
            from src.volatility.telegram import send_market_vi_alert, send_vi_level_alerts
            notif = db.query(NotificationSettings).first()
            if notif:
                bot_token, chat_id = _resolve_bot(notif.bots, notif.market_vi_alerts.get("bot_name"))
                alert_cfg = {**notif.market_vi_alerts, "bot_token": bot_token, "chat_id": chat_id}
                send_market_vi_alert(alert_cfg, market_vi, regime, timeframe, components)

                # ── 10b. VI level / range alerts ────────────────────────
                vi_levels: list = notif.market_vi_alerts.get("vi_levels", [])
                if vi_levels and notif.market_vi_alerts.get("enabled", False):
                    try:
                        from src.volatility.cache import _get_redis
                        r = _get_redis()
                        prev_key = f"atd:vi_prev_score:{timeframe}"
                        prev_raw = r.get(prev_key)
                        prev_100 = float(prev_raw) * 100 if prev_raw else None
                        r.set(prev_key, str(market_vi))
                    except Exception:
                        prev_100 = None
                    send_vi_level_alerts(alert_cfg, market_vi * 100, timeframe, vi_levels, prev_100)

                # ── 10c. Aggregated TF vi level alerts ────────────────────
                agg_levels = [lv for lv in vi_levels if lv.get("timeframe") == "aggregated"]
                if agg_levels:
                    try:
                        from src.volatility.cache import get_cached_market_vi, _get_redis
                        agg_data = get_cached_market_vi("aggregated")
                        if agg_data:
                            agg_100 = float(agg_data["vi_score"]) * 100
                            try:
                                rr = _get_redis()
                                prev_agg_raw = rr.get("atd:vi_prev_score:aggregated")
                                prev_agg = float(prev_agg_raw) * 100 if prev_agg_raw else None
                                rr.set("atd:vi_prev_score:aggregated", str(agg_data["vi_score"]))
                            except Exception:
                                prev_agg = None
                            send_vi_level_alerts(alert_cfg, agg_100, "aggregated", agg_levels, prev_agg)
                    except Exception:
                        pass
        except Exception as tg_exc:
            logger.warning("compute_market_vi(%s): Telegram error — %s", timeframe, tg_exc)
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
def compute_pair_vi(self, timeframe: str, force: bool = False) -> dict:  # type: ignore[override]
    """Compute Per-Pair Volatility Index (Kraken Futures).

    Pipeline (P2-6):
      1. Schedule gate (skipped when force=True — manual runs from /run/ endpoint)
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
        if not force and not is_within_schedule(db, "per_pair"):
            logger.debug("compute_pair_vi(%s): skipped (outside schedule)", timeframe)
            return {"status": "skipped", "reason": "outside_schedule", "timeframe": timeframe}

        # ── 2. Load settings ──────────────────────────────────────────────
        pp_cfg = _load_settings(db, "per_pair", None)
        enabled: dict = pp_cfg.get(
            "indicators",
            {"rvol": True, "mfi": True, "atr": True, "bb": True, "ema": True},
        )
        indicator_weights: dict = pp_cfg.get("indicator_weights", {})

        # ── 2b. Gate by execution_hours for this TF — weekday vs weekend split ──
        # execution_hours         → allowed UTC hours on weekdays (Mon–Fri)
        # weekend_execution_hours → allowed UTC hours on Sat–Sun
        # Empty list = no restriction for that day type (run at every natural cycle).
        if not force:
            tf_sched: dict = (pp_cfg.get("schedules") or {}).get(timeframe, {})
            now_utc_dt = datetime.now(UTC)
            is_weekend_day = now_utc_dt.weekday() >= 5
            if is_weekend_day:
                # Weekend: use weekend_execution_hours if key exists,
                # otherwise fall back to execution_hours.
                # None = key absent (never configured) → inherit weekday hours.
                # []   = key present but empty → no restriction on weekends.
                we_hours = tf_sched.get("weekend_execution_hours", None)
                exec_hours: list = (
                    we_hours if we_hours is not None
                    else tf_sched.get("execution_hours", [])
                )
            else:
                exec_hours = tf_sched.get("execution_hours", [])
            if exec_hours:
                current_hour = now_utc_dt.hour
                if current_hour not in exec_hours:
                    logger.debug(
                        "compute_pair_vi(%s): skipped (hour %dh outside %s execution_hours %s)",
                        timeframe, current_hour,
                        "weekend" if is_weekend_day else "weekday",
                        exec_hours,
                    )
                    return {"status": "skipped", "reason": "outside_execution_hours", "timeframe": timeframe}

            # Sub-hour interval gate (15m TF only: 15min native, or every 30min)
            # 5min grace window to absorb Celery dispatch + execution delay:
            #   beat fires at :00 → task executes at :03 → 3 % 30 = 3 < 5 → RUN ✓
            #   beat fires at :15 → task executes at :18 → 18 % 30 = 18 >= 5 → SKIP ✓
            #   beat fires at :30 → task executes at :34 → 4 % 30 = 4 < 5 → RUN ✓
            #   beat fires at :45 → task executes at :48 → 18 % 30 = 18 >= 5 → SKIP ✓
            interval_min: int | None = tf_sched.get("execution_interval_minutes")
            if interval_min and timeframe == "15m":
                if now_utc_dt.minute % interval_min >= _INTERVAL_GRACE_MIN:
                    logger.debug(
                        "compute_pair_vi(%s): skipped (minute :%02d not on %dmin interval)",
                        timeframe, now_utc_dt.minute, interval_min,
                    )
                    return {"status": "skipped", "reason": "outside_interval", "timeframe": timeframe}

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
            # Auto-bootstrap: run sync_instruments inline so the first manual
            # "Run" click always works without a separate Sync step.
            logger.info(
                "compute_pair_vi(%s): no instruments found — auto-running sync_instruments",
                timeframe,
            )
            try:
                sync_instruments.apply()  # synchronous inline call
            except Exception as sync_exc:
                logger.error(
                    "compute_pair_vi(%s): auto-sync failed — %s", timeframe, sync_exc
                )
                return {
                    "status": "error",
                    "reason": "auto_sync_failed",
                    "detail": str(sync_exc),
                    "timeframe": timeframe,
                }
            # Re-query after sync
            instruments_rows = (
                db.query(Instrument)
                .filter(
                    Instrument.broker_id == kraken_broker.id,
                    Instrument.is_active.is_(True),
                )
                .all()
            )
            if not instruments_rows:
                logger.error(
                    "compute_pair_vi(%s): still no instruments after sync — Kraken may be unreachable",
                    timeframe,
                )
                return {
                    "status": "error",
                    "reason": "no_instruments_after_sync",
                    "detail": "Sync ran but returned 0 instruments. Check Kraken API connectivity.",
                    "timeframe": timeframe,
                }

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
                    ema_ref = (pp_cfg.get("ema_ref_periods") or {}).get(timeframe) or _TF_EMA_REF.get(timeframe, 50)
                    retest_tol = (pp_cfg.get("ema_retest_tolerance") or {}).get(timeframe)
                    limit = _TF_CANDLE_LIMIT.get(timeframe, 220)
                    candles = client.fetch_ohlcv(symbol, timeframe, limit=limit)
                    result = compute_vi_score(candles, enabled, ema_ref, indicator_weights, retest_tol)
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

        # Regime content filter: keep only pairs whose own regime matches the
        # configured filter.  Applied always (including force=True runs) because
        # this controls WHAT appears in the watchlist, not whether to run at all.
        _content_filter: list = (
            (pp_cfg.get("schedules") or {}).get(timeframe, {}).get("regime_filter", [])
        )
        if _content_filter:
            before = len(watchlist_pairs)
            watchlist_pairs = [p for p in watchlist_pairs if p["regime"] in _content_filter]
            logger.info(
                "compute_pair_vi(%s): regime content filter %s → %d/%d pairs kept",
                timeframe, _content_filter, len(watchlist_pairs), before,
            )
        else:
            logger.info(
                "compute_pair_vi(%s): no regime content filter configured — all %d pairs kept",
                timeframe, len(watchlist_pairs),
            )

        # Dominant regime = regime of the pair with highest vi_score
        top_vi = max((float(r["vi_score"]) for r in watchlist_pairs), default=0.0)
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
        # ── 11. Telegram alert (fail-silent) ──────────────────────────────
        try:
            from src.volatility.models import NotificationSettings
            from src.volatility.telegram import send_watchlist_alert
            notif = db.query(NotificationSettings).first()
            if notif:
                bot_token, chat_id = _resolve_bot(notif.bots, notif.watchlist_alerts.get("bot_name"))
                alert_cfg = {**notif.watchlist_alerts, "bot_token": bot_token, "chat_id": chat_id}
                send_watchlist_alert(alert_cfg, watchlist_pairs, timeframe, dominant_regime, 0.0)
        except Exception as tg_exc:
            logger.warning("compute_pair_vi(%s): Telegram error — %s", timeframe, tg_exc)
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

    Kraken: upsert all active perpetuals → instruments table.
           Delisted pairs → is_active=False (never DELETE — historical trades FK).
    Binance: upsert top-100 by 24h quoteVolume → market_vi_pairs.
             Bootstrap is_selected=True for top-50 on first run.

    P2-3: skeleton.
    P2-7: full implementation.
    """
    from src.volatility.binance_client import BinanceClient
    from src.volatility.kraken_client import KrakenClient

    db = _get_db()
    try:
        now = datetime.now(UTC)

        # ── 1. Kraken perpetuals upsert ───────────────────────────────────
        kraken_broker = (
            db.query(Broker)
            .filter(Broker.name.ilike("%kraken%"), Broker.status == "active")
            .first()
        )
        kraken_upserted = 0
        kraken_deactivated = 0

        if kraken_broker is None:
            logger.warning("sync_instruments: no active Kraken broker in DB — skipping Kraken sync")
        else:
            with KrakenClient() as kc:
                kraken_symbols = kc.fetch_all_symbols()

            active_symbols: set[str] = set()
            for sym in kraken_symbols:
                active_symbols.add(sym["symbol"])
                stmt = (
                    pg_insert(Instrument)
                    .values(
                        broker_id=kraken_broker.id,
                        symbol=sym["symbol"],
                        display_name=sym["symbol"],
                        asset_class="crypto",
                        base_currency=sym.get("base"),
                        quote_currency=sym.get("quote"),
                        is_predefined=True,
                        is_active=sym["is_active"],
                    )
                    .on_conflict_do_update(
                        index_elements=["broker_id", "symbol"],
                        set_={
                            "is_active": sym["is_active"],
                            "base_currency": sym.get("base"),
                            "quote_currency": sym.get("quote"),
                        },
                    )
                )
                db.execute(stmt)
                kraken_upserted += 1

            # Mark delisted pairs inactive (never in API response anymore)
            delisted = (
                db.query(Instrument)
                .filter(
                    Instrument.broker_id == kraken_broker.id,
                    Instrument.is_active.is_(True),
                    Instrument.symbol.notin_(active_symbols),
                )
                .all()
            )
            for inst in delisted:
                inst.is_active = False
                kraken_deactivated += 1

        # ── 2. Binance top-100 upsert ─────────────────────────────────────
        with BinanceClient() as bc:
            all_binance = bc.fetch_all_symbols()

        # Sort by volume DESC, keep top-100
        top_100 = sorted(all_binance, key=lambda x: x["quote_volume_24h"], reverse=True)[:100]
        top_50_symbols = {s["symbol"] for s in top_100[:50]}

        # Detect first-run (table empty before this sync)
        existing_count: int = db.query(MarketVIPair).count()
        is_first_run = existing_count == 0

        binance_upserted = 0
        for rank, sym in enumerate(top_100, start=1):
            auto_select = is_first_run and sym["symbol"] in top_50_symbols
            stmt = (
                pg_insert(MarketVIPair)
                .values(
                    symbol=sym["symbol"],
                    display_name=sym["symbol"],
                    quote_volume_24h=Decimal(str(sym["quote_volume_24h"])),
                    volume_rank=rank,
                    is_selected=auto_select,
                )
                .on_conflict_do_update(
                    index_elements=["symbol"],
                    set_={
                        "quote_volume_24h": Decimal(str(sym["quote_volume_24h"])),
                        "volume_rank": rank,
                        "updated_at": now,
                        # Never override a user's manual is_selected on re-sync
                    },
                )
            )
            db.execute(stmt)
            binance_upserted += 1

        # Deselect symbols that have fallen out of top-100
        top_100_symbols = {s["symbol"] for s in top_100}
        db.query(MarketVIPair).filter(
            MarketVIPair.is_selected.is_(True),
            MarketVIPair.symbol.notin_(top_100_symbols),
        ).update({"is_selected": False}, synchronize_session=False)

        db.commit()
        logger.info(
            "sync_instruments: kraken upserted=%d deactivated=%d | "
            "binance upserted=%d first_run=%s",
            kraken_upserted, kraken_deactivated, binance_upserted, is_first_run,
        )
        return {
            "status": "ok",
            "kraken_upserted": kraken_upserted,
            "kraken_deactivated": kraken_deactivated,
            "binance_upserted": binance_upserted,
            "binance_selected": len(top_50_symbols) if is_first_run else None,
        }

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

    Uses TimescaleDB drop_chunks() for hypertables (volatility_snapshots,
    market_vi_snapshots) — much faster than DELETE on large time-series data.
    Falls back to a plain DELETE for watchlist_snapshots (regular table).

    P2-3: skeleton.
    P2-8: full implementation.
    """
    from sqlalchemy import text

    db = _get_db()
    try:
        # ── 1. Read retention_days from settings ─────────────────────────
        per_pair_cfg = _load_settings(db, "per_pair", None)
        mv_cfg = _load_settings(db, "market_vi", None)
        # per_pair retention → volatility_snapshots + watchlist_snapshots
        pp_retention: int = int(per_pair_cfg.get("retention_days", 30))
        # market_vi retention → market_vi_snapshots only
        mvi_retention: int = int(mv_cfg.get("retention_days", 90))
        pp_cutoff  = f"NOW() - INTERVAL '{pp_retention} days'"
        mvi_cutoff = f"NOW() - INTERVAL '{mvi_retention} days'"
        retention_days = max(pp_retention, mvi_retention)  # for log/return only

        # ── 2. TimescaleDB drop_chunks for hypertables ────────────────────
        # drop_chunks() returns one row per chunk dropped.
        vol_chunks = db.execute(
            text(f"SELECT drop_chunks('volatility_snapshots', {pp_cutoff})")
        ).fetchall()
        mvi_chunks = db.execute(
            text(f"SELECT drop_chunks('market_vi_snapshots', {mvi_cutoff})")
        ).fetchall()

        # ── 3. Plain DELETE for watchlist_snapshots (regular table) ───────
        # Uses per_pair retention — watchlist is the output of the per-pair pipeline
        deleted_watchlist = db.execute(
            text(f"DELETE FROM watchlist_snapshots WHERE generated_at < {pp_cutoff}")
        ).rowcount  # type: ignore[attr-defined]

        db.commit()
        logger.info(
            "cleanup_old_snapshots: retention=%d days | "
            "vol_chunks=%d mvi_chunks=%d watchlist_rows=%d",
            retention_days, len(vol_chunks), len(mvi_chunks), deleted_watchlist,
        )
        return {
            "status": "ok",
            "retention_days": retention_days,
            "volatility_chunks_dropped": len(vol_chunks),
            "market_vi_chunks_dropped": len(mvi_chunks),
            "watchlist_rows_deleted": deleted_watchlist,
        }

    except Exception as exc:
        logger.exception("cleanup_old_snapshots: error — %s", exc)
        try:
            raise self.retry(exc=exc, countdown=300)
        except MaxRetriesExceededError:
            return {"status": "error", "error": str(exc)}
    finally:
        db.close()

