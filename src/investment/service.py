"""
Phase 7 — Investment & Spot module service layer.

Business logic for:
  - SpotTrade CRUD (open, update, close, cancel)
  - Deposit CRUD (create, update, delete — all trigger capital recompute)
  - InvestmentSettings (auto-init + deep-merge update)
  - capital_current recompute for spot profiles
  - Portfolio summary (open positions + totals)
"""

from __future__ import annotations

import copy
import datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.core.models.broker import Profile
from src.investment.models import Deposit, InvestmentSettings, SpotTrade
from src.investment.schemas import (
    DepositCreate,
    DepositUpdate,
    PortfolioOut,
    SpotTradeClose,
    SpotTradeCreate,
    SpotTradeUpdate,
)

# ── Default config ─────────────────────────────────────────────────────────────

DEFAULT_INVESTMENT_CONFIG: dict = {
    "recurrent_deposit": {
        "enabled": False,
        "amount": 0,
        "currency": "USDT",
        "frequency": "monthly",
        "day_of_month": 1,
        "next_due": None,
    },
    "price_tracking": {
        "refresh_frequency_hours": 12,
        "last_fetched_at": None,
    },
    "watchlist_htf": {
        "timeframes": ["1W", "1D", "4H"],
        "top_n": 10,
    },
}


def _deep_merge(base: dict, patch: dict) -> dict:
    """Recursively merge patch into base. patch keys overwrite; base keys preserved."""
    result = copy.deepcopy(base)
    for key, value in patch.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


# ── Profile guards ────────────────────────────────────────────────────────────

def _get_profile_or_404(db: Session, profile_id: int) -> Profile:
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile {profile_id} not found.",
        )
    return profile


def _require_spot_profile(profile: Profile) -> None:
    """Raise 403 if profile is not a spot profile."""
    if getattr(profile, "account_type", "contracts") != "spot":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This endpoint is only available for spot profiles. "
                "This profile has account_type='contracts'."
            ),
        )


# ── capital_current recompute ─────────────────────────────────────────────────

def recompute_spot_capital(db: Session, profile_id: int) -> Profile:
    """Recompute and persist capital_current for a spot profile.

    Formula:
        capital_current = capital_start
                        + SUM(deposits.amount)
                        + SUM(spot_trades.realized_pnl WHERE status='closed')

    Called atomically after each deposit mutation and each trade close.
    """
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)

    total_deposits_raw = (
        db.query(func.sum(Deposit.amount))
        .filter(Deposit.profile_id == profile_id)
        .scalar()
    )
    total_deposits = (
        Decimal(str(total_deposits_raw))
        if total_deposits_raw is not None
        else Decimal("0")
    )

    total_pnl_raw = (
        db.query(func.sum(SpotTrade.realized_pnl))
        .filter(
            SpotTrade.profile_id == profile_id,
            SpotTrade.status == "closed",
            SpotTrade.realized_pnl.isnot(None),
        )
        .scalar()
    )
    total_pnl = (
        Decimal(str(total_pnl_raw)) if total_pnl_raw is not None else Decimal("0")
    )

    new_capital = (profile.capital_start + total_deposits + total_pnl).quantize(
        Decimal("0.01")
    )
    profile.capital_current = new_capital
    db.commit()
    db.refresh(profile)
    return profile


# ── Investment Settings ───────────────────────────────────────────────────────

