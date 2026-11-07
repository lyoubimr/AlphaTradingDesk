"""
src/kraken_execution/preflight.py

Pre-flight margin math for automated Kraken entries (pure functions, no I/O).

Two conditions must hold before an entry is sent:
  entry : available >= initial_margin x (1 + buffer)
          Kraken's real requirement runs above notional / leverage (fees, price
          variance on MARKET orders, internal buffers).
  stop  : available >= initial_margin + risk_at_stop + reserve
          When the stop is hit, free margin must still cover the closing order.
          Kraken refuses even reduce-only closes otherwise ("insufficient closing
          margin") and the stop-loss silently fails.

Both are linear in the lot size, so the largest passing position is
available / (needed / lot) — the nearest position to the one requested.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

# Percent of notional held back for entry taker fee (0.05%) + closing order.
# Calibrated on DOGE trade 158 (2026-11-07): closes were refused with 1.43 USD
# free (0.16% of notional) and accepted with 2.09 USD (0.24%) -> 0.30% closing
# reserve. Not Kraken's published formula; keep conservative.
EXIT_RESERVE_PCT = Decimal("0.35")

_ZERO = Decimal("0")


@dataclass(frozen=True)
class MarginCheck:
    ok: bool
    binding: str                 # "entry" | "stop" — the condition that sets the limit
    available: Decimal
    initial_margin: Decimal
    risk_at_stop: Decimal
    reserve: Decimal
    needed: Decimal
    shortfall: Decimal           # needed - available (0 when ok)
    max_lot_raw: Decimal         # largest unquantized lot that passes


def check_entry_margin(
    *,
    available: Decimal,
    lot: Decimal,
    entry: Decimal,
    stop_loss: Decimal | None,
    leverage: Decimal,
    buffer_pct: Decimal,
    reserve_pct: Decimal = EXIT_RESERVE_PCT,
) -> MarginCheck:
    """Evaluate both margin conditions for `lot` units at `entry`."""
    initial_margin = lot * entry / leverage
    risk = lot * abs(entry - stop_loss) if stop_loss is not None else _ZERO
    reserve = lot * entry * reserve_pct / Decimal("100")

    needed_entry = initial_margin * (Decimal("1") + buffer_pct / Decimal("100"))
    needed_stop = initial_margin + risk + reserve
    binding = "entry" if needed_entry >= needed_stop else "stop"
    needed = max(needed_entry, needed_stop)

    max_lot = available / (needed / lot) if lot > 0 and needed > 0 else _ZERO
    return MarginCheck(
        ok=available >= needed,
        binding=binding,
        available=available,
        initial_margin=initial_margin,
        risk_at_stop=risk,
        reserve=reserve,
        needed=needed,
        shortfall=max(needed - available, _ZERO),
        max_lot_raw=max_lot,
    )


def _usd(value: Decimal) -> str:
    return f"{value:,.2f}"


def _units(value: Decimal) -> str:
    text = f"{value:,.4f}".rstrip("0").rstrip(".")
    return text or "0"


def format_margin_error(
    check: MarginCheck,
    *,
    symbol: str,
    lot: Decimal,
    max_lot: Decimal | None,
    entry: Decimal,
    stop_loss: Decimal | None,
    leverage: Decimal,
    buffer_pct: Decimal,
) -> str:
    """Plain-text, multi-line explanation with the nearest valid position and next steps."""
    notional = lot * entry
    lines: list[str] = []

    if check.binding == "stop":
        free_after = check.available - check.initial_margin
        lines += [
            "Trade not sent to Kraken: your account could not survive its own stop-loss.",
            "",
            "What we found",
            f"- Kraken locks {_usd(check.initial_margin)} USD for this position "
            f"({_usd(notional)} USD at x{int(leverage)}).",
            f"- Free margin left after opening: {_usd(free_after)} USD.",
            f"- If the stop-loss{f' at {stop_loss}' if stop_loss is not None else ''} is hit you lose "
            f"{_usd(check.risk_at_stop)} USD, plus about {_usd(check.reserve)} USD of fees and closing reserve.",
            f"- Free margin would drop to {_usd(free_after - check.risk_at_stop - check.reserve)} USD. "
            'In that state Kraken refuses even closing orders ("insufficient closing margin"), '
            "so the stop can fail to execute and the position stays open and unprotected.",
        ]
    else:
        lines += [
            "Trade not sent to Kraken: not enough free margin to open it safely.",
            "",
            "What we found",
            f"- Needed: {_usd(check.needed)} USD = {_usd(check.initial_margin)} USD margin "
            f"({_usd(notional)} USD at x{int(leverage)}) + {buffer_pct:.0f}% safety buffer "
            "(Kraken's real requirement runs above the raw figure).",
            f"- Available on Kraken: {_usd(check.available)} USD (short by {_usd(check.shortfall)} USD).",
        ]

    lines.append("")
    if max_lot is None:
        lines += [
            "Even the smallest order does not fit with the current balance.",
            "",
            "How to fix",
            f"1. Deposit at least {_usd(check.shortfall)} USD on Kraken, then resubmit.",
            "2. Or close/reduce another position, or cancel open orders that lock margin.",
        ]
        return "\n".join(lines)

    per_unit_risk = abs(entry - stop_loss) if stop_loss is not None else _ZERO
    new_risk = max_lot * per_unit_risk
    reduction = (Decimal("1") - max_lot / lot) * Decimal("100")
    if stop_loss is not None:
        detail = f"risk {_usd(new_risk)} USD instead of {_usd(check.risk_at_stop)} USD"
    else:
        detail = f"instead of {_units(lot)} units"
    lines += [
        f"Largest position that passes: {_units(max_lot)} units of {symbol} "
        f"({detail}, {reduction:.1f}% smaller than requested).",
        "",
        "How to fix (pick one)",
    ]
    if stop_loss is not None:
        lines.append(f"1. Lower this trade's risk to about {_usd(new_risk)} USD and resubmit.")
    else:
        lines.append(f"1. Reduce the position to {_units(max_lot)} units or fewer and resubmit.")
    lines += [
        f"2. Or deposit at least {_usd(check.shortfall)} USD on Kraken to keep the planned size.",
        "3. Or close/reduce another position, or cancel open orders that lock margin.",
    ]
    return "\n".join(lines)
