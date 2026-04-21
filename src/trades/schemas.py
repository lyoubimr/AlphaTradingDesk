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
TradeStatus = Literal["pending", "open", "partial", "runner", "closed", "cancelled"]
Period = Literal["daily", "weekly", "monthly"]


# ── Position schemas ───────────────────────────────────────────────────────────


class PositionIn(BaseModel):
    """One TP target supplied when opening a trade (1–4 positions).

    position_number is optional: if omitted the backend auto-assigns
    based on list order (1-based).  Kept for backward-compat if a
    caller supplies it explicitly.

    For runner positions (is_runner=True):
      - take_profit_price is None (trailing stop — no fixed exit price)
      - Must be the last position in the list (highest position_number)
    """

    position_number: int | None = Field(default=None, ge=1, le=4)
    # None when is_runner=True (trailing stop — Kraken handles the exit price)
    take_profit_price: Decimal | None = Field(default=None, gt=0)
    lot_percentage: Decimal = Field(..., gt=0, le=100)
    is_runner: bool = False


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trade_id: int
    position_number: int
    take_profit_price: Decimal | None
    lot_percentage: Decimal
    is_runner: bool
    status: str
    # tp_hit=True  → closed at take_profit_price (real TP hit)
    # tp_hit=False → closed early via full_close before reaching TP
    tp_hit: bool = False
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
    instrument_id: int | None = None  # None → free-text pair allowed
    pair: str = Field(..., min_length=1, max_length=20)
    direction: Direction
    order_type: OrderType = "MARKET"  # MARKET → opens as 'open'; LIMIT → opens as 'pending'
    asset_class: str | None = Field(default=None, max_length=50)
    analyzed_timeframe: str | None = Field(default=None, max_length=10)

    entry_price: Decimal = Field(..., gt=0)
    entry_date: datetime | None = None  # if None → backend uses utcnow()
    stop_loss: Decimal = Field(..., gt=0)

    positions: list[PositionIn] = Field(..., min_length=1, max_length=4)

    # Optional overrides — if None the profile default is used
    risk_pct_override: Decimal | None = Field(default=None, gt=0, le=10)

    # Crypto position sizing — entered by the user in the form
    leverage: Decimal | None = Field(default=None, gt=0)  # actual leverage used
    margin_used: Decimal | None = Field(default=None, gt=0)  # actual margin deposited

    # Phase 3 — Dynamic Risk
    # force=True: override budget block (only honoured if risk_guard.force_allowed=True)
    force: bool = False
    # Risk Advisor breakdown captured at the moment of trade open (optional)
    dynamic_risk_snapshot: dict | None = None

    strategy_id: int | None = None
    # Multi-strategy: list of strategy IDs linked via trade_strategies table.
    # If strategy_ids is set and non-empty, strategy_id is auto-set to strategy_ids[0]
    # for backward compat with single-strategy code.
    # If only strategy_id is set (legacy), it is treated as strategy_ids=[strategy_id].
    strategy_ids: list[int] = Field(default_factory=list)
    session_tag: str | None = Field(default=None, max_length=20)
    notes: str | None = None
    confidence_score: int | None = Field(default=None, ge=0, le=100)
    entry_screenshot_urls: list[str] | None = None
    # When True and automation_enabled, ATD automatically moves SL to break-even on TP1 fill.
    be_on_tp1: bool = False
    # Runner (trailing stop as last TP) — if set, the last position must have is_runner=True.
    # This value is stored on the trade and used when placing the trailing stop order.
    # If None, the profile's runner_trailing_pct_default (from automation_settings) is used.
    runner_trailing_pct: Decimal | None = Field(default=None, gt=0, le=50)

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
            raise ValueError(f"lot_percentage across all positions must sum to 100, got {total}.")

        # 4. Unique position numbers
        nums = [p.position_number for p in self.positions]
        if len(nums) != len(set(nums)):
            raise ValueError("position_number must be unique across positions.")

        # 5. SL direction
        if self.direction == "long" and self.stop_loss >= self.entry_price:
            raise ValueError("For a long trade, stop_loss must be below entry_price.")
        if self.direction == "short" and self.stop_loss <= self.entry_price:
            raise ValueError("For a short trade, stop_loss must be above entry_price.")

        # 6. Runner validation
        runner_positions = [p for p in self.positions if p.is_runner]
        if len(runner_positions) > 1:
            raise ValueError("Only one runner position is allowed per trade.")
        if runner_positions:
            runner = runner_positions[0]
            # Runner must be the last position (highest position_number)
            max_pos_num = max(p.position_number for p in self.positions)  # type: ignore[type-var]
            if runner.position_number != max_pos_num:
                raise ValueError("The runner position must be the last position (highest position_number).")
            if runner.take_profit_price is not None:
                raise ValueError("Runner position must not have a take_profit_price (it uses a trailing stop).")
        else:
            # Non-runner positions must all have a take_profit_price
            for p in self.positions:
                if p.take_profit_price is None:
                    raise ValueError("take_profit_price is required for non-runner positions.")

        # 6. Normalise strategy_ids — if only strategy_id set, promote it
        if not self.strategy_ids and self.strategy_id is not None:
            self.strategy_ids = [self.strategy_id]
        elif self.strategy_ids and self.strategy_id is None:
            self.strategy_id = self.strategy_ids[0]

        return self


