"""
Seed: market_analysis_modules + market_analysis_indicators.

Phase 1 modules:
  1. Crypto — dual module (BTC + Alts), 11 indicators (Q1–Q11)
  2. Gold   — single module (XAUUSD), 7 indicators (Q1–Q7)

Modules 3–5 (Forex, Indices, Universal Overlay) are deferred to post-Phase 1.
They will be added as new rows with zero structural changes.

Indicator fields:
  key            — unique within module, used as answer key in JSONB
  asset_target   — 'a' (BTC side), 'b' (Alts side), 'single' (Gold)
  tv_symbol      — TradingView ticker to open
  tv_timeframe   — '1W', '1D', '4H'
  timeframe_level— 'htf', 'mtf' (ltf has no questions in Phase 1)
  default_enabled— True = ON by default, False = optional (user toggles)

Scoring:
  answer_bullish → +2 pts | answer_partial → +1 pt | answer_bearish → 0 pts
  score% = (sum / (active_questions × 2)) × 100
  Thresholds: >60% BULLISH | 40–60% NEUTRAL | <40% BEARISH

Idempotent: ON CONFLICT DO NOTHING on module.name and indicator (module_id, key).
"""
from __future__ import annotations

import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from src.core.models.market_analysis import MarketAnalysisIndicator, MarketAnalysisModule

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module definitions
# ---------------------------------------------------------------------------

MODULES: list[dict] = [
    {
        "name": "Crypto",
        "description": (
            "Weekly top-down analysis for BTC and Alts. "
            "Produces HTF and MTF bias scores for both assets."
        ),
        "is_dual": True,
        "asset_a": "BTC",
        "asset_b": "Alts",
        "is_active": True,
        "sort_order": 1,
    },
    {
        "name": "Gold",
        "description": (
            "Weekly top-down analysis for XAUUSD. "
            "Driven by real yields (US10Y), USD strength (DXY), and risk sentiment (VIX)."
        ),
        "is_dual": False,
        "asset_a": "XAUUSD",
        "asset_b": None,
        "is_active": True,
        "sort_order": 2,
    },
]


# ---------------------------------------------------------------------------
# Crypto indicators (11 total: Q1–Q11)
# ---------------------------------------------------------------------------

# Shorthand for repeated answer labels
_YES = "YES — bullish / aligned (+2)"
_PARTIAL = "PARTIAL — mixed / ranging (+1)"
_NO = "NO — bearish / breakdown (0)"

_YES_FALLING = "YES — falling / at support (+2)"
_NO_RISING = "NO — rising (0)"