def get_investment_settings(profile_id: int, db: Session) -> InvestmentSettings:
    """Return settings row, auto-creating with defaults on first access."""
    row = db.query(InvestmentSettings).filter_by(profile_id=profile_id).first()
    if row is None:
        row = InvestmentSettings(
            profile_id=profile_id,
            config=copy.deepcopy(DEFAULT_INVESTMENT_CONFIG),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_investment_settings(
    profile_id: int, patch: dict, db: Session
) -> InvestmentSettings:
    """Deep-merge patch into current config. DB values are the authoritative base."""
    row = get_investment_settings(profile_id, db)
    row.config = _deep_merge(row.config, patch)
    row.updated_at = datetime.datetime.now(datetime.UTC)
    db.commit()
    db.refresh(row)
    return row


# ── SpotTrade CRUD ────────────────────────────────────────────────────────────

def list_spot_trades(
    profile_id: int,
    db: Session,
    *,
    status_filter: str | None = None,
) -> list[SpotTrade]:
    _get_profile_or_404(db, profile_id)
    q = db.query(SpotTrade).filter(SpotTrade.profile_id == profile_id)
    if status_filter:
        q = q.filter(SpotTrade.status == status_filter)
    return q.order_by(SpotTrade.created_at.desc()).all()


def get_spot_trade(trade_id: int, profile_id: int, db: Session) -> SpotTrade:
    trade = (
        db.query(SpotTrade)
        .filter(SpotTrade.id == trade_id, SpotTrade.profile_id == profile_id)
        .first()
    )
    if not trade:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"SpotTrade {trade_id} not found for profile {profile_id}.",
        )
    return trade


def create_spot_trade(profile_id: int, data: SpotTradeCreate, db: Session) -> SpotTrade:
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)

    total_cost = (data.entry_price * data.quantity).quantize(Decimal("0.00000001"))

    trade = SpotTrade(
        profile_id=profile_id,
        parent_spot_trade_id=data.parent_spot_trade_id,
        strategy_id=data.strategy_id,
        instrument_id=data.instrument_id,
        pair=data.pair,
        asset_class=data.asset_class,
        analyzed_timeframe=data.analyzed_timeframe,
        order_type=data.order_type,
        status="open",
        entry_price=data.entry_price,
        quantity=data.quantity,
        total_cost=total_cost,
        entry_date=data.entry_date or datetime.datetime.now(datetime.UTC),
        stop_loss=data.stop_loss,
        nb_take_profits=data.nb_take_profits,
        tp_targets=[t.model_dump() for t in data.tp_targets],
        market_vi_at_entry=data.market_vi_at_entry,
        pair_vi_at_entry=data.pair_vi_at_entry,
        confidence_score=data.confidence_score,
        session_tag=data.session_tag,
        notes=data.notes,
    )
    db.add(trade)
    db.commit()
    db.refresh(trade)
    return trade


def update_spot_trade(
    trade_id: int, profile_id: int, data: SpotTradeUpdate, db: Session
) -> SpotTrade:
    trade = get_spot_trade(trade_id, profile_id, db)
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "tp_targets" and value is not None:
            setattr(trade, field, [t if isinstance(t, dict) else t.model_dump() for t in value])
        else:
            setattr(trade, field, value)
    trade.updated_at = datetime.datetime.now(datetime.UTC)
    db.commit()
    db.refresh(trade)
    return trade


def close_spot_trade(
    trade_id: int, profile_id: int, data: SpotTradeClose, db: Session
) -> SpotTrade:
    trade = get_spot_trade(trade_id, profile_id, db)
    if trade.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Trade is already closed.",
        )

    realized_pnl = (
        (data.exit_price - trade.entry_price) * trade.quantity
    ).quantize(Decimal("0.00000001"))

    trade.exit_price = data.exit_price
    trade.realized_pnl = realized_pnl
    trade.closed_at = data.closed_at or datetime.datetime.now(datetime.UTC)
    trade.status = "closed"
    trade.updated_at = datetime.datetime.now(datetime.UTC)
    db.commit()
    db.refresh(trade)

    # Recompute capital_current atomically after close
    recompute_spot_capital(db, profile_id)
    return trade


def cancel_spot_trade(trade_id: int, profile_id: int, db: Session) -> SpotTrade:
    trade = get_spot_trade(trade_id, profile_id, db)
    if trade.status == "closed":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Cannot cancel a closed trade.",
        )
    trade.status = "cancelled"
    trade.updated_at = datetime.datetime.now(datetime.UTC)
    db.commit()
    db.refresh(trade)
    return trade


