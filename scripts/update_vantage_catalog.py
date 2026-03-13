#!/usr/bin/env python3
"""
Refresh the Vantage CFD instrument catalog in seed_instruments.py.

Vantage Markets (https://www.vantagemarkets.com) does not expose a public
REST API catalog, so this script holds a curated offline catalog that
mirrors the instruments available on Standard/STP accounts (MT4/MT5).

Instrument data is based on Vantage contract spec documentation (2025-Q4).
Re-run this script whenever Vantage adds or removes instruments.

Usage:
    .venv/bin/python scripts/update_vantage_catalog.py [--dry-run]

    --dry-run   Print the generated block without modifying seed_instruments.py
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SEED_FILE = Path(__file__).parent.parent / "database/migrations/seeds/seed_instruments.py"

# ---------------------------------------------------------------------------
# Curated catalog
# ---------------------------------------------------------------------------
# Each entry maps 1-to-1 to an Instrument row.
# pip_size / tick_value are per 1 mini-lot (0.01) on a 100,000-unit contract.
# tick_value is approximate (USD, at rates as of 2025-Q4); used for display
# and risk annotation only — not in hard calculations.

CATALOG: list[dict] = [

    # ══════════════════════════════════════════════════════════════════════
    # METALS
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "XAUUSD",  "display_name": "Gold",          "asset_class": "Commodities", "pip_size": "0.01",     "tick_value": "1.00",   "min_lot": "0.01"},
    {"symbol": "XAGUSD",  "display_name": "Silver",        "asset_class": "Commodities", "pip_size": "0.001",    "tick_value": "5.00",   "min_lot": "0.01"},
    {"symbol": "XPTUSD",  "display_name": "Platinum",      "asset_class": "Commodities", "pip_size": "0.01",     "tick_value": "1.00",   "min_lot": "0.01"},
    {"symbol": "XPDUSD",  "display_name": "Palladium",     "asset_class": "Commodities", "pip_size": "0.01",     "tick_value": "1.00",   "min_lot": "0.01"},
    {"symbol": "XCUUSD",  "display_name": "Copper",        "asset_class": "Commodities", "pip_size": "0.001",    "tick_value": "1.00",   "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # ENERGY
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "XTIUSD",  "display_name": "WTI Crude Oil", "asset_class": "Commodities", "pip_size": "0.01",     "tick_value": "1.00",   "min_lot": "0.01"},
    {"symbol": "XBRUSD",  "display_name": "Brent Crude",   "asset_class": "Commodities", "pip_size": "0.01",     "tick_value": "1.00",   "min_lot": "0.01"},
    {"symbol": "XNGUSD",  "display_name": "Natural Gas",   "asset_class": "Commodities", "pip_size": "0.001",    "tick_value": "1.00",   "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # SOFT COMMODITIES
    # Note: symbol names may carry a suffix (.c / _USD) depending on account
    # type — add custom instruments if your broker uses a different suffix.
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "COFFEE",  "display_name": "Coffee (Arabica)", "asset_class": "Commodities", "pip_size": "0.001",  "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "SUGAR",   "display_name": "Sugar No. 11",     "asset_class": "Commodities", "pip_size": "0.00001","tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "WHEAT",   "display_name": "Wheat",            "asset_class": "Commodities", "pip_size": "0.001",  "tick_value": "5.00",  "min_lot": "0.01"},
    {"symbol": "CORN",    "display_name": "Corn",             "asset_class": "Commodities", "pip_size": "0.001",  "tick_value": "5.00",  "min_lot": "0.01"},
    {"symbol": "COTTON",  "display_name": "Cotton",           "asset_class": "Commodities", "pip_size": "0.0001", "tick_value": "5.00",  "min_lot": "0.01"},
    {"symbol": "COCOA",   "display_name": "Cocoa",            "asset_class": "Commodities", "pip_size": "0.01",   "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "SOYBEAN", "display_name": "Soybean",          "asset_class": "Commodities", "pip_size": "0.001",  "tick_value": "5.00",  "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # CRYPTO CFD
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "BTCUSD",  "display_name": "Bitcoin CFD",    "asset_class": "Crypto", "pip_size": "1.0",      "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "ETHUSD",  "display_name": "Ethereum CFD",   "asset_class": "Crypto", "pip_size": "0.1",      "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "BNBUSD",  "display_name": "BNB CFD",        "asset_class": "Crypto", "pip_size": "0.1",      "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "SOLUSD",  "display_name": "Solana CFD",     "asset_class": "Crypto", "pip_size": "0.01",     "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "XRPUSD",  "display_name": "Ripple CFD",     "asset_class": "Crypto", "pip_size": "0.0001",   "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "ADAUSD",  "display_name": "Cardano CFD",    "asset_class": "Crypto", "pip_size": "0.0001",   "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "DOGEUSD", "display_name": "Dogecoin CFD",   "asset_class": "Crypto", "pip_size": "0.00001",  "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "LTCUSD",  "display_name": "Litecoin CFD",   "asset_class": "Crypto", "pip_size": "0.01",     "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "LINKUSD", "display_name": "Chainlink CFD",  "asset_class": "Crypto", "pip_size": "0.001",    "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "DOTUSD",  "display_name": "Polkadot CFD",   "asset_class": "Crypto", "pip_size": "0.001",    "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "AVAXUSD", "display_name": "Avalanche CFD",  "asset_class": "Crypto", "pip_size": "0.01",     "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "MATICUSD","display_name": "Polygon CFD",    "asset_class": "Crypto", "pip_size": "0.0001",   "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "UNIUSD",  "display_name": "Uniswap CFD",    "asset_class": "Crypto", "pip_size": "0.001",    "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "ATOMUSD", "display_name": "Cosmos CFD",     "asset_class": "Crypto", "pip_size": "0.001",    "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "TRXUSD",  "display_name": "TRON CFD",       "asset_class": "Crypto", "pip_size": "0.000001", "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "XLMUSD",  "display_name": "Stellar CFD",    "asset_class": "Crypto", "pip_size": "0.00001",  "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "AAVEUSD", "display_name": "Aave CFD",       "asset_class": "Crypto", "pip_size": "0.01",     "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "ZECUSD",  "display_name": "Zcash CFD",      "asset_class": "Crypto", "pip_size": "0.1",      "tick_value": "1.00",  "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # FOREX — MAJORS
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "EURUSD",  "display_name": "Euro / Dollar",          "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "10.00",  "min_lot": "0.01"},
    {"symbol": "GBPUSD",  "display_name": "Pound / Dollar",         "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "10.00",  "min_lot": "0.01"},
    {"symbol": "USDJPY",  "display_name": "Dollar / Yen",           "asset_class": "Forex", "pip_size": "0.01",   "tick_value": "6.70",   "min_lot": "0.01"},
    {"symbol": "USDCHF",  "display_name": "Dollar / Franc",         "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "11.20",  "min_lot": "0.01"},
    {"symbol": "AUDUSD",  "display_name": "Aussie / Dollar",        "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "10.00",  "min_lot": "0.01"},
    {"symbol": "USDCAD",  "display_name": "Dollar / Cad",           "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "7.30",   "min_lot": "0.01"},
    {"symbol": "NZDUSD",  "display_name": "Kiwi / Dollar",          "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "10.00",  "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # FOREX — MINORS (EUR crosses)
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "EURJPY",  "display_name": "Euro / Yen",             "asset_class": "Forex", "pip_size": "0.01",   "tick_value": "6.70",   "min_lot": "0.01"},
    {"symbol": "EURGBP",  "display_name": "Euro / Pound",           "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "12.70",  "min_lot": "0.01"},
    {"symbol": "EURAUD",  "display_name": "Euro / Aussie",          "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "6.40",   "min_lot": "0.01"},
    {"symbol": "EURCAD",  "display_name": "Euro / Cad",             "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "7.30",   "min_lot": "0.01"},
    {"symbol": "EURCHF",  "display_name": "Euro / Franc",           "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "11.20",  "min_lot": "0.01"},
    {"symbol": "EURNZD",  "display_name": "Euro / Kiwi",            "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "5.90",   "min_lot": "0.01"},

    # GBP crosses
    {"symbol": "GBPJPY",  "display_name": "Pound / Yen",            "asset_class": "Forex", "pip_size": "0.01",   "tick_value": "6.70",   "min_lot": "0.01"},
    {"symbol": "GBPAUD",  "display_name": "Pound / Aussie",         "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "6.40",   "min_lot": "0.01"},
    {"symbol": "GBPCAD",  "display_name": "Pound / Cad",            "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "7.30",   "min_lot": "0.01"},
    {"symbol": "GBPCHF",  "display_name": "Pound / Franc",          "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "11.20",  "min_lot": "0.01"},
    {"symbol": "GBPNZD",  "display_name": "Pound / Kiwi",           "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "5.90",   "min_lot": "0.01"},

    # AUD crosses
    {"symbol": "AUDJPY",  "display_name": "Aussie / Yen",           "asset_class": "Forex", "pip_size": "0.01",   "tick_value": "6.70",   "min_lot": "0.01"},
    {"symbol": "AUDCAD",  "display_name": "Aussie / Cad",           "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "7.30",   "min_lot": "0.01"},
    {"symbol": "AUDCHF",  "display_name": "Aussie / Franc",         "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "11.20",  "min_lot": "0.01"},
    {"symbol": "AUDNZD",  "display_name": "Aussie / Kiwi",          "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "5.90",   "min_lot": "0.01"},

    # NZD crosses
    {"symbol": "NZDJPY",  "display_name": "Kiwi / Yen",             "asset_class": "Forex", "pip_size": "0.01",   "tick_value": "6.70",   "min_lot": "0.01"},
    {"symbol": "NZDCAD",  "display_name": "Kiwi / Cad",             "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "7.30",   "min_lot": "0.01"},
    {"symbol": "NZDCHF",  "display_name": "Kiwi / Franc",           "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "11.20",  "min_lot": "0.01"},

    # CAD / CHF crosses
    {"symbol": "CADJPY",  "display_name": "Cad / Yen",              "asset_class": "Forex", "pip_size": "0.01",   "tick_value": "6.70",   "min_lot": "0.01"},
    {"symbol": "CADCHF",  "display_name": "Cad / Franc",            "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "11.20",  "min_lot": "0.01"},
    {"symbol": "CHFJPY",  "display_name": "Franc / Yen",            "asset_class": "Forex", "pip_size": "0.01",   "tick_value": "6.70",   "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # FOREX — EXOTICS
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "USDMXN",  "display_name": "Dollar / Mexican Peso",   "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "0.59",   "min_lot": "0.01"},
    {"symbol": "USDSEK",  "display_name": "Dollar / Swedish Krona",  "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "0.95",   "min_lot": "0.01"},
    {"symbol": "USDNOK",  "display_name": "Dollar / Norwegian Krone","asset_class": "Forex", "pip_size": "0.0001", "tick_value": "0.93",   "min_lot": "0.01"},
    {"symbol": "USDSGD",  "display_name": "Dollar / Singapore Dollar","asset_class": "Forex","pip_size": "0.0001", "tick_value": "7.40",   "min_lot": "0.01"},
    {"symbol": "USDCNH",  "display_name": "Dollar / Chinese Yuan",   "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "1.38",   "min_lot": "0.01"},
    {"symbol": "USDTRY",  "display_name": "Dollar / Turkish Lira",   "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "0.29",   "min_lot": "0.01"},
    {"symbol": "USDZAR",  "display_name": "Dollar / South African Rand","asset_class": "Forex","pip_size": "0.0001","tick_value": "0.55",  "min_lot": "0.01"},
    {"symbol": "USDPLN",  "display_name": "Dollar / Polish Zloty",   "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "2.50",   "min_lot": "0.01"},
    {"symbol": "USDCNH",  "display_name": "Dollar / Chinese Yuan",   "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "1.38",   "min_lot": "0.01"},
    {"symbol": "EURTRY",  "display_name": "Euro / Turkish Lira",     "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "0.29",   "min_lot": "0.01"},
    {"symbol": "EURSEK",  "display_name": "Euro / Swedish Krona",    "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "0.95",   "min_lot": "0.01"},
    {"symbol": "EURNOK",  "display_name": "Euro / Norwegian Krone",  "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "0.93",   "min_lot": "0.01"},
    {"symbol": "EURPLN",  "display_name": "Euro / Polish Zloty",     "asset_class": "Forex", "pip_size": "0.0001", "tick_value": "2.50",   "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # INDICES — AMERICAS
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "US500",   "display_name": "S&P 500 CFD",       "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "US100",   "display_name": "Nasdaq 100 CFD",    "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "DJ30",    "display_name": "Dow Jones CFD",     "asset_class": "Indices", "pip_size": "1.0",  "tick_value": "1.00",  "min_lot": "0.01"},
    {"symbol": "US2000",  "display_name": "Russell 2000 CFD",  "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "1.00",  "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # INDICES — EUROPE
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "GER40",   "display_name": "DAX 40 CFD",          "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "1.10",  "min_lot": "0.01"},
    {"symbol": "UK100",   "display_name": "FTSE 100 CFD",        "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "0.77",  "min_lot": "0.01"},
    {"symbol": "FRA40",   "display_name": "CAC 40 CFD",          "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "1.10",  "min_lot": "0.01"},
    {"symbol": "ESP35",   "display_name": "IBEX 35 CFD",         "asset_class": "Indices", "pip_size": "1.0",  "tick_value": "1.10",  "min_lot": "0.01"},
    {"symbol": "ITA40",   "display_name": "FTSE MIB 40 CFD",     "asset_class": "Indices", "pip_size": "1.0",  "tick_value": "1.10",  "min_lot": "0.01"},
    {"symbol": "EU50",    "display_name": "Euro Stoxx 50 CFD",   "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "1.10",  "min_lot": "0.01"},
    {"symbol": "SWI20",   "display_name": "Swiss SMI 20 CFD",    "asset_class": "Indices", "pip_size": "0.1",  "tick_value": "1.12",  "min_lot": "0.01"},

    # ══════════════════════════════════════════════════════════════════════
    # INDICES — ASIA-PACIFIC
    # ══════════════════════════════════════════════════════════════════════
    {"symbol": "JP225",   "display_name": "Nikkei 225 CFD",     "asset_class": "Indices", "pip_size": "1.0",   "tick_value": "0.007", "min_lot": "0.01"},
    {"symbol": "HK50",    "display_name": "Hang Seng CFD",      "asset_class": "Indices", "pip_size": "1.0",   "tick_value": "0.13",  "min_lot": "0.01"},
    {"symbol": "AUS200",  "display_name": "ASX 200 CFD",        "asset_class": "Indices", "pip_size": "0.1",   "tick_value": "0.64",  "min_lot": "0.01"},
    {"symbol": "INDIA50", "display_name": "Nifty 50 CFD",       "asset_class": "Indices", "pip_size": "0.1",   "tick_value": "0.012", "min_lot": "0.01"},
    {"symbol": "CHINA50", "display_name": "China A50 CFD",      "asset_class": "Indices", "pip_size": "1.0",   "tick_value": "0.14",  "min_lot": "0.01"},
]


# ---------------------------------------------------------------------------
# Deduplicate (catalog has one intentional duplicate USDCNH — remove it)
# ---------------------------------------------------------------------------
def _dedup(catalog: list[dict]) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for row in catalog:
        if row["symbol"] not in seen:
            seen.add(row["symbol"])
            out.append(row)
    return out


# ---------------------------------------------------------------------------
# Code generation
# ---------------------------------------------------------------------------
_SECTION_ORDER: list[str] = [
    "Metals", "Energy", "Soft Commodities",
    "Crypto CFD",
    "Forex — Majors", "Forex — Minors (EUR crosses)",
    "Forex — Minors (GBP crosses)", "Forex — Minors (AUD crosses)",
    "Forex — Minors (NZD crosses)", "Forex — Minors (CAD / CHF crosses)",
    "Forex — Exotics",
    "Indices — Americas", "Indices — Europe", "Indices — Asia-Pacific",
]

_SECTION_MAP: dict[str, str] = {
    # symbol → section header
    "XAUUSD": "Metals",   "XAGUSD": "Metals",  "XPTUSD": "Metals",
    "XPDUSD": "Metals",   "XCUUSD": "Metals",
    "XTIUSD": "Energy",   "XBRUSD": "Energy",  "XNGUSD": "Energy",
    "COFFEE": "Soft Commodities", "SUGAR": "Soft Commodities",
    "WHEAT": "Soft Commodities",  "CORN":  "Soft Commodities",
    "COTTON": "Soft Commodities", "COCOA": "Soft Commodities",
    "SOYBEAN": "Soft Commodities",
    "BTCUSD": "Crypto CFD",  "ETHUSD": "Crypto CFD", "BNBUSD": "Crypto CFD",
    "SOLUSD": "Crypto CFD",  "XRPUSD": "Crypto CFD", "ADAUSD": "Crypto CFD",
    "DOGEUSD": "Crypto CFD", "LTCUSD": "Crypto CFD", "LINKUSD": "Crypto CFD",
    "DOTUSD": "Crypto CFD",  "AVAXUSD": "Crypto CFD","MATICUSD": "Crypto CFD",
    "UNIUSD": "Crypto CFD",  "ATOMUSD": "Crypto CFD","TRXUSD": "Crypto CFD",
    "XLMUSD": "Crypto CFD",  "AAVEUSD": "Crypto CFD","ZECUSD": "Crypto CFD",
    "EURUSD": "Forex — Majors",  "GBPUSD": "Forex — Majors",
    "USDJPY": "Forex — Majors",  "USDCHF": "Forex — Majors",
    "AUDUSD": "Forex — Majors",  "USDCAD": "Forex — Majors",
    "NZDUSD": "Forex — Majors",
    "EURJPY": "Forex — Minors (EUR crosses)", "EURGBP": "Forex — Minors (EUR crosses)",
    "EURAUD": "Forex — Minors (EUR crosses)", "EURCAD": "Forex — Minors (EUR crosses)",
    "EURCHF": "Forex — Minors (EUR crosses)", "EURNZD": "Forex — Minors (EUR crosses)",
    "GBPJPY": "Forex — Minors (GBP crosses)", "GBPAUD": "Forex — Minors (GBP crosses)",
    "GBPCAD": "Forex — Minors (GBP crosses)", "GBPCHF": "Forex — Minors (GBP crosses)",
    "GBPNZD": "Forex — Minors (GBP crosses)",
    "AUDJPY": "Forex — Minors (AUD crosses)", "AUDCAD": "Forex — Minors (AUD crosses)",
    "AUDCHF": "Forex — Minors (AUD crosses)", "AUDNZD": "Forex — Minors (AUD crosses)",
    "NZDJPY": "Forex — Minors (NZD crosses)", "NZDCAD": "Forex — Minors (NZD crosses)",
    "NZDCHF": "Forex — Minors (NZD crosses)",
    "CADJPY": "Forex — Minors (CAD / CHF crosses)", "CADCHF": "Forex — Minors (CAD / CHF crosses)",
    "CHFJPY": "Forex — Minors (CAD / CHF crosses)",
    "USDMXN": "Forex — Exotics", "USDSEK": "Forex — Exotics", "USDNOK": "Forex — Exotics",
    "USDSGD": "Forex — Exotics", "USDCNH": "Forex — Exotics", "USDTRY": "Forex — Exotics",
    "USDZAR": "Forex — Exotics", "USDPLN": "Forex — Exotics",
    "EURTRY": "Forex — Exotics", "EURSEK": "Forex — Exotics",
    "EURNOK": "Forex — Exotics", "EURPLN": "Forex — Exotics",
    "US500":  "Indices — Americas", "US100": "Indices — Americas",
    "DJ30":   "Indices — Americas", "US2000": "Indices — Americas",
    "GER40":  "Indices — Europe",   "UK100":  "Indices — Europe",
    "FRA40":  "Indices — Europe",   "ESP35":  "Indices — Europe",
    "ITA40":  "Indices — Europe",   "EU50":   "Indices — Europe",
    "SWI20":  "Indices — Europe",
    "JP225":  "Indices — Asia-Pacific", "HK50":   "Indices — Asia-Pacific",
    "AUS200": "Indices — Asia-Pacific", "INDIA50": "Indices — Asia-Pacific",
    "CHINA50": "Indices — Asia-Pacific",
}


def _build_vantage_block(catalog: list[dict]) -> str:
    catalog = _dedup(catalog)

    # Group by section
    sections: dict[str, list[dict]] = {s: [] for s in _SECTION_ORDER}
    for row in catalog:
        section = _SECTION_MAP.get(row["symbol"], "Misc")
        sections.setdefault(section, []).append(row)

    lines: list[str] = ["VANTAGE_INSTRUMENTS: list[dict] = ["]

    for section in _SECTION_ORDER:
        rows = sections.get(section, [])
        if not rows:
            continue
        dashes = "─" * max(4, 68 - len(section))
        lines.append(f"\n    # ── {section} {dashes}")
        for row in rows:
            sym   = f'"{row["symbol"]}",'.ljust(12)
            name  = f'"display_name": "{row["display_name"]}",'.ljust(38)
            ac    = f'"asset_class": "{row["asset_class"]}",'.ljust(28)
            pip   = f'"pip_size": Decimal("{row["pip_size"]}"),'.ljust(30)
            tick  = f'"tick_value": Decimal("{row["tick_value"]}"),'.ljust(32)
            lot   = f'"min_lot": Decimal("{row["min_lot"]}"),'.ljust(26)
            lines.append(
                f'    {{"symbol": {sym} {name} {ac} {pip} {tick} {lot} **_VANTAGE_BASE}},'
            )

    lines.append("]")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Patch seed file
# ---------------------------------------------------------------------------
_BLOCK_RE = re.compile(
    r"(VANTAGE_INSTRUMENTS: list\[dict\] = \[).*?^(\])",
    re.DOTALL | re.MULTILINE,
)


def _patch_docstring(text: str, count: int) -> str:
    return re.sub(
        r"(Vantage: )\d+( CFD instruments)",
        rf"\g<1>{count}\g<2>",
        text,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print generated code without writing to disk")
    args = parser.parse_args()

    catalog = _dedup(CATALOG)
    block = _build_vantage_block(CATALOG)

    if args.dry_run:
        print(block)
        print(f"\n— {len(catalog)} instruments total —")
        return

    original = SEED_FILE.read_text(encoding="utf-8")
    if not _BLOCK_RE.search(original):
        print("ERROR: Could not locate VANTAGE_INSTRUMENTS block.", file=sys.stderr)
        sys.exit(1)

    patched = _BLOCK_RE.sub(block, original, count=1)
    patched = _patch_docstring(patched, len(catalog))
    SEED_FILE.write_text(patched, encoding="utf-8")

    print(f"✓ seed_instruments.py updated — {len(catalog)} Vantage CFD instruments")
    from collections import Counter
    cats = Counter(r["asset_class"] for r in catalog)
    for cat in sorted(cats):
        print(f"   {cat:<18} → {cats[cat]:3d}")


if __name__ == "__main__":
    main()