# ── Trade update ──────────────────────────────────────────────────────────────


class TradeUpdate(BaseModel):
    """
    PUT /api/trades/{id} — partial update, only sent fields are changed.

    Fields available for all non-closed statuses:
        stop_loss, strategy_id, notes, confidence_score, session_tag,
        analyzed_timeframe, entry_screenshot_urls,
        leverage, margin_used (CFD/Crypto — corrects stored values)

    Fields available for ALL statuses (including closed!):
        close_notes, close_screenshot_urls
        (post-trade review — always editable)

    Fields only available for 'pending' trades (LIMIT not yet triggered):
        entry_price — recalculates risk_amount, lot sizes, potential_profit
        amend_positions — replace all TP targets (same validation as TradeOpen)

    The backend will raise 422 if entry_price / amend_positions are sent
    for a trade that is already 'open', 'partial', or 'closed'.
    """

    stop_loss: Decimal | None = Field(default=None, gt=0)
    strategy_id: int | None = None
    # Replace the full list of linked strategies (empty list = remove all)
    # If provided (even empty), overrides the current trade_strategies links.
    strategy_ids: list[int] | None = None
    notes: str | None = None
    confidence_score: int | None = Field(default=None, ge=0, le=100)
    session_tag: str | None = Field(default=None, max_length=20)
    analyzed_timeframe: str | None = Field(default=None, max_length=10)
    entry_screenshot_urls: list[str] | None = None

    # Post-trade review — editable on closed trades too
    close_notes: str | None = None
    close_screenshot_urls: list[str] | None = None

    # ── CFD/Crypto fields — editable on open/partial trades ──────────────
    leverage: Decimal | None = Field(default=None, gt=0)
    margin_used: Decimal | None = Field(default=None, gt=0)

    # ── runner trailing stop — editable while runner not yet activated ─────
    # Allowed on pending / open / partial as long as runner_activated_at is NULL.
    runner_trailing_pct: Decimal | None = Field(default=None, gt=0, le=50)

    # ── pending-only amendments ───────────────────────────────────────────
    entry_price: Decimal | None = Field(default=None, gt=0)
    amend_positions: list[PositionIn] | None = None  # replaces ALL positions if set


# ── Full close ────────────────────────────────────────────────────────────────


class TradeClose(BaseModel):
    """POST /api/trades/{id}/close — close all remaining open positions."""

    exit_price: Decimal = Field(..., gt=0)
    closed_at: datetime | None = None  # defaults to now()
    close_notes: str | None = None
    close_screenshot_urls: list[str] | None = None


# ── Partial close ─────────────────────────────────────────────────────────────


class TradePartialClose(BaseModel):
    """POST /api/trades/{id}/partial — close one TP position."""

    position_number: int = Field(..., ge=1, le=3)
    exit_price: Decimal = Field(..., gt=0)
    exit_date: datetime | None = None  # defaults to now()
    move_to_be: bool = False  # if True → SL moves to entry_price


# ── Post-trade review ────────────────────────────────────────────────────────

Outcome = Literal["poor", "could_do_better", "well_executed", "excellent"]


class PostTradeReviewIn(BaseModel):
    """PUT /api/trades/{id}/review — save (or clear) a post-trade review."""

    outcome: Outcome | None = None
    tags: list[str] = Field(default_factory=list)
    note: str | None = None


# ── Computed size helper (embedded in TradeOut) ───────────────────────────────


class TradeSizeResult(BaseModel):
    """
    Computed position-size info — returned on open, not stored as a DB column.

    For Crypto:
        units = risk_amount / abs(entry_price - stop_loss)
        notional = units x entry_price

    For CFD:
        lots  = risk_amount / (abs(entry_price - stop_loss) × tick_value)
        margin_warning = True if capital_current < safe_margin
        leverage = notional / safe_margin * MARGIN_SAFETY_FACTOR
    """

    risk_amount: Decimal
    units_or_lots: Decimal  # units for Crypto, lots for CFD
    market_type: str  # 'Crypto' or 'CFD'
    notional: Decimal | None = None  # position size in USD (Crypto: units × entry)
    leverage: Decimal | None = None  # max leverage from instrument config
    margin_required: Decimal | None = None  # notional / leverage — actual margin to deposit
    safe_margin: Decimal | None = None  # margin_required × MARGIN_SAFETY_FACTOR — recommended buffer
    liq_price: Decimal | None = None  # estimated liquidation price
    margin_warning: bool = False  # True when capital_current < safe_margin


# ── Response schemas ──────────────────────────────────────────────────────────


