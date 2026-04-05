"""
src/kraken_execution/service.py

Phase 5 — Automation service layer.

Responsibilities:
  - AutomationSettings CRUD (Config Table Pattern — auto-upsert on first access).
  - Fernet encryption/decryption of API keys stored in JSONB config.
  - Trade automation actions: open, close, move to breakeven, cancel entry.
  - SL/TP order placement after entry fill.

Security rules:
  - API keys are NEVER returned to callers — use has_api_keys() to check presence.
  - Keys are decrypted only inside _make_client(), never exposed elsewhere.
  - InvalidToken (bad ENCRYPTION_KEY) → MissingAPIKeysError, not leaked to user.
"""

from __future__ import annotations

import copy
from decimal import Decimal

import structlog
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.models.broker import Instrument
from src.core.models.trade import Position, Trade
from src.kraken_execution import (
    AutomationNotEnabledError,
    KrakenAPIError,
    MissingAPIKeysError,
    MissingPrecisionError,
)
from src.kraken_execution.client import KrakenExecutionClient
from src.kraken_execution.models import DEFAULT_AUTOMATION_CONFIG, AutomationSettings, KrakenOrder
from src.kraken_execution.precision import quantize_size
from src.risk_management.engine import _deep_merge
from src.volatility.kraken_client import KrakenClient as PublicKrakenClient

logger = structlog.get_logger()


# ── Encryption helpers ────────────────────────────────────────────────────────

def _fernet() -> Fernet:
    return Fernet(settings.encryption_key.encode())


def _encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def _decrypt(value: str) -> str:
    return _fernet().decrypt(value.encode()).decode()


# ── Settings CRUD (Config Table Pattern) ─────────────────────────────────────

