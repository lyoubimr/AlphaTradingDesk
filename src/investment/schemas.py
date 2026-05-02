"""
Phase 7 — Pydantic schemas for the Investment & Spot module.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

# ── Spot Trades ───────────────────────────────────────────────────────────────

class TpTarget(BaseModel):
    price: Decimal = Field(..., gt=0)
    pct_allocation: Decimal = Field(..., gt=0, le=100)


class SpotTradeCreate(BaseModel):
    pair: str = Field(..., min_length=1, max_length=30)
    asset_class: str | None = None
    analyzed_timeframe: str | None = None
    order_type: str = Field(default="MARKET", pattern="^(MARKET|LIMIT)$")
    entry_price: Decimal = Field(..., gt=0)
    quantity: Decimal = Field(..., gt=0)
    entry_date: datetime.datetime | None = None
    # SL is optional — an optional guard, not required
    stop_loss: Decimal | None = None
    nb_take_profits: int = Field(default=1, ge=0, le=3)
    tp_targets: list[TpTarget] = Field(default_factory=list)
    market_vi_at_entry: Decimal | None = None
    pair_vi_at_entry: Decimal | None = None
    confidence_score: Decimal | None = None
    session_tag: str | None = None
    notes: str | None = None
    strategy_id: int | None = None
    instrument_id: int | None = None
    parent_spot_trade_id: int | None = None


class SpotTradeUpdate(BaseModel):
    """All fields optional — PATCH semantics."""
    stop_loss: Decimal | None = None
    nb_take_profits: int | None = Field(default=None, ge=0, le=3)
    tp_targets: list[TpTarget] | None = None
    notes: str | None = None
    structured_notes: dict | None = None
    confidence_score: Decimal | None = None
    session_tag: str | None = None
    status: str | None = Field(
        default=None,
        pattern="^(pending|open|partial|runner|closed|cancelled)$",
    )


class SpotTradeClose(BaseModel):
    exit_price: Decimal = Field(..., gt=0)
    closed_at: datetime.datetime | None = None


class SpotTradeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    parent_spot_trade_id: int | None
    strategy_id: int | None
    instrument_id: int | None
    pair: str
    asset_class: str | None
    analyzed_timeframe: str | None
    order_type: str
    status: str
    entry_price: Decimal
    quantity: Decimal
    total_cost: Decimal | None
    entry_date: datetime.datetime | None
    stop_loss: Decimal | None
    nb_take_profits: int
    tp_targets: list
    exit_price: Decimal | None
    realized_pnl: Decimal | None
    closed_at: datetime.datetime | None
    market_vi_at_entry: Decimal | None
    pair_vi_at_entry: Decimal | None
    confidence_score: Decimal | None
    session_tag: str | None
    notes: str | None
    screenshot_urls: list
    created_at: datetime.datetime
    updated_at: datetime.datetime


# ── Deposits ──────────────────────────────────────────────────────────────────

class DepositCreate(BaseModel):
    amount: Decimal = Field(
        ..., description="Positive = deposit (capital in), negative = withdrawal"
    )
    deposit_date: datetime.date
    label: str | None = Field(default=None, max_length=100)
    is_recurrent: bool = False
    notes: str | None = None


class DepositUpdate(BaseModel):
    amount: Decimal | None = None
    deposit_date: datetime.date | None = None
    label: str | None = Field(default=None, max_length=100)
    notes: str | None = None


class DepositOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    amount: Decimal
    deposit_date: datetime.date
    label: str | None
    is_recurrent: bool
    notes: str | None
    created_at: datetime.datetime


# ── Investment Settings ───────────────────────────────────────────────────────

class InvestmentSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    profile_id: int
    config: dict
    updated_at: datetime.datetime


class InvestmentSettingsUpdateIn(BaseModel):
    config: dict


# ── Portfolio ─────────────────────────────────────────────────────────────────

class PositionSummary(BaseModel):
    pair: str
    quantity: Decimal
    entry_price: Decimal
    total_cost: Decimal | None
    current_price: Decimal | None = None
    unrealized_pnl: Decimal | None = None
    unrealized_pnl_pct: Decimal | None = None
    stop_loss: Decimal | None
    nb_take_profits: int


class PortfolioOut(BaseModel):
    profile_id: int
    capital_start: Decimal
    capital_current: Decimal
    total_deposited: Decimal
    total_realized_pnl: Decimal
    open_positions_count: int
    open_positions: list[PositionSummary]
    last_price_refresh: datetime.datetime | None = None
