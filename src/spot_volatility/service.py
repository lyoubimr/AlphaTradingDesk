"""
Phase 7 — Spot Volatility Service.

On-demand VI computation for Kraken Spot pairs.
- Reuses src.volatility.indicators (same ATR+HV+RVOL+BB algorithm)
- Stores snapshots in spot_watchlist_snapshots
- Settings in spot_volatility_settings (global, key='global')

Timeframes: 4h | 1d | 1w (Kraken Spot supports these natively)
"""

from __future__ import annotations

import logging
from copy import deepcopy
from datetime import UTC, datetime

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from src.core.models.broker import Instrument
from src.spot_volatility.kraken_spot_client import KrakenSpotClient
from src.spot_volatility.models import SpotVolatilitySettings, SpotWatchlistSnapshot
from src.spot_volatility.schemas import DEFAULT_SPOT_CONFIG, DEFAULT_SPOT_PAIRS
from src.volatility.indicators import compute_vi_score
from src.volatility.schedule import get_regime_thresholds, score_to_regime

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

VALID_SPOT_TFS: frozenset[str] = frozenset({"4h", "1d", "1w"})

# Superior TF for tf+1 watchlist column (spot HTF hierarchy)
_TF_SUPERIOR: dict[str, str] = {
    "4h": "1d",
    "1d": "1w",
    # "1w" has no superior — column left empty
}

# Reference EMA per TF (matches existing contracts convention)
_TF_EMA_REF: dict[str, int] = {
    "4h": 200,
    "1d":  99,
    "1w":  55,
}

# Candle limits — 4h needs 500 for EMA-200 convergence
_TF_CANDLE_LIMIT: dict[str, int] = {
    "4h": 500,
    "1d": 220,
    "1w": 220,
}

# Retest proximity per TF (fraction — 1% for 4h, 2% for 1d, 3% for 1w)
_TF_EMA_RETEST_TOL: dict[str, float] = {
    "4h": 0.015,
    "1d": 0.020,
    "1w": 0.030,
}

_EMA_RANK_BOOST_SIGNALS: frozenset[str] = frozenset({"breakout_up", "above_all"})
_EMA_RANK_BOOST = 0.05

