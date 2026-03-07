"""
Trade Journal router.

Routes:
  POST   /api/trades                          ← open trade (MARKET → 'open', LIMIT → 'pending')
  GET    /api/trades                          ← journal list (paginated + filters)
  GET    /api/trades/{id}                     ← trade detail
  PUT    /api/trades/{id}                     ← update (SL, notes, strategy… | closed: close_notes/screenshots only)
  POST   /api/trades/{id}/activate            ← LIMIT triggered: pending → open (reserves risk)
  POST   /api/trades/{id}/breakeven           ← move SL to entry price, current_risk → 0
  POST   /api/trades/{id}/close               ← full close
  POST   /api/trades/{id}/partial             ← partial close (TP hit)
  POST   /api/trades/{id}/cancel              ← cancel pending LIMIT order (no capital/WR impact)
  POST   /api/trades/{id}/snapshots/entry     ← upload entry snapshot image → returns updated TradeOut
  POST   /api/trades/{id}/snapshots/close     ← upload close snapshot image → returns updated TradeOut
  DELETE /api/trades/{id}/snapshots/entry/{url} ← remove one entry snapshot URL
  DELETE /api/trades/{id}/snapshots/close/{url} ← remove one close snapshot URL
  DELETE /api/trades/{id}                     ← physical delete (pending/open/partial/cancelled only)
"""

from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.deps import get_db
from src.trades import service
from src.trades.schemas import (
    TradeClose,
    TradeListItem,
    TradeOpen,
    TradeOut,
    TradePartialClose,
    TradeUpdate,
)

router = APIRouter(prefix="/trades", tags=["trades"])


@router.post("", response_model=TradeOut, status_code=status.HTTP_201_CREATED)
def open_trade(data: TradeOpen, db: Session = Depends(get_db)) -> object:
    """
    Open a new trade.
    The backend computes risk_amount and lot size from the profile's
    capital_current and the instrument data.
    """
    return service.open_trade(db, data)