def get_automation_settings(profile_id: int, db: Session) -> AutomationSettings:
    """Return automation settings for profile, auto-creating the row on first access.

    Never returns API key values — use has_api_keys() to check presence.
    """
    row = db.query(AutomationSettings).filter_by(profile_id=profile_id).first()
    if row is None:
        row = AutomationSettings(
            profile_id=profile_id,
            config=copy.deepcopy(DEFAULT_AUTOMATION_CONFIG),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_automation_settings(
    profile_id: int,
    patch: dict,
    db: Session,
) -> AutomationSettings:
    """Deep-merge patch into the existing config. DB is always the base.

    If patch contains "kraken_api_key" or "kraken_api_secret" (plaintext),
    they are encrypted with Fernet and stored as "kraken_api_key_enc" /
    "kraken_api_secret_enc". The plaintext fields are never persisted.
    """
    row = get_automation_settings(profile_id, db)

    # Extract and encrypt API keys if provided in plaintext
    safe_patch = {k: v for k, v in patch.items() if k not in ("kraken_api_key", "kraken_api_secret")}

    api_key = patch.get("kraken_api_key")
    api_secret = patch.get("kraken_api_secret")
    if api_key:
        safe_patch["kraken_api_key_enc"] = _encrypt(api_key)
    if api_secret:
        safe_patch["kraken_api_secret_enc"] = _encrypt(api_secret)

    row.config = _deep_merge(row.config, safe_patch)
    db.commit()
    db.refresh(row)
    return row


def has_api_keys(row: AutomationSettings) -> bool:
    """Return True if both Fernet-encrypted API keys are present in config."""
    return bool(row.config.get("kraken_api_key_enc") and row.config.get("kraken_api_secret_enc"))


# ── Client factory (decrypts keys, never exposes them) ───────────────────────

def _make_client(row: AutomationSettings) -> KrakenExecutionClient:
    """Decrypt API keys and return an authenticated client.

    Raises MissingAPIKeysError if keys are absent or the decryption token is invalid
    (e.g. ENCRYPTION_KEY changed without re-encrypting stored keys).
    """
    if not has_api_keys(row):
        raise MissingAPIKeysError(
            f"Profile {row.profile_id} has no Kraken API keys configured."
        )
    try:
        api_key = _decrypt(row.config["kraken_api_key_enc"])
        api_secret = _decrypt(row.config["kraken_api_secret_enc"])
    except InvalidToken as exc:
        raise MissingAPIKeysError(
            f"Profile {row.profile_id}: API key decryption failed — "
            "re-enter your Kraken API keys."
        ) from exc
    return KrakenExecutionClient(api_key=api_key, api_secret=api_secret)


# ── Connection test ───────────────────────────────────────────────────────────

def verify_connection(profile_id: int, db: Session) -> dict:
    """Verify that the profile's Kraken API keys work.

    Returns:
        {"connected": bool, "demo": bool, "base_url": str}
    """
    row = get_automation_settings(profile_id, db)
    if not has_api_keys(row):
        return {
            "connected": False,
            "demo": settings.kraken_demo or settings.environment == "dev",
            "base_url": settings.kraken_futures_base_url,
            "error": "No API keys configured.",
        }
    with _make_client(row) as client:
        ok, error = client.ping()
    result: dict = {
        "connected": ok,
        "demo": settings.kraken_demo or settings.environment == "dev",
        "base_url": settings.kraken_futures_base_url,
    }
    if error:
        result["error"] = error
    return result


def get_account_status(profile_id: int, db: Session) -> dict:
    """Return real-time Kraken account margin status + open positions.

    Used for diagnosing margin issues. Returns:
      available_margin, initial_margin, portfolio_value, balance_value,
      open_positions (list of {symbol, side, size, price})
    """
    row = get_automation_settings(profile_id, db)
    with _make_client(row) as client:
        acct = client.get_accounts_summary()
        open_positions = client.get_open_positions()
    flex = acct.get("accounts", {}).get("flex", {})
    return {
        "available_margin": flex.get("availableMargin"),
        "initial_margin": flex.get("initialMargin"),
        "maintenance_margin": flex.get("maintenanceMargin"),
        "portfolio_value": flex.get("portfolioValue"),
        "balance_value": flex.get("balanceValue"),
        "pnl": flex.get("pnl"),
        "open_positions": open_positions,
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_trade_or_404(trade_id: int, db: Session) -> Trade:
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if trade is None:
        raise ValueError(f"Trade {trade_id} not found.")
    return trade


def _resolve_instrument(trade: Trade, db: Session) -> Instrument:
    """Fetch instrument for trade and validate contract_value_precision is set."""
    if trade.instrument_id is None:
        raise MissingPrecisionError(
            f"Trade {trade.id} has no instrument — cannot compute lot size."
        )
    instrument = db.query(Instrument).filter(Instrument.id == trade.instrument_id).first()
    if instrument is None:
        raise MissingPrecisionError(f"Instrument not found for trade {trade.id}.")
    if instrument.contract_value_precision is None:
        raise MissingPrecisionError(
            f"Instrument {instrument.symbol} has no contract_value_precision. "
            "Run sync_instruments to populate this field."
        )
    return instrument


def _compute_lot_size(trade: Trade, instrument: Instrument) -> Decimal:
    """Calculate and quantize the entry lot size.

    Formula: risk_amount / abs(entry_price - stop_loss)
    Returns the quantized Decimal lot size ready for Kraken.
    """
    raw_size = trade.risk_amount / abs(trade.entry_price - trade.stop_loss)
    return quantize_size(raw_size, instrument.contract_value_precision if instrument.contract_value_precision is not None else 2)


def _entry_side(trade: Trade) -> str:
    """Map trade direction to Kraken order side for the entry."""
    return "buy" if trade.direction == "long" else "sell"


def _exit_side(trade: Trade) -> str:
    """Opposite side — used for SL and TP orders."""
    return "sell" if trade.direction == "long" else "buy"


def _kraken_order_type(atd_order_type: str) -> str:
    """Map ATD order type to Kraken API wire format."""
    return "lmt" if atd_order_type == "LIMIT" else "mkt"


# Kraken API wire format → DB-constrained value
# DB constraint: 'market' | 'limit' | 'stop' | 'take_profit'
_KRAKEN_TO_DB_ORDER_TYPE: dict[str, str] = {
    "mkt": "market",
    "lmt": "limit",
    "stp": "stop",
    "take_profit": "take_profit",
}


def _db_order_type(kraken_type: str) -> str:
    """Map Kraken API order type to the DB-constrained value."""
    return _KRAKEN_TO_DB_ORDER_TYPE.get(kraken_type, kraken_type)


# ── Trade automation actions ──────────────────────────────────────────────────

def open_automated_trade(trade_id: int, db: Session) -> KrakenOrder:
    """Place the entry order for an automated trade on Kraken Futures.

    Validates: automation_enabled, API keys, instrument precision, lot size.
    Inserts a KrakenOrder(role='entry') and updates trade.kraken_entry_order_id.

    Returns:
        The inserted KrakenOrder row.

    Raises:
        AutomationNotEnabledError, MissingAPIKeysError, MissingPrecisionError,
        InsufficientSizeError, KrakenAPIError.
    """
    trade = _get_trade_or_404(trade_id, db)

    settings_row = get_automation_settings(trade.profile_id, db)
    if not settings_row.config.get("enabled", False):
        raise AutomationNotEnabledError(
            f"Profile {trade.profile_id} does not have automation enabled."
        )

    instrument = _resolve_instrument(trade, db)
    lot_size = _compute_lot_size(trade, instrument)

    with _make_client(settings_row) as client:
        kraken_type = _kraken_order_type(trade.order_type)
        limit_price = str(trade.entry_price) if trade.order_type == "LIMIT" else None

        # ─ Pre-flight: check available Kraken margin before placing the order ─
        # Kraken Portfolio Margin (PF_) check: after placing the order, the remaining
        # available margin must still cover the total initial margin of ALL positions
        # (existing + new). Kraken's wouldCauseLiquidation fires when:
        #   available_after = availableMargin - new_IM
        #   available_after < total_IM_after = existing_IM + new_IM
        # Which simplifies to: availableMargin < 2 * new_IM + existing_IM
        leverage = Decimal(str(trade.leverage or 10))
        entry_price = trade.entry_price or Decimal(limit_price or "0")
        initial_margin = (lot_size * entry_price / leverage).quantize(Decimal("0.01"))
        try:
            acct = client.get_accounts_summary()
            flex = acct.get("accounts", {}).get("flex", {})
            available = Decimal(str(flex.get("availableMargin", -1)))
            # existing_im = initial margin already consumed by other open positions/orders
            existing_im_raw = flex.get("initialMargin", 0) or 0
            existing_im = Decimal(str(existing_im_raw)).quantize(Decimal("0.01"))
            # required = 2 × new_IM + existing_IM
            # (new_IM to open + new_IM as maintenance buffer + existing_IM still locked)
            required_margin = (Decimal("2") * initial_margin + existing_im).quantize(Decimal("0.01"))
            logger.info(
                "kraken_preflight",
                trade_id=trade_id,
                symbol=instrument.symbol,
                side=_entry_side(trade),
                lot_size=float(lot_size),
                entry_price=float(entry_price),
                leverage=int(leverage),
                notional=float(lot_size * entry_price),
                atd_initial_margin=float(initial_margin),
                atd_existing_im=float(existing_im),
                atd_required_margin=float(required_margin),
                kraken_available_margin=float(available) if available >= 0 else "N/A",
                kraken_portfolio_value=flex.get("portfolioValue", "N/A"),
                kraken_existing_initial_margin=float(existing_im),
            )
            # Warn if there are open orders for the same symbol — they lock margin
            # and can cause wouldCauseLiquidation even with sufficient balance.
            open_orders = client.get_open_orders()
            conflicting = [
                o for o in open_orders
                if o.get("symbol") == instrument.symbol
            ]
            if conflicting:
                logger.warning(
                    "kraken_preflight_open_orders_exist",
                    trade_id=trade_id,
                    symbol=instrument.symbol,
                    open_orders_count=len(conflicting),
                    open_orders=[{"order_id": o.get("order_id"), "side": o.get("side"), "size": o.get("size")} for o in conflicting],
                )
                raise KrakenAPIError(
                    0,
                    f"You already have {len(conflicting)} open order(s) for {instrument.symbol} on Kraken "
                    f"that are locking margin. Cancel them first before placing a new automated order, "
                    f"or close them from the Kraken UI.",
                )
            # Warn if there is already an open POSITION for this symbol on Kraken.
            # Adding a new entry order on top of an existing position increases combined
            # margin exposure and triggers wouldCauseLiquidation in Kraken's risk engine
            # even when availableMargin looks sufficient for the new order alone.
            try:
                open_positions = client.get_open_positions()
                conflicting_pos = [
                    p for p in open_positions
                    if p.get("symbol") == instrument.symbol
                ]
                if conflicting_pos:
                    pos_sides = ", ".join(
                        f"{p.get('side')} {p.get('size')} @ {p.get('price')}"
                        for p in conflicting_pos
                    )
                    logger.warning(
                        "kraken_preflight_open_position_exists",
                        trade_id=trade_id,
                        symbol=instrument.symbol,
                        positions=conflicting_pos,
                    )
                    raise KrakenAPIError(
                        0,
                        f"You already have an open position for {instrument.symbol} on Kraken "
                        f"({pos_sides}). Placing a new entry order on top of an existing position "
                        f"increases combined margin exposure and will be rejected by Kraken with "
                        f"'wouldCauseLiquidation'. Close or reduce the existing position first.",
                    )
            except KrakenAPIError:
                raise
            except Exception as pos_err:  # noqa: BLE001
                logger.warning(
                    "kraken_preflight_position_check_failed",
                    trade_id=trade_id,
                    error=str(pos_err),
                )
            if available >= 0 and available < required_margin:
                shortfall = (required_margin - available).quantize(Decimal("0.01"))
                raise KrakenAPIError(
                    0,
                    f"Insufficient Kraken margin for this trade: "
                    f"you have {float(available):.2f} USD available, "
                    f"but {float(required_margin):.2f} USD are required "
                    f"(2 × {float(initial_margin):.2f} new IM + {float(existing_im):.2f} existing locked — "
                    f"×{int(leverage)} leverage, {float(lot_size):.4f} units at {float(entry_price):.2f}). "
                    f"Add at least {float(shortfall):.2f} USD to your Kraken account, "
                    f"reduce risk % to lower position size, or close some existing positions to free margin.",
                )
        except KrakenAPIError:
            raise  # re-raise preflight failures directly
        except Exception as preflight_err:  # noqa: BLE001
            # If the accounts endpoint is unavailable, log a warning but don’t block.
            logger.warning(
                "kraken_preflight_check_failed",
                trade_id=trade_id,
                error=str(preflight_err),
            )

        result = client.send_order(
            order_type=kraken_type,
            symbol=instrument.symbol,
            side=_entry_side(trade),
            size=str(lot_size),
            limit_price=limit_price,
            max_leverage=int(trade.leverage or 10),
        )

    send_status = result.get("sendStatus", {})
    kraken_order_id = send_status.get("order_id", "")

    order = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=kraken_order_id,
        role="entry",
        status="open",
        order_type=_db_order_type(kraken_type),
        symbol=instrument.symbol,
        side=_entry_side(trade),
        size=float(lot_size),
        limit_price=float(trade.entry_price) if trade.order_type == "LIMIT" else None,
    )
    db.add(order)

    trade.kraken_entry_order_id = kraken_order_id
    trade.automation_enabled = True
    db.commit()
    db.refresh(order)

    logger.info(
        "automation_entry_placed",
        trade_id=trade_id,
        symbol=instrument.symbol,
        kraken_order_id=kraken_order_id,
        lot_size=str(lot_size),
    )

    # Dispatch notification
    exec_event = "TRADE_OPENED" if trade.order_type == "MARKET" else "LIMIT_PLACED"
    _notify_execution_event(
        profile_id=trade.profile_id,
        event=exec_event,
        db=db,
        trade_id=trade_id,
        pair=trade.pair,
        direction=trade.direction,
        size=str(lot_size),
        limit_price=str(trade.entry_price) if trade.order_type == "LIMIT" else None,
        entry_price=str(trade.entry_price),
    )

    # For MARKET orders: fill is immediate → place SL/TP right away.
    # For LIMIT orders: Celery poll_pending_orders handles SL/TP after fill.
    if trade.order_type == "MARKET":
        with _make_client(settings_row) as sl_tp_client:
            place_sl_tp_orders(trade, lot_size, sl_tp_client, db)

    return order


def place_sl_tp_orders(
    trade: Trade,
    entry_size: Decimal,
    client: KrakenExecutionClient,
    db: Session,
) -> list[KrakenOrder]:
    """Place SL and TP orders after the entry fill is confirmed.

    - SL: stop order (stp) at trade.stop_loss, reduce_only=True, FULL size.
    - TP1/2/3: take_profit orders at position.take_profit_price, reduce_only=True,
               sized by position.lot_percentage.

    All orders use reduce_only=True — Kraken fills only up to remaining position.

    Returns:
        List of inserted KrakenOrder rows.
    """
    instrument = trade.instrument
    assert instrument is not None, f"Trade {trade.id} has no instrument loaded"
    exit_side = _exit_side(trade)
    orders: list[KrakenOrder] = []

    # SL order — full size, reduce_only
    sl_result = client.send_order(
        order_type="stp",
        symbol=instrument.symbol,
        side=exit_side,
        size=str(entry_size),
        stop_price=str(trade.stop_loss),
        reduce_only=True,
        raise_on_rejection=False,
    )
    sl_send_status = sl_result.get("sendStatus", {})
    sl_order_id = sl_send_status.get("order_id", "") or ""
    sl_placement_status = sl_send_status.get("status", "unknown")
    # Kraken can return an order_id even for orders it will cancel (reduce_only with no
    # position). We store the real placement status so phantom orders are visible as "error"
    # instead of "open" — prevents false monitoring and UI confusion.
    sl_order_db_status = "open" if sl_placement_status == "placed" else "error"
    if sl_order_db_status == "error":
        logger.error(
            "automation_sl_placement_rejected",
            trade_id=trade.id,
            kraken_status=sl_placement_status,
            kraken_order_id=sl_order_id or "(none)",
            reason=sl_send_status.get("receivedTime", ""),
        )
    # If Kraken returned no order_id (extremely rare), generate a unique synthetic ID.
    # Must be unique due to UNIQUE constraint on kraken_order_id.
    if not sl_order_id:
        import uuid as _uuid  # noqa: PLC0415
        sl_order_id = f"NO-ID-sl-{trade.id}-{_uuid.uuid4().hex[:8]}"
    sl_order = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=sl_order_id,
        role="sl",
        status=sl_order_db_status,
        order_type="stop",
        symbol=instrument.symbol,
        side=exit_side,
        size=float(entry_size),
        limit_price=None,
        error_message=None if sl_order_db_status == "open" else f"Kraken rejected: {sl_placement_status}",
    )
    db.add(sl_order)
    orders.append(sl_order)

    # TP orders — sized by lot_percentage
    open_positions: list[Position] = [
        p for p in trade.positions if p.status == "open"
    ]
    role_map = {1: "tp1", 2: "tp2", 3: "tp3"}

    for pos in open_positions:
        tp_size = (Decimal(str(pos.lot_percentage)) / Decimal("100")) * entry_size
        # Quantize TP size — use same precision
        from src.kraken_execution.precision import quantize_size as _qs  # noqa: PLC0415
        tp_size = _qs(tp_size, instrument.contract_value_precision if instrument.contract_value_precision is not None else 2)

        tp_result = client.send_order(
            order_type="lmt",
            symbol=instrument.symbol,
            side=exit_side,
            size=str(tp_size),
            limit_price=str(pos.take_profit_price),
            reduce_only=True,
            raise_on_rejection=False,
        )
        tp_send_status = tp_result.get("sendStatus", {})
        tp_order_id = tp_send_status.get("order_id", "") or ""
        tp_placement_status = tp_send_status.get("status", "unknown")
        tp_order_db_status = "open" if tp_placement_status == "placed" else "error"
        if tp_order_db_status == "error":
            logger.error(
                "automation_tp_placement_rejected",
                trade_id=trade.id,
                position_number=pos.position_number,
                kraken_status=tp_placement_status,
                kraken_order_id=tp_order_id or "(none)",
            )
        role = role_map.get(pos.position_number, "tp1")
        if not tp_order_id:
            import uuid as _uuid  # noqa: PLC0415
            tp_order_id = f"NO-ID-{role}-{trade.id}-{_uuid.uuid4().hex[:8]}"
        tp_order = KrakenOrder(
            trade_id=trade.id,
            profile_id=trade.profile_id,
            kraken_order_id=tp_order_id,
            role=role,
            status=tp_order_db_status,
            order_type="limit",
            symbol=instrument.symbol,
            side=exit_side,
            size=float(tp_size),
            limit_price=float(pos.take_profit_price),
            error_message=None if tp_order_db_status == "open" else f"Kraken rejected: {tp_placement_status}",
        )
        db.add(tp_order)
        orders.append(tp_order)

    db.commit()
    for o in orders:
        db.refresh(o)

    placed_count = sum(1 for o in orders if o.status == "open")
    logger.info(
        "automation_sl_tp_placed",
        trade_id=trade.id,
        sl_order_id=sl_order_id,
        sl_status=sl_placement_status,
        tp_count=len(open_positions),
        placed_count=placed_count,
        error_count=len(orders) - placed_count,
    )
    return orders


