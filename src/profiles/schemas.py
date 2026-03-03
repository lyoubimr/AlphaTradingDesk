"""
Pydantic schemas for profiles.

ProfileCreate  — body for POST /api/profiles
ProfileUpdate  — body for PUT  /api/profiles/{id}  (all fields optional)
ProfileOut     — response shape (safe to expose)
StrategyCreate — body for POST /api/profiles/{id}/strategies
StrategyOut    — response shape for strategies
"""
from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class ProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    market_type: str = Field(..., pattern="^(CFD|Crypto)$")
    broker_id: int | None = None
    currency: str | None = Field(default=None, max_length=10)
    capital_start: Decimal = Field(..., gt=0)
    risk_percentage_default: Decimal = Field(
        default=Decimal("2.0"), gt=0, le=10
    )
    max_concurrent_risk_pct: Decimal = Field(
        default=Decimal("2.0"), gt=0
    )
    description: str | None = None
    notes: str | None = None


class ProfileUpdate(BaseModel):
    """All fields optional — only provided fields are updated (PATCH semantics)."""
    name: str | None = Field(default=None, min_length=1, max_length=255)
    market_type: str | None = Field(default=None, pattern="^(CFD|Crypto)$")
    broker_id: int | None = None
    currency: str | None = Field(default=None, max_length=10)
    capital_start: Decimal | None = Field(default=None, gt=0)
    capital_current: Decimal | None = Field(default=None, gt=0)
    risk_percentage_default: Decimal | None = Field(default=None, gt=0, le=10)
    max_concurrent_risk_pct: Decimal | None = Field(default=None, gt=0)
    description: str | None = None
    notes: str | None = None
    status: str | None = Field(default=None, pattern="^(active|archived|deleted)$")


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    market_type: str
    broker_id: int | None
    currency: str | None
    capital_start: Decimal
    capital_current: Decimal
    risk_percentage_default: Decimal
    max_concurrent_risk_pct: Decimal
    # Win-rate stats — updated atomically on every trade close
    trades_count: int
    win_count: int
    description: str | None
    notes: str | None
    status: str

# ── Strategy schemas ──────────────────────────────────────────────────────────

class StrategyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    emoji: str | None = Field(default=None, max_length=10)
    color: str | None = Field(default=None, max_length=7)


class StrategyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    name: str
    description: str | None
    emoji: str | None
    color: str | None
    status: str
    trades_count: int
    win_count: int
    min_trades_for_stats: int
