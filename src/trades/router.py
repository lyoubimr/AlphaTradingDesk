"""
Trade Journal router.

Routes:
  POST   /api/trades                  ← open trade
  GET    /api/trades                  ← journal list (paginated + filters)
  GET    /api/trades/{id}             ← trade detail
  PUT    /api/trades/{id}             ← update (SL, notes, strategy…)
  POST   /api/trades/{id}/close       ← full close
  POST   /api/trades/{id}/partial     ← partial close (TP hit)
  DELETE /api/trades/{id}             ← soft-delete
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


@router.delete("/{trade_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_trade(trade_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete an open/partial trade. Closed trades cannot be deleted (permanent journal record)."""
    service.delete_trade(db, trade_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