_REGIME_ALERT: dict[str, str] = {
    "EXTREME":  "warning_extreme",
    "ACTIVE":   "opportunity",
    "TRENDING": "setup_ready",
    "NORMAL":   "neutral",
    "CALM":     "low_activity",
    "DEAD":     "caution_dead",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(tz=UTC)


def _deep_merge(base: dict, patch: dict) -> dict:
    result = deepcopy(base)
    for key, val in patch.items():
        if isinstance(val, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def _resolve_pairs(cfg: dict, db: Session) -> list[str]:
    """Return the list of spot pairs to compute VI for.

    When ``use_all_synced`` is True (default), all active USD-quoted Kraken spot
    instruments are fetched from the instruments table.  When ``top_n > 0``,
    a single batch Ticker call pre-ranks them by 24h USD volume and the top N
    are kept — this prevents running OHLCV computation on hundreds of obscure
    illiquid pairs.

    Falls back to the static ``DEFAULT_SPOT_PAIRS`` list when no instruments
    are found in the DB (first boot before sync has run) or when
    ``use_all_synced`` is explicitly False + no custom ``pairs`` list is set.
    """
    use_all = cfg.get("use_all_synced", False)
    top_n: int = cfg.get("top_n", 0)

    if use_all:
        rows = (
            db.query(Instrument.symbol)
            .filter(
                Instrument.is_active.is_(True),
                Instrument.asset_class == "Crypto",
                ~Instrument.symbol.startswith("PF_"),
                ~Instrument.symbol.startswith("PI_"),
                ~Instrument.symbol.startswith("FF_"),
                # USD-only — USDT pairs are a strict subset and cause duplicates
                Instrument.quote_currency == "USD",
            )
            .order_by(Instrument.symbol)
            .all()
        )
        symbols = [r.symbol for r in rows]

        if not symbols:
            logger.warning("_resolve_pairs: use_all_synced=True but no instruments in DB — using fallback list")
        elif top_n > 0 and len(symbols) > top_n:
            # Pre-filter by 24h USD volume: one batch Ticker call, then take top N
            logger.info(
                "_resolve_pairs: %d synced pairs, pre-filtering to top %d by 24h volume",
                len(symbols), top_n,
            )
            try:
                with KrakenSpotClient() as client:
                    tickers = client.fetch_all_tickers(symbols)
                symbols_with_vol = [
                    (sym, tickers.get(sym, {}).get("volume_usd_24h", 0.0))
                    for sym in symbols
                ]
                symbols_with_vol.sort(key=lambda x: x[1], reverse=True)
                symbols = [sym for sym, _ in symbols_with_vol[:top_n]]
                logger.info("_resolve_pairs: top %d by volume selected", len(symbols))
            except Exception as exc:
                logger.warning(
                    "_resolve_pairs: volume pre-filter failed (%s) — using first %d alphabetically",
                    exc, top_n,
                )
                symbols = symbols[:top_n]

        if symbols:
            return symbols

    explicit = cfg.get("pairs") or []
    if explicit:
        return explicit

    return list(DEFAULT_SPOT_PAIRS)


def _check_tf(timeframe: str) -> None:
    if timeframe not in VALID_SPOT_TFS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid spot timeframe '{timeframe}'. Valid: {sorted(VALID_SPOT_TFS)}",
        )


# ── Settings ──────────────────────────────────────────────────────────────────

def get_settings(db: Session) -> SpotVolatilitySettings:
    """Return the global settings row, auto-creating with defaults if absent."""
    row = db.query(SpotVolatilitySettings).filter_by(key="global").first()
    if row is None:
        row = SpotVolatilitySettings(
            key="global",
            config=deepcopy(DEFAULT_SPOT_CONFIG),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_settings(patch: dict, db: Session) -> SpotVolatilitySettings:
    row = get_settings(db)
    row.config = _deep_merge(row.config, patch)
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return row


# ── Watchlist compute ─────────────────────────────────────────────────────────

def compute_spot_watchlist(timeframe: str, db: Session) -> SpotWatchlistSnapshot:
    """On-demand VI compute for all configured Kraken Spot pairs at `timeframe`.

    Pipeline:
      1. Load global settings → pairs list, enabled indicators
      2. KrakenSpotClient.fetch_ohlcv per pair + compute_vi_score (ATR+HV+RVOL+BB)
      3. KrakenSpotClient.fetch_all_tickers → 24h change per pair
      4. Load latest superior-TF spot snapshot → tf_sup_* columns
      5. Build sorted pairs list (vi_score DESC + EMA boost)
      6. INSERT spot_watchlist_snapshots row
    """
    _check_tf(timeframe)
    settings_row = get_settings(db)
    cfg = settings_row.config

    pairs: list[str] = _resolve_pairs(cfg, db)
    enabled: dict = cfg.get("indicators", {
        "rvol": True, "mfi": True, "atr": True, "bb": True, "ema": True,
    })
    candle_limit = _TF_CANDLE_LIMIT.get(timeframe, 220)
    ema_ref = _TF_EMA_REF.get(timeframe)
    retest_tol = _TF_EMA_RETEST_TOL.get(timeframe)

    thresholds = get_regime_thresholds(db)
    now = _utcnow()

    pair_scores: dict[str, dict] = {}
    tickers: dict[str, dict] = {}

    with KrakenSpotClient() as client:
        # ── 1. OHLCV + VI scores ─────────────────────────────────────────
        for symbol in pairs:
            try:
                candles = client.fetch_ohlcv(symbol, timeframe, limit=candle_limit)
                result = compute_vi_score(candles, enabled, ema_ref, None, retest_tol)
                pair_scores[symbol] = result
            except Exception as exc:
                logger.warning(
                    "compute_spot_watchlist(%s): pair %s failed — %s",
                    timeframe, symbol, exc,
                )

        if not pair_scores:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No pair data computed — Kraken Spot API may be unavailable",
            )

        # ── 2. 24h tickers ───────────────────────────────────────────────
        try:
            tickers = client.fetch_all_tickers(list(pair_scores.keys()))
        except Exception as exc:
            logger.warning("compute_spot_watchlist(%s): ticker fetch failed — %s", timeframe, exc)

    # ── 3. Superior TF data ──────────────────────────────────────────────
    sup_tf = _TF_SUPERIOR.get(timeframe)
    sup_scores: dict[str, dict] = {}
    if sup_tf:
        sup_snapshot = (
            db.query(SpotWatchlistSnapshot)
            .filter(SpotWatchlistSnapshot.timeframe == sup_tf)
            .order_by(SpotWatchlistSnapshot.generated_at.desc())
            .first()
        )
        if sup_snapshot:
            for entry in sup_snapshot.pairs:
                p = entry.get("pair", "")
                if p:
                    sup_scores[p] = {
                        "regime": entry.get("regime"),
                        "vi_score": entry.get("vi_score"),
                    }

    # ── 4. Build sorted pairs list ───────────────────────────────────────
    rows: list[dict] = []
    for symbol, res in pair_scores.items():
        vi = float(res["vi_score"])
        regime = score_to_regime(vi, thresholds)
        ema_signal: str = res.get("ema_signal", "mixed")
        ema_score: float = float(res.get("ema_score", 0.5))

        rank_score = vi + (_EMA_RANK_BOOST if ema_signal in _EMA_RANK_BOOST_SIGNALS else 0.0)

        ticker = tickers.get(symbol, {})
        change_24h = ticker.get("change_pct_24h")

        sup = sup_scores.get(symbol, {})
        tf_sup_regime = sup.get("regime")
        tf_sup_vi = sup.get("vi_score")

        alert = _REGIME_ALERT.get(regime, "neutral")

        rows.append({
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
        })

    rows.sort(key=lambda r: float(r["_rank"]), reverse=True)
    for r in rows:
        del r["_rank"]

    # ── 5. Dominant regime ───────────────────────────────────────────────
    top_vi = max((float(r["vi_score"]) for r in rows), default=0.0)
    dominant_regime = score_to_regime(top_vi, thresholds)

    # ── 6. Persist snapshot ──────────────────────────────────────────────
    snapshot = SpotWatchlistSnapshot(
        name=f"ATD_Spot_{timeframe}",
        timeframe=timeframe,
        regime=dominant_regime,
        pairs_count=len(rows),
        pairs=rows,
        generated_at=now,
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)

    logger.info(
        "compute_spot_watchlist(%s): %d pairs — dominant regime %s",
        timeframe, len(rows), dominant_regime,
    )

    return snapshot


# ── Watchlist reads ───────────────────────────────────────────────────────────

def _enrich_sup_tf(snapshot: SpotWatchlistSnapshot, db: Session) -> SpotWatchlistSnapshot:
    """Back-fill tf_sup_regime / tf_sup_vi from the latest superior-TF snapshot.

    Called on read when existing snapshot was computed before the superior-TF
    snapshot existed (pairs[i].tf_sup_regime == None).  Enrichment is in-memory
    only — the DB row is NOT updated (avoiding unnecessary writes on every GET).

    Only enriches if at least one pair has tf_sup_regime = None. If the snapshot
    already has full TF+1 data, this is a no-op.
    """
    if not snapshot.pairs:
        return snapshot

    # Check if enrichment is needed
    needs_enrich = any(p.get("tf_sup_regime") is None for p in snapshot.pairs)
    if not needs_enrich:
        return snapshot

    sup_tf = _TF_SUPERIOR.get(snapshot.timeframe)
    if not sup_tf:
        return snapshot  # 1W has no superior

    sup_snapshot = (
        db.query(SpotWatchlistSnapshot)
        .filter(SpotWatchlistSnapshot.timeframe == sup_tf)
        .order_by(SpotWatchlistSnapshot.generated_at.desc())
        .first()
    )
    if sup_snapshot is None:
        return snapshot

    sup_map: dict[str, dict] = {
        entry["pair"]: {"regime": entry.get("regime"), "vi_score": entry.get("vi_score")}
        for entry in sup_snapshot.pairs
        if entry.get("pair")
    }

    enriched = []
    for p in snapshot.pairs:
        sup = sup_map.get(p.get("pair", ""), {})
        enriched.append({
            **p,
            "tf_sup_regime": p.get("tf_sup_regime") or sup.get("regime"),
            "tf_sup_vi": p.get("tf_sup_vi") if p.get("tf_sup_vi") is not None else (
                round(float(sup["vi_score"]), 3) if sup.get("vi_score") is not None else None
            ),
        })

    # Replace pairs list in-memory only (SQLAlchemy ORM — no flush/commit)
    snapshot.pairs = enriched
    return snapshot


def get_latest_watchlist(timeframe: str, db: Session) -> SpotWatchlistSnapshot:
    """Return the latest snapshot for `timeframe`, or 404 if none exists."""
    _check_tf(timeframe)
    row = (
        db.query(SpotWatchlistSnapshot)
        .filter(SpotWatchlistSnapshot.timeframe == timeframe)
        .order_by(SpotWatchlistSnapshot.generated_at.desc())
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No spot watchlist snapshot yet for timeframe '{timeframe}' — run Generate first",
        )
    return _enrich_sup_tf(row, db)


def list_watchlists(days: int, db: Session) -> list[SpotWatchlistSnapshot]:
    """Return snapshot metadata for the past `days` days (no pairs payload)."""
    from datetime import timedelta  # noqa: PLC0415
    cutoff = _utcnow() - timedelta(days=days)
    return (
        db.query(SpotWatchlistSnapshot)
        .filter(SpotWatchlistSnapshot.generated_at >= cutoff)
        .order_by(SpotWatchlistSnapshot.generated_at.desc())
        .all()
    )


def get_watchlist_by_id(snapshot_id: int, db: Session) -> SpotWatchlistSnapshot:
    row = db.query(SpotWatchlistSnapshot).filter_by(id=snapshot_id).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Spot watchlist snapshot {snapshot_id} not found",
        )
    return _enrich_sup_tf(row, db)
