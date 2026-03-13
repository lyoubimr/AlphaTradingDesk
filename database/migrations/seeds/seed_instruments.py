"""
Seed: instruments table.

Pre-seeded instrument catalog for Phase 1:
  - Kraken: 317 Perpetual Futures (USD, Crypto)
  - Vantage: 89 CFD instruments (Forex, Commodities, Indices, Crypto)

Field notes:
  - pip_size / tick_value: CFD only (NULL for Kraken perps)
  - min_lot: minimum order qty. For Kraken perps stored as min contract size.
  - price_decimals: display precision for crypto prices.
  - max_leverage: cap enforced with UI warning (not a hard block).
    Stored per instrument as per Kraken Futures retail limits.

Idempotent: ON CONFLICT DO NOTHING on (broker_id, symbol).
"""
from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from src.core.models.broker import Instrument

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Kraken — Perpetual Futures (USD)
# ---------------------------------------------------------------------------

# max_leverage tiers per Kraken Futures retail rules:
#   BTC, ETH:                  50×
#   Large caps (SOL, XRP, ...): 25×
#   Mid/small caps:            10×
#   Meme coins:                 5×
_KRAKEN_BASE: dict = {
    "asset_class": "Crypto",
    "base_currency": "USD",
    "quote_currency": "USD",
    "pip_size": None,
    "tick_value": None,
    "is_predefined": True,
    "is_active": True,
}