def close_automated_trade(trade_id: int, db: Session) -> KrakenOrder:
    """Cancel all open SL/TP orders, place a market close order, and journal the trade.

    Uses the Kraken public mark price as the exit price for PnL journaling.
    If the mark price fetch fails, the close order is still placed and the trade
    is still journaled at the entry price (worst-case approximation).

    Returns:
        The market close KrakenOrder row.
    """
    trade = _get_trade_or_404(trade_id, db)
    if not trade.automation_enabled:
        raise AutomationNotEnabledError(f"Trade {trade_id} does not have automation enabled.")

    instrument = _resolve_instrument(trade, db)
    settings_row = get_automation_settings(trade.profile_id, db)

    # Find all open Kraken orders for this trade
    open_orders = (
        db.query(KrakenOrder)
        .filter(KrakenOrder.trade_id == trade_id, KrakenOrder.status == "open")
        .all()
    )

    with _make_client(settings_row) as client:
        # Cancel all open SL/TP orders
        for order in open_orders:
            if order.role in ("sl", "tp1", "tp2", "tp3"):
                try:
                    client.cancel_order(order.kraken_order_id)
                    order.status = "cancelled"
                except Exception:
                    logger.warning(
                        "close_trade_cancel_failed",
                        trade_id=trade_id,
                        kraken_order_id=order.kraken_order_id,
                    )

        # Place market close order
        entry_order = next(
            (o for o in open_orders if o.role == "entry" and o.status == "open"),
            None,
        )
        close_size = str(entry_order.size) if entry_order else "0"

        close_result = client.send_order(
            order_type="mkt",
            symbol=instrument.symbol,
            side=_exit_side(trade),
            size=close_size,
            reduce_only=True,
        )

    close_order_id = close_result.get("sendStatus", {}).get("order_id", "")
    close_order = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=close_order_id,
        role="entry",
        status="open",
        order_type="market",
        symbol=instrument.symbol,
        side=_exit_side(trade),
        size=float(close_size) if close_size != "0" else 0.0,
    )
    db.add(close_order)
    db.commit()
    db.refresh(close_order)

    # ── Journal the trade using the current mark price as exit approximation ──
    # Market orders fill near the mark price. This is updated as the best
    # available approximation; a future sync worker can refine it from fills.
    _journal_automated_close(trade_id=trade_id, symbol=instrument.symbol, db=db)

    return close_order


