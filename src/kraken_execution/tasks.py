"""
src/kraken_execution/tasks.py

Phase 5 — Celery tasks for Kraken Futures execution automation.

Tasks:
  poll_pending_orders  (every 30s) — detect LIMIT entry fills; place SL/TP after fill
  sync_open_positions  (every 60s) — detect SL/TP fills; reconcile trade lifecycle
  send_pnl_status      (configurable) — push unrealized PnL to Telegram per open trade

Idempotence:
  - kraken_fill_id UNIQUE constraint prevents double-processing fills.
  - On worker restart: tasks re-query DB state and skip already-processed fills.
"""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from celery import Task
from celery.exceptions import MaxRetriesExceededError
from sqlalchemy.orm import Session

from src.core.celery_app import celery_app
from src.core.models.trade import Trade
from src.kraken_execution import KrakenAPIError, MissingAPIKeysError
from src.kraken_execution.models import KrakenOrder
from src.kraken_execution.service import (
    _make_client,
    get_automation_settings,
    place_sl_tp_orders,
)

logger = structlog.get_logger()


# ── DB helper (mirrors pattern from volatility/tasks.py) ─────────────────────

def _get_db() -> Session:
    from src.core.database import get_session_factory  # noqa: PLC0415

    return get_session_factory()()

# ── Notification helper ──────────────────────────────────────────────────────

def _notify_event(profile_id: int, event: str, db: Session, **ctx) -> None:
    """Fire-and-forget notification dispatch from tasks. Fails silently."""
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
        logger.warning("tasks.notification_failed", event=event, profile_id=profile_id)

# ── poll_pending_orders ───────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="src.kraken_execution.tasks.poll_pending_orders",
    max_retries=3,
    default_retry_delay=30,
)
def poll_pending_orders(self: Task) -> dict:
    """Check if pending LIMIT entry orders have been filled on Kraken.

    For each profile with open entry orders:
      1. Fetch open orders from Kraken.
      2. If our entry order is NOT in the open orders list → look for a fill.
      3. On fill found: update KrakenOrder, update Trade status, place SL/TP.

    Returns:
        {"processed": int} — count of fills processed.
    """
    db = _get_db()
    processed = 0
    try:
        # Find all open entry orders where the trade is still pending (LIMIT)
        open_entries: list[KrakenOrder] = (
            db.query(KrakenOrder)
            .filter(KrakenOrder.role == "entry", KrakenOrder.status == "open")
            .join(Trade, Trade.id == KrakenOrder.trade_id)
            .filter(Trade.status == "pending", Trade.automation_enabled.is_(True))
            .all()
        )

        if not open_entries:
            return {"processed": 0}

        # Group by profile to minimise API calls
        by_profile: dict[int, list[KrakenOrder]] = {}
        for entry in open_entries:
            by_profile.setdefault(entry.profile_id, []).append(entry)

        for profile_id, entries in by_profile.items():
            try:
                settings_row = get_automation_settings(profile_id, db)
                with _make_client(settings_row) as client:
                    kraken_open_ids = {
                        o.get("order_id") for o in client.get_open_orders()
                    }
                    fills = client.get_fills()
                    fill_by_order_id = {f.get("order_id"): f for f in fills}

                for entry in entries:
                    if entry.kraken_order_id in kraken_open_ids:
                        continue  # still pending on Kraken

                    fill = fill_by_order_id.get(entry.kraken_order_id)
                    if fill is None:
                        continue  # no fill found yet — check again next cycle

                    fill_id = fill.get("fill_id") or fill.get("uid", "")
                    if entry.kraken_fill_id == fill_id:
                        continue  # already processed (idempotence guard)

                    # Mark entry as filled
                    entry.status = "filled"
                    entry.filled_price = float(fill.get("price", 0))
                    entry.filled_size = float(fill.get("size", 0))
                    entry.filled_at = datetime.now(UTC)
                    entry.kraken_fill_id = fill_id

                    # Update trade: open, update entry_price to filled price
                    trade = db.query(Trade).filter(Trade.id == entry.trade_id).first()
                    if trade:
                        trade.status = "open"
                        filled_price = entry.filled_price
                        if filled_price:
                            from decimal import Decimal  # noqa: PLC0415
                            trade.entry_price = Decimal(str(filled_price))

                        # Place SL + TP orders
                        with _make_client(settings_row) as sl_client:
                            place_sl_tp_orders(
                                trade=trade,
                                entry_size=Decimal(str(entry.filled_size or entry.size)),
                                client=sl_client,
                                db=db,
                            )

                    db.commit()
                    processed += 1
                    logger.info(
                        "limit_entry_filled",
                        trade_id=entry.trade_id,
                        kraken_order_id=entry.kraken_order_id,
                        filled_price=entry.filled_price,
                    )
                    # Notify: LIMIT_FILLED then TRADE_OPENED (entry confirmed)
                    _ctx = dict(
                        trade_id=entry.trade_id,
                        pair=trade.pair if trade else "—",
                        direction=trade.direction if trade else "",
                        size=str(entry.filled_size or entry.size),
                        filled_price=str(entry.filled_price or ""),
                    )
                    _notify_event(profile_id, "LIMIT_FILLED", db, **_ctx)
                    _notify_event(profile_id, "TRADE_OPENED", db, **_ctx)

            except MissingAPIKeysError:
                logger.warning("poll_pending_orders: missing API keys", profile_id=profile_id)
            except KrakenAPIError as exc:
                logger.error(
                    "poll_pending_orders: Kraken API error",
                    profile_id=profile_id,
                    status_code=exc.status_code,
                )
            except Exception as exc:
                logger.exception(
                    "poll_pending_orders: unexpected error", profile_id=profile_id, exc=exc
                )

        return {"processed": processed}

    except Exception as exc:
        logger.exception("poll_pending_orders: fatal error — %s", exc)
        try:
            raise self.retry(exc=exc, countdown=30)
        except MaxRetriesExceededError:
            return {"processed": processed, "error": str(exc)}
    finally:
        db.close()


