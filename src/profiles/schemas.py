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
    risk_percentage_default: Decimal = Field(default=Decimal("2.0"), gt=0, le=10)
    max_concurrent_risk_pct: Decimal = Field(default=Decimal("2.0"), gt=0)
    min_pnl_pct_for_stats: Decimal = Field(
        default=Decimal("0.100"),
        ge=0,
        le=100,
        description="Trades with abs(pnl%) below this threshold are excluded from WR stats.",
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
    min_pnl_pct_for_stats: Decimal | None = Field(default=None, ge=0, le=100)
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
    # WR counting threshold — global for this profile
    min_pnl_pct_for_stats: Decimal
    description: str | None
    notes: str | None
    status: str


# ── Strategy schemas ──────────────────────────────────────────────────────────


class StrategyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    rules: str | None = None
    emoji: str | None = Field(default=None, max_length=10)
    color: str | None = Field(default=None, max_length=7)
    image_url: str | None = Field(
        default=None,
        max_length=500,
        description="Direct URL to strategy chart/screenshot. Upload support in Phase 2+.",
    )


class StrategyUpdate(BaseModel):
    """All fields optional — PATCH semantics."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    rules: str | None = None
    emoji: str | None = Field(default=None, max_length=10)
    color: str | None = Field(default=None, max_length=7)
    image_url: str | None = Field(default=None, max_length=500)
    min_trades_for_stats: int | None = Field(default=None, ge=1)
    status: str | None = Field(default=None, pattern="^(active|archived)$")


class StrategyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    # NULL = global strategy (shared across all profiles)
    # NOT NULL = profile-specific strategy
    profile_id: int | None
    name: str
    description: str | None
    rules: str | None
    emoji: str | None
    color: str | None
    image_url: str | None
    status: str
    trades_count: int
    win_count: int
    min_trades_for_stats: int
