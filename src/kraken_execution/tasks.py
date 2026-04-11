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


# ── PnL helper ────────────────────────────────────────────────────────────────

def _compute_pnl_pct(direction: str, fill_price, entry_price) -> str | None:
    """Return P&L % string adjusted for direction (used for TP/SL fill events).
    Positive = profit regardless of direction.
    """
    try:
        sign = 1 if direction == "long" else -1
        pct = sign * (float(fill_price) - float(entry_price)) / float(entry_price) * 100
        return f"{pct:+.2f}"
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _compute_price_change_pct(current_price, entry_price) -> str | None:
    """Return raw price change % from entry (positive = price rose, negative = dropped).
    Used for PNL_STATUS to show where current price sits relative to entry.
    """
    try:
        pct = (float(current_price) - float(entry_price)) / float(entry_price) * 100
        return f"{pct:+.2f}"
    except (TypeError, ValueError, ZeroDivisionError):
        return None


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
        # Find all open entry orders where the trade is not yet closed.
        # We intentionally include trades with status="open" (not just "pending") to handle
        # edge cases where trade.status was manually patched while the LIMIT is still live.
        open_entries: list[KrakenOrder] = (
            db.query(KrakenOrder)
            .filter(KrakenOrder.role == "entry", KrakenOrder.status == "open")
            .join(Trade, Trade.id == KrakenOrder.trade_id)
            .filter(
                Trade.status.notin_(["closed", "cancelled"]),
                Trade.automation_enabled.is_(True),
            )
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

                # Aggregate partial fills — Kraken can send N fills for the same order_id
                # (e.g. two partial fills of 263+792 for the same LIMIT). A plain dict
                # comprehension would silently discard all but the last one.
                from collections import defaultdict  # noqa: PLC0415
                fills_by_order: dict[str, list] = defaultdict(list)
                for f in fills:
                    oid = f.get("order_id")
                    if oid:
                        fills_by_order[oid].append(f)

                def _aggregate_fills(fill_list: list) -> dict:
                    """Merge multiple partial fills into a single synthetic fill."""
                    if len(fill_list) == 1:
                        return fill_list[0]
                    total_size = sum(float(f.get("size", 0)) for f in fill_list)
                    avg_price = (
                        sum(float(f.get("price", 0)) * float(f.get("size", 0)) for f in fill_list)
                        / total_size
                        if total_size
                        else 0.0
                    )
                    latest = max(fill_list, key=lambda f: f.get("fillTime", ""))
                    return {**latest, "size": total_size, "price": avg_price}

                fill_by_order_id = {
                    oid: _aggregate_fills(fl) for oid, fl in fills_by_order.items()
                }

                for entry in entries:
                    if entry.kraken_order_id in kraken_open_ids:
                        continue  # still pending on Kraken

                    fill = fill_by_order_id.get(entry.kraken_order_id)
                    if fill is None:
                        # Order left Kraken's open book with no matching fill:
                        # it was cancelled/rejected on Kraken's side (margin check,
                        # post-only, user cancel on exchange, etc.).
                        # Mark it cancelled so the trade stops looping forever.
                        logger.warning(
                            "limit_entry_cancelled_on_kraken",
                            trade_id=entry.trade_id,
                            kraken_order_id=entry.kraken_order_id,
                        )
                        entry.status = "cancelled"
                        trade_for_cancel = db.query(Trade).filter(Trade.id == entry.trade_id).first()
                        if trade_for_cancel and trade_for_cancel.status == "pending":
                            trade_for_cancel.automation_enabled = False
                        db.commit()
                        _notify_event(
                            profile_id,
                            "ORDER_FAILED",
                            db,
                            trade_id=entry.trade_id,
                            pair=entry.symbol,
                            direction=trade_for_cancel.direction if trade_for_cancel else "",
                            error_message="Limit order disappeared from Kraken with no fill (cancelled/rejected)",
                        )
                        continue

                    fill_id = fill.get("fill_id") or fill.get("uid", "")
                    if entry.kraken_fill_id == fill_id:
                        continue  # already processed (idempotence guard)

                    # ── Phase 1: commit fill data atomically ───────────────────
                    # We commit HERE before attempting SL/TP so that a downstream
                    # Kraken rejection will never roll back the fill record.
                    from decimal import Decimal  # noqa: PLC0415
                    entry.status = "filled"
                    entry.filled_price = float(fill.get("price", 0))
                    entry.filled_size = float(fill.get("size", 0))
                    entry.filled_at = datetime.now(UTC)
                    entry.kraken_fill_id = fill_id

                    trade = db.query(Trade).filter(Trade.id == entry.trade_id).first()
                    if trade:
                        if trade.status != "open":
                            trade.status = "open"
                        # LIMIT filled → capital is now at risk.
                        # Always activate current_risk on fill, regardless of whether
                        # trade.status was already "open" (e.g. manually patched in UI).
                        if trade.risk_amount:
                            trade.current_risk = trade.risk_amount
                    filled_price = entry.filled_price
                    if trade and filled_price:
                        trade.entry_price = Decimal(str(filled_price))

                    db.commit()  # ← commit fill first — SL/TP failure must NOT undo this

                    # ── Phase 2: place SL/TP (best-effort) ────────────────────
                    # Guard: MARKET trades already have SL/TP placed by open_automated_trade.
                    # Skip if an open SL already exists to prevent duplicate placement.
                    _existing_sl = (
                        db.query(KrakenOrder)
                        .filter(
                            KrakenOrder.trade_id == entry.trade_id,
                            KrakenOrder.role == "sl",
                            KrakenOrder.status == "open",
                        )
                        .first()
                    )
                    if _existing_sl is not None:
                        logger.info(
                            "poll_pending_sl_tp_already_placed_skipping",
                            trade_id=entry.trade_id,
                        )
                    elif trade:
                        try:
                            with _make_client(settings_row) as sl_client:
                                place_sl_tp_orders(
                                    trade=trade,
                                    entry_size=Decimal(str(entry.filled_size or entry.size)),
                                    client=sl_client,
                                    db=db,
                                )
                            db.commit()
                        except Exception as sl_exc:
                            logger.error(
                                "sl_tp_placement_failed_after_fill",
                                trade_id=trade.id,
                                error=str(sl_exc),
                            )
                            _notify_event(
                                profile_id,
                                "ORDER_FAILED",
                                db,
                                trade_id=trade.id,
                                pair=trade.pair,
                                direction=trade.direction,
                                error_message=f"SL/TP placement failed after fill: {sl_exc}",
                            )

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
                        sl_price=str(trade.stop_loss) if trade and trade.stop_loss else None,
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
                fill_by_order_id = {
                    (f.get("order_id") or f.get("orderId")): f
                    for f in fills
                    if (f.get("order_id") or f.get("orderId"))
                }

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

    Delegates to the canonical partial_close / full_close from trades.service
    so that profile.capital_current and WR stats are always correctly updated.

    Both partial_close and full_close commit internally — the outer task commit
    after this call is a harmless no-op.
    """
    from decimal import Decimal  # noqa: PLC0415

    from fastapi import HTTPException  # noqa: PLC0415

    from src.trades.schemas import TradeClose, TradePartialClose  # noqa: PLC0415
    from src.trades.service import full_close, partial_close  # noqa: PLC0415

    trade = db.query(Trade).filter(Trade.id == order.trade_id).first()
    if trade is None:
        return

    fill_price = Decimal(str(order.filled_price or 0))

    if order.role == "sl":
        try:
            full_close(
                db=db,
                trade_id=trade.id,
                data=TradeClose(
                    exit_price=fill_price,
                    close_notes="SL hit via Kraken automation",
                ),
            )
        except HTTPException as exc:
            if exc.status_code == 409:
                logger.warning("sl_fill_trade_already_closed", trade_id=trade.id)
            else:
                raise
        _notify_event(
            trade.profile_id, "SL_HIT", db,
            trade_id=trade.id, pair=trade.pair, direction=trade.direction,
            filled_price=str(order.filled_price or ""),
            size=str(order.filled_size or order.size),
            pnl_pct=_compute_pnl_pct(trade.direction, fill_price, trade.entry_price),
            trade_pnl=str(trade.realized_pnl) if trade.realized_pnl is not None else None,
        )

    elif order.role in ("tp1", "tp2", "tp3"):
        tp_num = int(order.role[-1])  # "tp1" → 1
        try:
            partial_close(
                db=db,
                trade_id=trade.id,
                data=TradePartialClose(
                    position_number=tp_num,
                    exit_price=fill_price,
                ),
            )
        except HTTPException as exc:
            if exc.status_code in (409, 422):
                logger.warning(
                    "tp_fill_position_already_closed",
                    trade_id=trade.id,
                    role=order.role,
                )
            else:
                raise

        event_name = f"TP{tp_num}_TAKEN"
        _notify_event(
            trade.profile_id, event_name, db,
            trade_id=trade.id, pair=trade.pair, direction=trade.direction,
            filled_price=str(order.filled_price or ""),
            size=str(order.filled_size or order.size),
            pnl_pct=_compute_pnl_pct(trade.direction, fill_price, trade.entry_price),
            trade_pnl=str(trade.realized_pnl) if trade.realized_pnl is not None else None,
        )

        # Auto break-even on TP1 — if opted-in, move SL to entry_price automatically
        if tp_num == 1 and trade.be_on_tp1:
            try:
                db.refresh(trade)
                if trade.status in ("open", "partial") and trade.stop_loss != trade.entry_price:
                    from src.kraken_execution.service import (
                        move_to_breakeven as _kraken_be,  # noqa: PLC0415
                    )
                    from src.trades.service import move_to_breakeven as _db_be  # noqa: PLC0415
                    _db_be(db, trade.id)         # update stop_loss + current_risk in DB
                    _kraken_be(trade.id, db)     # cancel/replace SL on Kraken + BE_MOVED notif
                    logger.info("be_on_tp1_triggered", trade_id=trade.id)
            except Exception:  # noqa: BLE001
                logger.exception("be_on_tp1_auto_failed", trade_id=trade.id)


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
            .filter(Trade.status.in_(["open", "partial"]), Trade.automation_enabled.is_(True))
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
                interval_min = int(settings_row.config.get("pnl_status_interval_minutes", 60))

                with _make_client(settings_row) as client:
                    open_positions = client.get_open_positions()
                    # Tickers provide markPrice — openPositions does NOT include it
                    try:
                        tickers = client.get_tickers()
                    except Exception:  # noqa: BLE001
                        tickers = {}
                pos_by_symbol = {p.get("symbol"): p for p in open_positions}
                logger.debug(
                    "send_pnl_status: positions fetched",
                    profile_id=profile_id,
                    position_symbols=list(pos_by_symbol.keys()),
                    ticker_count=len(tickers),
                    trade_count=len(trades),
                )

                for trade in trades:
                    # Per-trade Redis cooldown
                    redis_key = f"atd:pnl_status_sent:{profile_id}:{trade.id}"
                    try:
                        from src.volatility.cache import _get_redis  # noqa: PLC0415
                        r = _get_redis()
                        if r.get(redis_key):
                            logger.debug(
                                "send_pnl_status: cooldown active, skipping",
                                trade_id=trade.id,
                                profile_id=profile_id,
                            )
                            continue
                        r.setex(redis_key, interval_min * 60, "1")
                    except Exception:  # noqa: BLE001
                        pass  # Redis unavailable — proceed without cooldown

                    instr = trade.instrument
                    symbol = instr.symbol if instr else None
                    pos = pos_by_symbol.get(symbol, {}) if symbol else {}
                    ticker = tickers.get(symbol, {}) if symbol else {}

                    # markPrice comes from tickers — openPositions returns no live price
                    raw_mark = ticker.get("markPrice") or ticker.get("last")
                    current_price = str(raw_mark) if raw_mark is not None else None

                    # Unrealized PnL in quote currency (size × price diff)
                    unrealized_pnl: float | None = None
                    pos_size = pos.get("size")
                    if raw_mark is not None and pos_size:
                        try:
                            cp = float(raw_mark)
                            ep = float(trade.entry_price)
                            sz = float(pos_size)
                            if trade.direction == "long":
                                unrealized_pnl = round(sz * (cp - ep), 2)
                            else:
                                unrealized_pnl = round(sz * (ep - cp), 2)
                        except (TypeError, ValueError):
                            pass

                    pnl_pct = _compute_price_change_pct(current_price, trade.entry_price)

                    # TPs from the positions relationship (sorted by position_number)
                    tp_ctx: dict[str, str | None] = {}
                    for p in sorted(trade.positions, key=lambda x: x.position_number):
                        if p.status != "cancelled":
                            tp_ctx[f"tp{p.position_number}_price"] = str(p.take_profit_price)

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
                        pnl_pct=pnl_pct,
                        sl_price=str(trade.stop_loss) if trade.stop_loss else None,
                        **tp_ctx,
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