class TradeOut(BaseModel):
    """Full trade detail — returned after open / close / partial / GET by id."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    instrument_id: int | None
    strategy_id: int | None
    # All strategy IDs linked to this trade (via trade_strategies junction table)
    # Populated by the service — not directly from the ORM model_validate.
    strategy_ids: list[int] = Field(default_factory=list)
    pair: str
    instrument_display_name: str | None = (
        None  # from instrument.display_name, None for free-text pairs
    )
    direction: str  # always uppercased by model_post_init → 'LONG' | 'SHORT'
    order_type: str
    asset_class: str | None
    analyzed_timeframe: str | None
    entry_price: Decimal
    entry_date: datetime
    stop_loss: Decimal
    # initial_stop_loss = original SL at trade open (never changes after BE move)
    initial_stop_loss: Decimal
    nb_take_profits: int
    risk_amount: Decimal
    potential_profit: Decimal
    current_risk: Decimal | None
    status: str
    realized_pnl: Decimal | None
    # Sum of realized_pnl from already-closed positions (partial trades).
    # Populated by _trade_to_out — not a DB column.
    booked_pnl: Decimal | None = None
    # Weighted-average exit price of closed positions — populated by _trade_to_out.
    # For SL hits all positions share same price; for multi-TP it's lot-weighted avg.
    exit_price: Decimal | None = None
    session_tag: str | None
    notes: str | None
    confidence_score: int | None
    dynamic_risk_snapshot: dict | None = None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None

    # Snapshots + post-trade review (editable even after close)
    entry_screenshot_urls: list[str] | None = None
    close_notes: str | None = None
    close_screenshot_urls: list[str] | None = None
    post_trade_review: dict | None = None

    positions: list[PositionOut] = []

    # CFD/Crypto specifics — stored, exposed for display and edit
    leverage: Decimal | None = None
    margin_used: Decimal | None = None

    # Computed on open — not stored, re-attached by the service
    size_info: TradeSizeResult | None = None

    # True when this trade has an active automation workflow on Kraken
    automation_enabled: bool = False
    # Auto move SL to BE on TP1 fill
    be_on_tp1: bool = False
    # Runner trailing stop — set when a runner position exists
    runner_trailing_pct: Decimal | None = None
    runner_activated_at: datetime | None = None
    # True when the post-trade review is complete (computed by _trade_to_out)
    is_reviewed: bool = False

    @model_validator(mode="after")
    def normalise_direction_out(self) -> TradeOut:
        """Guarantee direction is always uppercase in API responses.

        The DB stores 'long' / 'short' (normalised at write time).
        All frontend comparisons rely on 'LONG' / 'SHORT', so we
        normalise here once instead of scattering .toUpperCase() on the client.
        """
        self.direction = self.direction.upper()
        return self


class TradeListItem(BaseModel):
    """Slim response for GET /api/trades (journal list)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    profile_id: int
    pair: str
    instrument_display_name: str | None = None  # populated by list_trades service
    direction: str  # always uppercased by model_post_init → 'LONG' | 'SHORT'
    order_type: str
    strategy_id: int | None = None
    # All strategy IDs linked (populated by service, not ORM validate)
    strategy_ids: list[int] = Field(default_factory=list)
    entry_price: Decimal
    entry_date: datetime
    stop_loss: Decimal
    # initial_stop_loss = original SL at trade open — used for PnL preview on frontend
    initial_stop_loss: Decimal
    nb_take_profits: int
    risk_amount: Decimal
    potential_profit: Decimal
    current_risk: Decimal | None  # 0 after BE move, None for pending LIMIT orders
    status: str
    realized_pnl: Decimal | None
    # Sum of realized_pnl across all already-closed positions (for partial trades).
    # Equals realized_pnl once the trade is fully closed.
    booked_pnl: Decimal | None = None
    # Weighted-average exit price of closed positions (populated by service).
    # For SL hits all positions share same price. For multi-TP it's lot-weighted avg.
    exit_price: Decimal | None = None
    closed_at: datetime | None
    created_at: datetime

    # ── Computed flags (not DB columns — set by list_trades service) ──────────
    # True when current_risk == 0 and trade is open/partial (SL moved to BE)
    is_be: bool = False
    # True when at least one KrakenOrder row exists for this trade
    has_kraken_orders: bool = False
    # True when the trade entry was placed through Kraken automation
    automation_enabled: bool = False
    # Auto move SL to BE on TP1 fill
    be_on_tp1: bool = False
    # True when the post-trade review is considered complete:
    #   outcome set + non-empty close_notes + ≥1 close screenshot + ≥1 non-strategy tag
    is_reviewed: bool = False
    # Position numbers (1-based) where tp_hit=True — excludes runners.
    # Empty for not-yet-closed trades, SL hits, and full-close exits.
    tp_hits: list[int] = Field(default_factory=list)

    @model_validator(mode="after")
    def normalise_direction_list(self) -> TradeListItem:
        """Guarantee direction is always uppercase in API responses.

        The DB stores 'long' / 'short' (normalised at write time).
        All frontend comparisons rely on 'LONG' / 'SHORT'.
        """
        self.direction = self.direction.upper()
        return self
