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
    MissingAPIKeysError,
    MissingPrecisionError,
)
from src.kraken_execution.client import KrakenExecutionClient
from src.kraken_execution.models import DEFAULT_AUTOMATION_CONFIG, AutomationSettings, KrakenOrder
from src.kraken_execution.precision import quantize_size
from src.risk_management.engine import _deep_merge

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
        ok = client.ping()
    return {
        "connected": ok,
        "demo": settings.kraken_demo or settings.environment == "dev",
        "base_url": settings.kraken_futures_base_url,
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
    return quantize_size(raw_size, instrument.contract_value_precision)


def _entry_side(trade: Trade) -> str:
    """Map trade direction to Kraken order side for the entry."""
    return "buy" if trade.direction == "long" else "sell"


def _exit_side(trade: Trade) -> str:
    """Opposite side — used for SL and TP orders."""
    return "sell" if trade.direction == "long" else "buy"


def _kraken_order_type(atd_order_type: str) -> str:
    """Map ATD order type to Kraken order type string."""
    return "lmt" if atd_order_type == "LIMIT" else "mkt"


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

    if not trade.automation_enabled:
        raise AutomationNotEnabledError(
            f"Trade {trade_id} does not have automation enabled."
        )

    instrument = _resolve_instrument(trade, db)
    lot_size = _compute_lot_size(trade, instrument)

    settings_row = get_automation_settings(trade.profile_id, db)

    with _make_client(settings_row) as client:
        kraken_type = _kraken_order_type(trade.order_type)
        limit_price = str(trade.entry_price) if trade.order_type == "LIMIT" else None

        result = client.send_order(
            order_type=kraken_type,
            symbol=instrument.symbol,
            side=_entry_side(trade),
            size=str(lot_size),
            limit_price=limit_price,
        )

    send_status = result.get("sendStatus", {})
    kraken_order_id = send_status.get("orderId", "")

    order = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=kraken_order_id,
        role="entry",
        status="open",
        order_type=kraken_type,
        symbol=instrument.symbol,
        side=_entry_side(trade),
        size=float(lot_size),
        limit_price=float(trade.entry_price) if trade.order_type == "LIMIT" else None,
    )
    db.add(order)

    trade.kraken_entry_order_id = kraken_order_id
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
    )
    sl_order_id = sl_result.get("sendStatus", {}).get("orderId", "")
    sl_order = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=sl_order_id,
        role="sl",
        status="open",
        order_type="stp",
        symbol=instrument.symbol,
        side=exit_side,
        size=float(entry_size),
        limit_price=None,
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
        tp_size = _qs(tp_size, instrument.contract_value_precision)

        tp_result = client.send_order(
            order_type="take_profit",
            symbol=instrument.symbol,
            side=exit_side,
            size=str(tp_size),
            limit_price=str(pos.take_profit_price),
            reduce_only=True,
        )
        tp_order_id = tp_result.get("sendStatus", {}).get("orderId", "")
        role = role_map.get(pos.position_number, "tp1")
        tp_order = KrakenOrder(
            trade_id=trade.id,
            profile_id=trade.profile_id,
            kraken_order_id=tp_order_id,
            role=role,
            status="open",
            order_type="take_profit",
            symbol=instrument.symbol,
            side=exit_side,
            size=float(tp_size),
            limit_price=float(pos.take_profit_price),
        )
        db.add(tp_order)
        orders.append(tp_order)

    db.commit()
    for o in orders:
        db.refresh(o)

    logger.info(
        "automation_sl_tp_placed",
        trade_id=trade.id,
        sl_order_id=sl_order_id,
        tp_count=len(open_positions),
    )
    return orders


def close_automated_trade(trade_id: int, db: Session) -> KrakenOrder:
    """Cancel all open SL/TP orders and place a market close order.

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

    close_order_id = close_result.get("sendStatus", {}).get("orderId", "")
    close_order = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=close_order_id,
        role="entry",
        status="open",
        order_type="mkt",
        symbol=instrument.symbol,
        side=_exit_side(trade),
        size=float(close_size) if close_size != "0" else 0.0,
    )
    db.add(close_order)
    db.commit()
    db.refresh(close_order)
    return close_order


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

    new_order_id = sl_result.get("sendStatus", {}).get("orderId", "")
    new_sl = KrakenOrder(
        trade_id=trade.id,
        profile_id=trade.profile_id,
        kraken_order_id=new_order_id,
        role="sl",
        status="open",
        order_type="stp",
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


def list_kraken_orders(trade_id: int, db: Session) -> list[KrakenOrder]:
    """Return all KrakenOrder rows for a trade, ordered by sent_at DESC."""
    return (
        db.query(KrakenOrder)
        .filter(KrakenOrder.trade_id == trade_id)
        .order_by(KrakenOrder.sent_at.desc())
        .all()
    )


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