def _journal_automated_close(trade_id: int, symbol: str, db: Session) -> None:
    """Journal a trade as closed using the Kraken mark price as exit approximation.

    Called internally after a market close order is placed. Wraps in a
    try/except so a price-fetch failure does not prevent the close order from
    being persisted.
    """
    from src.trades.schemas import TradeClose
    from src.trades.service import full_close as journal_full_close

    # Fetch current mark price (public endpoint — no auth required)
    exit_price: Decimal | None = None
    try:
        with PublicKrakenClient() as public_client:
            ticker = public_client.fetch_ticker(symbol)
            exit_price = Decimal(str(ticker["last"]))
    except Exception as exc:
        logger.warning(
            "automation_close_mark_price_failed",
            trade_id=trade_id,
            symbol=symbol,
            error=str(exc),
        )

    if exit_price is None:
        # Fallback: reload trade and use entry_price (rare edge case)
        trade = db.query(Trade).filter(Trade.id == trade_id).first()
        exit_price = trade.entry_price if trade else Decimal("1")

    try:
        data = TradeClose(
            exit_price=exit_price,
            close_notes="Closed via Kraken automation (market order). Exit price is mark price approximation.",
        )
        journal_full_close(db=db, trade_id=trade_id, data=data)
        logger.info(
            "automation_trade_journaled",
            trade_id=trade_id,
            exit_price=str(exit_price),
        )
    except Exception as exc:
        logger.error(
            "automation_journal_failed",
            trade_id=trade_id,
            error=str(exc),
        )


