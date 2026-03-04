"""
Pydantic schemas for the Trade Journal.

TradeOpen       — POST /api/trades
TradeUpdate     — PUT  /api/trades/{id}
TradeClose      — POST /api/trades/{id}/close
TradePartial    — POST /api/trades/{id}/partial
PositionIn      — TP target inside TradeOpen
PositionOut     — position row in responses
TradeOut        — full trade response (includes positions)
TradeListItem   — slim version for the journal list
TradeSizeResult — computed position-size helper (embedded in TradeOut)
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Direction = Literal["long", "short", "LONG", "SHORT"]
OrderType = Literal["MARKET", "LIMIT"]
TradeStatus = Literal["pending", "open", "partial", "closed", "cancelled"]
Period = Literal["daily", "weekly", "monthly"]


# ── Position schemas ───────────────────────────────────────────────────────────

class PositionIn(BaseModel):
    """One TP target supplied when opening a trade (1–4 positions).
    
    position_number is optional: if omitted the backend auto-assigns
    based on list order (1-based).  Kept for backward-compat if a
    caller supplies it explicitly.
    """
    position_number: int | None = Field(default=None, ge=1, le=4)
    take_profit_price: Decimal = Field(..., gt=0)
    lot_percentage: Decimal = Field(..., gt=0, le=100)


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trade_id: int
    position_number: int
    take_profit_price: Decimal
    lot_percentage: Decimal
    status: str
    exit_price: Decimal | None
    exit_date: datetime | None
    realized_pnl: Decimal | None


# ── Trade open ────────────────────────────────────────────────────────────────

class TradeOpen(BaseModel):
    """
    Body for POST /api/trades.

    The backend computes risk_amount, lot_size / units, and potential_profit
    from the profile's capital_current + risk_percentage_default and the
    instrument's tick_value (CFD) or the price distance (Crypto).
    """
    profile_id: int
    instrument_id: int | None = None    # None → free-text pair allowed
    pair: str = Field(..., min_length=1, max_length=20)
    direction: Direction
    order_type: OrderType = "MARKET"    # MARKET → opens as 'open'; LIMIT → opens as 'pending'
    asset_class: str | None = Field(default=None, max_length=50)
    analyzed_timeframe: str | None = Field(default=None, max_length=10)

    entry_price: Decimal = Field(..., gt=0)
    entry_date: datetime | None = None   # if None → backend uses utcnow()
    stop_loss: Decimal = Field(..., gt=0)

    positions: list[PositionIn] = Field(..., min_length=1, max_length=4)

    # Optional overrides — if None the profile default is used
    risk_pct_override: Decimal | None = Field(default=None, gt=0, le=10)

    strategy_id: int | None = None
    session_tag: str | None = Field(default=None, max_length=20)
    notes: str | None = None
    confidence_score: int | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def normalise_and_validate(self) -> TradeOpen:
        """
        1. Normalise direction to lowercase.
        2. Auto-assign position_number if omitted (1-based from list order).
        3. Validate lot_percentage sums to 100.
        4. Validate position_numbers are unique.
        5. Validate SL direction.
        """
        # 1. Normalise direction
        self.direction = self.direction.lower()  # type: ignore[assignment]

        # 2. Auto-assign position_number
        for idx, pos in enumerate(self.positions, start=1):
            if pos.position_number is None:
                pos.position_number = idx

        # 3. Lot sum
        total = sum(p.lot_percentage for p in self.positions)
        if total != Decimal("100"):
            raise ValueError(
                f"lot_percentage across all positions must sum to 100, got {total}."
            )

        # 4. Unique position numbers
        nums = [p.position_number for p in self.positions]
        if len(nums) != len(set(nums)):
            raise ValueError("position_number must be unique across positions.")

        # 5. SL direction
        if self.direction == "long" and self.stop_loss >= self.entry_price:
            raise ValueError("For a long trade, stop_loss must be below entry_price.")
        if self.direction == "short" and self.stop_loss <= self.entry_price:
            raise ValueError("For a short trade, stop_loss must be above entry_price.")

        return self


# ── Trade update ──────────────────────────────────────────────────────────────

class TradeUpdate(BaseModel):
    """
    PUT /api/trades/{id} — partial update, only sent fields are changed.

    Fields available for all non-closed statuses:
        stop_loss, strategy_id, notes, confidence_score, session_tag,
        analyzed_timeframe

    Fields only available for 'pending' trades (LIMIT not yet triggered):
        entry_price — recalculates risk_amount, lot sizes, potential_profit
        amend_positions — replace all TP targets (same validation as TradeOpen)

    The backend will raise 422 if entry_price / amend_positions are sent
    for a trade that is already 'open', 'partial', or 'closed'.
    """
    stop_loss: Decimal | None = Field(default=None, gt=0)
    strategy_id: int | None = None
    notes: str | None = None
    confidence_score: int | None = Field(default=None, ge=0, le=100)
    session_tag: str | None = Field(default=None, max_length=20)
    analyzed_timeframe: str | None = Field(default=None, max_length=10)

    # ── pending-only amendments ───────────────────────────────────────────
    entry_price: Decimal | None = Field(default=None, gt=0)
    amend_positions: list[PositionIn] | None = None   # replaces ALL positions if set


# ── Full close ────────────────────────────────────────────────────────────────

class TradeClose(BaseModel):
    """POST /api/trades/{id}/close — close all remaining open positions."""
    exit_price: Decimal = Field(..., gt=0)
    closed_at: datetime | None = None   # defaults to now()


# ── Partial close ─────────────────────────────────────────────────────────────

class TradePartialClose(BaseModel):
    """POST /api/trades/{id}/partial — close one TP position."""
    position_number: int = Field(..., ge=1, le=3)
    exit_price: Decimal = Field(..., gt=0)
    exit_date: datetime | None = None   # defaults to now()
    move_to_be: bool = False            # if True → SL moves to entry_price


# ── Computed size helper (embedded in TradeOut) ───────────────────────────────

class TradeSizeResult(BaseModel):
    """
    Computed position-size info — returned on open, not stored as a DB column.

    For Crypto:
        units = risk_amount / abs(entry_price - stop_loss)

    For CFD:
        lots  = risk_amount / (abs(entry_price - stop_loss) × tick_value)
        margin_warning = True if capital_current < safe_margin
    """
    risk_amount: Decimal
    units_or_lots: Decimal          # units for Crypto, lots for CFD
    market_type: str                # 'Crypto' or 'CFD'
    margin_warning: bool = False    # CFD only — safe_margin check
    safe_margin: Decimal | None = None   # CFD only


# ── Response schemas ──────────────────────────────────────────────────────────

class TradeOut(BaseModel):
    """Full trade detail — returned after open / close / partial / GET by id."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    instrument_id: int | None
    strategy_id: int | None
    pair: str
    instrument_display_name: str | None = None  # from instrument.display_name, None for free-text pairs
    direction: str
    order_type: str
    asset_class: str | None
    analyzed_timeframe: str | None
    entry_price: Decimal
    entry_date: datetime
    stop_loss: Decimal
    nb_take_profits: int
    risk_amount: Decimal
    potential_profit: Decimal
    current_risk: Decimal | None
    status: str
    realized_pnl: Decimal | None
    session_tag: str | None
    notes: str | None
    confidence_score: int | None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None

    positions: list[PositionOut] = []

    # Computed on open — not stored, re-attached by the service
    size_info: TradeSizeResult | None = None


class TradeListItem(BaseModel):
    """Slim response for GET /api/trades (journal list)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    pair: str
    instrument_display_name: str | None = None  # populated by list_trades service
    direction: str
    order_type: str
    entry_price: Decimal
    entry_date: datetime
    stop_loss: Decimal
    nb_take_profits: int
    risk_amount: Decimal
    potential_profit: Decimal
    current_risk: Decimal | None   # 0 after BE move, None for pending LIMIT orders
    status: str
    realized_pnl: Decimal | None
    # Sum of realized_pnl across all already-closed positions (for partial trades).
    # Equals realized_pnl once the trade is fully closed.
    booked_pnl: Decimal | None = None
    closed_at: datetime | None
    created_at: datetime
