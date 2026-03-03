"""
Trade Journal router.

Routes:
  POST   /api/trades                  ← open trade (MARKET → 'open', LIMIT → 'pending')
  GET    /api/trades                  ← journal list (paginated + filters)
  GET    /api/trades/{id}             ← trade detail
  PUT    /api/trades/{id}             ← update (SL, notes, strategy… | pending: also entry + TPs)
  POST   /api/trades/{id}/activate    ← LIMIT triggered: pending → open (reserves risk)
  POST   /api/trades/{id}/breakeven   ← move SL to entry price, current_risk → 0
  POST   /api/trades/{id}/close       ← full close
  POST   /api/trades/{id}/partial     ← partial close (TP hit)
  POST   /api/trades/{id}/cancel      ← cancel pending LIMIT order (no capital/WR impact)
  DELETE /api/trades/{id}             ← physical delete (pending/open/partial/cancelled only)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

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
    trade_status: str | None = Query(default=None, alias="status", description="open | partial | closed"),
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
