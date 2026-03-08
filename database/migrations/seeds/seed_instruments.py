"""
Seed: instruments table.

Pre-seeded instrument catalog for Phase 1:
  - Kraken: 50 Perpetual Futures (USD, Crypto)
  - Vantage: 22 CFD instruments (Forex, Commodities, Indices, Crypto)

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
    # ── Tier 1: BTC + ETH — max 50× ─────────────────────────────────────
    {"symbol": "PF_XBTUSD",     "display_name": "Bitcoin (BTC)",              "min_lot": Decimal("0.001"), "max_leverage": 50,  **_KRAKEN_BASE},
    {"symbol": "PF_ETHUSD",     "display_name": "Ethereum (ETH)",             "min_lot": Decimal("0.01"),  "max_leverage": 50,  **_KRAKEN_BASE},

    # ── Tier 2: Large caps — max 25× ────────────────────────────────────
    {"symbol": "PF_SOLUSD",     "display_name": "Solana (SOL)",               "min_lot": Decimal("0.1"),   "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_XRPUSD",     "display_name": "Ripple (XRP)",               "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_ADAUSD",     "display_name": "Cardano (ADA)",              "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_DOTUSD",     "display_name": "Polkadot (DOT)",             "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_LINKUSD",    "display_name": "Chainlink (LINK)",           "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_AVAXUSD",    "display_name": "Avalanche (AVAX)",           "min_lot": Decimal("0.1"),   "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_MATICUSD",   "display_name": "Polygon (MATIC)",            "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_ATOMUSD",    "display_name": "Cosmos (ATOM)",              "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_UNIUSD",     "display_name": "Uniswap (UNI)",              "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_NEARUSD",    "display_name": "Near Protocol (NEAR)",       "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_APTUSD",     "display_name": "Aptos (APT)",                "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_ARBUSD",     "display_name": "Arbitrum (ARB)",             "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_OPUSD",      "display_name": "Optimism (OP)",              "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_INJUSD",     "display_name": "Injective (INJ)",            "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_SUIUSD",     "display_name": "Sui (SUI)",                  "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_TRXUSD",     "display_name": "TRON (TRX)",                 "min_lot": Decimal("100"),   "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_TONUSD",     "display_name": "Toncoin (TON)",              "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_AAVEUSD",    "display_name": "Aave (AAVE)",               "min_lot": Decimal("0.1"),   "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_MKRUSD",     "display_name": "Maker (MKR)",                "min_lot": Decimal("0.01"),  "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_ICPUSD",     "display_name": "Internet Computer (ICP)",    "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_FILUSD",     "display_name": "Filecoin (FIL)",             "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_LDOUSD",     "display_name": "Lido DAO (LDO)",             "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_RNDRUSD",    "display_name": "Render (RNDR)",              "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_FETUSD",     "display_name": "Fetch.ai (FET)",             "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_TIAUSD",     "display_name": "Celestia (TIA)",             "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_STXUSD",     "display_name": "Stacks (STX)",               "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_JUPUSD",     "display_name": "Jupiter (JUP)",              "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_ENAUSD",     "display_name": "Ethena (ENA)",               "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_HYPEUSD",    "display_name": "Hyperliquid (HYPE)",         "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_WLDUSD",     "display_name": "Worldcoin (WLD)",            "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_JTOUSD",     "display_name": "Jito (JTO)",                 "min_lot": Decimal("1"),     "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_PYTHUSD",    "display_name": "Pyth Network (PYTH)",        "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_ONDOUSD",    "display_name": "Ondo Finance (ONDO)",        "min_lot": Decimal("10"),    "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_TAOUSD",     "display_name": "Bittensor (TAO)",            "min_lot": Decimal("0.01"),  "max_leverage": 25,  **_KRAKEN_BASE},
    {"symbol": "PF_SNXUSD",     "display_name": "Synthetix (SNX)",            "min_lot": Decimal("10"),    "max_leverage": 10,  **_KRAKEN_BASE},
    {"symbol": "PF_CROUSD",     "display_name": "Cronos (CRO)",               "min_lot": Decimal("100"),   "max_leverage": 10,  **_KRAKEN_BASE},
    {"symbol": "PF_FTMUSD",     "display_name": "Fantom (FTM)",               "min_lot": Decimal("10"),    "max_leverage": 10,  **_KRAKEN_BASE},
    {"symbol": "PF_ALGOUSD",    "display_name": "Algorand (ALGO)",            "min_lot": Decimal("10"),    "max_leverage": 10,  **_KRAKEN_BASE},

    # ── Tier 4: Meme coins — max 5× ─────────────────────────────────────
    {"symbol": "PF_DOGEUSD",    "display_name": "Dogecoin (DOGE)",            "min_lot": Decimal("100"),   "max_leverage": 5,   **_KRAKEN_BASE},
    {"symbol": "PF_SHIBUSDT",   "display_name": "Shiba Inu (SHIB)",          "min_lot": Decimal("100000"), "max_leverage": 5,  **_KRAKEN_BASE},
    {"symbol": "PF_PEPEUSD",    "display_name": "Pepe (PEPE)",               "min_lot": Decimal("1000000"), "max_leverage": 5, **_KRAKEN_BASE},
    {"symbol": "PF_WIFUSD",     "display_name": "dogwifhat (WIF)",            "min_lot": Decimal("10"),    "max_leverage": 5,   **_KRAKEN_BASE},
    {"symbol": "PF_BONKUSD",    "display_name": "BONK (BONK)",               "min_lot": Decimal("1000000"), "max_leverage": 5, **_KRAKEN_BASE},
    {"symbol": "PF_MOVEUSDT",   "display_name": "Movement (MOVE)",            "min_lot": Decimal("10"),    "max_leverage": 5,   **_KRAKEN_BASE},
    {"symbol": "PF_AI16ZUSD",   "display_name": "ai16z (AI16Z)",             "min_lot": Decimal("10"),    "max_leverage": 5,   **_KRAKEN_BASE},
    {"symbol": "PF_VIRTUALUSD", "display_name": "Virtuals Protocol (VIRT)",   "min_lot": Decimal("10"),    "max_leverage": 5,   **_KRAKEN_BASE},
    {"symbol": "PF_PENGUUSD",   "display_name": "Pudgy Penguins (PENGU)",    "min_lot": Decimal("100"),   "max_leverage": 5,   **_KRAKEN_BASE},
    {"symbol": "PF_EIGENUSDT",  "display_name": "Eigenlayer (EIGEN)",        "min_lot": Decimal("10"),    "max_leverage": 5,   **_KRAKEN_BASE},
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
    # ── Commodities ─────────────────────────────────────────────────────
    {
        "symbol": "XAUUSD", "display_name": "Gold",
        "asset_class": "Commodities",
        "pip_size": Decimal("0.01"),  "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "XAGUSD", "display_name": "Silver",
        "asset_class": "Commodities",
        "pip_size": Decimal("0.001"), "tick_value": Decimal("5.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "XTIUSD", "display_name": "WTI Crude Oil",
        "asset_class": "Commodities",
        "pip_size": Decimal("0.01"),  "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "XBRUSD", "display_name": "Brent Crude Oil",
        "asset_class": "Commodities",
        "pip_size": Decimal("0.01"),  "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },

    # ── Crypto CFD ──────────────────────────────────────────────────────
    {
        "symbol": "BTCUSD", "display_name": "Bitcoin CFD",
        "asset_class": "Crypto",
        "pip_size": Decimal("1.0"),   "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "ETHUSD", "display_name": "Ethereum CFD",
        "asset_class": "Crypto",
        "pip_size": Decimal("0.1"),   "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "ZECUSD", "display_name": "Zcash CFD",
        "asset_class": "Crypto",
        "pip_size": Decimal("0.1"),   "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },

    # ── Forex ────────────────────────────────────────────────────────────
    {
        "symbol": "EURUSD", "display_name": "Euro / Dollar",
        "asset_class": "Forex",
        "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "GBPUSD", "display_name": "Pound / Dollar",
        "asset_class": "Forex",
        "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "USDJPY", "display_name": "Dollar / Yen",
        "asset_class": "Forex",
        "pip_size": Decimal("0.01"),   "tick_value": Decimal("9.10"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "USDCHF", "display_name": "Dollar / Franc",
        "asset_class": "Forex",
        "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "AUDUSD", "display_name": "Aussie / Dollar",
        "asset_class": "Forex",
        "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "USDCAD", "display_name": "Dollar / Cad",
        "asset_class": "Forex",
        "pip_size": Decimal("0.0001"), "tick_value": Decimal("7.70"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "NZDUSD", "display_name": "Kiwi / Dollar",
        "asset_class": "Forex",
        "pip_size": Decimal("0.0001"), "tick_value": Decimal("10.00"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "GBPJPY", "display_name": "Pound / Yen",
        "asset_class": "Forex",
        "pip_size": Decimal("0.01"),   "tick_value": Decimal("9.10"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "EURJPY", "display_name": "Euro / Yen",
        "asset_class": "Forex",
        "pip_size": Decimal("0.01"),   "tick_value": Decimal("9.10"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },
    {
        "symbol": "EURGBP", "display_name": "Euro / Pound",
        "asset_class": "Forex",
        "pip_size": Decimal("0.0001"), "tick_value": Decimal("13.00"),
        "min_lot": Decimal("0.01"),    **_VANTAGE_BASE,
    },

    # ── Indices ──────────────────────────────────────────────────────────
    {
        "symbol": "US500", "display_name": "S&P 500 CFD",
        "asset_class": "Indices",
        "pip_size": Decimal("0.1"),   "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "US100", "display_name": "Nasdaq 100 CFD",
        "asset_class": "Indices",
        "pip_size": Decimal("0.1"),   "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "DJ30", "display_name": "Dow Jones CFD",
        "asset_class": "Indices",
        "pip_size": Decimal("1.0"),   "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "GER40", "display_name": "DAX 40 CFD",
        "asset_class": "Indices",
        "pip_size": Decimal("0.1"),   "tick_value": Decimal("1.00"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
    {
        "symbol": "UK100", "display_name": "FTSE 100 CFD",
        "asset_class": "Indices",
        "pip_size": Decimal("0.1"),   "tick_value": Decimal("0.77"),
        "min_lot": Decimal("0.01"),   **_VANTAGE_BASE,
    },
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
        len(kraken_rows),
        len(vantage_rows),
    )