def move_to_breakeven(trade_id: int, db: Session) -> KrakenOrder:
    """Cancel the existing SL order and place a new one at entry_price (breakeven).

    Returns:
        The new SL KrakenOrder row.
    """
    trade = _get_trade_or_404(trade_id, db)
    if not trade.automation_enabled:
        raise AutomationNotEnabledError(f"Trade {trade_id} does not have automation enabled.")

    instrument = _resolve_instrument(trade, db)
    settings_row = get_automation_settings(trade.profile_id, db)

    # Find existing open SL order
    sl_order = (
        db.query(KrakenOrder)
        .filter(
            KrakenOrder.trade_id == trade_id,
            KrakenOrder.role == "sl",
            KrakenOrder.status == "open",
        )
        .first()
    )

    with _make_client(settings_row) as client:
        # Cancel old SL
        if sl_order:
            client.cancel_order(sl_order.kraken_order_id)
            sl_order.status = "cancelled"

        # Place new SL at entry_price
        sl_result = client.send_order(
            order_type="stp",
            symbol=instrument.symbol,
            side=_exit_side(trade),
            size=str(sl_order.size) if sl_order else "0",
            stop_price=str(trade.entry_price),
            reduce_only=True,
        )

    new_order_id = sl_result.get("sendStatus", {}).get("order_id", "")
    new_sl = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=new_order_id,
        role="sl",
        status="open",
        order_type="stop",
        symbol=instrument.symbol,
        side=_exit_side(trade),
        size=sl_order.size if sl_order else 0.0,
        limit_price=None,
    )
    db.add(new_sl)
    db.commit()
    db.refresh(new_sl)

    logger.info(
        "automation_breakeven_moved",
        trade_id=trade_id,
        new_sl_order_id=new_order_id,
        breakeven_price=str(trade.entry_price),
    )

    # Dispatch notification
    _notify_execution_event(
        profile_id=trade.profile_id,
        event="BE_MOVED",
        db=db,
        trade_id=trade_id,
        pair=trade.pair,
        direction=trade.direction,
        stop_price=str(trade.entry_price),
    )

    return new_sl


