"""
Pydantic schemas for brokers and instruments (read-only — reference data).
"""
from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict


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
