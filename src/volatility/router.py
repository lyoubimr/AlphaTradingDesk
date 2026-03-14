"""
Volatility Engine — FastAPI router (P2-9, P2-10, P2-11).

Routes
------
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
    MarketVIOut,
    NotificationSettingsOut,
    NotificationSettingsPatch,
    PairVIOut,
    PairsVIOut,
    VolatilitySettingsOut,
    VolatilitySettingsPatch,
    WatchlistOut,
    _DEFAULT_MARKET_VI,
    _DEFAULT_PER_PAIR,
    _DEFAULT_REGIMES,
)

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


# ── Live Prices ───────────────────────────────────────────────────────────────

@router.get("/prices/live")
def live_prices() -> dict:
    """Return latest BTC/USD, ETH/USD, XAU/USD prices. Cached 30s in Redis."""
    from src.volatility.prices import get_live_prices
    return get_live_prices()