# ── Deposits ──────────────────────────────────────────────────────────────────

def list_deposits(profile_id: int, db: Session) -> list[Deposit]:
    _get_profile_or_404(db, profile_id)
    return (
        db.query(Deposit)
        .filter(Deposit.profile_id == profile_id)
        .order_by(Deposit.deposit_date.desc())
        .all()
    )


def create_deposit(profile_id: int, data: DepositCreate, db: Session) -> Deposit:
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)

    deposit = Deposit(
        profile_id=profile_id,
        amount=data.amount,
        deposit_date=data.deposit_date,
        label=data.label,
        is_recurrent=data.is_recurrent,
        notes=data.notes,
    )
    db.add(deposit)
    db.commit()
    db.refresh(deposit)

    # Recompute capital_current atomically after deposit
    recompute_spot_capital(db, profile_id)
    return deposit


def update_deposit(
    deposit_id: int, profile_id: int, data: DepositUpdate, db: Session
) -> Deposit:
    deposit = (
        db.query(Deposit)
        .filter(Deposit.id == deposit_id, Deposit.profile_id == profile_id)
        .first()
    )
    if not deposit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Deposit {deposit_id} not found for profile {profile_id}.",
        )
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(deposit, field, value)
    db.commit()
    db.refresh(deposit)

    # Recompute capital_current atomically after update
    recompute_spot_capital(db, profile_id)
    return deposit


def delete_deposit(deposit_id: int, profile_id: int, db: Session) -> None:
    deposit = (
        db.query(Deposit)
        .filter(Deposit.id == deposit_id, Deposit.profile_id == profile_id)
        .first()
    )
    if not deposit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Deposit {deposit_id} not found for profile {profile_id}.",
        )
    db.delete(deposit)
    db.commit()

    # Recompute capital_current atomically after delete
    recompute_spot_capital(db, profile_id)


# ── Portfolio summary ─────────────────────────────────────────────────────────

def get_portfolio(profile_id: int, db: Session) -> PortfolioOut:
    """Return holdings summary.

    Prices are not fetched live here — caller uses the price polling endpoint
    to refresh cached prices. We read last_fetched_at from investment_settings
    and include it in the response so the UI can show "Last updated X ago".
    """
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)

    open_trades = (
        db.query(SpotTrade)
        .filter(
            SpotTrade.profile_id == profile_id,
            SpotTrade.status.in_(["open", "partial", "runner"]),
        )
        .order_by(SpotTrade.entry_date.asc())
        .all()
    )

    total_deposited_raw = (
        db.query(func.sum(Deposit.amount))
        .filter(Deposit.profile_id == profile_id)
        .scalar()
    )
    total_deposited = (
        Decimal(str(total_deposited_raw))
        if total_deposited_raw is not None
        else Decimal("0")
    )

    total_pnl_raw = (
        db.query(func.sum(SpotTrade.realized_pnl))
        .filter(
            SpotTrade.profile_id == profile_id,
            SpotTrade.status == "closed",
            SpotTrade.realized_pnl.isnot(None),
        )
        .scalar()
    )
    total_pnl = (
        Decimal(str(total_pnl_raw)) if total_pnl_raw is not None else Decimal("0")
    )

    # Last price refresh from investment_settings
    settings_row = db.query(InvestmentSettings).filter_by(profile_id=profile_id).first()
    last_price_refresh = None
    if settings_row:
        raw_ts = settings_row.config.get("price_tracking", {}).get("last_fetched_at")
        if raw_ts:
            try:
                last_price_refresh = datetime.datetime.fromisoformat(raw_ts)
            except (ValueError, TypeError):
                pass

    return PortfolioOut(
        profile_id=profile_id,
        capital_start=profile.capital_start,
        capital_current=profile.capital_current,
        total_deposited=total_deposited,
        realized_pnl=total_pnl,
        open_positions_count=len(open_trades),
        last_price_refresh=last_price_refresh,
    )