CRYPTO_INDICATORS: list[dict] = [
    # ── Score A: BTC ─ HTF 1W ────────────────────────────────────────────
    {
        "key": "btc_htf_1w_price",
        "label": "BTC Price (1W)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": "Is BTC in a clear weekly uptrend — higher highs and higher lows?",
        "tooltip": (
            "Open BTCUSDT on the weekly chart. "
            "Look for the last 2–3 swing lows: are they higher than the previous ones? "
            "Is price above the 20W and 50W moving averages?"
        ),
        "answer_bullish": _YES,
        "answer_partial": _PARTIAL,
        "answer_bearish": _NO,
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "btc_htf_1w_total_mcap",
        "label": "Total Market Cap (1W)",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:TOTAL",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is the total crypto market cap in an uptrend "
            "or breaking a key resistance?"
        ),
        "tooltip": (
            "Open CRYPTOCAP:TOTAL on the weekly chart. "
            "Higher highs + higher lows = growing market interest. "
            "A breakout above resistance = bullish signal."
        ),
        "answer_bullish": "YES — uptrend / breakout (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": _NO,
        "default_enabled": True,
        "sort_order": 2,
    },
    {
        "key": "btc_htf_1w_usdt_dominance",
        "label": "Tether Dominance (1W)",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:USDT.D",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is Tether Dominance falling or holding at a support level?"
        ),
        "tooltip": (
            "Open CRYPTOCAP:USDT.D on the weekly chart. "
            "USDT.D falling = money rotating from stablecoins into crypto = risk-on. "
            "Rising USDT.D = investors moving to safety = bearish."
        ),
        "answer_bullish": _YES_FALLING,
        "answer_partial": _PARTIAL,
        "answer_bearish": _NO_RISING,
        "default_enabled": True,
        "sort_order": 3,
    },
    # ── Score A: BTC ─ HTF 1D ────────────────────────────────────────────
    {
        "key": "btc_htf_1d_price",
        "label": "BTC Price (1D)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "question": (
            "On the daily chart, is BTC in an uptrend "
            "and above its key moving averages?"
        ),
        "tooltip": (
            "Open BTCUSDT on the daily chart. "
            "Check the 20 EMA and 50 EMA. "
            "Price above both = bullish. Below both = bearish."
        ),
        "answer_bullish": "YES — uptrend / above MAs (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": _NO,
        "default_enabled": True,
        "sort_order": 4,
    },
    # ── Score A: BTC ─ MTF 4H ────────────────────────────────────────────
    {
        "key": "btc_mtf_4h_price",
        "label": "BTC Price (4H)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "question": (
            "On the 4H chart, is BTC showing bullish structure "
            "or a setup forming?"
        ),
        "tooltip": (
            "Open BTCUSDT on the 4H chart. "
            "Higher highs on 4H? Break of structure upward? "
            "Support holding? Potential entry setup forming?"
        ),
        "answer_bullish": "YES — bullish setup forming (+2)",
        "answer_partial": "PARTIAL — ranging / consolidating (+1)",
        "answer_bearish": "NO — bearish structure / breakdown (0)",
        "default_enabled": True,
        "sort_order": 5,
    },
    # ── Score B: Alts ─ HTF 1W ───────────────────────────────────────────
    {
        "key": "alts_htf_1w_btc_dominance",
        "label": "BTC Dominance (1W)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:BTC.D",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is BTC Dominance falling or rejecting a resistance level?"
        ),
        "tooltip": (
            "Open CRYPTOCAP:BTC.D on the weekly chart. "
            "BTC.D falling = capital rotating from BTC into altcoins. "
            "BTC.D rising = BTC outperforming = bearish for alts."
        ),
        "answer_bullish": "YES — falling / rejecting resistance (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": "NO — rising (bearish for alts) (0)",
        "default_enabled": True,
        "sort_order": 6,
    },
    {
        "key": "alts_htf_1w_ethbtc",
        "label": "ETH/BTC Ratio (1W)",
        "asset_target": "b",
        "tv_symbol": "ETHBTC",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is the ETH/BTC ratio in an uptrend "
            "or bouncing from a support level?"
        ),
        "tooltip": (
            "Open ETHBTC on the weekly chart. "
            "ETH/BTC rising = ETH outperforming BTC = alt season proxy. "
            "This is one of the strongest signals for altcoin strength."
        ),
        "answer_bullish": "YES — uptrend / bouncing from support (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": "NO — downtrend / breaking support (0)",
        "default_enabled": True,
        "sort_order": 7,
    },
    {
        "key": "alts_htf_1w_total2",
        "label": "Total2 — Alts ex-BTC (1W)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is TOTAL2 (all alts minus BTC) in an uptrend "
            "or making higher highs?"
        ),
        "tooltip": (
            "Open CRYPTOCAP:TOTAL2 on the weekly chart. "
            "TOTAL2 rising while BTC is flat → altcoins outperforming. "
            "Confirms capital rotation into alts."
        ),
        "answer_bullish": "YES — uptrend / higher highs (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": "NO — downtrend / lower highs (0)",
        "default_enabled": True,
        "sort_order": 8,
    },
    {
        "key": "alts_htf_1w_others",
        "label": "Others Cap — Small Alts (1W)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:OTHERS",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is the 'Others' cap trending up without a vertical blow-off?"
        ),
        "tooltip": (
            "Open CRYPTOCAP:OTHERS on the weekly chart. "
            "OTHERS = small-cap alts outside the top 10. "
            "They move last in a bull cycle. "
            "A blow-off top (nearly vertical move) is a warning, not bullish."
        ),
        "answer_bullish": "YES — trending up, no blow-off (+2)",
        "answer_partial": "PARTIAL — slow/steady or just starting (+1)",
        "answer_bearish": "NO — downtrend or vertical blow-off (0)",
        "default_enabled": False,   # optional — default OFF
        "sort_order": 9,
    },
    # ── Score B: Alts ─ HTF 1D ───────────────────────────────────────────
    {
        "key": "alts_htf_1d_ethbtc",
        "label": "ETH/BTC Ratio (1D)",
        "asset_target": "b",
        "tv_symbol": "ETHBTC",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "question": (
            "On the daily chart, is ETH/BTC holding above support "
            "and trending up?"
        ),
        "tooltip": (
            "Open ETHBTC on the daily chart. "
            "This confirms (or denies) the weekly alt season signal. "
            "Above 20 EMA + rising = bullish for alts."
        ),
        "answer_bullish": "YES — above support / trending up (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": "NO — below support / falling (0)",
        "default_enabled": True,
        "sort_order": 10,
    },
    # ── Score B: Alts ─ MTF 4H ───────────────────────────────────────────
    {
        "key": "alts_mtf_4h_eth_price",
        "label": "ETH Price (4H)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "question": (
            "On the 4H chart, is ETH showing bullish structure "
            "or a setup forming?"
        ),
        "tooltip": (
            "Open ETHUSD on the 4H chart. "
            "ETH is the altcoin proxy on 4H — if ETH has a setup, "
            "most large caps likely have one too."
        ),
        "answer_bullish": "YES — bullish setup forming (+2)",
        "answer_partial": "PARTIAL — ranging / consolidating (+1)",
        "answer_bearish": "NO — bearish structure / breakdown (0)",
        "default_enabled": True,
        "sort_order": 11,
    },
]


