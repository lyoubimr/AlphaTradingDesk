"""
Trade Journal service -- all business logic.

Open trade flow:
  1. Validate profile + instrument (must belong to profile's broker if set)
  2. Compute risk_amount from capital_current x risk_pct
  3. Compute units (Crypto) or lots (CFD) + optional margin warning
  4. Compute potential_profit from best TP x units/lots
  5. Persist Trade + Position rows -- all in one commit

Partial close flow:
  1. Load position by number -- must be 'open'
  2. Compute position PnL: (exit_price - entry_price) x direction_sign x qty
  3. If move_to_be=True -> set SL = entry_price, current_risk = 0
  4. Else -> recalculate current_risk from remaining open positions
  5. trade.status = 'partial'
  6. Commit atomically

Full close flow:
  1. Close all remaining open positions at exit_price
  2. Sum all position PnLs -> trade.realized_pnl
  3. trade.status = 'closed', trade.closed_at = now()
  4. In same transaction:
     a. profile.capital_current += realized_pnl
     b. strategy.trades_count += 1  (if strategy set)
     c. strategy.win_count   += 1  (if PnL > 0)

Capital is ALWAYS updated in the same DB transaction as trade close.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from src.core.models.broker import Instrument, Profile
from src.core.models.trade import Position, Strategy, Trade
from src.trades.schemas import (
    TradeClose,
    TradeOpen,
    TradeOut,
    TradePartialClose,
    TradeSizeResult,
    TradeUpdate,
)

# -- Constants -----------------------------------------------------------------

# CFD: safe_margin = (lots x contract_size x entry_price / max_leverage) x MARGIN_SAFETY_FACTOR
# We flag a warning when capital_current < safe_margin.
MARGIN_SAFETY_FACTOR = Decimal("2.5")
DEFAULT_CFD_CONTRACT_SIZE = Decimal("100000")   # standard lot; overridden by instrument if set
DEFAULT_CFD_MAX_LEVERAGE = 100                  # conservative fallback
DEFAULT_CRYPTO_MAX_LEVERAGE = 10                # conservative fallback


# -- Internal helpers ----------------------------------------------------------

def _get_profile_or_404(db: Session, profile_id: int) -> Profile:
    p = db.query(Profile).filter(Profile.id == profile_id).first()
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile {profile_id} not found.",
        )
    return p


def _get_trade_or_404(db: Session, trade_id: int) -> Trade:
    t = db.query(Trade).filter(Trade.id == trade_id).first()
    if not t:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Trade {trade_id} not found.",
        )
    return t


def _get_instrument_or_422(db: Session, instrument_id: int) -> Instrument:
    inst = db.query(Instrument).filter(Instrument.id == instrument_id).first()
    if not inst:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Instrument {instrument_id} not found.",
        )
    return inst


def _validate_instrument_broker(instrument: Instrument, profile: Profile) -> None:
    """
    If the profile has a broker, the instrument must belong to that same broker.
    This prevents accidentally mixing Kraken instruments with a Vantage profile.
    """
    if profile.broker_id is not None and instrument.broker_id != profile.broker_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Instrument '{instrument.symbol}' belongs to broker {instrument.broker_id}, "
                f"but profile uses broker {profile.broker_id}."
            ),
        )


def _compute_price_distance(entry: Decimal, sl: Decimal) -> Decimal:
    return abs(entry - sl)


def _compute_size_crypto(
    risk_amount: Decimal,
    entry_price: Decimal,
    stop_loss: Decimal,
) -> Decimal:
    """units = risk_amount / |entry_price - stop_loss|"""
    dist = _compute_price_distance(entry_price, stop_loss)
    if dist == 0:
        return Decimal("0")
    return (risk_amount / dist).quantize(Decimal("0.00000001"))


def _compute_size_cfd(
    risk_amount: Decimal,
    entry_price: Decimal,
    stop_loss: Decimal,
    tick_value: Decimal,
) -> Decimal:
    """lots = risk_amount / (|entry_price - stop_loss| x tick_value)"""
    dist = _compute_price_distance(entry_price, stop_loss)
    if dist == 0 or tick_value == 0:
        return Decimal("0")
    return (risk_amount / (dist * tick_value)).quantize(Decimal("0.01"))


def _compute_size_info(
    profile: Profile,
    instrument: Instrument | None,
    data: TradeOpen,
    risk_amount: Decimal,
) -> TradeSizeResult:
    """
    Determine market_type from the profile and dispatch to the right formula.
    Returns a TradeSizeResult with units_or_lots and optional margin_warning.
    """
    market_type = profile.market_type   # 'Crypto' or 'CFD'

    if market_type == "Crypto":
        units = _compute_size_crypto(risk_amount, data.entry_price, data.stop_loss)
        return TradeSizeResult(
            risk_amount=risk_amount,
            units_or_lots=units,
            market_type=market_type,
        )

    # -- CFD ------------------------------------------------------------------
    tick_value = (
        instrument.tick_value
        if instrument and instrument.tick_value
        else Decimal("1")
    )
    lots = _compute_size_cfd(risk_amount, data.entry_price, data.stop_loss, tick_value)

    # Margin check
    max_lev = (
        instrument.max_leverage
        if instrument and instrument.max_leverage
        else DEFAULT_CFD_MAX_LEVERAGE
    )
    safe_margin = (
        lots * DEFAULT_CFD_CONTRACT_SIZE * data.entry_price
        / Decimal(str(max_lev))
        * MARGIN_SAFETY_FACTOR
    ).quantize(Decimal("0.01"))

    margin_warning = profile.capital_current < safe_margin

    return TradeSizeResult(
        risk_amount=risk_amount,
        units_or_lots=lots,
        market_type=market_type,
        margin_warning=margin_warning,
        safe_margin=safe_margin,
    )


def _compute_potential_profit(
    data: TradeOpen,
    size_info: TradeSizeResult,
) -> Decimal:
    """
    Use the best (highest-numbered) TP to estimate max potential profit.
    profit = units_or_lots x |best_tp - entry_price|
    """
    best_tp = max(data.positions, key=lambda p: p.position_number)
    distance = abs(best_tp.take_profit_price - data.entry_price)
    return (size_info.units_or_lots * distance).quantize(Decimal("0.01"))


def _position_pnl(
    trade: Trade,
    position: Position,
    exit_price: Decimal,
) -> Decimal:
    """
    Compute realized PnL for a single position at exit_price.

    pnl = (exit_price - entry_price) x direction_sign x units_per_position
    units_per_position = (risk_amount / price_dist) x (lot_pct / 100)
    """
    price_dist = abs(trade.entry_price - trade.stop_loss)
    if price_dist == 0:
        return Decimal("0")

    total_units = trade.risk_amount / price_dist
    pos_units = total_units * (position.lot_percentage / 100)
    direction_sign = Decimal("1") if trade.direction == "long" else Decimal("-1")
    pnl = (exit_price - trade.entry_price) * direction_sign * pos_units
    return pnl.quantize(Decimal("0.01"))


def _recalculate_current_risk(trade: Trade, db: Session) -> Decimal:
    """
    Sum the remaining risk from all still-open positions.
    current_risk = sum(risk_amount x lot_pct/100) for open positions.
    At BE (stop_loss == entry_price): always 0.
    """
    if trade.stop_loss == trade.entry_price:
        return Decimal("0.00")

    open_positions = [p for p in trade.positions if p.status == "open"]
    if not open_positions:
        return Decimal("0.00")

    total_open_pct = sum(p.lot_percentage for p in open_positions)
    return (trade.risk_amount * total_open_pct / 100).quantize(Decimal("0.01"))


def _attach_size_info(trade: Trade, size_info: TradeSizeResult) -> TradeOut:
    """Build a TradeOut from a Trade ORM object and attach size_info."""
    out = TradeOut.model_validate(trade)
    out.size_info = size_info
    return out


# -- Public service functions --------------------------------------------------

def open_trade(db: Session, data: TradeOpen) -> TradeOut:
    """
    Open a new trade.

    Steps:
    1. Validate profile + optional instrument
    2. Compute risk_amount (capital_current x risk_pct / 100)
    3. Compute units/lots + optional CFD margin warning
    4. Persist Trade + Position rows in one commit
    5. Return TradeOut with size_info attached
    """
    profile = _get_profile_or_404(db, data.profile_id)

    instrument: Instrument | None = None
    if data.instrument_id is not None:
        instrument = _get_instrument_or_422(db, data.instrument_id)
        _validate_instrument_broker(instrument, profile)

    # Determine risk_amount
    risk_pct = data.risk_pct_override or profile.risk_percentage_default
    risk_amount = (profile.capital_current * risk_pct / 100).quantize(Decimal("0.01"))

    size_info = _compute_size_info(profile, instrument, data, risk_amount)
    potential_profit = _compute_potential_profit(data, size_info)

    trade = Trade(
        profile_id=data.profile_id,
        instrument_id=data.instrument_id,
        strategy_id=data.strategy_id,
        pair=data.pair,
        direction=data.direction,
        asset_class=(
            data.asset_class
            or (instrument.asset_class if instrument else None)
        ),
        analyzed_timeframe=data.analyzed_timeframe,
        entry_price=data.entry_price,
        entry_date=data.entry_date,
        stop_loss=data.stop_loss,
        nb_take_profits=len(data.positions),
        risk_amount=risk_amount,
        potential_profit=potential_profit,
        current_risk=risk_amount,   # at open, full risk is in play
        status="open",
        session_tag=data.session_tag,
        notes=data.notes,
        confidence_score=data.confidence_score,
    )
    db.add(trade)
    db.flush()  # get trade.id before adding positions

    for pos_in in data.positions:
        pos = Position(
            trade_id=trade.id,
            position_number=pos_in.position_number,
            take_profit_price=pos_in.take_profit_price,
            lot_percentage=pos_in.lot_percentage,
            status="open",
        )
        db.add(pos)

    db.commit()
    db.refresh(trade)
    return _attach_size_info(trade, size_info)


def list_trades(
    db: Session,
    profile_id: int | None = None,
    trade_status: str | None = None,
    pair: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[Trade]:
    """
    Return trades (most recent first) with optional filters.
    Only valid statuses (open, partial, closed) are stored -- no deleted flag needed.
    """
    q = db.query(Trade)

    if profile_id is not None:
        q = q.filter(Trade.profile_id == profile_id)
    if trade_status is not None:
        q = q.filter(Trade.status == trade_status)
    if pair is not None:
        q = q.filter(Trade.pair.ilike(f"%{pair}%"))

    return (
        q.order_by(Trade.entry_date.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def get_trade(db: Session, trade_id: int) -> Trade:
    return _get_trade_or_404(db, trade_id)


def update_trade(db: Session, trade_id: int, data: TradeUpdate) -> Trade:
    trade = _get_trade_or_404(db, trade_id)

    if trade.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot update a closed trade.",
        )

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(trade, field, value)

    # If SL was moved, recalculate current_risk
    if "stop_loss" in data.model_fields_set:
        trade.current_risk = _recalculate_current_risk(trade, db)

    db.commit()
    db.refresh(trade)
    return trade


def partial_close(db: Session, trade_id: int, data: TradePartialClose) -> Trade:
    """
    Close one TP position.

    1. Find the open position by position_number
    2. Compute PnL for that slice
    3. If move_to_be=True -> SL = entry_price, current_risk = 0
    4. Else -> recalculate current_risk from remaining open positions
    5. trade.status = 'partial'
    6. Commit
    """
    trade = _get_trade_or_404(db, trade_id)

    if trade.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Trade is already fully closed.",
        )

    position = next(
        (p for p in trade.positions if p.position_number == data.position_number),
        None,
    )
    if not position:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Position {data.position_number} not found on trade {trade_id}.",
        )
    if position.status != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Position {data.position_number} is already {position.status}.",
        )

    exit_dt = data.exit_date or datetime.utcnow()
    pnl = _position_pnl(trade, position, data.exit_price)

    position.exit_price = data.exit_price
    position.exit_date = exit_dt
    position.realized_pnl = pnl
    position.status = "closed"

    if data.move_to_be:
        trade.stop_loss = trade.entry_price
        trade.current_risk = Decimal("0.00")
    else:
        trade.current_risk = _recalculate_current_risk(trade, db)

    trade.status = "partial"

    db.commit()
    db.refresh(trade)
    return trade


def full_close(db: Session, trade_id: int, data: TradeClose) -> Trade:
    """
    Fully close a trade.

    1. Close all remaining open positions at exit_price
    2. Sum all position PnLs -> trade.realized_pnl
    3. trade.status = 'closed', trade.closed_at = now()
    4. profile.capital_current += realized_pnl        (same transaction)
    5. strategy stats updated                          (same transaction)
    """
    trade = _get_trade_or_404(db, trade_id)

    if trade.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Trade is already closed.",
        )

    exit_dt = data.closed_at or datetime.utcnow()
    total_pnl = Decimal("0.00")

    for position in trade.positions:
        if position.status == "open":
            pnl = _position_pnl(trade, position, data.exit_price)
            position.exit_price = data.exit_price
            position.exit_date = exit_dt
            position.realized_pnl = pnl
            position.status = "closed"
            total_pnl += pnl
        elif position.realized_pnl is not None:
            # Already closed via partial -- include its PnL in the total
            total_pnl += position.realized_pnl

    trade.realized_pnl = total_pnl.quantize(Decimal("0.01"))
    trade.status = "closed"
    trade.closed_at = exit_dt
    trade.current_risk = Decimal("0.00")

    # -- Atomic capital update -------------------------------------------------
    profile = db.query(Profile).filter(Profile.id == trade.profile_id).first()
    if profile:
        profile.capital_current = (
            profile.capital_current + trade.realized_pnl
        ).quantize(Decimal("0.01"))

    # -- Atomic strategy stats update ------------------------------------------
    if trade.strategy_id:
        strategy = db.query(Strategy).filter(Strategy.id == trade.strategy_id).first()
        if strategy:
            strategy.trades_count += 1
            if trade.realized_pnl > 0:
                strategy.win_count += 1

    db.commit()
    db.refresh(trade)
    return trade


def delete_trade(db: Session, trade_id: int) -> None:
    """
    Delete a trade.

    Open/partial trades are physically deleted (no PnL impact, nothing to preserve).
    Closed trades are rejected -- they are the permanent journal record.
    """
    trade = _get_trade_or_404(db, trade_id)

    if trade.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot delete a closed trade. The journal record must be preserved.",
        )

    db.delete(trade)
    db.commit()
