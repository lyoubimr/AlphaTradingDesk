"""
Volatility Engine — FastAPI router (P2-9).

Routes
------
  GET /api/volatility/market/{timeframe}    ← latest Market VI (Redis → DB fallback)
  GET /api/volatility/pairs/{timeframe}     ← latest per-pair VI (Redis → DB fallback)
  GET /api/volatility/watchlist/{timeframe} ← latest watchlist snapshot (DB)

Valid timeframes: 15m | 1h | 4h | 1d | 1w
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.volatility.cache import (
    get_cached_market_vi,
    get_cached_pair_vi,
)
from src.volatility.models import (
    MarketVISnapshot,
    VolatilitySnapshot,
    WatchlistSnapshot,
)
from src.volatility.schedule import score_to_regime, get_regime_thresholds
from src.volatility.schemas import MarketVIOut, PairVIOut, PairsVIOut, WatchlistOut

router = APIRouter(prefix="/volatility", tags=["volatility"])

_VALID_TIMEFRAMES = {"15m", "1h", "4h", "1d", "1w"}


def _check_tf(timeframe: str) -> None:
    if timeframe not in _VALID_TIMEFRAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid timeframe '{timeframe}'. Valid: {sorted(_VALID_TIMEFRAMES)}",
        )


# ── Market VI ─────────────────────────────────────────────────────────────────

@router.get("/market/{timeframe}", response_model=MarketVIOut)
def get_market_vi(timeframe: str, db: Session = Depends(get_db)) -> MarketVIOut:
    """Return the latest aggregated Market VI for a given timeframe.

    Reads from Redis cache first; falls back to the most recent DB row.
    Returns 404 if no data is available yet (task hasn't run).
    """
    _check_tf(timeframe)

    # 1. Redis cache
    cached = get_cached_market_vi(timeframe)
    if cached:
        return MarketVIOut(
            timeframe=timeframe,
            vi_score=float(cached["vi_score"]),
            regime=cached["regime"],
            timestamp=cached["timestamp"],
        )

    # 2. DB fallback — latest row for this timeframe
    row = (
        db.query(MarketVISnapshot)
        .filter(MarketVISnapshot.timeframe == timeframe)
        .order_by(MarketVISnapshot.timestamp.desc())
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No Market VI data yet for timeframe '{timeframe}'",
        )
    return MarketVIOut(
        timeframe=timeframe,
        vi_score=float(row.vi_score),
        regime=row.regime,
        timestamp=row.timestamp.isoformat(),
    )


# ── Per-pair VI ───────────────────────────────────────────────────────────────

@router.get("/pairs/{timeframe}", response_model=PairsVIOut)
def get_pairs_vi(timeframe: str, db: Session = Depends(get_db)) -> PairsVIOut:
    """Return the latest VI score for every tracked pair at a given timeframe.

    For each pair, reads from Redis cache first; falls back to the most recent
    DB row for that pair. Only pairs with at least one snapshot are returned.
    """
    _check_tf(timeframe)

    # Get distinct pairs that have data for this timeframe
    db_pairs: list[str] = [
        r[0]
        for r in db.query(VolatilitySnapshot.pair)
        .filter(VolatilitySnapshot.timeframe == timeframe)
        .distinct()
        .all()
    ]

    if not db_pairs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No pair VI data yet for timeframe '{timeframe}'",
        )

    results: list[PairVIOut] = []
    for pair in db_pairs:
        # Try Redis first
        cached = get_cached_pair_vi(pair, timeframe)
        if cached:
            results.append(
                PairVIOut(
                    pair=pair,
                    timeframe=timeframe,
                    vi_score=float(cached["vi_score"]),
                    regime=cached["regime"],
                    components=cached.get("components", {}),
                    timestamp=cached["timestamp"],
                )
            )
            continue

        # DB fallback — latest snapshot for this pair+timeframe
        row = (
            db.query(VolatilitySnapshot)
            .filter(
                VolatilitySnapshot.pair == pair,
                VolatilitySnapshot.timeframe == timeframe,
            )
            .order_by(VolatilitySnapshot.timestamp.desc())
            .first()
        )
        if row:
            thresholds = get_regime_thresholds(db)
            results.append(
                PairVIOut(
                    pair=pair,
                    timeframe=timeframe,
                    vi_score=float(row.vi_score),
                    regime=score_to_regime(float(row.vi_score), thresholds),
                    components=row.components or {},
                    timestamp=row.timestamp.isoformat(),
                )
            )

    results.sort(key=lambda r: r.vi_score, reverse=True)
    return PairsVIOut(timeframe=timeframe, pairs=results, count=len(results))


# ── Watchlist ─────────────────────────────────────────────────────────────────

@router.get("/watchlist/{timeframe}", response_model=WatchlistOut)
def get_watchlist(timeframe: str, db: Session = Depends(get_db)) -> WatchlistOut:
    """Return the latest watchlist snapshot for a given timeframe.

    Reads directly from DB (watchlist_snapshots is a regular table, not a hypertable).
    Returns 404 if the per-pair task has not run yet.
    """
    _check_tf(timeframe)

    row = (
        db.query(WatchlistSnapshot)
        .filter(WatchlistSnapshot.timeframe == timeframe)
        .order_by(WatchlistSnapshot.generated_at.desc())
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No watchlist data yet for timeframe '{timeframe}'",
        )
    return WatchlistOut(
        timeframe=row.timeframe,
        regime=row.regime,
        pairs_count=row.pairs_count,
        pairs=row.pairs or [],
        generated_at=row.generated_at,
    )
