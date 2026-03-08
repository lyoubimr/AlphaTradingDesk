"""
Pydantic schemas for brokers, instruments, and trading styles (read-only reference data).
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class TradingStyleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    display_name: str
    default_timeframes: str | None
    description: str | None
    sort_order: int


class InstrumentCreate(BaseModel):
    """Body for POST /api/brokers/{id}/instruments — add a custom instrument."""

    symbol: str = Field(..., min_length=1, max_length=30)
    display_name: str = Field(..., min_length=1, max_length=100)
    asset_class: str = Field(..., min_length=1, max_length=50)
    base_currency: str | None = Field(default=None, max_length=10)
    quote_currency: str | None = Field(default=None, max_length=10)
    pip_size: Decimal | None = Field(default=None, gt=0)
    tick_value: Decimal | None = Field(default=None, gt=0)
    min_lot: Decimal | None = Field(default=None, gt=0)
    max_leverage: int | None = Field(default=None, gt=0)


class InstrumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    display_name: str
    asset_class: str
    base_currency: str | None
    quote_currency: str | None
    pip_size: Decimal | None
    tick_value: Decimal | None
    min_lot: Decimal | None
    max_leverage: int | None
    is_active: bool


class BrokerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    market_type: str
    default_currency: str
    is_predefined: bool
    status: str
