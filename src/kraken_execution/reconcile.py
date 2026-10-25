"""
src/kraken_execution/reconcile.py

Replace ATD's theoretical PnL of a closed automated trade with the real,
net-of-costs result taken from the Kraken account log.

ATD computes PnL as (exit - entry) x virtual units, which ignores fees and
funding and drifts when sizes/fills differ from the plan. The account log gives
the exact balance effect (new_balance - old_balance) of every fill and funding
payment, so the trade result and profile.capital_current stay aligned with the
exchange.

Allocation to positions:
  - A TP/runner order's fills go straight to its own position.
  - Everything else (SL, entry fee, funding, dust / manual / liquidation fills)
    is shared across the positions that have no direct TP fill (or, when every
    position was closed by a TP, the last position).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy.orm import Session

from src.core.models.trade import Position, Trade
from src.kraken_execution.models import KrakenOrder

logger = structlog.get_logger()

MIN_AGE = timedelta(minutes=2)  # let fills reach the account log
MAX_AGE = timedelta(hours=48)

_FUNDING_INFO = "funding rate change"
_TRADE_INFOS = frozenset(
    {"futures trade", "futures liquidation", "futures partial liquidation", "futures assignor"}
)
_CENT = Decimal("0.01")


@dataclass
class LogSummary:
    gross: Decimal = Decimal("0")
    fees: Decimal = Decimal("0")  # positive = cost
    funding: Decimal = Decimal("0")  # signed balance effect (negative = paid)
    net: Decimal = Decimal("0")
    per_order: dict[str, Decimal] = field(default_factory=dict)
    executions: set[str] = field(default_factory=set)


def _dec(value: Any) -> Decimal:
    return Decimal(str(value)) if value is not None else Decimal("0")


def summarize_account_log(
    entries: list[dict], contract: str, fill_to_order: dict[str, str]
) -> LogSummary:
    """Fold account-log entries of one contract into gross / fees / funding / net."""
    s = LogSummary()
    contract = contract.lower()
    for e in entries:
        # Each fill is logged twice: once in the contract's own units (position size)
        # and once in usd (the cash effect). Only the usd leg is money.
        if e.get("asset") != "usd" or (e.get("contract") or "").lower() != contract:
            continue
        info = e.get("info")
        if info != _FUNDING_INFO and info not in _TRADE_INFOS:
            continue
        if e.get("new_balance") is not None and e.get("old_balance") is not None:
            delta = _dec(e["new_balance"]) - _dec(e["old_balance"])
        else:
            delta = _dec(e.get("realized_pnl")) - _dec(e.get("fee")) + _dec(e.get("realized_funding"))

        s.net += delta
        if info == _FUNDING_INFO:
            s.funding += delta
            continue

        s.gross += _dec(e.get("realized_pnl"))
        s.fees += _dec(e.get("fee")) + _dec(e.get("liquidation_fee"))
        s.funding += _dec(e.get("realized_funding"))  # funding settled on this fill
        execution = e.get("execution")
        if execution:
            s.executions.add(execution)
            order_id = fill_to_order.get(execution)
            if order_id:
                s.per_order[order_id] = s.per_order.get(order_id, Decimal("0")) + delta
    return s


def allocate_to_positions(
    positions: list[Position],
    direct: dict[int, Decimal],
    net_total: Decimal,
) -> dict[int, Decimal]:
    """Split net_total across position ids: direct amounts first, remainder shared.

    The returned values are quantized to cents and sum exactly to net_total (quantized).
    """
    net_q = net_total.quantize(_CENT)
    covered = {pid for pid in direct}
    uncovered = [p for p in positions if p.id not in covered]
    targets = uncovered or positions[-1:]

    remainder = net_total - sum(direct.values(), Decimal("0"))
    weight_sum = sum((p.lot_percentage for p in targets), Decimal("0"))

    raw: dict[int, Decimal] = {p.id: direct.get(p.id, Decimal("0")) for p in positions}
    for p in targets:
        share = (p.lot_percentage / weight_sum) if weight_sum > 0 else Decimal(1) / len(targets)
        raw[p.id] += remainder * share

    out = {pid: v.quantize(_CENT) for pid, v in raw.items()}
    diff = net_q - sum(out.values(), Decimal("0"))
    if diff != 0:
        out[targets[-1].id] += diff
    return out


def _ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return int(dt.timestamp() * 1000)


def reconcile_trade_pnl(trade: Trade, db: Session, client: Any) -> str:
    """Reconcile one closed automated trade against Kraken.

    Returns one of:
      "reconciled" — PnL/capital updated (or already done)
      "residual"   — Kraken still holds a position on the symbol; nothing changed
      "pending"    — account log doesn't have the fills yet (or API unavailable); retry later
      "skipped"    — not eligible
    """
    from src.trades.service import reclassify_wr_stats  # noqa: PLC0415

    if (
        trade.status != "closed"
        or not trade.automation_enabled
        or trade.pnl_source is not None
        or trade.closed_at is None
        or trade.instrument is None
    ):
        return "skipped"

    symbol = trade.instrument.symbol
    orders = db.query(KrakenOrder).filter(KrakenOrder.trade_id == trade.id).all()
    entry = min(
        (o for o in orders if o.role == "entry"), key=lambda o: o.sent_at, default=None
    )
    if entry is None:
        return "skipped"

    # A later trade on the same contract bounds the window (netted positions).
    next_entry = (
        db.query(KrakenOrder)
        .filter(
            KrakenOrder.profile_id == trade.profile_id,
            KrakenOrder.symbol == symbol,
            KrakenOrder.role == "entry",
            KrakenOrder.sent_at > entry.sent_at,
            KrakenOrder.trade_id != trade.id,
        )
        .order_by(KrakenOrder.sent_at.asc())
        .first()
    )

    if any(p.get("symbol") == symbol and abs(float(p.get("size", 0))) > 0 for p in client.get_open_positions()):
        return "residual"

    fills = client.get_fills()
    own_order_ids = {o.kraken_order_id for o in orders}
    own_fills = [f for f in fills if f.get("order_id") in own_order_ids]
    fill_to_order = {f["fill_id"]: f["order_id"] for f in own_fills if f.get("fill_id")}
    if not own_fills:
        return "pending"

    log = client.get_account_log(
        since_ms=_ms(entry.sent_at - timedelta(minutes=1)),
        before_ms=_ms(next_entry.sent_at) if next_entry else None,
    )
    summary = summarize_account_log(log, symbol, fill_to_order)
    if not set(fill_to_order) <= summary.executions:
        return "pending"

    positions = sorted(trade.positions, key=lambda p: p.position_number)
    if not positions:
        return "skipped"

    pos_by_number = {p.position_number: p for p in positions}
    runner = next((p for p in positions if p.is_runner), None)
    direct: dict[int, Decimal] = {}
    for o in orders:
        if o.role in ("tp1", "tp2", "tp3"):
            pos = pos_by_number.get(int(o.role[-1]))
        elif o.role == "runner":
            pos = runner
        else:
            continue
        if pos is not None and o.kraken_order_id in summary.per_order:
            direct[pos.id] = direct.get(pos.id, Decimal("0")) + summary.per_order[o.kraken_order_id]

    alloc = allocate_to_positions(positions, direct, summary.net)
    old_pnl = trade.realized_pnl
    new_pnl = summary.net.quantize(_CENT)

    for p in positions:
        p.realized_pnl = alloc[p.id]
    trade.realized_pnl = new_pnl
    trade.fees_paid = summary.fees.quantize(Decimal("0.0001"))
    trade.funding_paid = (-summary.funding).quantize(Decimal("0.0001"))  # positive = paid
    trade.pnl_source = "kraken"

    profile = trade.profile
    if profile is not None:
        profile.capital_current = (
            profile.capital_current + new_pnl - (old_pnl or Decimal("0"))
        ).quantize(_CENT)
        reclassify_wr_stats(db, trade, profile, old_pnl)

    db.commit()
    logger.info(
        "trade_pnl_reconciled",
        trade_id=trade.id,
        old_pnl=str(old_pnl),
        new_pnl=str(new_pnl),
        fees=str(summary.fees),
        funding=str(summary.funding),
    )
    return "reconciled"
