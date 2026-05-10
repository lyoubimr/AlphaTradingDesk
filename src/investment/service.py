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

import httpx as _httpx
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Instrument, Profile
from src.core.models.trade import Trade
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
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)
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
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)
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
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)
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
    _require_spot_profile(profile)  # Deposits are a spot-only concept

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

    recompute_spot_capital(db, profile_id)
    return deposit


def update_deposit(
    deposit_id: int, profile_id: int, data: DepositUpdate, db: Session
) -> Deposit:
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)
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
    recompute_spot_capital(db, profile_id)
    return deposit


def delete_deposit(deposit_id: int, profile_id: int, db: Session) -> None:
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)
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
    recompute_spot_capital(db, profile_id)


# ── Portfolio summary ─────────────────────────────────────────────────────────

def get_portfolio(profile_id: int, db: Session) -> PortfolioOut:
    """Return portfolio summary — works for all profile types.

    Contracts: open_positions_count + realized_pnl come from the trades table.
    Spot:      open_positions_count + realized_pnl come from spot_trades table.
    Deposits are universal (from the deposits table for all profiles).
    """
    profile = _get_profile_or_404(db, profile_id)
    # No account_type guard — portfolio is available for all profile types

    # Deposits — universal
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

    if profile.account_type == "spot":
        # Spot: use spot_trades
        open_count: int = (
            db.query(func.count(SpotTrade.id))
            .filter(
                SpotTrade.profile_id == profile_id,
                SpotTrade.status.in_(["open", "partial", "runner"]),
            )
            .scalar() or 0
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
        # Last price refresh from investment_settings (spot only)
        settings_row = db.query(InvestmentSettings).filter_by(profile_id=profile_id).first()
        last_price_refresh = None
        if settings_row:
            raw_ts = settings_row.config.get("price_tracking", {}).get("last_fetched_at")
            if raw_ts:
                try:
                    last_price_refresh = datetime.datetime.fromisoformat(raw_ts)
                except (ValueError, TypeError):
                    pass
    else:
        # Contracts: use trades table
        open_count = (
            db.query(func.count(Trade.id))
            .filter(
                Trade.profile_id == profile_id,
                Trade.status.in_(["open", "partial", "runner"]),
            )
            .scalar() or 0
        )
        total_pnl_raw = (
            db.query(func.sum(Trade.realized_pnl))
            .filter(
                Trade.profile_id == profile_id,
                Trade.status == "closed",
                Trade.realized_pnl.isnot(None),
            )
            .scalar()
        )
        last_price_refresh = None

    total_pnl = (
        Decimal(str(total_pnl_raw)) if total_pnl_raw is not None else Decimal("0")
    )

    return PortfolioOut(
        profile_id=profile_id,
        capital_start=profile.capital_start,
        capital_current=profile.capital_current,
        total_deposited=total_deposited,
        realized_pnl=total_pnl,
        open_positions_count=open_count,
        last_price_refresh=last_price_refresh,
    )


# ── Spot instruments catalog ────────────────────────────────────────────────

def list_spot_instruments(profile_id: int, db: Session) -> list[Instrument]:
    """Return active non-futures instruments for the given profile's broker.

    Spot instruments are distinguished from Kraken Futures by having a symbol
    that does NOT start with 'PF_'.
    """
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if not profile or not profile.broker_id:
        return []
    return (
        db.query(Instrument)
        .filter(
            Instrument.broker_id == profile.broker_id,
            Instrument.is_active.is_(True),
            ~Instrument.symbol.startswith("PF_"),
            ~Instrument.symbol.startswith("PI_"),
        )
        .order_by(Instrument.symbol)
        .all()
    )


# ── Spot instruments catalog sync ──────────────────────────────────────────────────────────────────────────

def sync_spot_instruments(db: Session) -> dict[str, int]:
    """Fetch Kraken spot pairs from the public API and upsert into instruments.

    Filters: USD and USDT quoted pairs with status 'online'.
    Symbol used: altname (e.g. 'XBTUSD'). display_name: wsname (e.g. 'XBT/USD').
    Idempotent via ON CONFLICT DO UPDATE on (broker_id, symbol).
    """
    kraken_broker = (
        db.query(Broker)
        .filter(Broker.name.ilike("%kraken%"), Broker.status == "active")
        .first()
    )
    if kraken_broker is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Kraken broker not found in DB. Cannot sync spot instruments.",
        )

    try:
        r = _httpx.get(
            "https://api.kraken.com/0/public/AssetPairs",
            headers={"User-Agent": "AlphaTradingDesk/7.0"},
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Kraken API unreachable: {exc}",
        ) from exc

    api_errors = data.get("error", [])
    if api_errors:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Kraken API returned errors: {api_errors}",
        )

    pairs = data.get("result", {})
    synced = 0

    for _pair_name, info in pairs.items():
        # Skip dark/index entries and futures
        if _pair_name.startswith(".") or _pair_name.startswith("PF_"):
            continue
        # Only USD and USDT quoted
        quote = info.get("quote", "")
        if quote not in ("ZUSD", "USDT"):
            continue
        # Must have a websocket name
        wsname: str = info.get("wsname", "")
        if not wsname:
            continue
        # Skip pairs not online
        pair_status = info.get("status")
        if pair_status is not None and pair_status != "online":
            continue

        altname: str = info.get("altname", _pair_name)
        base_raw: str = info.get("base", "")
        # Kraken uses X/Z prefixes for ISO 4217 currencies (e.g. XXBT, ZUSD)
        clean_base = base_raw[1:] if len(base_raw) == 4 and base_raw[0] in ("X", "Z") else base_raw
        clean_quote = "USD" if quote == "ZUSD" else "USDT"
        ordermin_raw = info.get("ordermin")
        ordermin = Decimal(str(ordermin_raw)) if ordermin_raw else None

        stmt = (
            pg_insert(Instrument)
            .values(
                broker_id=kraken_broker.id,
                symbol=altname,
                display_name=wsname,
                asset_class="Crypto",
                base_currency=clean_base,
                quote_currency=clean_quote,
                is_predefined=True,
                is_active=True,
                max_leverage=None,
                contract_value_precision=None,
                min_lot=ordermin,
            )
            .on_conflict_do_update(
                index_elements=["broker_id", "symbol"],
                set_={
                    "is_active": True,
                    "display_name": wsname,
                    "base_currency": clean_base,
                    "quote_currency": clean_quote,
                    "min_lot": ordermin,
                },
            )
        )
        db.execute(stmt)
        synced += 1

    db.commit()
    return {"synced": synced}


