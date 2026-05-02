"""
Phase 7 — Investment & Spot module API router.

Prefix: /api/investment

All write endpoints for spot_trades and deposits require account_type='spot'
on the profile (403 otherwise). Read endpoints are open to allow the UI to
query safely without pre-checking the profile type.

Endpoints:
  GET    /investment/spot-trades/{profile_id}             → list positions
  POST   /investment/spot-trades/{profile_id}             → open position
  GET    /investment/spot-trades/{profile_id}/{id}        → get position
  PUT    /investment/spot-trades/{profile_id}/{id}        → update position
  POST   /investment/spot-trades/{profile_id}/{id}/close  → close position
  POST   /investment/spot-trades/{profile_id}/{id}/cancel → cancel position

  GET    /investment/deposits/{profile_id}                → list deposits
  POST   /investment/deposits/{profile_id}                → log deposit/withdrawal
  PUT    /investment/deposits/{profile_id}/{id}           → update deposit
  DELETE /investment/deposits/{profile_id}/{id}           → delete deposit

  GET    /investment/settings/{profile_id}                → investment settings
  PUT    /investment/settings/{profile_id}                → update settings

  GET    /investment/portfolio/{profile_id}               → portfolio summary
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from src.core.deps import get_db
from src.investment import service
from src.investment.schemas import (
    DepositCreate,
    DepositOut,
    DepositUpdate,
    InvestmentSettingsOut,
    InvestmentSettingsUpdateIn,
    PortfolioOut,
    SpotTradeClose,
    SpotTradeCreate,
    SpotTradeOut,
    SpotTradeUpdate,
)

router = APIRouter(prefix="/investment", tags=["investment"])


# ── Spot Trades ───────────────────────────────────────────────────────────────

@router.get("/spot-trades/{profile_id}", response_model=list[SpotTradeOut])
def list_spot_trades(
    profile_id: int,
    status: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> list:
    return service.list_spot_trades(profile_id, db, status_filter=status)


@router.post(
    "/spot-trades/{profile_id}",
    response_model=SpotTradeOut,
    status_code=201,
)
def create_spot_trade(
    profile_id: int,
    data: SpotTradeCreate,
    db: Session = Depends(get_db),
) -> object:
    return service.create_spot_trade(profile_id, data, db)


@router.get("/spot-trades/{profile_id}/{trade_id}", response_model=SpotTradeOut)
def get_spot_trade(
    profile_id: int,
    trade_id: int,
    db: Session = Depends(get_db),
) -> object:
    return service.get_spot_trade(trade_id, profile_id, db)


@router.put("/spot-trades/{profile_id}/{trade_id}", response_model=SpotTradeOut)
def update_spot_trade(
    profile_id: int,
    trade_id: int,
    data: SpotTradeUpdate,
    db: Session = Depends(get_db),
) -> object:
    return service.update_spot_trade(trade_id, profile_id, data, db)


@router.post(
    "/spot-trades/{profile_id}/{trade_id}/close",
    response_model=SpotTradeOut,
)
def close_spot_trade(
    profile_id: int,
    trade_id: int,
    data: SpotTradeClose,
    db: Session = Depends(get_db),
) -> object:
    return service.close_spot_trade(trade_id, profile_id, data, db)


@router.post(
    "/spot-trades/{profile_id}/{trade_id}/cancel",
    response_model=SpotTradeOut,
)
def cancel_spot_trade(
    profile_id: int,
    trade_id: int,
    db: Session = Depends(get_db),
) -> object:
    return service.cancel_spot_trade(trade_id, profile_id, db)


# ── Deposits ──────────────────────────────────────────────────────────────────

@router.get("/deposits/{profile_id}", response_model=list[DepositOut])
def list_deposits(
    profile_id: int,
    db: Session = Depends(get_db),
) -> list:
    return service.list_deposits(profile_id, db)


@router.post(
    "/deposits/{profile_id}",
    response_model=DepositOut,
    status_code=201,
)
def create_deposit(
    profile_id: int,
    data: DepositCreate,
    db: Session = Depends(get_db),
) -> object:
    return service.create_deposit(profile_id, data, db)


@router.put("/deposits/{profile_id}/{deposit_id}", response_model=DepositOut)
def update_deposit(
    profile_id: int,
    deposit_id: int,
    data: DepositUpdate,
    db: Session = Depends(get_db),
) -> object:
    return service.update_deposit(deposit_id, profile_id, data, db)


@router.delete(
    "/deposits/{profile_id}/{deposit_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
def delete_deposit(
    profile_id: int,
    deposit_id: int,
    db: Session = Depends(get_db),
) -> Response:
    service.delete_deposit(deposit_id, profile_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Investment Settings ───────────────────────────────────────────────────────

@router.get("/settings/{profile_id}", response_model=InvestmentSettingsOut)
def read_investment_settings(
    profile_id: int,
    db: Session = Depends(get_db),
) -> InvestmentSettingsOut:
    row = service.get_investment_settings(profile_id, db)
    return InvestmentSettingsOut.model_validate(row)


@router.put("/settings/{profile_id}", response_model=InvestmentSettingsOut)
def write_investment_settings(
    profile_id: int,
    body: InvestmentSettingsUpdateIn,
    db: Session = Depends(get_db),
) -> InvestmentSettingsOut:
    row = service.update_investment_settings(profile_id, body.config, db)
    return InvestmentSettingsOut.model_validate(row)


# ── Portfolio ─────────────────────────────────────────────────────────────────

@router.get("/portfolio/{profile_id}", response_model=PortfolioOut)
def get_portfolio(
    profile_id: int,
    db: Session = Depends(get_db),
) -> PortfolioOut:
    return service.get_portfolio(profile_id, db)
