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
     b. BE filter: pnl_pct = realized_pnl / risk_amount * 100
        - If abs(pnl_pct) < profile.min_pnl_pct_for_stats → BREAKEVEN → no stats updated
     c. profile.trades_count += 1  (if not BE)
     d. profile.win_count    += 1  (if pnl_pct > 0 and not BE)
     e. ALL linked strategies (via trade_strategies) get trades_count/win_count updated

Capital is ALWAYS updated in the same DB transaction as trade close.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import update as sa_update
from sqlalchemy.orm import Session, joinedload

from src.core.models.broker import Instrument, Profile
from src.core.models.trade import Position, Strategy, Trade, TradeStrategy
from src.kraken_execution.models import KrakenOrder
from src.risk_management.defaults import DEFAULT_RISK_CONFIG
from src.risk_management.engine import _deep_merge
from src.risk_management.service import get_risk_budget, get_risk_settings
from src.trades.schemas import (
    PositionIn,
    TradeClose,
    TradeListItem,
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
DEFAULT_CFD_CONTRACT_SIZE = Decimal("100000")  # standard lot; overridden by instrument if set
DEFAULT_CFD_MAX_LEVERAGE = 100  # conservative fallback
DEFAULT_CRYPTO_MAX_LEVERAGE = 10  # conservative fallback

logger = logging.getLogger(__name__)


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
    t = (
        db.query(Trade)
        .options(joinedload(Trade.instrument), joinedload(Trade.positions))
        .filter(Trade.id == trade_id)
        .first()
    )
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


def _price_quant(price: Decimal) -> Decimal:
    """Return a quantize string adapted to the price magnitude.
    BTC 95000 → 0.01 | ETH 3200 → 0.01 | XRP 0.55 → 0.0001 | SHIB 0.000012 → 0.00000001
    """
    if price >= 100:
        return Decimal("0.01")
    if price >= 1:
        return Decimal("0.0001")
    if price >= Decimal("0.01"):
        return Decimal("0.000001")
    return Decimal("0.00000001")


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
    market_type = profile.market_type  # 'Crypto' or 'CFD'

    direction = data.direction.lower()

    if market_type == "Crypto":
        units = _compute_size_crypto(risk_amount, data.entry_price, data.stop_loss)
        notional = (units * data.entry_price).quantize(Decimal("0.01"))
        max_lev_crypto = instrument.max_leverage if instrument and instrument.max_leverage else None
        if max_lev_crypto:
            lev = Decimal(str(max_lev_crypto))
            margin_required = (notional / lev).quantize(Decimal("0.01"))
            safe_margin = (margin_required * MARGIN_SAFETY_FACTOR).quantize(Decimal("0.01"))
            margin_warning = profile.capital_current < safe_margin
            if direction == "long":
                liq_price = (data.entry_price * (1 - 1 / lev)).quantize(_price_quant(data.entry_price))
            else:
                liq_price = (data.entry_price * (1 + 1 / lev)).quantize(_price_quant(data.entry_price))
        else:
            margin_required = None
            safe_margin = None
            margin_warning = False
            liq_price = None
        return TradeSizeResult(
            risk_amount=risk_amount,
            units_or_lots=units,
            market_type=market_type,
            notional=notional,
            leverage=Decimal(str(max_lev_crypto)) if max_lev_crypto else None,
            margin_required=margin_required,
            safe_margin=safe_margin,
            liq_price=liq_price,
            margin_warning=margin_warning,
        )

    # -- CFD ------------------------------------------------------------------
    tick_value = instrument.tick_value if instrument and instrument.tick_value else Decimal("1")
    lots = _compute_size_cfd(risk_amount, data.entry_price, data.stop_loss, tick_value)

    max_lev = (
        instrument.max_leverage
        if instrument and instrument.max_leverage
        else DEFAULT_CFD_MAX_LEVERAGE
    )
    lev_cfd = Decimal(str(max_lev))
    notional_cfd = (lots * DEFAULT_CFD_CONTRACT_SIZE * data.entry_price).quantize(Decimal("0.01"))
    margin_required_cfd = (notional_cfd / lev_cfd).quantize(Decimal("0.01"))
    safe_margin = (margin_required_cfd * MARGIN_SAFETY_FACTOR).quantize(Decimal("0.01"))
    margin_warning = profile.capital_current < safe_margin
    if direction == "long":
        liq_price = (data.entry_price * (1 - 1 / lev_cfd)).quantize(_price_quant(data.entry_price))
    else:
        liq_price = (data.entry_price * (1 + 1 / lev_cfd)).quantize(_price_quant(data.entry_price))

    return TradeSizeResult(
        risk_amount=risk_amount,
        units_or_lots=lots,
        market_type=market_type,
        notional=notional_cfd,
        leverage=lev_cfd,
        margin_required=margin_required_cfd,
        safe_margin=safe_margin,
        liq_price=liq_price,
        margin_warning=margin_warning,
    )


def _compute_potential_profit(
    data: TradeOpen,
    size_info: TradeSizeResult,
) -> Decimal:
    """
    Use the best (highest-numbered) TP to estimate max potential profit.
    profit = units_or_lots x |best_tp - entry_price|
    """
    best_tp = max(data.positions, key=lambda p: (p.position_number or 0))
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
    units_per_position = (risk_amount / initial_price_dist) x (lot_pct / 100)

    Uses initial_stop_loss (never changes) instead of current stop_loss
    so that PnL is always correct even after the SL is moved to BE.
    If initial_stop_loss is somehow unavailable (legacy rows backfilled at
    entry_price), fall back to stop_loss to avoid a zero-division crash.
    """
    # Prefer initial_stop_loss; fall back to stop_loss for safety
    reference_sl = (
        trade.initial_stop_loss
        if hasattr(trade, "initial_stop_loss") and trade.initial_stop_loss is not None
        else trade.stop_loss
    )
    price_dist = abs(trade.entry_price - reference_sl)
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


def _trade_to_out(trade: Trade, size_info: TradeSizeResult | None = None) -> TradeOut:
    """
    Convert a Trade ORM object to a TradeOut schema.
    Resolves instrument_display_name from the instrument relationship if loaded.
    Also computes booked_pnl (sum of closed-position PnLs) so the detail page
    can show already-booked PnL for partial trades — same logic as list_trades.
    """
    out = TradeOut.model_validate(trade)
    # Populate display name — trade.instrument must be eagerly loaded before calling this.
    if trade.instrument is not None:
        out.instrument_display_name = trade.instrument.display_name
    if size_info is not None:
        out.size_info = size_info
    # Compute booked_pnl from closed positions (populated for partial + closed trades)
    booked = sum(
        (p.realized_pnl for p in trade.positions if p.realized_pnl is not None),
        Decimal("0.00"),
    )
    out.booked_pnl = booked if booked != Decimal("0.00") else None
    # Compute exit_price: lot-percentage weighted average of closed positions' exit prices
    closed_pos = [p for p in trade.positions if p.status == "closed" and p.exit_price is not None]
    if closed_pos:
        total_pct = sum((Decimal(str(p.lot_percentage)) for p in closed_pos), Decimal("0"))
        if total_pct > 0:
            out.exit_price = (
                sum(
                    (Decimal(str(p.exit_price)) * Decimal(str(p.lot_percentage)) for p in closed_pos),
                    Decimal("0"),
                )
                / total_pct
            ).quantize(Decimal("0.00000001"))
    return out


def _reload_and_out(
    db: Session, trade_id: int, size_info: TradeSizeResult | None = None
) -> TradeOut:
    """
    Reload a trade fresh from DB with joinedload (instrument + positions),
    then convert to TradeOut. Use this after any commit() to ensure the
    instrument relationship is populated (avoids post-commit lazy-load failures).
    Also populates strategy_ids from trade_strategies junction table.
    """
    trade = _get_trade_or_404(db, trade_id)
    out = _trade_to_out(trade, size_info)
    _populate_strategy_ids(out, db)
    return out


def _attach_size_info(trade: Trade, size_info: TradeSizeResult) -> TradeOut:
    """Build a TradeOut from a Trade ORM object and attach size_info."""
    return _trade_to_out(trade, size_info)


def _sync_trade_strategies(db: Session, trade: Trade, strategy_ids: list[int]) -> None:
    """
    Replace the full set of trade_strategies links for a trade.

    - Validates each strategy_id exists in DB.
    - Deletes all existing links then inserts the new set.
    - Also keeps trade.strategy_id = strategy_ids[0] (compat with single-strategy FK).
    - strategy_ids=[] removes all links and sets strategy_id = None.
    """
    # Validate all IDs exist
    if strategy_ids:
        found = (
            db.query(Strategy.id)
            .filter(Strategy.id.in_(strategy_ids), Strategy.status == "active")
            .all()
        )
        found_ids = {r[0] for r in found}
        missing = set(strategy_ids) - found_ids
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Strategy IDs not found or not active: {sorted(missing)}",
            )

    # Delete existing links
    db.query(TradeStrategy).filter(TradeStrategy.trade_id == trade.id).delete()

    # Insert new links
    for sid in strategy_ids:
        db.add(TradeStrategy(trade_id=trade.id, strategy_id=sid))

    # Keep FK in sync (first strategy = primary)
    trade.strategy_id = strategy_ids[0] if strategy_ids else None


def _populate_strategy_ids(out: TradeOut | TradeListItem, db: Session) -> None:
    """Fetch strategy_ids from trade_strategies and attach to the schema output."""
    rows = (
        db.query(TradeStrategy.strategy_id)
        .filter(TradeStrategy.trade_id == out.id)
        .order_by(TradeStrategy.id)
        .all()
    )
    out.strategy_ids = [r[0] for r in rows]


def _update_wr_stats(db: Session, trade: Trade, profile: Profile) -> None:
    """
    Update win-rate stats on the profile + ALL linked strategies atomically.

    BE filter (profile-level):
      - Compute pnl_r = realized_pnl / risk_amount  (R-multiple, e.g. -0.13R)
        (risk_amount is the capital at risk for this trade — always > 0 for real trades)
      - If abs(pnl_r) < profile.min_pnl_pct_for_stats → BREAK-EVEN trade
        → excluded from BOTH trades_count AND win_count on all targets (profile + strategies).
        Example: threshold=0.2, risked $10 → any close within ±$2 is treated as BE.
      - Otherwise → trades_count += 1 everywhere.
        win_count += 1 only where pnl_r > 0 (pure win, not BE).

    Strategy scope:
      - We update ALL strategies linked via trade_strategies junction table,
        NOT just the legacy single-FK trade.strategy_id.
    """
    # Compute R-multiple: realized_pnl expressed as a fraction of risk_amount.
    # e.g. -$1.69 on $12.75 risk = -0.133R
    # realized_pnl is set by the close flow before this helper is called — never None here.
    realized_pnl: Decimal = trade.realized_pnl or Decimal("0")

    if trade.risk_amount and trade.risk_amount > 0:
        pnl_r = (realized_pnl / trade.risk_amount).quantize(Decimal("0.001"))
    else:
        # Edge case: risk_amount is 0 (should not happen for real trades).
        # Fall back to raw PnL sign — at least profile WR won't be wrong.
        pnl_r = Decimal("1") if realized_pnl > 0 else (
            Decimal("-1") if realized_pnl < 0 else Decimal("0")
        )

    be_threshold = profile.min_pnl_pct_for_stats  # stored as R, e.g. 0.200

    # BE trade — skip entirely, zero impact on WR
    if abs(pnl_r) < be_threshold:
        return

    is_win = pnl_r > 0

    # ── Profile stats ────────────────────────────────────────────────────
    profile.trades_count += 1
    if is_win:
        profile.win_count += 1

    # ── All linked strategies ────────────────────────────────────────────
    # Fetch all strategy IDs from the junction table (many-to-many).
    rows = (
        db.query(TradeStrategy.strategy_id)
        .filter(TradeStrategy.trade_id == trade.id)
        .all()
    )
    linked_ids = [r[0] for r in rows]

    if linked_ids:
        strategies = (
            db.query(Strategy)
            .filter(Strategy.id.in_(linked_ids))
            .all()
        )
        for strategy in strategies:
            strategy.trades_count += 1
            if is_win:
                strategy.win_count += 1


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

    # Validate leverage cap
    if (
        data.leverage is not None
        and instrument is not None
        and instrument.max_leverage is not None
        and data.leverage > instrument.max_leverage
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Leverage {data.leverage}× exceeds the maximum allowed for this instrument ({instrument.max_leverage}×).",
        )

    # Determine risk_amount
    risk_pct = data.risk_pct_override or profile.risk_percentage_default
    risk_amount = (profile.capital_current * risk_pct / 100).quantize(Decimal("0.01"))

    # ── P3-7 Risk Guard ─────────────────────────────────────────────────────────
    # Guard applies to the effective risk amount regardless of the path
    # (base default, override, or Advisor-adjusted value).
    # Only skipped for LIMIT/pending orders (budget not yet consumed).
    if data.order_type != "LIMIT":
        settings = get_risk_settings(data.profile_id, db)
        guard_config = _deep_merge(DEFAULT_RISK_CONFIG, settings.config).get("risk_guard", {})
        guard_enabled: bool = bool(guard_config.get("enabled", True))
        if guard_enabled:
            budget = get_risk_budget(data.profile_id, db)
            effective_risk_pct = float(risk_pct)
            if effective_risk_pct > budget["budget_remaining_pct"]:
                force_allowed: bool = budget["force_allowed"]
                if not data.force or not force_allowed:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail={
                            "detail": (
                                f"Insufficient risk budget. "
                                f"Remaining: {budget['budget_remaining_pct']:.2f}%, "
                                f"requested: {effective_risk_pct:.2f}%. "
                                f"Use force=true to override."
                            ),
                            "code": "RISK_BUDGET_EXCEEDED",
                            "budget_remaining_pct": budget["budget_remaining_pct"],
                            "effective_risk_pct": effective_risk_pct,
                            "force_allowed": force_allowed,
                        },
                    )
                logger.warning(
                    "open_trade: Risk Guard bypassed via force=True "
                    "(profile=%d, remaining=%.2f%%, requested=%.2f%%)",
                    data.profile_id, budget["budget_remaining_pct"], effective_risk_pct,
                )

    size_info = _compute_size_info(profile, instrument, data, risk_amount)
    potential_profit = _compute_potential_profit(data, size_info)

    trade = Trade(
        profile_id=data.profile_id,
        instrument_id=data.instrument_id,
        strategy_id=data.strategy_id,
        pair=data.pair,
        direction=data.direction,
        order_type=data.order_type,
        asset_class=(data.asset_class or (instrument.asset_class if instrument else None)),
        analyzed_timeframe=data.analyzed_timeframe,
        entry_price=data.entry_price,
        entry_date=data.entry_date or datetime.utcnow(),
        stop_loss=data.stop_loss,
        # initial_stop_loss is set ONCE here and never changed.
        # Used by _position_pnl so that moving SL to BE doesn't zero out PnL.
        initial_stop_loss=data.stop_loss,
        nb_take_profits=len(data.positions),
        risk_amount=risk_amount,
        potential_profit=potential_profit,
        # LIMIT orders start as 'pending' — no capital-risk reserved yet.
        # MARKET orders start as 'open'   — full risk reserved immediately.
        status="pending" if data.order_type == "LIMIT" else "open",
        current_risk=Decimal("0.00") if data.order_type == "LIMIT" else risk_amount,
        session_tag=data.session_tag,
        notes=data.notes,
        confidence_score=data.confidence_score,
        leverage=data.leverage,
        margin_used=data.margin_used,
        entry_screenshot_urls=data.entry_screenshot_urls,
        dynamic_risk_snapshot=data.dynamic_risk_snapshot,
        be_on_tp1=data.be_on_tp1,
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

    # Link all strategies via trade_strategies junction table
    if data.strategy_ids:
        _sync_trade_strategies(db, trade, data.strategy_ids)

    db.commit()
    # Reload fresh with joinedload to populate instrument_display_name
    return _reload_and_out(db, trade.id, size_info)


def list_trades(
    db: Session,
    profile_id: int | None = None,
    trade_status: str | None = None,
    pair: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[TradeListItem]:
    """
    Return trades (most recent first) with optional filters.
    Eagerly loads instrument + positions so display_name and booked_pnl are available.
    """
    q = db.query(Trade).options(joinedload(Trade.instrument), joinedload(Trade.positions))

    if profile_id is not None:
        q = q.filter(Trade.profile_id == profile_id)
    if trade_status is not None:
        q = q.filter(Trade.status == trade_status)
    if pair is not None:
        q = q.filter(Trade.pair.ilike(f"%{pair}%"))

    trades = q.order_by(Trade.entry_date.desc()).offset(offset).limit(limit).all()

    # Bulk-fetch strategy_ids for all trades in one query (avoid N+1)
    trade_ids = [t.id for t in trades]
    strat_rows: list = []
    if trade_ids:
        strat_rows = (
            db.query(TradeStrategy.trade_id, TradeStrategy.strategy_id)
            .filter(TradeStrategy.trade_id.in_(trade_ids))
            .order_by(TradeStrategy.trade_id, TradeStrategy.id)
            .all()
        )
    strat_map: dict[int, list[int]] = {}
    for trade_id, strategy_id in strat_rows:
        strat_map.setdefault(trade_id, []).append(strategy_id)

    # Bulk-fetch which trades have at least one non-cancelled KrakenOrder (avoid N+1)
    kraken_trade_ids: set[int] = set()
    if trade_ids:
        kraken_rows = (
            db.query(KrakenOrder.trade_id)
            .filter(
                KrakenOrder.trade_id.in_(trade_ids),
                KrakenOrder.status != "cancelled",
            )
            .distinct()
            .all()
        )
        kraken_trade_ids = {r[0] for r in kraken_rows}

    items = []
    for t in trades:
        item = TradeListItem.model_validate(t)
        if t.instrument is not None:
            item.instrument_display_name = t.instrument.display_name
        # booked_pnl: sum of realized_pnl from all closed positions (for partial trades)
        item.booked_pnl = (
            sum(
                (p.realized_pnl for p in t.positions if p.realized_pnl is not None),
                Decimal("0.00"),
            )
            or None
        )
        # exit_price: lot-percentage weighted average of closed positions' exit prices
        closed_pos = [p for p in t.positions if p.status == "closed" and p.exit_price is not None]
        if closed_pos:
            total_pct = sum((Decimal(str(p.lot_percentage)) for p in closed_pos), Decimal("0"))
            if total_pct > 0:
                item.exit_price = (
                    sum(
                        (Decimal(str(p.exit_price)) * Decimal(str(p.lot_percentage)) for p in closed_pos),
                        Decimal("0"),
                    )
                    / total_pct
                ).quantize(Decimal("0.00000001"))
        item.strategy_ids = strat_map.get(t.id, [])
        # is_be: SL has been moved to breakeven (SL == entry_price, trade still active).
        # currentrisk==0 alone is a false-positive for unactivated LIMIT orders.
        item.is_be = (
            t.status in ("open", "partial")
            and t.stop_loss is not None
            and t.entry_price is not None
            and t.stop_loss == t.entry_price
        )
        item.has_kraken_orders = t.id in kraken_trade_ids
        items.append(item)
    return items


def _recompute_size_info_from_trade(trade: Trade, db: Session) -> TradeSizeResult | None:
    """
    Re-derive TradeSizeResult for an existing trade using persisted fields.

    Used by get_trade() so the detail page always has size_info, even for
    trades that were opened before size_info was exposed on the GET endpoint.
    Returns None only if entry == stop_loss (invalid trade data).
    """
    dist = abs(trade.entry_price - (trade.initial_stop_loss or trade.stop_loss))
    if dist == 0:
        return None

    profile = db.query(Profile).filter(Profile.id == trade.profile_id).first()
    if profile is None:
        return None

    instrument = (
        db.query(Instrument).filter(Instrument.id == trade.instrument_id).first()
        if trade.instrument_id
        else None
    )

    market_type = profile.market_type  # 'Crypto' or 'CFD'
    risk_amount = trade.risk_amount

    direction = (trade.direction or "long").lower()

    if market_type == "Crypto":
        units = _compute_size_crypto(risk_amount, trade.entry_price, trade.initial_stop_loss or trade.stop_loss)
        notional = (units * trade.entry_price).quantize(Decimal("0.01"))
        # Prefer stored margin (user-entered, exact) over computing from leverage
        stored_margin = trade.margin_used
        stored_lev = trade.leverage
        lev_source = stored_lev if stored_lev else (
            Decimal(str(instrument.max_leverage)) if instrument and instrument.max_leverage else None
        )
        if stored_margin or lev_source:
            margin_required = stored_margin.quantize(Decimal("0.01")) if stored_margin else (notional / lev_source).quantize(Decimal("0.01"))  # type: ignore[operator]
            lev = (notional / stored_margin).quantize(Decimal("0.01")) if stored_margin else lev_source
            safe_margin = (margin_required * MARGIN_SAFETY_FACTOR).quantize(Decimal("0.01"))
            margin_warning = profile.capital_current < safe_margin
            if lev and lev > 0:
                if direction == "long":
                    liq_price = (trade.entry_price * (1 - 1 / lev)).quantize(_price_quant(trade.entry_price))
                else:
                    liq_price = (trade.entry_price * (1 + 1 / lev)).quantize(_price_quant(trade.entry_price))
            else:
                liq_price = None
        else:
            margin_required = None
            safe_margin = None
            margin_warning = False
            liq_price = None
        return TradeSizeResult(
            risk_amount=risk_amount,
            units_or_lots=units,
            market_type=market_type,
            notional=notional,
            leverage=lev_source,
            margin_required=margin_required,
            safe_margin=safe_margin,
            liq_price=liq_price,
            margin_warning=margin_warning,
        )

    # CFD
    tick_value = instrument.tick_value if instrument and instrument.tick_value else Decimal("1")
    lots = _compute_size_cfd(risk_amount, trade.entry_price, trade.initial_stop_loss or trade.stop_loss, tick_value)
    max_lev = (
        instrument.max_leverage if instrument and instrument.max_leverage else DEFAULT_CFD_MAX_LEVERAGE
    )
    lev_cfd = Decimal(str(max_lev))
    notional_cfd = (lots * DEFAULT_CFD_CONTRACT_SIZE * trade.entry_price).quantize(Decimal("0.01"))
    margin_required_cfd = (notional_cfd / lev_cfd).quantize(Decimal("0.01"))
    safe_margin = (margin_required_cfd * MARGIN_SAFETY_FACTOR).quantize(Decimal("0.01"))
    margin_warning = profile.capital_current < safe_margin
    if direction == "long":
        liq_price = (trade.entry_price * (1 - 1 / lev_cfd)).quantize(_price_quant(trade.entry_price))
    else:
        liq_price = (trade.entry_price * (1 + 1 / lev_cfd)).quantize(_price_quant(trade.entry_price))
    return TradeSizeResult(
        risk_amount=risk_amount,
        units_or_lots=lots,
        market_type=market_type,
        notional=notional_cfd,
        leverage=lev_cfd,
        margin_required=margin_required_cfd,
        safe_margin=safe_margin,
        liq_price=liq_price,
        margin_warning=margin_warning,
    )


def get_trade(db: Session, trade_id: int) -> TradeOut:
    trade = _get_trade_or_404(db, trade_id)
    # Re-compute size_info from persisted trade data so it is always available
    # on GET (not just at open time).
    size_info = _recompute_size_info_from_trade(trade, db)
    out = _trade_to_out(trade, size_info)
    _populate_strategy_ids(out, db)
    return out


def update_trade(db: Session, trade_id: int, data: TradeUpdate) -> TradeOut:
    """
    Partial update for a trade.

    Always allowed (pending / open / partial):
        stop_loss, strategy_id, notes, confidence_score, session_tag,
        analyzed_timeframe, entry_screenshot_urls

    Always allowed (including closed):
        close_notes, close_screenshot_urls
        (post-trade review — always editable regardless of status)

    Pending-only (LIMIT not yet triggered):
        entry_price      — recalculates risk_amount, lot sizes, potential_profit
        amend_positions  — replaces all TP positions

    Closed trades can ONLY update close_notes / notes / close_screenshot_urls.
    """
    trade = _get_trade_or_404(db, trade_id)

    # ── Fields allowed on closed trades (post-trade review) ──────────────
    # notes is also editable on closed trades (late entry rationale fix).
    closed_allowed = {"close_notes", "close_screenshot_urls", "notes"}

    if trade.status == "closed":
        # Reject structural field changes on closed trades
        structural_fields = (
            data.model_fields_set
            - closed_allowed
            - {"entry_price", "amend_positions"}  # handled below
        )
        if structural_fields:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Cannot update structural fields on a closed trade: "
                    f"{', '.join(sorted(structural_fields))}. "
                    "Only close_notes, notes and close_screenshot_urls are editable."
                ),
            )
        for field in closed_allowed:
            if field in data.model_fields_set:
                setattr(trade, field, getattr(data, field))
        db.commit()
        return _reload_and_out(db, trade_id)

    for field in closed_allowed:
        if field in data.model_fields_set:
            setattr(trade, field, getattr(data, field))

    # ── Guard: pending-only fields on non-pending trade ───────────────────
    amend_entry = data.entry_price is not None
    amend_positions = data.amend_positions is not None

    if (amend_entry or amend_positions) and trade.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "entry_price and amend_positions can only be changed on a 'pending' "
                f"LIMIT order. Current status: '{trade.status}'. "
                "Once a trade is open/active, amend the stop-loss instead."
            ),
        )

    # ── Apply simple scalar fields ────────────────────────────────────────
    simple_fields = {
        "stop_loss",
        "strategy_id",
        "notes",
        "confidence_score",
        "session_tag",
        "analyzed_timeframe",
        "entry_screenshot_urls",
        "leverage",
        "margin_used",
    }
    for field in simple_fields:
        if field in data.model_fields_set:
            setattr(trade, field, getattr(data, field))

    # ── Multi-strategy sync ───────────────────────────────────────────────
    if "strategy_ids" in data.model_fields_set and data.strategy_ids is not None:
        _sync_trade_strategies(db, trade, data.strategy_ids)

    # ── Recalculate risk when SL changed (open/partial) ───────────────────
    if "stop_loss" in data.model_fields_set and not amend_entry:
        trade.current_risk = _recalculate_current_risk(trade, db)

    # ── Amend entry (pending-only) ─────────────────────────────────────────
    if amend_entry:
        assert data.entry_price is not None  # amend_entry flag guarantees this
        new_entry: Decimal = data.entry_price
        sl: Decimal = data.stop_loss if data.stop_loss is not None else trade.stop_loss

        # Validate SL direction against the new entry
        if trade.direction == "long" and sl >= new_entry:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="For a long trade, stop_loss must be below entry_price.",
            )
        if trade.direction == "short" and sl <= new_entry:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="For a short trade, stop_loss must be above entry_price.",
            )

        trade.entry_price = new_entry
        trade.stop_loss = sl

        # Recalculate risk_amount from original profile risk%
        profile = db.query(Profile).filter(Profile.id == trade.profile_id).first()
        if profile:
            instrument = (
                db.query(Instrument).filter(Instrument.id == trade.instrument_id).first()
                if trade.instrument_id
                else None
            )
            # Rebuild a minimal TradeOpen-like object for _compute_size_info
            dummy = TradeOpen(
                profile_id=trade.profile_id,
                pair=trade.pair,
                direction=trade.direction,  # type: ignore[arg-type]
                entry_price=new_entry,
                stop_loss=sl,
                asset_class=trade.asset_class,
                positions=[
                    PositionIn(
                        position_number=p.position_number,
                        take_profit_price=p.take_profit_price,
                        lot_percentage=p.lot_percentage,
                    )
                    for p in trade.positions
                ],
            )
            # Use profile's default risk% (not overridable on amend — keeps original intent)
            risk_pct = profile.risk_percentage_default
            risk_amount = (profile.capital_current * risk_pct / 100).quantize(Decimal("0.01"))
            size_info = _compute_size_info(profile, instrument, dummy, risk_amount)
            potential_profit = _compute_potential_profit(dummy, size_info)

            trade.risk_amount = risk_amount
            trade.potential_profit = potential_profit
            # pending → current_risk stays 0 until activate

    # ── Amend positions (pending-only) ────────────────────────────────────
    if amend_positions:
        assert data.amend_positions is not None  # narrowed by amend_positions guard
        new_positions: list[PositionIn] = data.amend_positions
        # Validate lot sum
        total_pct = sum(p.lot_percentage for p in new_positions)
        if total_pct != Decimal("100"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"amend_positions lot_percentage must sum to 100, got {total_pct}.",
            )

        # Delete existing positions and replace
        for pos in list(trade.positions):
            db.delete(pos)
        db.flush()

        entry = trade.entry_price
        for idx, pos_in in enumerate(new_positions, start=1):
            if pos_in.position_number is None:
                pos_in.position_number = idx
            pos = Position(
                trade_id=trade.id,
                position_number=pos_in.position_number,
                take_profit_price=pos_in.take_profit_price,
                lot_percentage=pos_in.lot_percentage,
                status="open",
            )
            db.add(pos)
        trade.nb_take_profits = len(new_positions)

        # Recompute potential_profit from new TPs
        best_tp = max(new_positions, key=lambda p: (p.position_number or 0))
        price_dist = abs(trade.entry_price - trade.stop_loss)
        if price_dist > 0:
            total_units = trade.risk_amount / price_dist
            tp_dist = abs(best_tp.take_profit_price - entry)
            trade.potential_profit = (total_units * tp_dist).quantize(Decimal("0.01"))

    db.commit()
    return _reload_and_out(db, trade.id)


def move_to_breakeven(db: Session, trade_id: int) -> TradeOut:
    """
    Move stop-loss to entry price (breakeven).

    Rules:
    - Only open / partial trades can be moved to BE.
    - Sets trade.stop_loss = trade.entry_price.
    - Sets trade.current_risk = 0 (no remaining downside risk at BE).
    - Does NOT close any position.

    This is a dedicated endpoint so the intent is crystal-clear in the journal.
    Equivalent to partial_close(move_to_be=True) but without closing a position.
    """
    trade = _get_trade_or_404(db, trade_id)

    if trade.status not in ("open", "partial"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Can only move to breakeven on an 'open' or 'partial' trade. "
                f"Current status: '{trade.status}'."
            ),
        )

    if trade.stop_loss == trade.entry_price:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Stop-loss is already at breakeven (entry price).",
        )

    trade.stop_loss = trade.entry_price
    trade.current_risk = Decimal("0.00")

    db.commit()
    return _reload_and_out(db, trade_id)


def partial_close(db: Session, trade_id: int, data: TradePartialClose) -> TradeOut:
    """
    Close one TP position.

    1. Find the open position by position_number
    2. Compute PnL for that slice (using initial_stop_loss for unit calculation)
    3. If move_to_be=True -> SL = entry_price, current_risk = 0
    4. Else -> recalculate current_risk from remaining open positions
    5a. If there are still open positions → trade.status = 'partial'
    5b. If ALL positions are now closed → auto-transition to full close:
        sum all position PnLs, update trade.realized_pnl, update profile capital,
        update strategy stats, set trade.status = 'closed'.
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

    # ── Credit capital immediately for this position's PnL ───────────────
    profile = db.query(Profile).filter(Profile.id == trade.profile_id).first()
    if profile and pnl is not None:
        profile.capital_current = (profile.capital_current + pnl).quantize(Decimal("0.01"))

    # ── Auto-close when all positions are now closed ─────────────────────
    # After marking this position closed, check if any remain open.
    remaining_open = [p for p in trade.positions if p.status == "open"]

    if not remaining_open:
        # All TPs hit — finalize the trade exactly like full_close
        total_pnl = sum(
            (p.realized_pnl for p in trade.positions if p.realized_pnl is not None),
            Decimal("0.00"),
        )
        trade.realized_pnl = total_pnl.quantize(Decimal("0.01"))
        trade.status = "closed"
        trade.closed_at = exit_dt
        trade.current_risk = Decimal("0.00")

        # WR stats update (capital already credited above)
        if profile:
            _update_wr_stats(db, trade, profile)
    else:
        trade.status = "partial"

    db.commit()
    return _reload_and_out(db, trade_id)


def full_close(db: Session, trade_id: int, data: TradeClose) -> TradeOut:
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

    # Save close notes + screenshots if provided
    if data.close_notes is not None:
        trade.close_notes = data.close_notes
    if data.close_screenshot_urls is not None:
        trade.close_screenshot_urls = data.close_screenshot_urls

    # -- Atomic capital + WR stats update (profile + all linked strategies) -----
    profile = db.query(Profile).filter(Profile.id == trade.profile_id).first()
    if profile:
        profile.capital_current = (profile.capital_current + trade.realized_pnl).quantize(
            Decimal("0.01")
        )
        _update_wr_stats(db, trade, profile)

    db.commit()
    return _reload_and_out(db, trade_id)


def activate_trade(db: Session, trade_id: int) -> TradeOut:
    """
    Activate a pending LIMIT order — marks it as triggered by the market.

    Transition: pending → open

    Effects:
    - trade.status = 'open'
    - trade.current_risk is set to trade.risk_amount
      (capital-risk is reserved NOW, not at order placement)

    Rules:
    - Only 'pending' trades can be activated.
    - MARKET trades are already 'open' from creation — this endpoint is LIMIT-only.
    - No capital or WR stats are changed here (that happens on full_close).
    """
    trade = _get_trade_or_404(db, trade_id)

    if trade.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Only 'pending' LIMIT orders can be activated. "
                f"Current status: '{trade.status}'."
            ),
        )

    trade.status = "open"
    trade.current_risk = trade.risk_amount  # risk is now live

    db.commit()
    return _reload_and_out(db, trade_id)