# ── sync_open_positions ───────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="src.kraken_execution.tasks.sync_open_positions",
    max_retries=3,
    default_retry_delay=60,
)
def sync_open_positions(self: Task) -> dict:
    """Detect SL/TP fills and reconcile open automated trades.

    For each profile with open SL/TP orders:
      1. Fetch recent fills from Kraken.
      2. Match fills against our open KrakenOrder rows by order_id.
      3. On fill: update KrakenOrder, update Trade/Position accordingly.

    Returns:
        {"processed": int}
    """
    db = _get_db()
    processed = 0
    try:
        # Find all open SL/TP orders for active automated trades
        open_orders: list[KrakenOrder] = (
            db.query(KrakenOrder)
            .filter(
                KrakenOrder.role.in_(["sl", "tp1", "tp2", "tp3"]),
                KrakenOrder.status == "open",
            )
            .join(Trade, Trade.id == KrakenOrder.trade_id)
            .filter(Trade.status == "open", Trade.automation_enabled.is_(True))
            .all()
        )

        if not open_orders:
            return {"processed": 0}

        by_profile: dict[int, list[KrakenOrder]] = {}
        for order in open_orders:
            by_profile.setdefault(order.profile_id, []).append(order)

        for profile_id, orders in by_profile.items():
            try:
                settings_row = get_automation_settings(profile_id, db)
                with _make_client(settings_row) as client:
                    fills = client.get_fills()
                fill_by_order_id = {f.get("order_id"): f for f in fills}

                for order in orders:
                    fill = fill_by_order_id.get(order.kraken_order_id)
                    if fill is None:
                        continue

                    fill_id = fill.get("fill_id") or fill.get("uid", "")
                    if order.kraken_fill_id == fill_id:
                        continue  # idempotence guard

                    order.status = "filled"
                    order.filled_price = float(fill.get("price", 0))
                    order.filled_size = float(fill.get("size", 0))
                    order.filled_at = datetime.now(UTC)
                    order.kraken_fill_id = fill_id

                    _handle_fill(order, db)
                    db.commit()
                    processed += 1

                    logger.info(
                        "automation_fill_detected",
                        trade_id=order.trade_id,
                        role=order.role,
                        kraken_order_id=order.kraken_order_id,
                        filled_price=order.filled_price,
                    )

            except MissingAPIKeysError:
                logger.warning("sync_open_positions: missing API keys", profile_id=profile_id)
            except KrakenAPIError as exc:
                logger.error(
                    "sync_open_positions: Kraken API error",
                    profile_id=profile_id,
                    status_code=exc.status_code,
                )
            except Exception as exc:
                logger.exception(
                    "sync_open_positions: unexpected error", profile_id=profile_id, exc=exc
                )

        return {"processed": processed}

    except Exception as exc:
        logger.exception("sync_open_positions: fatal error — %s", exc)
        try:
            raise self.retry(exc=exc, countdown=60)
        except MaxRetriesExceededError:
            return {"processed": processed, "error": str(exc)}
    finally:
        db.close()


# ── Fill handler ──────────────────────────────────────────────────────────────