# ── Real-time Spot price (Kraken public Ticker) ───────────────────────────────

def get_spot_price(symbol: str) -> dict:
    """Fetch current ask/bid/last price for a Kraken Spot pair.

    Calls: GET https://api.kraken.com/0/public/Ticker?pair=<symbol>
    Returns: { symbol, ask_price, bid_price, last_price }
    """
    try:
        r = _httpx.get(
            "https://api.kraken.com/0/public/Ticker",
            params={"pair": symbol},
            headers={"User-Agent": "AlphaTradingDesk/7.0"},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Kraken price API unreachable: {exc}",
        ) from exc

    errors = data.get("error", [])
    if errors:
        raise HTTPException(status_code=502, detail=f"Kraken API error: {errors}")

    result = data.get("result", {})
    if not result:
        raise HTTPException(status_code=404, detail=f"No price data for symbol '{symbol}'")

    ticker = next(iter(result.values()))
    return {
        "symbol": symbol,
        "ask_price": float(ticker["a"][0]),
        "bid_price": float(ticker["b"][0]),
        "last_price": float(ticker["c"][0]),
    }


# ── Screenshot upload helper ──────────────────────────────────────────────────

def append_spot_screenshot(trade_id: int, profile_id: int, url: str, db: Session) -> SpotTrade:
    """Append a screenshot URL to spot_trade.screenshot_urls."""
    profile = _get_profile_or_404(db, profile_id)
    _require_spot_profile(profile)
    trade = (
        db.query(SpotTrade)
        .filter(SpotTrade.id == trade_id, SpotTrade.profile_id == profile_id)
        .first()
    )
    if trade is None:
        raise HTTPException(status_code=404, detail="Spot trade not found")
    trade.screenshot_urls = list(trade.screenshot_urls or []) + [url]
    db.commit()
    db.refresh(trade)
    return trade
