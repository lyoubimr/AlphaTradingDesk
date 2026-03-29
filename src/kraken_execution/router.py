"""
src/kraken_execution/router.py

Phase 5 — Kraken Execution API router.

Prefix: /api/kraken-execution

Endpoints:
  GET  /settings/{profile_id}                  — Read automation settings (no keys)
  PUT  /settings/{profile_id}                  — Update settings (keys encrypted on write)
  POST /settings/{profile_id}/test-connection  — Verify API keys against Kraken
  GET  /orders/{trade_id}                      — List kraken_orders for a trade
  POST /trades/{trade_id}/open                 — Trigger: open automated entry
  POST /trades/{trade_id}/close                — Trigger: close automated position
  POST /trades/{trade_id}/breakeven            — Trigger: move SL to entry price
  POST /trades/{trade_id}/cancel-entry         — Trigger: cancel pending LIMIT entry
  POST /trades/{trade_id}/sync-fill            — Check if pending LIMIT entry was filled → activate + place SL/TP
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.kraken_execution import (
    AutomationNotEnabledError,
    KrakenAPIError,
    MissingAPIKeysError,
    MissingPrecisionError,
)
from src.kraken_execution.models import AutomationSettings
from src.kraken_execution.schemas import (
    AutomationConfigOut,
    AutomationSettingsOut,
    AutomationSettingsUpdateIn,
    ConnectionTestOut,
    KrakenOrderOut,
)
from src.kraken_execution.service import (
    cancel_entry,
    close_automated_trade,
    get_automation_settings,
    has_api_keys,
    list_kraken_orders,
    move_to_breakeven,
    open_automated_trade,
    sync_pending_fill,
    update_automation_settings,
    verify_connection,
)
from src.volatility.kraken_client import KrakenClient

router = APIRouter(prefix="/kraken-execution", tags=["kraken-execution"])


# ── Helper ────────────────────────────────────────────────────────────────────

def _settings_to_out(row: AutomationSettings) -> AutomationSettingsOut:
    safe_config = AutomationConfigOut(
        enabled=row.config.get("enabled", False),
        pnl_status_interval_minutes=row.config.get("pnl_status_interval_minutes", 60),
        max_leverage_override=row.config.get("max_leverage_override"),
    )
    return AutomationSettingsOut(
        profile_id=row.profile_id,
        has_api_keys=has_api_keys(row),
        config=safe_config,
        updated_at=row.updated_at,
    )


# ── Settings endpoints ────────────────────────────────────────────────────────

@router.get("/settings/{profile_id}", response_model=AutomationSettingsOut)
def read_automation_settings(
    profile_id: int,
    db: Session = Depends(get_db),
) -> AutomationSettingsOut:
    row = get_automation_settings(profile_id, db)
    return _settings_to_out(row)


@router.put("/settings/{profile_id}", response_model=AutomationSettingsOut)
def write_automation_settings(
    profile_id: int,
    body: AutomationSettingsUpdateIn,
    db: Session = Depends(get_db),
) -> AutomationSettingsOut:
    patch = body.model_dump(exclude_none=True)
    row = update_automation_settings(profile_id, patch, db)
    return _settings_to_out(row)


@router.post(
    "/settings/{profile_id}/test-connection",
    response_model=ConnectionTestOut,
)
def check_connection(
    profile_id: int,
    db: Session = Depends(get_db),
) -> ConnectionTestOut:
    result = verify_connection(profile_id, db)
    return ConnectionTestOut(**result)


# ── Orders list ───────────────────────────────────────────────────────────────

@router.get("/orders/{trade_id}", response_model=list[KrakenOrderOut])
def read_kraken_orders(
    trade_id: int,
    db: Session = Depends(get_db),
) -> list[KrakenOrderOut]:
    orders = list_kraken_orders(trade_id, db)
    return [KrakenOrderOut.model_validate(o) for o in orders]


# ── Trade automation triggers ─────────────────────────────────────────────────

def _map_exc(exc: Exception) -> HTTPException:
    """Map domain exceptions to HTTP error responses."""
    if isinstance(exc, AutomationNotEnabledError):
        return HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(exc))
    if isinstance(exc, MissingAPIKeysError):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if isinstance(exc, MissingPrecisionError):
        return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    if isinstance(exc, KrakenAPIError):
        return HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Kraken API error {exc.status_code}: {exc.body}",
        )
    if isinstance(exc, ValueError):
        return HTTPException(status.HTTP_404_NOT_FOUND, detail=str(exc))
    return HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc))


@router.post("/trades/{trade_id}/open", response_model=KrakenOrderOut)
def trigger_open(
    trade_id: int,
    db: Session = Depends(get_db),
) -> KrakenOrderOut:
    try:
        order = open_automated_trade(trade_id, db)
    except Exception as exc:
        raise _map_exc(exc) from exc
    return KrakenOrderOut.model_validate(order)


@router.post("/trades/{trade_id}/close", response_model=KrakenOrderOut)
def trigger_close(
    trade_id: int,
    db: Session = Depends(get_db),
) -> KrakenOrderOut:
    try:
        order = close_automated_trade(trade_id, db)
    except Exception as exc:
        raise _map_exc(exc) from exc
    return KrakenOrderOut.model_validate(order)


@router.post("/trades/{trade_id}/breakeven", response_model=KrakenOrderOut)
def trigger_breakeven(
    trade_id: int,
    db: Session = Depends(get_db),
) -> KrakenOrderOut:
    try:
        order = move_to_breakeven(trade_id, db)
    except Exception as exc:
        raise _map_exc(exc) from exc
    return KrakenOrderOut.model_validate(order)


@router.post("/trades/{trade_id}/cancel-entry", response_model=KrakenOrderOut)
def trigger_cancel_entry(
    trade_id: int,
    db: Session = Depends(get_db),
) -> KrakenOrderOut:
    try:
        order = cancel_entry(trade_id, db)
    except Exception as exc:
        raise _map_exc(exc) from exc
    return KrakenOrderOut.model_validate(order)


@router.post("/trades/{trade_id}/sync-fill")
def trigger_sync_fill(
    trade_id: int,
    db: Session = Depends(get_db),
) -> dict:
    """Check whether a pending LIMIT entry has been filled on Kraken.

    Called by the frontend every ~15 s while the trade is pending + automated.
    On fill detection: activates trade (pending → open) and places SL/TP orders.

    Returns:
        {"filled": bool, "fill_price": float | null, "skipped"?: bool}
    """
    try:
        return sync_pending_fill(trade_id, db)
    except Exception as exc:
        raise _map_exc(exc) from exc

@router.get("/mark-price/{symbol}")
def get_mark_price(symbol: str) -> dict:
    """Return the current last/mark price for a Kraken Futures symbol.

    Uses the public tickers endpoint — no API keys required.
    Used by NewTradePage to prefill entry_price for MARKET orders.
    """
    try:
        with KrakenClient() as client:
            ticker = client.fetch_ticker(symbol)
        return {"symbol": symbol, "mark_price": ticker["last"]}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Kraken price unavailable: {exc}",
        ) from exc