def cancel_entry(trade_id: int, db: Session) -> KrakenOrder:
    """Cancel a pending LIMIT entry order and disable automation on the trade.

    Returns:
        The cancelled KrakenOrder row.
    """
    trade = _get_trade_or_404(trade_id, db)
    if not trade.automation_enabled:
        raise AutomationNotEnabledError(f"Trade {trade_id} does not have automation enabled.")

    settings_row = get_automation_settings(trade.profile_id, db)

    entry_order = (
        db.query(KrakenOrder)
        .filter(
            KrakenOrder.trade_id == trade_id,
            KrakenOrder.role == "entry",
            KrakenOrder.status == "open",
        )
        .first()
    )
    if entry_order is None:
        raise ValueError(f"No open entry order found for trade {trade_id}.")

    with _make_client(settings_row) as client:
        client.cancel_order(entry_order.kraken_order_id)

    entry_order.status = "cancelled"
    trade.automation_enabled = False
    db.commit()
    db.refresh(entry_order)

    logger.info(
        "automation_entry_cancelled",
        trade_id=trade_id,
        kraken_order_id=entry_order.kraken_order_id,
    )
    return entry_order


def sync_pending_fill(trade_id: int, db: Session) -> dict:
    """Check whether a pending LIMIT entry order has been filled on Kraken.

    This is the Celery-free alternative to poll_pending_orders — called on
    demand (frontend polls every 15 s while trade is pending + automated).

    Flow:
        1. Find the open entry KrakenOrder for this trade.
        2. Call get_open_orders() — if the order_id is NOT there, it was filled
           (or cancelled/rejected).
        3. Call get_fills() to confirm fill and get the exact fill price.
        4. If filled:
             a. Update KrakenOrder: status='filled', filled_price, filled_at.
             b. Activate the ATD trade: pending → open (reserves risk budget).
             c. Place SL/TP orders on Kraken immediately.

    Returns:
        {"filled": True,  "fill_price": float} on fill detected.
        {"filled": False, "fill_price": None}  if still pending.
        {"filled": False, "fill_price": None, "skipped": True} if trade is
          already open/closed (idempotent).

    Raises:
        AutomationNotEnabledError if automation is off.
        ValueError if no open entry order exists.
    """
    from datetime import datetime as _dt  # noqa: PLC0415

    trade = _get_trade_or_404(trade_id, db)

    # Idempotent — if already open/closed, nothing to do
    if trade.status in ("open", "partial", "closed"):
        return {"filled": False, "fill_price": None, "skipped": True}

    if not trade.automation_enabled:
        raise AutomationNotEnabledError(f"Trade {trade_id} does not have automation enabled.")

    entry_order = (
        db.query(KrakenOrder)
        .filter(
            KrakenOrder.trade_id == trade_id,
            KrakenOrder.role == "entry",
            KrakenOrder.status == "open",
        )
        .first()
    )
    if entry_order is None:
        # Already processed (filled row exists) — still idempotent
        filled_entry = (
            db.query(KrakenOrder)
            .filter(
                KrakenOrder.trade_id == trade_id,
                KrakenOrder.role == "entry",
                KrakenOrder.status == "filled",
            )
            .first()
        )
        return {
            "filled": bool(filled_entry),
            "fill_price": float(filled_entry.filled_price) if filled_entry and filled_entry.filled_price else None,
            "skipped": True,
        }

    settings_row = get_automation_settings(trade.profile_id, db)

    with _make_client(settings_row) as client:
        # Step 1 — is the order still open on Kraken?
        open_orders = client.get_open_orders()
        open_ids = {o.get("order_id") or o.get("orderId") for o in open_orders}

        if entry_order.kraken_order_id in open_ids:
            # Not filled yet
            return {"filled": False, "fill_price": None}

        # Step 2 — order gone from open orders → look for a fill
        fills = client.get_fills()
        matched_fill = next(
            (f for f in fills if (f.get("order_id") or f.get("orderId")) == entry_order.kraken_order_id),
            None,
        )

        fill_price_raw = None
        fill_id = None
        if matched_fill:
            fill_price_raw = matched_fill.get("price") or matched_fill.get("fillPrice")
            fill_id = matched_fill.get("fill_id") or matched_fill.get("fillId")

        # If order left open_orders but has no fill record:
        # - LIMIT orders: the order was cancelled/rejected by Kraken — never use mark price.
        #   A LIMIT buy fills at ≤ limit_price, so a mark price fill is factually wrong.
        # - MARKET orders only: fill record may be purged from the 100-fill window → fallback ok.
        if fill_price_raw is None:
            if entry_order.order_type == "limit":
                logger.warning(
                    "sync_fill_limit_order_not_found_skipped",
                    trade_id=trade_id,
                    kraken_order_id=entry_order.kraken_order_id,
                )
                return {"filled": False, "fill_price": None}

            # Market order only: fall back to mark price (fill may be > 100 fills ago)
            instrument = _resolve_instrument(trade, db)
            try:
                from src.volatility.kraken_client import KrakenClient as _PubClient  # noqa: PLC0415
                with _PubClient() as pub:
                    ticker = pub.fetch_ticker(instrument.symbol)
                fill_price_raw = ticker["last"]
            except Exception:
                fill_price_raw = float(trade.entry_price)
            logger.warning(
                "sync_fill_no_fill_record_found",
                trade_id=trade_id,
                kraken_order_id=entry_order.kraken_order_id,
                using_fallback=fill_price_raw,
            )

        fill_price = Decimal(str(fill_price_raw))

        # Sanity-check: a LIMIT buy can never fill above its limit price (and vice versa).
        # If Kraken returns a physically impossible fill price, abort rather than book a wrong trade.
        if entry_order.order_type == "limit" and trade.entry_price:
            limit_price = Decimal(str(trade.entry_price))
            # Allow 0.1% tolerance for rounding differences
            tolerance = Decimal("0.001")
            if entry_order.side == "buy" and fill_price > limit_price * (1 + tolerance):
                logger.error(
                    "sync_fill_invalid_fill_price_above_limit",
                    trade_id=trade_id,
                    fill_price=str(fill_price),
                    limit_price=str(limit_price),
                )
                return {"filled": False, "fill_price": None}
            if entry_order.side == "sell" and fill_price < limit_price * (1 - tolerance):
                logger.error(
                    "sync_fill_invalid_fill_price_below_limit",
                    trade_id=trade_id,
                    fill_price=str(fill_price),
                    limit_price=str(limit_price),
                )
                return {"filled": False, "fill_price": None}

        # Step 3 — update entry order row
        entry_order.status = "filled"
        entry_order.filled_price = float(fill_price)
        entry_order.filled_size = entry_order.size
        entry_order.filled_at = _dt.utcnow()
        if fill_id:
            entry_order.kraken_fill_id = fill_id

        # Step 4a — activate trade (pending → open, current_risk = risk_amount)
        from src.trades.service import activate_trade as _activate  # noqa: PLC0415
        try:
            _activate(db=db, trade_id=trade_id)
        except Exception as exc:
            # If trade was already activated (race condition), don't fail
            logger.warning("sync_fill_activate_skipped", trade_id=trade_id, error=str(exc))

        # Step 4b — place SL/TP
        instrument = _resolve_instrument(trade, db)
        entry_size = Decimal(str(entry_order.size))
        # Reload trade to get fresh relationships after activate
        db.refresh(trade)
        place_sl_tp_orders(trade, entry_size, client, db)

    logger.info(
        "sync_fill_detected",
        trade_id=trade_id,
        fill_price=str(fill_price),
        kraken_order_id=entry_order.kraken_order_id,
    )

    _notify_execution_event(
        profile_id=trade.profile_id,
        event="LIMIT_FILLED",
        db=db,
        trade_id=trade_id,
        pair=trade.pair,
        direction=trade.direction,
        fill_price=str(fill_price),
    )

    return {"filled": True, "fill_price": float(fill_price)}