KRAKEN_INSTRUMENTS: list[dict] = [
    # ── Tier 1: BTC + ETH — max 50× ──────────────────────────────────────────────────────────────────────
    {"symbol": "PF_AAVEUSD",          "display_name": "AAVE Perp",               "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ADAUSD",           "display_name": "ADA Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ALGOUSD",          "display_name": "ALGO Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_APEUSD",           "display_name": "APE Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_APTUSD",           "display_name": "APT Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ARBUSD",           "display_name": "ARB Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ATOMUSD",          "display_name": "ATOM Perp",               "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_AVAXUSD",          "display_name": "AVAX Perp",               "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_BCHUSD",           "display_name": "BCH Perp",                "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_BNBUSD",           "display_name": "BNB Perp",                "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_BONKUSD",          "display_name": "BONK Perp",               "min_lot": Decimal("1000"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_CRVUSD",           "display_name": "CRV Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_DOGEUSD",          "display_name": "DOGE Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_DOTUSD",           "display_name": "DOT Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ENAUSD",           "display_name": "ENA Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ENSUSD",           "display_name": "ENS Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ETCUSD",           "display_name": "ETC Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ETHUSD",           "display_name": "ETH Perp",                "min_lot": Decimal("0.001"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_EURUSD",           "display_name": "EUR Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_FARTCOINUSD",      "display_name": "FARTCOIN Perp",           "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_FETUSD",           "display_name": "FET Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_FILUSD",           "display_name": "FIL Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_FLOKIUSD",         "display_name": "FLOKI Perp",              "min_lot": Decimal("1000"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_GBPUSD",           "display_name": "GBP Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_GOATUSD",          "display_name": "GOAT Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_HBARUSD",          "display_name": "HBAR Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_HYPEUSD",          "display_name": "HYPE Perp",               "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ICPUSD",           "display_name": "ICP Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_INJUSD",           "display_name": "INJ Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_LDOUSD",           "display_name": "LDO Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_LINKUSD",          "display_name": "LINK Perp",               "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_LTCUSD",           "display_name": "LTC Perp",                "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_MANAUSD",          "display_name": "MANA Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_MOODENGUSD",       "display_name": "MOODENG Perp",            "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_NEARUSD",          "display_name": "NEAR Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_ONDOUSD",          "display_name": "ONDO Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_OPUSD",            "display_name": "OP Perp",                 "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_PENGUUSD",         "display_name": "PENGU Perp",              "min_lot": Decimal("10"),  "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_PEPEUSD",          "display_name": "PEPE Perp",               "min_lot": Decimal("1000"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_POLUSD",           "display_name": "POL Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_POPCATUSD",        "display_name": "POPCAT Perp",             "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_PUMPUSD",          "display_name": "PUMP Perp",               "min_lot": Decimal("100"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_RENDERUSD",        "display_name": "RENDER Perp",             "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_RUNEUSD",          "display_name": "RUNE Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_SEIUSD",           "display_name": "SEI Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_SHIBUSD",          "display_name": "SHIB Perp",               "min_lot": Decimal("1000"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_SOLUSD",           "display_name": "SOL Perp",                "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_SPXUSD",           "display_name": "SPX Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_STXUSD",           "display_name": "STX Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_SUIUSD",           "display_name": "SUI Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_TAOUSD",           "display_name": "TAO Perp",                "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_TIAUSD",           "display_name": "TIA Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_TONUSD",           "display_name": "TON Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_TRUMPUSD",         "display_name": "TRUMP Perp",              "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_UNIUSD",           "display_name": "UNI Perp",                "min_lot": Decimal("0.1"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_USDCUSD",          "display_name": "USDC Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_USDTUSD",          "display_name": "USDT Perp",               "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_VIRTUALUSD",       "display_name": "VIRTUAL Perp",            "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_WIFUSD",           "display_name": "WIF Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_WLDUSD",           "display_name": "WLD Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_XAUTUSD",          "display_name": "XAUT Perp",               "min_lot": Decimal("0.001"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_XBTUSD",           "display_name": "BTC Perp",                "min_lot": Decimal("0.0001"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_XLMUSD",           "display_name": "XLM Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_XMRUSD",           "display_name": "XMR Perp",                "min_lot": Decimal("0.01"), "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_XRPUSD",           "display_name": "XRP Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},
    {"symbol": "PF_XTZUSD",           "display_name": "XTZ Perp",                "min_lot": Decimal("1"),   "max_leverage": 50, **_KRAKEN_BASE},

    # ── Tier 2: Large caps — max 25× ─────────────────────────────────────────────────────────────────────
    {"symbol": "PF_1INCHUSD",         "display_name": "1INCH Perp",              "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_AGLDUSD",          "display_name": "AGLD Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_ARUSD",            "display_name": "AR Perp",                 "min_lot": Decimal("0.01"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_AXSUSD",           "display_name": "AXS Perp",                "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_BANDUSD",          "display_name": "BAND Perp",               "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_BATUSD",           "display_name": "BAT Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_CHZUSD",           "display_name": "CHZ Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_COMPUSD",          "display_name": "COMP Perp",               "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_DASHUSD",          "display_name": "DASH Perp",               "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_EGLDUSD",          "display_name": "EGLD Perp",               "min_lot": Decimal("0.01"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_EIGENUSD",         "display_name": "EIGEN Perp",              "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_ETHFIUSD",         "display_name": "ETHFI Perp",              "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_GALAUSD",          "display_name": "GALA Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_GMTUSD",           "display_name": "GMT Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_GRTUSD",           "display_name": "GRT Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_IMXUSD",           "display_name": "IMX Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_JASMYUSD",         "display_name": "JASMY Perp",              "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_JTOUSD",           "display_name": "JTO Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_JUPUSD",           "display_name": "JUP Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_KAVAUSD",          "display_name": "KAVA Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_KSMUSD",           "display_name": "KSM Perp",                "min_lot": Decimal("0.01"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_LCAPUSD",          "display_name": "LCAP Perp",               "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_LPTUSD",           "display_name": "LPT Perp",                "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_LRCUSD",           "display_name": "LRC Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_NEOUSD",           "display_name": "NEO Perp",                "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_NIGHTUSD",         "display_name": "NIGHT Perp",              "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_ORDIUSD",          "display_name": "ORDI Perp",               "min_lot": Decimal("0.01"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_PENDLEUSD",        "display_name": "PENDLE Perp",             "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_PNUTUSD",          "display_name": "PNUT Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_PYTHUSD",          "display_name": "PYTH Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_SANDUSD",          "display_name": "SAND Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_SNXUSD",           "display_name": "SNX Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_STRKUSD",          "display_name": "STRK Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_SUSHIUSD",         "display_name": "SUSHI Perp",              "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_THETAUSD",         "display_name": "THETA Perp",              "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_TLMUSD",           "display_name": "TLM Perp",                "min_lot": Decimal("10"),  "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_TOSHIUSD",         "display_name": "TOSHI Perp",              "min_lot": Decimal("1000"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_TRXUSD",           "display_name": "TRX Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_TURBOUSD",         "display_name": "TURBO Perp",              "min_lot": Decimal("100"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_UMAUSD",           "display_name": "UMA Perp",                "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_WLFIUSD",          "display_name": "WLFI Perp",               "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_YFIUSD",           "display_name": "YFI Perp",                "min_lot": Decimal("0.0001"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_ZECUSD",           "display_name": "ZEC Perp",                "min_lot": Decimal("0.01"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_ZENUSD",           "display_name": "ZEN Perp",                "min_lot": Decimal("0.1"), "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_ZKUSD",            "display_name": "ZK Perp",                 "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},
    {"symbol": "PF_ZROUSD",           "display_name": "ZRO Perp",                "min_lot": Decimal("1"),   "max_leverage": 25, **_KRAKEN_BASE},

    # ── Tier 3 (20×) ─────────────────────────────────────────────────────────────────────────────────────
    {"symbol": "PF_1MBABYDOGEUSD",    "display_name": "1MBABYDOGE Perp",         "min_lot": Decimal("1000"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_2ZUSD",            "display_name": "2Z Perp",                 "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_AAPLXUSD",         "display_name": "AAPLx Perp",              "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_AEVOUSD",          "display_name": "AEVO Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_AIXBTUSD",         "display_name": "AIXBT Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ALEOUSD",          "display_name": "ALEO Perp",               "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ALICEUSD",         "display_name": "ALICE Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ALTUSD",           "display_name": "ALT Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ANIMEUSD",         "display_name": "ANIME Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ANKRUSD",          "display_name": "ANKR Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_API3USD",          "display_name": "API3 Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ARCUSD",           "display_name": "ARC Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ARKMUSD",          "display_name": "ARKM Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ASTERUSD",         "display_name": "ASTER Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ASTRUSD",          "display_name": "ASTR Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ATHUSD",           "display_name": "ATH Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_AUCTIONUSD",       "display_name": "AUCTION Perp",            "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_AUDUSD",           "display_name": "AUD Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BBUSD",            "display_name": "BB Perp",                 "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BDXUSD",           "display_name": "BDX Perp",                "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BEAMUSD",          "display_name": "BEAM Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BERAUSD",          "display_name": "BERA Perp",               "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BICOUSD",          "display_name": "BICO Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BIGTIMEUSD",       "display_name": "BIGTIME Perp",            "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BIOUSD",           "display_name": "BIO Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BLURUSD",          "display_name": "BLUR Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BOMEUSD",          "display_name": "BOME Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BRETTUSD",         "display_name": "BRETT Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_BSUUSD",           "display_name": "BSU Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_C98USD",           "display_name": "C98 Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CAKEUSD",          "display_name": "CAKE Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CATIUSD",          "display_name": "CATI Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CELRUSD",          "display_name": "CELR Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CETUSUSD",         "display_name": "CETUS Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CFGUSD",           "display_name": "CFG Perp",                "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CFXUSD",           "display_name": "CFX Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CGPTUSD",          "display_name": "CGPT Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CHFUSD",           "display_name": "CHF Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CHILLGUYUSD",      "display_name": "CHILLGUY Perp",           "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CKBUSD",           "display_name": "CKB Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_COTIUSD",          "display_name": "COTI Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_COWUSD",           "display_name": "COW Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CRCLXUSD",         "display_name": "CRCLx Perp",              "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CROUSD",           "display_name": "CRO Perp",                "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CTSIUSD",          "display_name": "CTSI Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_CVXUSD",           "display_name": "CVX Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_DEGENUSD",         "display_name": "DEGEN Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_DENTUSD",          "display_name": "DENT Perp",               "min_lot": Decimal("100"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_DEXEUSD",          "display_name": "DEXE Perp",               "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_DFUSD",            "display_name": "DF Perp",                 "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_DOGSUSD",          "display_name": "DOGS Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_DYDXUSD",          "display_name": "DYDX Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_DYMUSD",           "display_name": "DYM Perp",                "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ENJUSD",           "display_name": "ENJ Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ESPORTSUSD",       "display_name": "ESPORTS Perp",            "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ESPUSD",           "display_name": "ESP Perp",                "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_FLOWUSD",          "display_name": "FLOW Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_FLUXUSD",          "display_name": "FLUX Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_GLDXUSD",          "display_name": "GLDx Perp",               "min_lot": Decimal("0.001"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_GMXUSD",           "display_name": "GMX Perp",                "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_GOOGLXUSD",        "display_name": "GOOGLx Perp",             "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_GRASSUSD",         "display_name": "GRASS Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_GUSD",             "display_name": "G Perp",                  "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_HFTUSD",           "display_name": "HFT Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_HIPPOUSD",         "display_name": "HIPPO Perp",              "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_HMSTRUSD",         "display_name": "HMSTR Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_HOODXUSD",         "display_name": "HOODx Perp",              "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_HOOKUSD",          "display_name": "HOOK Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ICXUSD",           "display_name": "ICX Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_INITUSD",          "display_name": "INIT Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_IOSTUSD",          "display_name": "IOST Perp",               "min_lot": Decimal("100"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_IOTAUSD",          "display_name": "IOTA Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_IOTXUSD",          "display_name": "IOTX Perp",               "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_IOUSD",            "display_name": "IO Perp",                 "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_IPUSD",            "display_name": "IP Perp",                 "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_JPYUSD",           "display_name": "JPY Perp",                "min_lot": Decimal("100"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_KAIAUSD",          "display_name": "KAIA Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_KAITOUSD",         "display_name": "KAITO Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_KASUSD",           "display_name": "KAS Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_LSKUSD",           "display_name": "LSK Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MELANIAUSD",       "display_name": "MELANIA Perp",            "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MEWUSD",           "display_name": "MEW Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MINAUSD",          "display_name": "MINA Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MIRAUSD",          "display_name": "MIRA Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MNTUSD",           "display_name": "MNT Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MORPHOUSD",        "display_name": "MORPHO Perp",             "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MOVEUSD",          "display_name": "MOVE Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MOVRUSD",          "display_name": "MOVR Perp",               "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MSTRXUSD",         "display_name": "MSTRx Perp",              "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_MTLUSD",           "display_name": "MTL Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_NMRUSD",           "display_name": "NMR Perp",                "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_NOTUSD",           "display_name": "NOT Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_NVDAXUSD",         "display_name": "NVDAx Perp",              "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_OGNUSD",           "display_name": "OGN Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_OMIUSD",           "display_name": "OMI Perp",                "min_lot": Decimal("10000"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ONEUSD",           "display_name": "ONE Perp",                "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ONGUSD",           "display_name": "ONG Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ONTUSD",           "display_name": "ONT Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_OPNUSD",           "display_name": "OPN Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_PAXGUSD",          "display_name": "PAXG Perp",               "min_lot": Decimal("0.001"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_PEOPLEUSD",        "display_name": "PEOPLE Perp",             "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_PERPUSD",          "display_name": "PERP Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_POWRUSD",          "display_name": "POWR Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_QNTUSD",           "display_name": "QNT Perp",                "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_QQQXUSD",          "display_name": "QQQx Perp",               "min_lot": Decimal("0.001"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_QTUMUSD",          "display_name": "QTUM Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_RARIUSD",          "display_name": "RARI Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_RAYUSD",           "display_name": "RAY Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_REZUSD",           "display_name": "REZ Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ROSEUSD",          "display_name": "ROSE Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_RSRUSD",           "display_name": "RSR Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SAGAUSD",          "display_name": "SAGA Perp",               "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SATSUSD",          "display_name": "SATS Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SHELLUSD",         "display_name": "SHELL Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SKLUSD",           "display_name": "SKL Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SPELLUSD",         "display_name": "SPELL Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SPYXUSD",          "display_name": "SPYx Perp",               "min_lot": Decimal("0.001"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SSVUSD",           "display_name": "SSV Perp",                "min_lot": Decimal("0.1"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_STEEMUSD",         "display_name": "STEEM Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_STORJUSD",         "display_name": "STORJ Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SUPERUSD",         "display_name": "SUPER Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SUSD",             "display_name": "S Perp",                  "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_SXPUSD",           "display_name": "SXP Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_TNSRUSD",          "display_name": "TNSR Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_TRBUSD",           "display_name": "TRB Perp",                "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_TRUUSD",           "display_name": "TRU Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_TSLAXUSD",         "display_name": "TSLAx Perp",              "min_lot": Decimal("0.01"), "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_TUSD",             "display_name": "T Perp",                  "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_USUALUSD",         "display_name": "USUAL Perp",              "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_VETUSD",           "display_name": "VET Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_WUSD",             "display_name": "W Perp",                  "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_YGGUSD",           "display_name": "YGG Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ZETAUSD",          "display_name": "ZETA Perp",               "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ZIGUSD",           "display_name": "ZIG Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ZILUSD",           "display_name": "ZIL Perp",                "min_lot": Decimal("10"),  "max_leverage": 20, **_KRAKEN_BASE},
    {"symbol": "PF_ZRXUSD",           "display_name": "ZRX Perp",                "min_lot": Decimal("1"),   "max_leverage": 20, **_KRAKEN_BASE},

    # ── Tier 3: Mid caps — max 10× ───────────────────────────────────────────────────────────────────────
    {"symbol": "PF_ACEUSD",           "display_name": "ACE Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_AIUSD",            "display_name": "AI Perp",                 "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_AKTUSD",           "display_name": "AKT Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_ALCHUSD",          "display_name": "ALCH Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_B3USD",            "display_name": "B3 Perp",                 "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_BANANAUSD",        "display_name": "BANANA Perp",             "min_lot": Decimal("0.1"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_BELUSD",           "display_name": "BEL Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_BNTUSD",           "display_name": "BNT Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_CATUSD",           "display_name": "CAT Perp",                "min_lot": Decimal("1000"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_CELOUSD",          "display_name": "CELO Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_CHRUSD",           "display_name": "CHR Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_COOKIEUSD",        "display_name": "COOKIE Perp",             "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_CYBERUSD",         "display_name": "CYBER Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_DEEPUSD",          "display_name": "DEEP Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_DOGUSD",           "display_name": "DOG Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_DRIFTUSD",         "display_name": "DRIFT Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_ETHWUSD",          "display_name": "ETHW Perp",               "min_lot": Decimal("0.1"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_FLRUSD",           "display_name": "FLR Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_FOLKSUSD",         "display_name": "FOLKS Perp",              "min_lot": Decimal("0.1"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_GASUSD",           "display_name": "GAS Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_GIGAUSD",          "display_name": "GIGA Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_GPSUSD",           "display_name": "GPS Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_GRIFFAINUSD",      "display_name": "GRIFFAIN Perp",           "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_GTCUSD",           "display_name": "GTC Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_HAEDALUSD",        "display_name": "HAEDAL Perp",             "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_HIGHUSD",          "display_name": "HIGH Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_IDUSD",            "display_name": "ID Perp",                 "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_KOMAUSD",          "display_name": "KOMA Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_LAYERUSD",         "display_name": "LAYER Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_LQTYUSD",          "display_name": "LQTY Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_LUNA2USD",         "display_name": "LUNA2 Perp",              "min_lot": Decimal("0.1"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_METISUSD",         "display_name": "METIS Perp",              "min_lot": Decimal("0.1"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_MEUSD",            "display_name": "ME Perp",                 "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_MOGUSD",           "display_name": "MOG Perp",                "min_lot": Decimal("1000"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_MONUSD",           "display_name": "MON Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_MUBARAKUSD",       "display_name": "MUBARAK Perp",            "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_NEIROUSD",         "display_name": "NEIRO Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_OPENUSD",          "display_name": "OPEN Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_ORCAUSD",          "display_name": "ORCA Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_ORDERUSD",         "display_name": "ORDER Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_OXTUSD",           "display_name": "OXT Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_PIXELUSD",         "display_name": "PIXEL Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_PONKEUSD",         "display_name": "PONKE Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_PORTALUSD",        "display_name": "PORTAL Perp",             "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_PROMPTUSD",        "display_name": "PROMPT Perp",             "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_RAREUSD",          "display_name": "RARE Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_RIVERUSD",         "display_name": "RIVER Perp",              "min_lot": Decimal("0.1"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_RLCUSD",           "display_name": "RLC Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SOLVUSD",          "display_name": "SOLV Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SONICUSD",         "display_name": "SONIC Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SOONUSD",          "display_name": "SOON Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SPKUSD",           "display_name": "SPK Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_STBLUSD",          "display_name": "STBL Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_STGUSD",           "display_name": "STG Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SUNUSD",           "display_name": "SUN Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SWARMSUSD",        "display_name": "SWARMS Perp",             "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SWELLUSD",         "display_name": "SWELL Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SXTUSD",           "display_name": "SXT Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SYNUSD",           "display_name": "SYN Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_SYRUPUSD",         "display_name": "SYRUP Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_TAIKOUSD",         "display_name": "TAIKO Perp",              "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_VELOUSD",          "display_name": "VELO Perp",               "min_lot": Decimal("10"),  "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_VINEUSD",          "display_name": "VINE Perp",               "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_WOOUSD",           "display_name": "WOO Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_XCNUSD",           "display_name": "XCN Perp",                "min_lot": Decimal("10"),  "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_XPLUSD",           "display_name": "XPL Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_XVSUSD",           "display_name": "XVS Perp",                "min_lot": Decimal("0.1"), "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_ZBTUSD",           "display_name": "ZBT Perp",                "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
    {"symbol": "PF_ZEREBROUSD",       "display_name": "ZEREBRO Perp",            "min_lot": Decimal("1"),   "max_leverage": 10, **_KRAKEN_BASE},
]


# ---------------------------------------------------------------------------
# Vantage — CFD instruments
# ---------------------------------------------------------------------------

_VANTAGE_BASE: dict = {
    "base_currency": "USD",
    "quote_currency": "USD",
    "is_predefined": True,
    "is_active": True,
    "max_leverage": None,  # Vantage CFD leverage configured at account level
}

VANTAGE_INSTRUMENTS: list[dict] = [

    # ── Metals ──────────────────────────────────────────────────────────────
    {"symbol": "XAUUSD",    "display_name": "Gold",                "asset_class": "Commodities", "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XAGUSD",    "display_name": "Silver",              "asset_class": "Commodities", "pip_size": Decimal("0.001"),  "tick_value": Decimal("5.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XPTUSD",    "display_name": "Platinum",            "asset_class": "Commodities", "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XPDUSD",    "display_name": "Palladium",           "asset_class": "Commodities", "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XCUUSD",    "display_name": "Copper",              "asset_class": "Commodities", "pip_size": Decimal("0.001"),  "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Energy ──────────────────────────────────────────────────────────────
    {"symbol": "XTIUSD",    "display_name": "WTI Crude Oil",       "asset_class": "Commodities", "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XBRUSD",    "display_name": "Brent Crude",         "asset_class": "Commodities", "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XNGUSD",    "display_name": "Natural Gas",         "asset_class": "Commodities", "pip_size": Decimal("0.001"),  "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Soft Commodities ────────────────────────────────────────────────────
    {"symbol": "COFFEE",    "display_name": "Coffee (Arabica)",    "asset_class": "Commodities", "pip_size": Decimal("0.001"),  "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "SUGAR",     "display_name": "Sugar No. 11",        "asset_class": "Commodities", "pip_size": Decimal("0.00001"), "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "WHEAT",     "display_name": "Wheat",               "asset_class": "Commodities", "pip_size": Decimal("0.001"),  "tick_value": Decimal("5.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "CORN",      "display_name": "Corn",                "asset_class": "Commodities", "pip_size": Decimal("0.001"),  "tick_value": Decimal("5.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "COTTON",    "display_name": "Cotton",              "asset_class": "Commodities", "pip_size": Decimal("0.0001"), "tick_value": Decimal("5.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "COCOA",     "display_name": "Cocoa",               "asset_class": "Commodities", "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "SOYBEAN",   "display_name": "Soybean",             "asset_class": "Commodities", "pip_size": Decimal("0.001"),  "tick_value": Decimal("5.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Crypto CFD ──────────────────────────────────────────────────────────
    {"symbol": "BTCUSD",    "display_name": "Bitcoin CFD",         "asset_class": "Crypto",     "pip_size": Decimal("1.0"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "ETHUSD",    "display_name": "Ethereum CFD",        "asset_class": "Crypto",     "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "BNBUSD",    "display_name": "BNB CFD",             "asset_class": "Crypto",     "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "SOLUSD",    "display_name": "Solana CFD",          "asset_class": "Crypto",     "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XRPUSD",    "display_name": "Ripple CFD",          "asset_class": "Crypto",     "pip_size": Decimal("0.0001"), "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "ADAUSD",    "display_name": "Cardano CFD",         "asset_class": "Crypto",     "pip_size": Decimal("0.0001"), "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "DOGEUSD",   "display_name": "Dogecoin CFD",        "asset_class": "Crypto",     "pip_size": Decimal("0.00001"), "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "LTCUSD",    "display_name": "Litecoin CFD",        "asset_class": "Crypto",     "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "LINKUSD",   "display_name": "Chainlink CFD",       "asset_class": "Crypto",     "pip_size": Decimal("0.001"),  "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "DOTUSD",    "display_name": "Polkadot CFD",        "asset_class": "Crypto",     "pip_size": Decimal("0.001"),  "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "AVAXUSD",   "display_name": "Avalanche CFD",       "asset_class": "Crypto",     "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "MATICUSD",  "display_name": "Polygon CFD",         "asset_class": "Crypto",     "pip_size": Decimal("0.0001"), "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "UNIUSD",    "display_name": "Uniswap CFD",         "asset_class": "Crypto",     "pip_size": Decimal("0.001"),  "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "ATOMUSD",   "display_name": "Cosmos CFD",          "asset_class": "Crypto",     "pip_size": Decimal("0.001"),  "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "TRXUSD",    "display_name": "TRON CFD",            "asset_class": "Crypto",     "pip_size": Decimal("0.000001"), "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "XLMUSD",    "display_name": "Stellar CFD",         "asset_class": "Crypto",     "pip_size": Decimal("0.00001"), "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "AAVEUSD",   "display_name": "Aave CFD",            "asset_class": "Crypto",     "pip_size": Decimal("0.01"),   "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "ZECUSD",    "display_name": "Zcash CFD",           "asset_class": "Crypto",     "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Forex — Majors ──────────────────────────────────────────────────────
    {"symbol": "EURUSD",    "display_name": "Euro / Dollar",       "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "GBPUSD",    "display_name": "Pound / Dollar",      "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDJPY",    "display_name": "Dollar / Yen",        "asset_class": "Forex",      "pip_size": Decimal("0.01"),   "tick_value": Decimal("6.70"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDCHF",    "display_name": "Dollar / Franc",      "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("11.20"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "AUDUSD",    "display_name": "Aussie / Dollar",     "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDCAD",    "display_name": "Dollar / Cad",        "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("7.30"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "NZDUSD",    "display_name": "Kiwi / Dollar",       "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Forex — Minors (EUR crosses) ────────────────────────────────────────
    {"symbol": "EURJPY",    "display_name": "Euro / Yen",          "asset_class": "Forex",      "pip_size": Decimal("0.01"),   "tick_value": Decimal("6.70"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURGBP",    "display_name": "Euro / Pound",        "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("12.70"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURAUD",    "display_name": "Euro / Aussie",       "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("6.40"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURCAD",    "display_name": "Euro / Cad",          "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("7.30"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURCHF",    "display_name": "Euro / Franc",        "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("11.20"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURNZD",    "display_name": "Euro / Kiwi",         "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("5.90"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Forex — Minors (GBP crosses) ────────────────────────────────────────
    {"symbol": "GBPJPY",    "display_name": "Pound / Yen",         "asset_class": "Forex",      "pip_size": Decimal("0.01"),   "tick_value": Decimal("6.70"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "GBPAUD",    "display_name": "Pound / Aussie",      "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("6.40"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "GBPCAD",    "display_name": "Pound / Cad",         "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("7.30"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "GBPCHF",    "display_name": "Pound / Franc",       "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("11.20"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "GBPNZD",    "display_name": "Pound / Kiwi",        "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("5.90"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Forex — Minors (AUD crosses) ────────────────────────────────────────
    {"symbol": "AUDJPY",    "display_name": "Aussie / Yen",        "asset_class": "Forex",      "pip_size": Decimal("0.01"),   "tick_value": Decimal("6.70"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "AUDCAD",    "display_name": "Aussie / Cad",        "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("7.30"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "AUDCHF",    "display_name": "Aussie / Franc",      "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("11.20"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "AUDNZD",    "display_name": "Aussie / Kiwi",       "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("5.90"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Forex — Minors (NZD crosses) ────────────────────────────────────────
    {"symbol": "NZDJPY",    "display_name": "Kiwi / Yen",          "asset_class": "Forex",      "pip_size": Decimal("0.01"),   "tick_value": Decimal("6.70"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "NZDCAD",    "display_name": "Kiwi / Cad",          "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("7.30"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "NZDCHF",    "display_name": "Kiwi / Franc",        "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("11.20"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Forex — Minors (CAD / CHF crosses) ──────────────────────────────────
    {"symbol": "CADJPY",    "display_name": "Cad / Yen",           "asset_class": "Forex",      "pip_size": Decimal("0.01"),   "tick_value": Decimal("6.70"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "CADCHF",    "display_name": "Cad / Franc",         "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("11.20"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "CHFJPY",    "display_name": "Franc / Yen",         "asset_class": "Forex",      "pip_size": Decimal("0.01"),   "tick_value": Decimal("6.70"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Forex — Exotics ─────────────────────────────────────────────────────
    {"symbol": "USDMXN",    "display_name": "Dollar / Mexican Peso", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.59"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDSEK",    "display_name": "Dollar / Swedish Krona", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.95"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDNOK",    "display_name": "Dollar / Norwegian Krone", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.93"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDSGD",    "display_name": "Dollar / Singapore Dollar", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("7.40"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDCNH",    "display_name": "Dollar / Chinese Yuan", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("1.38"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDTRY",    "display_name": "Dollar / Turkish Lira", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.29"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDZAR",    "display_name": "Dollar / South African Rand", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.55"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "USDPLN",    "display_name": "Dollar / Polish Zloty", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("2.50"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURTRY",    "display_name": "Euro / Turkish Lira", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.29"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURSEK",    "display_name": "Euro / Swedish Krona", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.95"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURNOK",    "display_name": "Euro / Norwegian Krone", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("0.93"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EURPLN",    "display_name": "Euro / Polish Zloty", "asset_class": "Forex",      "pip_size": Decimal("0.0001"), "tick_value": Decimal("2.50"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Indices — Americas ──────────────────────────────────────────────────
    {"symbol": "US500",     "display_name": "S&P 500 CFD",         "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "US100",     "display_name": "Nasdaq 100 CFD",      "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "DJ30",      "display_name": "Dow Jones CFD",       "asset_class": "Indices",    "pip_size": Decimal("1.0"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "US2000",    "display_name": "Russell 2000 CFD",    "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.00"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Indices — Europe ────────────────────────────────────────────────────
    {"symbol": "GER40",     "display_name": "DAX 40 CFD",          "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.10"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "UK100",     "display_name": "FTSE 100 CFD",        "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("0.77"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "FRA40",     "display_name": "CAC 40 CFD",          "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.10"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "ESP35",     "display_name": "IBEX 35 CFD",         "asset_class": "Indices",    "pip_size": Decimal("1.0"),    "tick_value": Decimal("1.10"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "ITA40",     "display_name": "FTSE MIB 40 CFD",     "asset_class": "Indices",    "pip_size": Decimal("1.0"),    "tick_value": Decimal("1.10"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "EU50",      "display_name": "Euro Stoxx 50 CFD",   "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.10"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "SWI20",     "display_name": "Swiss SMI 20 CFD",    "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("1.12"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},

    # ── Indices — Asia-Pacific ──────────────────────────────────────────────
    {"symbol": "JP225",     "display_name": "Nikkei 225 CFD",      "asset_class": "Indices",    "pip_size": Decimal("1.0"),    "tick_value": Decimal("0.007"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "HK50",      "display_name": "Hang Seng CFD",       "asset_class": "Indices",    "pip_size": Decimal("1.0"),    "tick_value": Decimal("0.13"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "AUS200",    "display_name": "ASX 200 CFD",         "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("0.64"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "INDIA50",   "display_name": "Nifty 50 CFD",        "asset_class": "Indices",    "pip_size": Decimal("0.1"),    "tick_value": Decimal("0.012"),  "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
    {"symbol": "CHINA50",   "display_name": "China A50 CFD",       "asset_class": "Indices",    "pip_size": Decimal("1.0"),    "tick_value": Decimal("0.14"),   "min_lot": Decimal("0.01"), **_VANTAGE_BASE},
]


def seed_instruments(session: Session, broker_ids: dict[str, int]) -> None:
    """
    Insert predefined instruments per broker. Skip existing rows (idempotent).

    broker_ids: mapping returned by seed_brokers() — must contain 'Kraken' and 'Vantage'.
    """
    kraken_id = broker_ids["Kraken"]
    vantage_id = broker_ids["Vantage"]

    kraken_rows = [{**r, "broker_id": kraken_id} for r in KRAKEN_INSTRUMENTS]
    vantage_rows = [{**r, "broker_id": vantage_id} for r in VANTAGE_INSTRUMENTS]

    for batch in (kraken_rows, vantage_rows):
        stmt = (
            insert(Instrument)
            .values(batch)
            .on_conflict_do_nothing(index_elements=["broker_id", "symbol"])
        )
        session.execute(stmt)

    session.flush()
    logger.info(
        "Instruments seeded — Kraken: %d, Vantage: %d",
        len(KRAKEN_INSTRUMENTS),
        len(VANTAGE_INSTRUMENTS),
    )
