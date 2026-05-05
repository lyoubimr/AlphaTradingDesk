"""
Phase 7 — Spot Volatility API Router.

Endpoints:
  GET  /spot-volatility/watchlist/{timeframe}   → latest snapshot (or 404)
  GET  /spot-volatility/watchlists              → recent snapshot list (metadata, no pairs)
  GET  /spot-volatility/watchlist-by-id/{id}    → full snapshot by PK
  POST /spot-volatility/run                     → synchronous compute + store
  GET  /spot-volatility/settings                → global settings (auto-init)
  PUT  /spot-volatility/settings                → merge-patch settings
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.core.database import get_db
from src.spot_volatility import schemas, service

router = APIRouter(prefix="/spot-volatility", tags=["spot-volatility"])


# ── Type alias ────────────────────────────────────────────────────────────────
Db = Annotated[Session, Depends(get_db)]


# ── Watchlist reads ───────────────────────────────────────────────────────────

@router.get("/watchlist/{timeframe}", response_model=schemas.SpotWatchlistOut)
def get_watchlist(timeframe: str, db: Db) -> schemas.SpotWatchlistOut:
    """Return the latest spot watchlist snapshot for *timeframe* (4h | 1d | 1w).

    Raises 404 if no snapshot exists yet — run POST /run first.
    """
    row = service.get_latest_watchlist(timeframe.lower(), db)
    return schemas.SpotWatchlistOut.model_validate(row)


@router.get("/watchlists", response_model=list[schemas.SpotWatchlistMetaOut])
def list_watchlists(
    db: Db,
    days: int = Query(default=30, ge=1, le=365),
) -> list[schemas.SpotWatchlistMetaOut]:
    """List snapshot metadata for the past *days* days (no pairs payload)."""
    rows = service.list_watchlists(days, db)
    return [schemas.SpotWatchlistMetaOut.model_validate(r) for r in rows]


@router.get("/watchlist-by-id/{snapshot_id}", response_model=schemas.SpotWatchlistOut)
def get_watchlist_by_id(snapshot_id: int, db: Db) -> schemas.SpotWatchlistOut:
    """Return a specific spot watchlist snapshot by its database ID."""
    row = service.get_watchlist_by_id(snapshot_id, db)
    return schemas.SpotWatchlistOut.model_validate(row)


# ── Compute (synchronous) ─────────────────────────────────────────────────────

@router.post("/run", response_model=schemas.SpotRunResponse)
def run_compute(body: schemas.SpotRunRequest, db: Db) -> schemas.SpotRunResponse:
    """Compute spot VI scores for all configured pairs at *timeframe* and store.

    This is a synchronous operation (~5–15 s depending on pair count and network).
    The frontend should poll /watchlist/{timeframe} after the response is received.
    """
    snapshot = service.compute_spot_watchlist(body.timeframe.lower(), db)
    return schemas.SpotRunResponse(
        status="ok",
        timeframe=snapshot.timeframe,
        pairs_computed=snapshot.pairs_count,
        snapshot_id=snapshot.id,
    )


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=schemas.SpotVolatilitySettingsOut)
def get_settings(db: Db) -> schemas.SpotVolatilitySettingsOut:
    """Return global spot volatility settings (auto-initialised with defaults if absent)."""
    row = service.get_settings(db)
    return schemas.SpotVolatilitySettingsOut.model_validate(row)


@router.put("/settings", response_model=schemas.SpotVolatilitySettingsOut)
def update_settings(body: schemas.SpotVolatilitySettingsPatch, db: Db) -> schemas.SpotVolatilitySettingsOut:
    """Deep-merge *config* patch into global settings."""
    row = service.update_settings(body.config, db)
    return schemas.SpotVolatilitySettingsOut.model_validate(row)