@router.get("", response_model=list[TradeListItem])
def list_trades(
    profile_id: int | None = Query(default=None, description="Filter by profile"),
    trade_status: str | None = Query(
        default=None, alias="status", description="open | partial | closed"
    ),
    pair: str | None = Query(default=None, description="Partial match on pair symbol"),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> list:
    return service.list_trades(
        db,
        profile_id=profile_id,
        trade_status=trade_status,
        pair=pair,
        offset=offset,
        limit=limit,
    )


@router.get("/{trade_id}", response_model=TradeOut)
def get_trade(trade_id: int, db: Session = Depends(get_db)) -> object:
    return service.get_trade(db, trade_id)


@router.put("/{trade_id}", response_model=TradeOut)
def update_trade(
    trade_id: int,
    data: TradeUpdate,
    db: Session = Depends(get_db),
) -> object:
    return service.update_trade(db, trade_id, data)


@router.post("/{trade_id}/activate", response_model=TradeOut)
def activate_trade(trade_id: int, db: Session = Depends(get_db)) -> object:
    """
    Activate a pending LIMIT order — the limit price was touched by the market.

    Transitions status: pending → open.
    Reserves risk (current_risk = risk_amount) at this point, not at order placement.
    Only 'pending' LIMIT trades can be activated.
    """
    return service.activate_trade(db, trade_id)


@router.post("/{trade_id}/breakeven", response_model=TradeOut)
def move_to_breakeven(trade_id: int, db: Session = Depends(get_db)) -> object:
    """
    Move stop-loss to entry price (breakeven).

    - Sets stop_loss = entry_price.
    - Sets current_risk = 0 (no remaining downside exposure at BE).
    - Only available for 'open' or 'partial' trades.
    - Does NOT close any position — use partial_close to book a TP first.
    """
    return service.move_to_breakeven(db, trade_id)


@router.post("/{trade_id}/close", response_model=TradeOut)
def full_close(
    trade_id: int,
    data: TradeClose,
    db: Session = Depends(get_db),
) -> object:
    """
    Fully close a trade at the given exit_price.
    Closes all remaining open positions, sums PnL,
    and atomically updates profile.capital_current.
    """
    return service.full_close(db, trade_id, data)


@router.post("/{trade_id}/partial", response_model=TradeOut)
def partial_close(
    trade_id: int,
    data: TradePartialClose,
    db: Session = Depends(get_db),
) -> object:
    """
    Partially close one TP position.
    Optionally moves SL to break-even (move_to_be=true).
    """
    return service.partial_close(db, trade_id, data)


@router.post("/{trade_id}/cancel", response_model=TradeOut)
def cancel_trade(trade_id: int, db: Session = Depends(get_db)) -> object:
    """
    Cancel a pending LIMIT order (never triggered).

    Sets status='cancelled'. No impact on capital or WR stats.
    Only 'pending' trades can be cancelled — open trades must be closed normally.
    The trade is kept as a journal record — use DELETE to remove it entirely.
    """
    return service.cancel_trade(db, trade_id)


@router.delete("/{trade_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_trade(trade_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete an open/partial/cancelled trade. Closed trades cannot be deleted."""
    service.delete_trade(db, trade_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Snapshot upload helpers ────────────────────────────────────────────────────

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_SIZE_MB = 10
UPLOAD_DIR = os.path.join(settings.uploads_dir, "trades")


def _save_snapshot(file: UploadFile, trade_id: int) -> str:
    """
    Save an uploaded image to disk and return the relative URL path.
    URL format: /uploads/trades/<trade_id>/<uuid>.<ext>
    """
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unsupported image type: {file.content_type}. Allowed: jpeg, png, webp, gif",
        )

    ext = (file.filename or "image.jpg").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
        ext = "jpg"

    dest_dir = os.path.join(UPLOAD_DIR, str(trade_id))
    os.makedirs(dest_dir, exist_ok=True)

    filename = f"{uuid.uuid4().hex}.{ext}"
    dest_path = os.path.join(dest_dir, filename)

    content = file.file.read()
    if len(content) > MAX_IMAGE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Image too large (max {MAX_IMAGE_SIZE_MB} MB).",
        )

    with open(dest_path, "wb") as f:
        f.write(content)

    return f"/uploads/trades/{trade_id}/{filename}"


@router.post("/{trade_id}/snapshots/entry", response_model=TradeOut)
def upload_entry_snapshot(
    trade_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> object:
    """
    Upload an entry snapshot image for a trade.
    Appends the URL to trade.entry_screenshot_urls.
    Available for any trade status (you may upload screenshots retroactively).
    """
    url = _save_snapshot(file, trade_id)
    trade = service.get_trade_raw(db, trade_id)
    existing = list(trade.entry_screenshot_urls or [])
    existing.append(url)
    return service.update_entry_screenshots(db, trade_id, existing)


@router.post("/{trade_id}/snapshots/close", response_model=TradeOut)
def upload_close_snapshot(
    trade_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> object:
    """
    Upload a close snapshot image for a trade.
    Appends the URL to trade.close_screenshot_urls.
    Available for any trade status, including closed.
    """
    url = _save_snapshot(file, trade_id)
    trade = service.get_trade_raw(db, trade_id)
    existing = list(trade.close_screenshot_urls or [])
    existing.append(url)
    return service.update_close_screenshots(db, trade_id, existing)


@router.delete("/{trade_id}/snapshots/entry/{url_b64}", response_model=TradeOut)
def delete_entry_snapshot(
    trade_id: int,
    url_b64: str,
    db: Session = Depends(get_db),
) -> object:
    """
    Remove a specific entry snapshot URL (base64url-encoded path).
    Does NOT delete the file from disk — managed separately.
    """
    import base64
    url = base64.urlsafe_b64decode(url_b64 + "==").decode("utf-8")
    trade = service.get_trade_raw(db, trade_id)
    existing = [u for u in (trade.entry_screenshot_urls or []) if u != url]
    return service.update_entry_screenshots(db, trade_id, existing)


@router.delete("/{trade_id}/snapshots/close/{url_b64}", response_model=TradeOut)
def delete_close_snapshot(
    trade_id: int,
    url_b64: str,
    db: Session = Depends(get_db),
) -> object:
    """
    Remove a specific close snapshot URL (base64url-encoded path).
    Does NOT delete the file from disk — managed separately.
    """
    import base64
    url = base64.urlsafe_b64decode(url_b64 + "==").decode("utf-8")
    trade = service.get_trade_raw(db, trade_id)
    existing = [u for u in (trade.close_screenshot_urls or []) if u != url]
    return service.update_close_screenshots(db, trade_id, existing)
