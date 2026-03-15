"""
Volatility Engine — FastAPI router (P2-9, P2-10, P2-11, P2-13b).

Routes
------
  GET  /api/volatility/market/aggregated              ← cross-TF aggregated Market VI (Redis → DB fallback)
  GET  /api/volatility/market/{timeframe}              ← latest Market VI (Redis → DB fallback)
  GET  /api/volatility/pairs/{timeframe}               ← latest per-pair VI (Redis → DB fallback)
  GET  /api/volatility/watchlist/{timeframe}           ← latest watchlist snapshot (DB)
  GET  /api/volatility/settings/{profile_id}           ← volatility settings (create with defaults if missing)
  PUT  /api/volatility/settings/{profile_id}           ← merge-patch volatility settings
  GET  /api/volatility/notifications/{profile_id}      ← notification settings (create with defaults if missing)
  PUT  /api/volatility/notifications/{profile_id}      ← merge-patch notification settings
  POST /api/volatility/notifications/{profile_id}/test ← send test Telegram message
  GET  /api/volatility/prices/live                     ← BTC/ETH (Kraken) + XAU (Twelve Data), cached 30s

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
    NotificationSettings,
    VolatilitySettings,
    VolatilitySnapshot,
    WatchlistSnapshot,
)
from src.volatility.schedule import score_to_regime, get_regime_thresholds
from src.volatility.schemas import (
    AggregatedMarketVIOut,
    MarketVIOut,
    NotificationSettingsOut,
    NotificationSettingsPatch,
    PairVIOut,
    PairsVIOut,
    TFComponentOut,
    VolatilitySettingsOut,
    VolatilitySettingsPatch,
    WatchlistMetaOut,
    WatchlistOut,
    _DEFAULT_MARKET_VI,
    _DEFAULT_PER_PAIR,
    _DEFAULT_REGIMES,
)

router = APIRouter(prefix="/volatility", tags=["volatility"])

_VALID_TIMEFRAMES = {"15m", "1h", "4h", "1d", "1w"}
_TF_AGG_ORDER = ["15m", "1h", "4h", "1d"]


def _check_tf(timeframe: str) -> None:
    if timeframe not in _VALID_TIMEFRAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid timeframe '{timeframe}'. Valid: {sorted(_VALID_TIMEFRAMES)}",
        )


def _build_tf_components(db: Session, is_weekend: bool) -> list[TFComponentOut]:
    """Build the list of per-TF components for the aggregated response.

    Reads each TF score from Redis, reads tf_weights from the first
    VolatilitySettings row found (profile-agnostic at this point).
    Returns an empty list if no data is available yet.
    """
    row = db.query(VolatilitySettings).first()
    mv_cfg: dict = row.market_vi if row else {}
    tf_weights_cfg: dict = mv_cfg.get("tf_weights", {})
    day_key = "weekend" if is_weekend else "weekday"
    weights: dict = tf_weights_cfg.get(
        day_key,
        {"15m": 0.25, "1h": 0.40, "4h": 0.25, "1d": 0.10},
    )

    components: list[TFComponentOut] = []
    for tf in _TF_AGG_ORDER:
        cached = get_cached_market_vi(tf)
        if cached is not None:
            components.append(
                TFComponentOut(
                    tf=tf,
                    vi_score=float(cached["vi_score"]),
                    regime=cached["regime"],
                    weight=float(weights.get(tf, 0.0)),
                )
            )
            continue
        # Redis empty (e.g. after container restart) — fall back to DB
        db_row = (
            db.query(MarketVISnapshot)
            .filter(MarketVISnapshot.timeframe == tf)
            .order_by(MarketVISnapshot.timestamp.desc())
            .first()
        )
        if db_row is None:
            continue
        thresholds = get_regime_thresholds(db)
        components.append(
            TFComponentOut(
                tf=tf,
                vi_score=float(db_row.vi_score),
                regime=score_to_regime(float(db_row.vi_score), thresholds),
                weight=float(weights.get(tf, 0.0)),
            )
        )
    return components


# ── Market VI ─────────────────────────────────────────────────────────────────

@router.get("/market/aggregated", response_model=AggregatedMarketVIOut)
def get_aggregated_market_vi(db: Session = Depends(get_db)) -> AggregatedMarketVIOut:
    """Return the cross-TF aggregated Market VI score.

    Weights: weekday 25%×15m + 40%×1h + 25%×4h + 10%×1d,
             weekend 75%×15m + 25%×1h + 0%×4h + 0%×1d.
    Weights are configurable via volatility_settings.market_vi.tf_weights.

    Reads from Redis cache first; falls back to the most recent DB row
    with timeframe='aggregated'. Returns 404 if no data is available yet.
    """
    from datetime import UTC, datetime  # noqa: PLC0415

    is_weekend = datetime.now(UTC).weekday() >= 5

    # 1. Redis cache — aggregated key
    cached = get_cached_market_vi("aggregated")
    if cached:
        return AggregatedMarketVIOut(
            vi_score=float(cached["vi_score"]),
            regime=cached["regime"],
            timestamp=cached["timestamp"],
            is_weekend=is_weekend,
            tf_components=_build_tf_components(db, is_weekend),
        )

    # 2. DB fallback
    row = (
        db.query(MarketVISnapshot)
        .filter(MarketVISnapshot.timeframe == "aggregated")
        .order_by(MarketVISnapshot.timestamp.desc())
        .first()
    )
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No aggregated Market VI data yet — engine has not run",
        )
    return AggregatedMarketVIOut(
        vi_score=float(row.vi_score),
        regime=row.regime,
        timestamp=row.timestamp.isoformat(),
        is_weekend=is_weekend,
        tf_components=_build_tf_components(db, is_weekend),
    )

@router.get("/market/{timeframe}/history", response_model=list[MarketVIOut])
def get_market_vi_history(
    timeframe: str,
    limit: int = 96,
    since: str | None = None,
    db: Session = Depends(get_db),
) -> list[MarketVIOut]:
    """Return Market VI snapshots for a timeframe, oldest first.

    Query params:
      limit  — max rows to return (default 96, max 500)
      since  — ISO-8601 datetime string; if provided, return rows after this
               timestamp (takes precedence over limit for date filtering)

    Accepts any value for timeframe including 'aggregated'.
    No schedule gate — purely a DB read.
    """
    from datetime import UTC, datetime  # noqa: PLC0415

    q = db.query(MarketVISnapshot).filter(MarketVISnapshot.timeframe == timeframe)

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            q = q.filter(MarketVISnapshot.timestamp >= since_dt)
        except ValueError:
            pass  # bad param — ignore, fall through to limit-only query

    rows = (
        q.order_by(MarketVISnapshot.timestamp.desc())
        .limit(min(limit, 500))
        .all()
    )
    return [
        MarketVIOut(
            timeframe=timeframe,
            vi_score=float(r.vi_score),
            regime=r.regime,
            timestamp=r.timestamp.isoformat(),
        )
        for r in reversed(rows)
    ]


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

# NOTE: /watchlist/snapshot/{id} MUST be registered before /watchlist/{timeframe}.
# FastAPI matches routes in registration order; without this ordering,
# "snapshot" is swallowed as the {timeframe} path parameter.

@router.get("/watchlist/snapshot/{snapshot_id}", response_model=WatchlistOut)
def get_watchlist_by_id(
    snapshot_id: int, db: Session = Depends(get_db)
) -> WatchlistOut:
    """Return a specific watchlist snapshot by its primary key."""
    row = db.query(WatchlistSnapshot).filter(WatchlistSnapshot.id == snapshot_id).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Snapshot {snapshot_id} not found",
        )
    return WatchlistOut(
        id=row.id,
        timeframe=row.timeframe,
        regime=row.regime,
        pairs_count=row.pairs_count,
        pairs=row.pairs or [],
        generated_at=row.generated_at,
    )


@router.get("/watchlists", response_model=list[WatchlistMetaOut])
def list_watchlists(days: int = 7, db: Session = Depends(get_db)) -> list[WatchlistMetaOut]:
    """Return lightweight metadata for all watchlist snapshots in the last N days (default 7).

    Used by the tree/folder view in the frontend.
    """
    from datetime import UTC, datetime, timedelta  # noqa: PLC0415

    since = datetime.now(UTC) - timedelta(days=days)
    rows = (
        db.query(WatchlistSnapshot)
        .filter(WatchlistSnapshot.generated_at >= since)
        .order_by(WatchlistSnapshot.generated_at.desc())
        .limit(500)
        .all()
    )
    return [
        WatchlistMetaOut(
            id=r.id,
            timeframe=r.timeframe,
            name=r.name,
            regime=r.regime,
            pairs_count=r.pairs_count,
            generated_at=r.generated_at,
        )
        for r in rows
    ]


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
        id=row.id,
        timeframe=row.timeframe,
        regime=row.regime,
        pairs_count=row.pairs_count,
        pairs=row.pairs or [],
        generated_at=row.generated_at,
    )


# ── Volatility Settings ───────────────────────────────────────────────────────

def _get_or_create_vol_settings(db: Session, profile_id: int) -> VolatilitySettings:
    """Return existing VolatilitySettings row, or insert defaults and return it."""
    row = db.query(VolatilitySettings).filter(
        VolatilitySettings.profile_id == profile_id
    ).first()
    if row is None:
        row = VolatilitySettings(
            profile_id=profile_id,
            market_vi=_DEFAULT_MARKET_VI.copy(),
            per_pair=_DEFAULT_PER_PAIR.copy(),
            regimes=_DEFAULT_REGIMES.copy(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/settings/{profile_id}", response_model=VolatilitySettingsOut)
def get_volatility_settings(
    profile_id: int, db: Session = Depends(get_db)
) -> VolatilitySettingsOut:
    """Return volatility settings for a profile.

    Creates a row with defaults on first access — no 404 ever.
    """
    from src.core.models.broker import Profile  # late import to avoid circular

    if not db.query(Profile).filter(Profile.id == profile_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    row = _get_or_create_vol_settings(db, profile_id)
    return VolatilitySettingsOut(
        profile_id=row.profile_id,
        market_vi=row.market_vi,
        per_pair=row.per_pair,
        regimes=row.regimes,
        updated_at=row.updated_at,
    )


@router.put("/settings/{profile_id}", response_model=VolatilitySettingsOut)
def update_volatility_settings(
    profile_id: int,
    patch: VolatilitySettingsPatch,
    db: Session = Depends(get_db),
) -> VolatilitySettingsOut:
    """Merge-patch volatility settings. Only provided keys are updated."""
    from src.core.models.broker import Profile

    if not db.query(Profile).filter(Profile.id == profile_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    row = _get_or_create_vol_settings(db, profile_id)

    if patch.market_vi is not None:
        row.market_vi = {**row.market_vi, **patch.market_vi}
    if patch.per_pair is not None:
        row.per_pair = {**row.per_pair, **patch.per_pair}
    if patch.regimes is not None:
        row.regimes = {**row.regimes, **patch.regimes}

    from datetime import UTC, datetime
    row.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(row)
    return VolatilitySettingsOut(
        profile_id=row.profile_id,
        market_vi=row.market_vi,
        per_pair=row.per_pair,
        regimes=row.regimes,
        updated_at=row.updated_at,
    )


# ── Notification Settings ─────────────────────────────────────────────────────

def _get_or_create_notif_settings(db: Session, profile_id: int) -> NotificationSettings:
    """Return existing NotificationSettings row, or insert defaults and return it."""
    row = db.query(NotificationSettings).filter(
        NotificationSettings.profile_id == profile_id
    ).first()
    if row is None:
        row = NotificationSettings(
            profile_id=profile_id,
            bots=[],
            market_vi_alerts={},
            watchlist_alerts={},
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/notifications/{profile_id}", response_model=NotificationSettingsOut)
def get_notification_settings(
    profile_id: int, db: Session = Depends(get_db)
) -> NotificationSettingsOut:
    """Return notification settings for a profile. Creates with defaults on first access."""
    from src.core.models.broker import Profile

    if not db.query(Profile).filter(Profile.id == profile_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    row = _get_or_create_notif_settings(db, profile_id)
    return NotificationSettingsOut(
        profile_id=row.profile_id,
        bots=row.bots,
        market_vi_alerts=row.market_vi_alerts,
        watchlist_alerts=row.watchlist_alerts,
        updated_at=row.updated_at,
    )


@router.put("/notifications/{profile_id}", response_model=NotificationSettingsOut)
def update_notification_settings(
    profile_id: int,
    patch: NotificationSettingsPatch,
    db: Session = Depends(get_db),
) -> NotificationSettingsOut:
    """Merge-patch notification settings. Only provided keys are updated."""
    from src.core.models.broker import Profile

    if not db.query(Profile).filter(Profile.id == profile_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    row = _get_or_create_notif_settings(db, profile_id)

    if patch.bots is not None:
        row.bots = patch.bots
    if patch.market_vi_alerts is not None:
        row.market_vi_alerts = {**row.market_vi_alerts, **patch.market_vi_alerts}
    if patch.watchlist_alerts is not None:
        row.watchlist_alerts = {**row.watchlist_alerts, **patch.watchlist_alerts}

    from datetime import UTC, datetime
    row.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(row)
    return NotificationSettingsOut(
        profile_id=row.profile_id,
        bots=row.bots,
        market_vi_alerts=row.market_vi_alerts,
        watchlist_alerts=row.watchlist_alerts,
        updated_at=row.updated_at,
    )


@router.post("/notifications/{profile_id}/test", status_code=200)
def test_notification(
    profile_id: int,
    db: Session = Depends(get_db),
) -> dict:
    """Send a test Telegram message to verify bot configuration."""
    from src.core.models.broker import Profile
    from src.volatility.telegram import _dispatch

    if not db.query(Profile).filter(Profile.id == profile_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")

    row = _get_or_create_notif_settings(db, profile_id)
    bots: list = row.bots or []
    if not bots:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No bots configured. Add at least one bot in notification settings.",
        )

    first_bot = bots[0]
    bot_token = first_bot.get("bot_token")
    chat_id = first_bot.get("chat_id")
    if not bot_token or not chat_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="First bot is missing bot_token or chat_id.",
        )

    success = _dispatch({"bot_token": bot_token, "chat_id": chat_id}, "🔔 AlphaTradingDesk — test message OK")
    if not success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Telegram API call failed. Check bot_token and chat_id.",
        )
    return {"status": "ok", "message": "Test message sent successfully."}


# ── Manual task trigger ───────────────────────────────────────────────────────

_RUNNABLE_TASKS = {"market-vi", "pairs", "sync"}
_TF_ALL = ["15m", "1h", "4h", "1d"]


@router.post("/run/{task}", status_code=202)
def run_task_now(
    task: str,
    timeframe: str = "1h",
) -> dict:
    """Manually queue a background Celery task.

    task      : 'market-vi' | 'pairs' | 'sync'
    timeframe : '15m' | '1h' | '4h' | '1d' | 'all' (default '1h')
                'all' queues one task per TF (4 tasks in parallel).

    Returns 202 Accepted immediately — tasks run asynchronously.
    """
    if task not in _RUNNABLE_TASKS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown task '{task}'. Valid: {sorted(_RUNNABLE_TASKS)}",
        )

    # Resolve timeframes to compute
    if task in {"market-vi", "pairs"}:
        if timeframe == "all":
            tfs_to_run = _TF_ALL
        elif timeframe in _VALID_TIMEFRAMES:
            tfs_to_run = [timeframe]
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid timeframe '{timeframe}'. Valid: {sorted(_VALID_TIMEFRAMES)} or 'all'",
            )
    else:
        tfs_to_run = []

    from src.volatility.tasks import compute_market_vi, compute_pair_vi, sync_instruments  # noqa: PLC0415

    if task == "market-vi":
        results = [compute_market_vi.delay(tf) for tf in tfs_to_run]
        return {
            "status": "queued",
            "task": task,
            "timeframes": tfs_to_run,
            "task_ids": [r.id for r in results],
        }
    elif task == "pairs":
        results = [compute_pair_vi.apply_async((tf,), {"force": True}) for tf in tfs_to_run]
        return {
            "status": "queued",
            "task": task,
            "timeframes": tfs_to_run,
            "task_ids": [r.id for r in results],
        }
    else:
        celery_result = sync_instruments.delay()
        return {
            "status": "queued",
            "task": "sync",
            "timeframes": None,
            "task_ids": [celery_result.id],
        }


# ── Live Prices ───────────────────────────────────────────────────────────────

@router.get("/prices/live")
def live_prices() -> dict:
    """Return latest BTC/USD, ETH/USD, XAU/USD prices. Cached 30s in Redis."""
    from src.volatility.prices import get_live_prices
    return get_live_prices()