def cancel_trade(db: Session, trade_id: int) -> TradeOut:
    """
    Cancel a pending LIMIT order.

    Rules:
    - Only 'pending' trades can be cancelled.
      (An 'open' trade already has real fills → use full_close instead.)
    - Sets status = 'cancelled', current_risk = 0.
    - Does NOT update profile.capital_current or any WR counters.
    - Trade is kept as a journal record (not deleted).
    """
    trade = _get_trade_or_404(db, trade_id)

    if trade.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Only 'pending' LIMIT orders can be cancelled. "
                f"Current status: '{trade.status}'. "
                f"If the trade is 'open', close it via the close endpoint."
            ),
        )

    trade.status = "cancelled"
    trade.current_risk = Decimal("0.00")

    db.commit()
    return _reload_and_out(db, trade_id)


def delete_trade(db: Session, trade_id: int) -> None:
    """
    Physically delete a trade.

    Open/partial/cancelled trades are physically deleted.
    Closed trades are rejected — they are the permanent journal record.
    """
    trade = _get_trade_or_404(db, trade_id)

    if trade.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot delete a closed trade. The journal record must be preserved.",
        )

    db.delete(trade)
    db.commit()


def get_trade_raw(db: Session, trade_id: int) -> Trade:
    """Return the raw Trade ORM object (no eager loads). Used by snapshot endpoints."""
    return _get_trade_or_404(db, trade_id)


def update_entry_screenshots(db: Session, trade_id: int, urls: list[str]) -> TradeOut:
    """
    Targeted SQL UPDATE — sets only entry_screenshot_urls.
    Uses Core SQLAlchemy (not ORM session flush) so no other column is touched,
    avoiding NOT NULL violations on columns that are NULL due to legacy data.
    """
    _get_trade_or_404(db, trade_id)  # 404 guard
    db.execute(sa_update(Trade).where(Trade.id == trade_id).values(entry_screenshot_urls=urls))
    db.commit()
    return _reload_and_out(db, trade_id)


def update_close_screenshots(db: Session, trade_id: int, urls: list[str]) -> TradeOut:
    """
    Targeted SQL UPDATE — sets only close_screenshot_urls.
    Uses Core SQLAlchemy (not ORM session flush) so no other column is touched,
    avoiding NOT NULL violations on columns that are NULL due to legacy data.
    """
    _get_trade_or_404(db, trade_id)  # 404 guard
    db.execute(sa_update(Trade).where(Trade.id == trade_id).values(close_screenshot_urls=urls))
    db.commit()
    return _reload_and_out(db, trade_id)