# ---------------------------------------------------------------------------
# Gold indicators (7 total: Q1–Q7)
# ---------------------------------------------------------------------------

GOLD_INDICATORS: list[dict] = [
    # ── HTF 1W ───────────────────────────────────────────────────────────
    {
        "key": "gold_htf_1w_price",
        "label": "Gold Price (1W)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is Gold in a clear weekly uptrend — "
            "higher highs and higher lows?"
        ),
        "tooltip": (
            "Open XAUUSD on the weekly chart. "
            "Are swing lows rising? Is price above the 20W and 50W MA? "
            "That's structural bullish for Gold."
        ),
        "answer_bullish": "YES — uptrend / above MAs (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": _NO,
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "gold_htf_1w_dxy",
        "label": "US Dollar Index DXY (1W)",
        "asset_target": "single",
        "tv_symbol": "TVC:DXY",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is the US Dollar (DXY) in a downtrend "
            "or rejecting a resistance level?"
        ),
        "tooltip": (
            "Open TVC:DXY on the weekly chart. "
            "DXY and Gold move inversely. "
            "DXY falling or rejecting resistance = bullish for Gold."
        ),
        "answer_bullish": "YES — DXY falling / rejecting resistance (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": "NO — DXY rising / breaking out (0)",
        "default_enabled": True,
        "sort_order": 2,
    },
    {
        "key": "gold_htf_1w_us10y",
        "label": "US 10Y Yield (1W)",
        "asset_target": "single",
        "tv_symbol": "TVC:US10Y",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Are US 10-year yields falling or capped at a resistance?"
        ),
        "tooltip": (
            "Open TVC:US10Y on the weekly chart. "
            "Rising yields = gold less attractive vs bonds. "
            "Falling or capped yields = gold wins as a store of value."
        ),
        "answer_bullish": "YES — yields falling / capped (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": "NO — yields rising (0)",
        "default_enabled": True,
        "sort_order": 3,
    },
    {
        "key": "gold_htf_1w_vix",
        "label": "VIX Volatility Index (1W)",
        "asset_target": "single",
        "tv_symbol": "CBOE:VIX",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is the VIX elevated between 15–30 — mild fear, not panic?"
        ),
        "tooltip": (
            "Open CBOE:VIX on the weekly chart. "
            "VIX 15–30 = mild risk-off = gold safe-haven demand. "
            "VIX >35 (panic) = everything sells including gold. "
            "VIX <15 (complacency) = no tailwind for gold."
        ),
        "answer_bullish": "YES — VIX 15–30, rising gently (+2)",
        "answer_partial": "PARTIAL — VIX <15, complacency (+1)",
        "answer_bearish": "NO — VIX >35, panic selling (0)",
        "default_enabled": True,
        "sort_order": 4,
    },
    {
        "key": "gold_htf_1w_gold_silver_ratio",
        "label": "Gold / Silver Ratio (1W)",
        "asset_target": "single",
        "tv_symbol": "TVC:GOLD/TVC:SILVER",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "question": (
            "Is the Gold/Silver ratio flat or falling "
            "(silver keeping pace with gold)?"
        ),
        "tooltip": (
            "Open TVC:GOLD/TVC:SILVER on the weekly chart. "
            "Falling ratio = silver outperforming = healthy metals momentum. "
            "A sharply rising ratio = gold running alone = weaker signal."
        ),
        "answer_bullish": "YES — flat or falling (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": "NO — rising sharply (0)",
        "default_enabled": False,   # optional — default OFF
        "sort_order": 5,
    },
    # ── HTF 1D ───────────────────────────────────────────────────────────
    {
        "key": "gold_htf_1d_price",
        "label": "Gold Price (1D)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "question": (
            "On the daily chart, is Gold in an uptrend "
            "and above its key moving averages?"
        ),
        "tooltip": (
            "Open XAUUSD on the daily chart. "
            "Check the 20 EMA and 50 EMA. "
            "Price above both = bullish. Below both = bearish."
        ),
        "answer_bullish": "YES — uptrend / above MAs (+2)",
        "answer_partial": _PARTIAL,
        "answer_bearish": _NO,
        "default_enabled": True,
        "sort_order": 6,
    },
    # ── MTF 4H ───────────────────────────────────────────────────────────
    {
        "key": "gold_mtf_4h_price",
        "label": "Gold Price (4H)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "question": (
            "On the 4H chart, is Gold showing bullish structure "
            "or a setup forming?"
        ),
        "tooltip": (
            "Open XAUUSD on the 4H chart. "
            "Higher highs on 4H? Support holding? "
            "Break of 4H structure upward? "
            "Re-check this before each trading session — it changes within hours."
        ),
        "answer_bullish": "YES — bullish setup forming (+2)",
        "answer_partial": "PARTIAL — ranging / consolidating (+1)",
        "answer_bearish": "NO — bearish structure / breakdown (0)",
        "default_enabled": True,
        "sort_order": 7,
    },
]