def list_kraken_orders(trade_id: int, db: Session) -> list[KrakenOrder]:
    """Return all KrakenOrder rows for a trade, ordered by sent_at DESC."""
    return (
        db.query(KrakenOrder)
        .filter(KrakenOrder.trade_id == trade_id)
        .order_by(KrakenOrder.sent_at.desc())
        .all()
    )


def sync_sl_tp_fills(trade_id: int, db: Session) -> dict:
    """On-demand: detect SL/TP fills for one trade and reconcile ATD state.

    Celery-free alternative to sync_open_positions — called on demand by the
    frontend (polls every 30 s while trade is open/partial + automated).

    Uses the canonical partial_close / full_close from trades.service so that
    profile.capital_current and WR stats are always correctly updated.

    Returns:
        {"processed": int, "events": list[dict]}              — fills found
        {"processed": 0, "events": [], "skipped": True}       — nothing to do
    """
    from datetime import datetime as _dt  # noqa: PLC0415
    from decimal import Decimal  # noqa: PLC0415

    from fastapi import HTTPException  # noqa: PLC0415

    from src.trades.schemas import TradeClose, TradePartialClose  # noqa: PLC0415
    from src.trades.service import full_close, partial_close  # noqa: PLC0415

    trade = _get_trade_or_404(trade_id, db)

    if trade.status in ("closed", "cancelled", "pending"):
        return {"processed": 0, "events": [], "skipped": True}

    if not trade.automation_enabled:
        raise AutomationNotEnabledError(f"Trade {trade_id} does not have automation enabled.")

    open_orders = (
        db.query(KrakenOrder)
        .filter(
            KrakenOrder.trade_id == trade_id,
            KrakenOrder.role.in_(["sl", "tp1", "tp2", "tp3"]),
            KrakenOrder.status == "open",
        )
        .all()
    )
    if not open_orders:
        return {"processed": 0, "events": []}

    settings_row = get_automation_settings(trade.profile_id, db)
    with _make_client(settings_row) as client:
        fills = client.get_fills()

    fill_by_order_id = {
        (f.get("order_id") or f.get("orderId")): f
        for f in fills
        if (f.get("order_id") or f.get("orderId"))
    }

    processed = 0
    events: list[dict] = []

    for order in open_orders:
        fill = fill_by_order_id.get(order.kraken_order_id)
        if fill is None:
            continue

        fill_id = fill.get("fill_id") or fill.get("uid", "")
        if order.kraken_fill_id == fill_id:
            continue  # idempotent

        fill_price = Decimal(str(fill.get("price", 0)))
        fill_size = float(fill.get("size", order.size or 0))

        order.status = "filled"
        order.filled_price = float(fill_price)
        order.filled_size = fill_size
        order.filled_at = _dt.utcnow()
        if fill_id:
            order.kraken_fill_id = fill_id

        if order.role == "sl":
            try:
                full_close(
                    db=db,
                    trade_id=trade_id,
                    data=TradeClose(
                        exit_price=fill_price,
                        close_notes="SL hit via Kraken automation",
                    ),
                )
            except HTTPException as exc:
                if exc.status_code == 409:
                    logger.warning("sync_sl_tp: trade_already_closed", trade_id=trade_id)
                else:
                    raise
            events.append({"role": "sl", "fill_price": float(fill_price)})

        elif order.role in ("tp1", "tp2", "tp3"):
            tp_num = int(order.role[-1])
            try:
                partial_close(
                    db=db,
                    trade_id=trade_id,
                    data=TradePartialClose(
                        position_number=tp_num,
                        exit_price=fill_price,
                    ),
                )
            except HTTPException as exc:
                if exc.status_code in (409, 422):
                    logger.warning(
                        "sync_sl_tp: position_already_closed",
                        trade_id=trade_id,
                        role=order.role,
                    )
                else:
                    raise
            events.append({"role": order.role, "fill_price": float(fill_price)})

        # full_close / partial_close already commit; flush the order row update too
        db.commit()
        processed += 1

        logger.info(
            "sync_sl_tp_fill_detected",
            trade_id=trade_id,
            role=order.role,
            fill_price=float(fill_price),
        )

    return {"processed": processed, "events": events}


# ── Notification dispatch ─────────────────────────────────────────────────────

def _notify_execution_event(
    profile_id: int,
    event: str,
    db: Session,
    **ctx,
) -> None:
    """Fire-and-forget: send a Kraken execution notification if configured.

    Fails silently — never raises. All errors are logged as warnings.
    """
    try:
        from src.volatility.models import NotificationSettings  # noqa: PLC0415
        from src.volatility.telegram import send_execution_event  # noqa: PLC0415
        notif = db.query(NotificationSettings).filter_by(profile_id=profile_id).first()
        if notif is None:
            return
        send_execution_event(
            execution_alerts_cfg=notif.execution_alerts,
            bots=notif.bots,
            event=event,
            **ctx,
        )
    except Exception:  # noqa: BLE001
        logger.warning(
            "execution_notification_failed",
            event=event,
            profile_id=profile_id,
        )
