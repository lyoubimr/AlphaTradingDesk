"""
src/kraken_execution/fills.py

Fill helpers shared by the on-demand sync (service) and the Celery sync (tasks).
"""

from __future__ import annotations

from decimal import Decimal


def aggregate_fills_by_order(fills: list[dict]) -> dict[str, dict]:
    """Merge every fill chunk of an order into one synthetic fill.

    Kraken can split one order into N fills; keeping only one chunk loses size
    and gives a wrong exit price. Result per order_id:
        {"fill_id": <last chunk id>, "price": <size-weighted avg>, "size": <total>}
    """
    chunks_by_order: dict[str, list[dict]] = {}
    for f in fills:
        oid = f.get("order_id") or f.get("orderId")
        if oid:
            chunks_by_order.setdefault(oid, []).append(f)

    out: dict[str, dict] = {}
    for oid, chunks in chunks_by_order.items():
        total = sum((Decimal(str(c.get("size", 0))) for c in chunks), Decimal("0"))
        if total > 0:
            price = sum(
                (Decimal(str(c.get("price", 0))) * Decimal(str(c.get("size", 0))) for c in chunks),
                Decimal("0"),
            ) / total
        else:
            price = Decimal(str(chunks[-1].get("price", 0)))
        out[oid] = {
            "fill_id": chunks[-1].get("fill_id") or chunks[-1].get("uid", ""),
            "price": price,
            "size": total,
        }
    return out


def is_fully_filled(fill: dict, order_size) -> bool:
    """False while an aggregated fill is still smaller than the order size."""
    return Decimal(str(fill.get("size", 0))) >= Decimal(str(order_size or 0))


def find_order_end_reason(events: list[dict], order_id: str) -> str | None:
    """Explain why an order left Kraken's book without a fill, from order-history events."""
    for el in events:
        ev = el.get("event") or {}
        rejected = ev.get("OrderRejected")
        if rejected and (rejected.get("order") or {}).get("uid") == order_id:
            return (
                f"rejected by Kraken: {rejected.get('orderError')} "
                f"(reason: {rejected.get('reason')})"
            )
        cancelled = ev.get("OrderCancelled")
        if cancelled and (cancelled.get("order") or {}).get("uid") == order_id:
            return (
                f"cancelled on Kraken (reason: {cancelled.get('reason')}, "
                f"origin: {cancelled.get('origin')})"
            )
    return None