# ---------------------------------------------------------------------------
# Seed function
# ---------------------------------------------------------------------------

def seed_market_analysis(session: Session) -> None:
    """
    Insert market analysis modules and indicators. Skip existing rows (idempotent).

    Execution order:
      1. Insert modules (ON CONFLICT DO NOTHING on name)
      2. Resolve module IDs
      3. Insert indicators (ON CONFLICT DO NOTHING on (module_id, key))
    """
    # ── Step 1: modules ─────────────────────────────────────────────────
    stmt = (
        insert(MarketAnalysisModule)
        .values(MODULES)
        .on_conflict_do_nothing(index_elements=["name"])
    )
    session.execute(stmt)
    session.flush()

    # ── Step 2: resolve IDs ──────────────────────────────────────────────
    module_rows = session.query(MarketAnalysisModule).filter(
        MarketAnalysisModule.name.in_([m["name"] for m in MODULES])
    ).all()
    module_ids = {m.name: m.id for m in module_rows}

    crypto_id = module_ids["Crypto"]
    gold_id = module_ids["Gold"]

    # ── Step 3: indicators ────────────────────────────────────────────────
    crypto_rows = [{**ind, "module_id": crypto_id} for ind in CRYPTO_INDICATORS]
    gold_rows = [{**ind, "module_id": gold_id} for ind in GOLD_INDICATORS]

    for batch in (crypto_rows, gold_rows):
        stmt = (
            insert(MarketAnalysisIndicator)
            .values(batch)
            .on_conflict_do_nothing(index_elements=["module_id", "key"])
        )
        session.execute(stmt)

    session.flush()
    logger.info(
        "Market analysis seeded — Crypto: %d indicators, Gold: %d indicators",
        len(crypto_rows),
        len(gold_rows),
    )
