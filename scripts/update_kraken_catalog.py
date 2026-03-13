#!/usr/bin/env python3
"""
Refresh the Kraken perpetual futures catalog in seed_instruments.py.

Fetches all tradeable PF_* flexible_futures from the Kraken Futures API,
derives max_leverage from retailMarginLevels, min_lot from
contractValueTradePrecision, and rewrites the KRAKEN_INSTRUMENTS list in
database/migrations/seeds/seed_instruments.py in-place.

Usage:
    .venv/bin/python scripts/update_kraken_catalog.py [--dry-run]

    --dry-run   Print generated code without modifying seed_instruments.py
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.request
from decimal import Decimal
from pathlib import Path

API_URL = "https://futures.kraken.com/derivatives/api/v3/instruments"
SEED_FILE = Path(__file__).parent.parent / "database/migrations/seeds/seed_instruments.py"

# ---------------------------------------------------------------------------
# Leverage tier bucketing (based on retailMarginLevels[0].initialMargin)
# ---------------------------------------------------------------------------
# 1/initialMargin → raw leverage → round to closest recognised tier
_TIERS: list[tuple[float, int]] = [
    (0.021, 50),   # ≤2%  initialMargin → 50×
    (0.045, 25),   # 2-4% → 25×
    (0.09, 20),    # 5%   → 20×
    (0.15, 10),    # 10%  → 10×
    (0.25, 5),     # 20%  → 5×
    (1.00, 2),     # 50%  → 2×
]


def _retail_max_leverage(instrument: dict) -> int:
    levels: list[dict] = instrument.get("retailMarginLevels") or []
    if not levels:
        # Fallback to top-level marginLevels
        levels = instrument.get("marginLevels") or []
    if not levels:
        return 5

    first_im: float = float(levels[0].get("initialMargin", 0.5))
    for threshold, lev in _TIERS:
        if first_im <= threshold:
            return lev
    return 2


def _min_lot(instrument: dict) -> Decimal:
    """Derive minimum contract size from contractValueTradePrecision.

    contractValueTradePrecision (int):
        positive n → 1 unit has n decimal digits → min_lot = 10^(-n)
        negative n → min_lot = 10^abs(n)  (e.g. -2 → 100)
    """
    prec: int = instrument.get("contractValueTradePrecision", 0)
    if prec >= 0:
        return Decimal(10) ** -prec
    else:
        return Decimal(10) ** abs(prec)


def _display_name(instrument: dict) -> str:
    base: str = instrument.get("base", "")
    if not base:
        # Derive from symbol: PF_XXXUSD → XXX  /  PF_XXXUSDT → XXX
        sym = instrument["symbol"].lstrip("PF_")
        base = re.sub(r"USDT?$", "", sym)
    return f"{base} Perp"


# ---------------------------------------------------------------------------
# Tier grouping
# ---------------------------------------------------------------------------
_TIER_HEADERS: dict[int, str] = {
    50: "Tier 1: BTC + ETH — max 50×",
    25: "Tier 2: Large caps — max 25×",
    20: "Tier 3 (20×)",
    10: "Tier 3: Mid caps — max 10×",
    5:  "Tier 4: Small caps / Meme — max 5×",
    2:  "Tier 5: Very low leverage — max 2×",
}

_LINE_LEN = 105  # target column for comment dashes


def _format_row(inst: dict, lev: int) -> str:
    symbol = inst["symbol"]
    display = _display_name(inst)
    min_lot = _min_lot(inst)

    # Normalise Decimal representation: avoid scientific notation
    min_lot_str = format(min_lot.normalize(), "f")

    sym_field   = f'"{symbol}",'
    name_field  = f'"display_name": "{display}",'
    lot_field   = f'"min_lot": Decimal("{min_lot_str}"),'
    lev_field   = f'"max_leverage": {lev},'
    base_field  = "**_KRAKEN_BASE},"

    return (
        f"    {{\"symbol\": {sym_field:<22} "
        f"{name_field:<42} "
        f"{lot_field:<26} "
        f"{lev_field:<18} "
        f"{base_field}"
    )


def _build_instrument_list(instruments: list[dict]) -> str:
    buckets: dict[int, list[dict]] = {}
    for inst in instruments:
        lev = _retail_max_leverage(inst)
        buckets.setdefault(lev, []).append(inst)

    lines: list[str] = ["KRAKEN_INSTRUMENTS: list[dict] = ["]

    for tier_lev in sorted(buckets, reverse=True):
        header = _TIER_HEADERS.get(tier_lev, f"Tier: max {tier_lev}×")
        dashes = "─" * max(4, _LINE_LEN - len(header) - 8)
        lines.append(f"    # ── {header} {dashes}")

        sorted_insts = sorted(buckets[tier_lev], key=lambda x: x["symbol"])
        for inst in sorted_insts:
            lines.append(_format_row(inst, tier_lev))
        lines.append("")

    # Remove trailing blank line inside the list
    if lines[-1] == "":
        lines.pop()
    lines.append("]")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Patch seed_instruments.py in-place
# ---------------------------------------------------------------------------
_BLOCK_RE = re.compile(
    r"(KRAKEN_INSTRUMENTS: list\[dict\] = \[).*?^(\])",
    re.DOTALL | re.MULTILINE,
)


def _patch_seed_file(new_block: str) -> None:
    original = SEED_FILE.read_text(encoding="utf-8")
    if not _BLOCK_RE.search(original):
        print("ERROR: Could not find KRAKEN_INSTRUMENTS block in seed file.", file=sys.stderr)
        sys.exit(1)

    patched = _BLOCK_RE.sub(new_block, original, count=1)
    SEED_FILE.write_text(patched, encoding="utf-8")
    print(f"✓ Updated {SEED_FILE}")


# ---------------------------------------------------------------------------
# Also patch docstring count
# ---------------------------------------------------------------------------
def _patch_docstring(text: str, count: int) -> str:
    return re.sub(
        r"(Kraken: )\d+( Perpetual Futures)",
        rf"\g<1>{count}\g<2>",
        text,
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print generated code without writing to disk")
    args = parser.parse_args()

    print(f"Fetching {API_URL} …")
    try:
        with urllib.request.urlopen(API_URL, timeout=30) as resp:
            raw = json.loads(resp.read())
    except Exception as exc:
        print(f"ERROR fetching API: {exc}", file=sys.stderr)
        sys.exit(1)

    all_instruments: list[dict] = raw.get("instruments", [])

    # Filter: PF_* flexible_futures that are tradeable
    pf = [
        i for i in all_instruments
        if i.get("symbol", "").startswith("PF_")
        and i.get("type") == "flexible_futures"
        and i.get("tradeable") is True
    ]

    print(f"Found {len(pf)} tradeable PF_* perpetual futures\n")

    new_block = _build_instrument_list(pf)

    if args.dry_run:
        print(new_block)
        return

    # Patch the seed file
    original = SEED_FILE.read_text(encoding="utf-8")
    if not _BLOCK_RE.search(original):
        print("ERROR: Could not locate KRAKEN_INSTRUMENTS block.", file=sys.stderr)
        sys.exit(1)

    patched = _BLOCK_RE.sub(new_block, original, count=1)
    patched = _patch_docstring(patched, len(pf))
    SEED_FILE.write_text(patched, encoding="utf-8")
    print(f"✓ seed_instruments.py updated — {len(pf)} Kraken perps")

    # Brief summary by tier
    from collections import Counter
    tiers = Counter(_retail_max_leverage(i) for i in pf)
    for lev in sorted(tiers, reverse=True):
        print(f"   {lev:3d}×  → {tiers[lev]:3d} instruments")


if __name__ == "__main__":
    main()