def _handle_fill(order: KrakenOrder, db: Session) -> None:
    """Update Trade/Position state based on a freshly-detected fill.

    Called from sync_open_positions for each matched fill.
    Does NOT commit — caller commits after all fills for a profile are processed.
    """
    from decimal import Decimal  # noqa: PLC0415

    trade = db.query(Trade).filter(Trade.id == order.trade_id).first()
    if trade is None:
        return

    if order.role == "sl":
        _close_trade(trade, filled_price=order.filled_price, db=db)
        _notify_event(
            trade.profile_id, "SL_HIT", db,
            trade_id=trade.id, pair=trade.pair, direction=trade.direction,
            filled_price=str(order.filled_price or ""),
            size=str(order.filled_size or order.size),
        )

    elif order.role in ("tp1", "tp2", "tp3"):
        tp_num = int(order.role[-1])  # "tp1" → 1
        for pos in trade.positions:
            if pos.position_number == tp_num and pos.status == "open":
                pos.status = "closed"
                pos.exit_price = Decimal(str(order.filled_price or 0))
                pos.exit_date = datetime.now(UTC)
                from decimal import Decimal as _D  # noqa: PLC0415
                pos.realized_pnl = (
                    (pos.exit_price - trade.entry_price)
                    * _D(str(pos.lot_percentage / 100))
                    * _D(str(order.filled_size or 0))
                    * (1 if trade.direction == "long" else -1)
                )
                break

        event_name = f"TP{tp_num}_TAKEN"
        _notify_event(
            trade.profile_id, event_name, db,
            trade_id=trade.id, pair=trade.pair, direction=trade.direction,
            filled_price=str(order.filled_price or ""),
            size=str(order.filled_size or order.size),
        )

        # If all positions are closed → close the trade
        all_closed = all(p.status in ("closed", "cancelled") for p in trade.positions)
        if all_closed:
            _close_trade(trade, filled_price=order.filled_price, db=db)


def _close_trade(trade: Trade, filled_price: float | None, db: Session) -> None:
    """Mark trade as closed and update capital (simplified — full PnL calc in trade service)."""
    from decimal import Decimal  # noqa: PLC0415

    trade.status = "closed"
    trade.closed_at = datetime.now(UTC)
    if filled_price:
        trade.realized_pnl = (
            (Decimal(str(filled_price)) - trade.entry_price)
            * trade.risk_amount
            / abs(trade.entry_price - trade.stop_loss)
            * (1 if trade.direction == "long" else -1)
        )


# ── send_pnl_status ───────────────────────────────────────────────────────────────

@celery_app.task(
    bind=True,
    name="src.kraken_execution.tasks.send_pnl_status",
    max_retries=2,
    default_retry_delay=60,
)
def send_pnl_status(self: Task) -> dict:  # noqa: ARG001
    """Push unrealized PnL to Telegram for each open automated trade.

    Interval: controlled by automation_settings.config["pnl_status_interval_minutes"].
    Fetches current positions from Kraken and dispatches PNL_STATUS notifications.

    Returns:
        {"notified": int} — count of notifications sent.
    """
    db = _get_db()
    notified = 0
    try:
        open_trades: list[Trade] = (
            db.query(Trade)
            .filter(Trade.status == "open", Trade.automation_enabled.is_(True))
            .all()
        )
        if not open_trades:
            return {"notified": 0}

        by_profile: dict[int, list[Trade]] = {}
        for trade in open_trades:
            by_profile.setdefault(trade.profile_id, []).append(trade)

        for profile_id, trades in by_profile.items():
            try:
                settings_row = get_automation_settings(profile_id, db)
                with _make_client(settings_row) as client:
                    open_positions = client.get_open_positions()
                pos_by_symbol = {p.get("symbol"): p for p in open_positions}

                for trade in trades:
                    instr = trade.instrument
                    symbol = instr.symbol if instr else None
                    pos = pos_by_symbol.get(symbol, {}) if symbol else {}
                    unrealized_pnl = pos.get("unrealisedPnl") or pos.get("pnl")
                    current_price = pos.get("markPrice") or pos.get("lastPrice")

                    _notify_event(
                        profile_id,
                        "PNL_STATUS",
                        db,
                        trade_id=trade.id,
                        pair=trade.pair,
                        direction=trade.direction,
                        entry_price=str(trade.entry_price),
                        unrealized_pnl=unrealized_pnl,
                        current_price=current_price,
                    )
                    notified += 1

            except MissingAPIKeysError:
                logger.warning("send_pnl_status: missing API keys", profile_id=profile_id)
            except KrakenAPIError as exc:
                logger.error(
                    "send_pnl_status: Kraken API error",
                    profile_id=profile_id,
                    status_code=exc.status_code,
                )
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "send_pnl_status: unexpected error", profile_id=profile_id, exc=exc
                )

        return {"notified": notified}
    except Exception as exc:  # noqa: BLE001
        logger.exception("send_pnl_status: fatal error — %s", exc)
        return {"notified": notified, "error": str(exc)}
    finally:
        db.close()
