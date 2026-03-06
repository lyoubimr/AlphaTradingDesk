"""
Seed: market_analysis_modules + market_analysis_indicators  (v2)

Modules:
  1. Crypto  — dual (BTC + Alts) — default-on set: 14 indicators
  2. Gold    — single (XAUUSD)   — default-on set: 7 indicators

v2 design rules:
  • score_block = 'trend' | 'momentum' | 'participation'
  • Composite = 0.45 × Trend + 0.30 × Momentum + 0.25 × Participation
  • Thresholds: ≥ 65 BULLISH | 35–64 NEUTRAL | ≤ 34 BEARISH
  • Questions: short, emoji-first, actionable (max ~8 words)
  • No RSI on LTF by default (default_enabled=False)
  • Participation block uses TOTAL / TOTAL2 / BTC.D / USDT.D — NOT BTC/ETH price
  • LTF = entry timing tiebreaker only (10% composite weight)

Idempotent: ON CONFLICT DO NOTHING on (name) for modules, (module_id, key) for indicators.
"""
from __future__ import annotations

import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from src.core.models.market_analysis import MarketAnalysisIndicator, MarketAnalysisModule

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------

MODULES: list[dict] = [
    {
        "name": "Crypto",
        "description": "Weekly top-down for BTC + Alts — Trend · Momentum · Participation",
        "is_dual": True,
        "asset_a": "BTC",
        "asset_b": "Alts",
        "is_active": True,
        "sort_order": 1,
    },
    {
        "name": "Gold",
        "description": "Weekly top-down for XAUUSD — DXY, yields, VIX, structure",
        "is_dual": False,
        "asset_a": "XAUUSD",
        "asset_b": None,
        "is_active": True,
        "sort_order": 2,
    },
]


# ---------------------------------------------------------------------------
# Crypto indicators
# ---------------------------------------------------------------------------
# Score A = BTC side  (asset_target = 'a')
# Score B = Alts side (asset_target = 'b')
#
# Blocks:
#   trend         — BTC structure 1W/1D + ETH/BTC ratio
#   momentum      — BTC/ETH volume + OBV + 4H structure
#   participation — TOTAL / TOTAL2 / BTC.D / USDT.D   (NOT BTC/ETH price)
# ---------------------------------------------------------------------------

CRYPTO_INDICATORS: list[dict] = [

    # ── TREND — BTC structure ──────────────────────────────────────────────

    {
        "key": "btc_htf_1w_structure",
        "label": "BTC Structure (1W)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "📈 BTC — weekly HH/HL uptrend intact?",
        "tooltip": (
            "Check BTCUSDT 1W. Are the last 2–3 swing lows higher than the previous? "
            "Price above 20W and 50W MA = bullish structure."
        ),
        "answer_bullish": "🟢 Yes — HH/HL, above MAs",
        "answer_partial": "🟡 Mixed — ranging / consolidating",
        "answer_bearish": "🔴 No — LL/LH or below MAs",
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "btc_htf_1d_structure",
        "label": "BTC Structure (1D)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "📈 BTC daily — above key MAs, uptrend?",
        "tooltip": (
            "Open BTCUSDT 1D. "
            "Price above 20 EMA and 50 EMA = bullish. "
            "Impulse candles up + corrective pullbacks = healthy trend."
        ),
        "answer_bullish": "🟢 Yes — uptrend, above 20/50 EMA",
        "answer_partial": "🟡 Mixed — at MAs or ranging",
        "answer_bearish": "🔴 No — below MAs or downtrend",
        "default_enabled": True,
        "sort_order": 2,
    },

    # ── TREND — Alts rotation proxy ────────────────────────────────────────

    {
        "key": "alts_htf_1w_ethbtc",
        "label": "ETH/BTC Ratio (1W)",
        "asset_target": "b",
        "tv_symbol": "ETHBTC",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🔀 ETH/BTC weekly — uptrend or bouncing?",
        "tooltip": (
            "Open ETHBTC 1W. "
            "Rising ETH/BTC = capital rotating from BTC into alts = primary alt season signal."
        ),
        "answer_bullish": "🟢 Yes — uptrend / bouncing from support",
        "answer_partial": "🟡 Flat / unclear direction",
        "answer_bearish": "🔴 No — downtrend / breaking support",
        "default_enabled": True,
        "sort_order": 3,
    },
    {
        "key": "alts_htf_1d_ethbtc",
        "label": "ETH/BTC Ratio (1D)",
        "asset_target": "b",
        "tv_symbol": "ETHBTC",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🔀 ETH/BTC daily — holding above support?",
        "tooltip": (
            "Open ETHBTC 1D. Confirms or denies the weekly alt season signal. "
            "Above 20 EMA + rising = bullish for alts."
        ),
        "answer_bullish": "🟢 Yes — above support, 20 EMA rising",
        "answer_partial": "🟡 At support — no clear reaction",
        "answer_bearish": "🔴 No — below support / falling",
        "default_enabled": True,
        "sort_order": 4,
    },

    # ── MOMENTUM — Volume conviction ───────────────────────────────────────

    {
        "key": "btc_htf_1w_volume",
        "label": "BTC Volume (1W)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 BTC 1W — volume up on green candles?",
        "tooltip": (
            "Open BTCUSDT 1W — add Volume. "
            "Volume up on green weeks = institutional buying. "
            "High volume on red weeks = warning — distribution."
        ),
        "answer_bullish": "🟢 Yes — volume confirms uptrend",
        "answer_partial": "🟡 Mixed — no clear pattern",
        "answer_bearish": "🔴 No — high volume on red candles",
        "default_enabled": True,
        "sort_order": 5,
    },
    {
        "key": "btc_htf_1d_obv",
        "label": "BTC OBV (1D)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 BTC OBV 1D — confirming price, no divergence?",
        "tooltip": (
            "Open BTCUSDT 1D — add OBV. "
            "OBV rising with price = bullish. "
            "OBV falling while price rises = bearish divergence — distribution."
        ),
        "answer_bullish": "🟢 OBV confirms — no divergence",
        "answer_partial": "🟡 OBV flat / lagging",
        "answer_bearish": "🔴 Bearish divergence — OBV falling",
        "default_enabled": True,
        "sort_order": 6,
    },
    {
        "key": "btc_mtf_4h_momentum",
        "label": "BTC Momentum (4H)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "⚡ BTC 4H — bullish structure or setup?",
        "tooltip": (
            "Open BTCUSDT 4H. "
            "Higher highs? BOS upward? Support holding? Setup forming aligned with HTF?"
        ),
        "answer_bullish": "🟢 Yes — bullish structure / BOS up",
        "answer_partial": "🟡 Ranging / consolidating at support",
        "answer_bearish": "🔴 No — BOS down / bearish structure",
        "default_enabled": True,
        "sort_order": 7,
    },
    {
        "key": "alts_mtf_4h_momentum",
        "label": "ETH Momentum (4H)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "⚡ ETH 4H — bullish structure or setup?",
        "tooltip": (
            "Open ETHUSD 4H. ETH = altcoin proxy for 4H entry timing. "
            "If ETH has a valid setup, most large-cap alts likely do too."
        ),
        "answer_bullish": "🟢 Yes — bullish structure / BOS up",
        "answer_partial": "🟡 Ranging / consolidating",
        "answer_bearish": "🔴 No — BOS down / breakdown",
        "default_enabled": True,
        "sort_order": 8,
    },

    # ── PARTICIPATION — Market breadth & rotation ──────────────────────────

    {
        "key": "btc_htf_1w_total_mcap",
        "label": "Total Market Cap (1W)",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:TOTAL",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🌍 TOTAL — uptrend or breaking resistance?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL 1W. "
            "Total crypto market cap rising = growing participation. "
            "Breakout above resistance = broad influx of new capital."
        ),
        "answer_bullish": "🟢 Yes — uptrend / breaking resistance",
        "answer_partial": "🟡 Flat / consolidating",
        "answer_bearish": "🔴 No — downtrend / below support",
        "default_enabled": True,
        "sort_order": 9,
    },
    {
        "key": "btc_htf_1w_usdt_dominance",
        "label": "USDT Dominance (1W)",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:USDT.D",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "💵 USDT.D — falling? (risk-on signal)",
        "tooltip": (
            "Open CRYPTOCAP:USDT.D 1W. "
            "USDT.D falling = money rotating from stablecoins into crypto = risk-on. "
            "USDT.D rising = investors moving to safety = bearish."
        ),
        "answer_bullish": "🟢 Yes — falling / at support",
        "answer_partial": "🟡 Flat / sideways",
        "answer_bearish": "🔴 No — rising (risk-off)",
        "default_enabled": True,
        "sort_order": 10,
    },
    {
        "key": "alts_htf_1w_btc_dominance",
        "label": "BTC Dominance (1W)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:BTC.D",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🔃 BTC.D — falling or rejecting resistance?",
        "tooltip": (
            "Open CRYPTOCAP:BTC.D 1W. "
            "BTC.D falling = capital rotating from BTC into altcoins. "
            "BTC.D rising = BTC outperforming = bearish for alts."
        ),
        "answer_bullish": "🟢 Yes — falling / rejecting resistance",
        "answer_partial": "🟡 Flat / unclear",
        "answer_bearish": "🔴 No — rising (BTC dominates)",
        "default_enabled": True,
        "sort_order": 11,
    },
    {
        "key": "alts_htf_1w_total2",
        "label": "TOTAL2 — Alts ex-BTC (1W)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🌐 TOTAL2 — uptrend or higher highs?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL2 1W (all alts minus BTC). "
            "Rising while BTC flat = alts outperforming = capital rotation confirmed."
        ),
        "answer_bullish": "🟢 Yes — uptrend / higher highs",
        "answer_partial": "🟡 Flat / consolidating",
        "answer_bearish": "🔴 No — downtrend / lower highs",
        "default_enabled": True,
        "sort_order": 12,
    },

    # ── LTF — Entry timing (tiebreaker only) ──────────────────────────────

    {
        "key": "btc_ltf_1h_structure",
        "label": "BTC Structure (1H)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🎯 BTC 1H — BOS upward or CHoCH?",
        "tooltip": (
            "Open BTCUSDT 1H. "
            "BOS upward = breaking a recent 1H swing high. "
            "CHoCH = first HH after a downtrend. "
            "Use for ENTRY TIMING only — never against HTF bias."
        ),
        "answer_bullish": "🟢 Yes — BOS / CHoCH upward",
        "answer_partial": "🟡 Ranging at support",
        "answer_bearish": "🔴 No — BOS down / bearish",
        "default_enabled": True,
        "sort_order": 13,
    },
    {
        "key": "alts_ltf_1h_structure",
        "label": "ETH Structure (1H)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🎯 ETH 1H — BOS upward or CHoCH?",
        "tooltip": (
            "Open ETHUSD 1H. ETH 1H = large-cap alts entry timing proxy. "
            "Confirm 1H aligned with 4H before entering."
        ),
        "answer_bullish": "🟢 Yes — BOS / CHoCH upward, 4H aligned",
        "answer_partial": "🟡 Consolidating / no setup yet",
        "answer_bearish": "🔴 No — BOS down / breakdown",
        "default_enabled": True,
        "sort_order": 14,
    },

    # ── Optional indicators (default OFF) ─────────────────────────────────

    {
        "key": "alts_htf_1w_others",
        "label": "Others Cap (1W)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:OTHERS",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🎲 OTHERS — trending up, no blow-off top?",
        "tooltip": (
            "Open CRYPTOCAP:OTHERS 1W (small-caps outside top 10). "
            "Move last in a bull cycle. Near-vertical blow-off = warning sign."
        ),
        "answer_bullish": "🟢 Yes — steady uptrend, no blow-off",
        "answer_partial": "🟡 Slow / just starting",
        "answer_bearish": "🔴 No — downtrend or blow-off top",
        "default_enabled": False,
        "sort_order": 15,
    },
    {
        "key": "alts_htf_1d_obv",
        "label": "ETH OBV (1D)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 ETH OBV 1D — confirming price?",
        "tooltip": (
            "Open ETHUSD 1D — add OBV. "
            "OBV rising with price = accumulation. "
            "OBV falling while price rises = distribution — alts likely to roll over."
        ),
        "answer_bullish": "🟢 OBV confirms — rising with price",
        "answer_partial": "🟡 OBV flat / lagging",
        "answer_bearish": "🔴 Bearish divergence — being distributed",
        "default_enabled": False,
        "sort_order": 16,
    },
    {
        "key": "btc_htf_1d_sr",
        "label": "BTC S/R Reaction (1D)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🧱 BTC daily — clean rejection at support?",
        "tooltip": (
            "Open BTCUSDT 1D. Nearest S/R = swing highs/lows or round numbers. "
            "Bullish: hammer/engulfing at support — buyers defended the level. "
            "Bearish: close below support — level failed."
        ),
        "answer_bullish": "🟢 Yes — clean rejection, level holds",
        "answer_partial": "🟡 At support — no clear reaction yet",
        "answer_bearish": "🔴 No — support broken, close below",
        "default_enabled": False,
        "sort_order": 17,
    },
    {
        "key": "btc_ltf_1h_rsi",
        "label": "BTC RSI (1H)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "📉 BTC 1H RSI — 40–70 range, rising?",
        "tooltip": (
            "Open BTCUSDT 1H — add RSI(14). "
            "40–55 + rising = momentum building. "
            ">70 = overbought (wait). <40 = bearish (avoid longs)."
        ),
        "answer_bullish": "🟢 Yes — RSI 40–70, rising",
        "answer_partial": "🟡 Flat / mild divergence",
        "answer_bearish": "🔴 No — >70 overbought or <40 bearish",
        "default_enabled": False,   # RSI off by default
        "sort_order": 18,
    },
]


# ---------------------------------------------------------------------------
# Gold indicators
# ---------------------------------------------------------------------------

GOLD_INDICATORS: list[dict] = [

    # ── TREND ──────────────────────────────────────────────────────────────

    {
        "key": "gold_htf_1w_structure",
        "label": "Gold Structure (1W)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "📈 Gold — weekly HH/HL uptrend intact?",
        "tooltip": (
            "Open XAUUSD 1W. Rising swing lows + above 20W/50W MA = bullish structure."
        ),
        "answer_bullish": "🟢 Yes — HH/HL, above MAs",
        "answer_partial": "🟡 Mixed — ranging / consolidating",
        "answer_bearish": "🔴 No — LL/LH or below MAs",
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "gold_htf_1d_structure",
        "label": "Gold Structure (1D)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "📈 Gold daily — above 20/50 EMA, uptrend?",
        "tooltip": (
            "Open XAUUSD 1D. "
            "Above 20 EMA and 50 EMA with impulse candles up = bullish."
        ),
        "answer_bullish": "🟢 Yes — uptrend, above 20/50 EMA",
        "answer_partial": "🟡 At MAs / ranging",
        "answer_bearish": "🔴 No — below MAs or downtrend",
        "default_enabled": True,
        "sort_order": 2,
    },

    # ── PARTICIPATION — Macro drivers ──────────────────────────────────────

    {
        "key": "gold_htf_1w_dxy",
        "label": "DXY (1W)",
        "asset_target": "single",
        "tv_symbol": "TVC:DXY",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "💵 DXY — downtrend or rejecting resistance?",
        "tooltip": (
            "Open TVC:DXY 1W. DXY and Gold move inversely. "
            "DXY falling or rejecting resistance = bullish tailwind for Gold."
        ),
        "answer_bullish": "🟢 Yes — DXY falling / rejecting resistance",
        "answer_partial": "🟡 Flat / consolidating",
        "answer_bearish": "🔴 No — DXY rising / breaking out",
        "default_enabled": True,
        "sort_order": 3,
    },
    {
        "key": "gold_htf_1w_us10y",
        "label": "US 10Y Yield (1W)",
        "asset_target": "single",
        "tv_symbol": "TVC:US10Y",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "📉 US10Y yields — falling or capped?",
        "tooltip": (
            "Open TVC:US10Y 1W. "
            "Rising yields = Gold less attractive. "
            "Falling or capped yields = Gold wins as store of value."
        ),
        "answer_bullish": "🟢 Yes — yields falling / capped",
        "answer_partial": "🟡 Flat / ranging",
        "answer_bearish": "🔴 No — yields rising",
        "default_enabled": True,
        "sort_order": 4,
    },
    {
        "key": "gold_htf_1w_vix",
        "label": "VIX (1W)",
        "asset_target": "single",
        "tv_symbol": "CBOE:VIX",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "😰 VIX 15–30? (mild fear = gold bid)",
        "tooltip": (
            "Open CBOE:VIX 1W. "
            "15–30 = mild risk-off = Gold safe-haven bid. "
            ">35 = panic — everything sells. <15 = complacency — no Gold tailwind."
        ),
        "answer_bullish": "🟢 Yes — VIX 15–30, mild fear",
        "answer_partial": "🟡 VIX <15 — complacency",
        "answer_bearish": "🔴 No — VIX >35, panic selling",
        "default_enabled": True,
        "sort_order": 5,
    },

    # ── MOMENTUM ───────────────────────────────────────────────────────────

    {
        "key": "gold_htf_1w_volume",
        "label": "Gold Volume (1W)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 Gold 1W — volume up on green weeks?",
        "tooltip": (
            "Open XAUUSD 1W — add Volume. "
            "Volume up on green weeks = institutional demand. "
            "High volume on red week = warning — distribution."
        ),
        "answer_bullish": "🟢 Yes — volume confirms uptrend",
        "answer_partial": "🟡 Mixed — no clear pattern",
        "answer_bearish": "🔴 No — high volume on red weeks",
        "default_enabled": True,
        "sort_order": 6,
    },
    {
        "key": "gold_mtf_4h_momentum",
        "label": "Gold Momentum (4H)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "⚡ Gold 4H — bullish structure or setup?",
        "tooltip": (
            "Open XAUUSD 4H. Higher highs? BOS upward? Support holding? "
            "Re-check before each session — 4H changes within hours."
        ),
        "answer_bullish": "🟢 Yes — bullish structure / BOS up",
        "answer_partial": "🟡 Ranging / consolidating",
        "answer_bearish": "🔴 No — BOS down / breakdown",
        "default_enabled": True,
        "sort_order": 7,
    },

    # ── LTF — Entry timing ─────────────────────────────────────────────────

    {
        "key": "gold_ltf_1h_structure",
        "label": "Gold Structure (1H)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🎯 Gold 1H — BOS upward or CHoCH?",
        "tooltip": (
            "Open XAUUSD 1H. BOS upward = breaking a recent 1H swing high. "
            "CHoCH = first HH after a downtrend. Use for ENTRY TIMING only."
        ),
        "answer_bullish": "🟢 Yes — BOS / CHoCH upward, 4H aligned",
        "answer_partial": "🟡 Consolidating / no setup yet",
        "answer_bearish": "🔴 No — BOS down / breakdown",
        "default_enabled": True,
        "sort_order": 8,
    },

    # ── Optional (default OFF) ─────────────────────────────────────────────

    {
        "key": "gold_htf_1d_obv",
        "label": "Gold OBV (1D)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 Gold OBV 1D — confirming price, no divergence?",
        "tooltip": (
            "Open XAUUSD 1D — add OBV. "
            "OBV rising with price = institutional accumulation. "
            "OBV falling while price rises = distribution — likely to reverse."
        ),
        "answer_bullish": "🟢 OBV confirms — rising with price",
        "answer_partial": "🟡 OBV flat / no clear divergence",
        "answer_bearish": "🔴 Bearish divergence — OBV falling",
        "default_enabled": False,
        "sort_order": 9,
    },
    {
        "key": "gold_htf_1d_sr",
        "label": "Gold S/R Reaction (1D)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🧱 Gold daily — clean rejection at support?",
        "tooltip": (
            "Open XAUUSD 1D. Key S/R = prior highs/lows, round numbers (2000/2500/3000). "
            "Bullish: hammer/engulfing at support — buyers defended. "
            "Bearish: daily close below support."
        ),
        "answer_bullish": "🟢 Yes — clean rejection, buyers defended",
        "answer_partial": "🟡 At support — no reaction yet",
        "answer_bearish": "🔴 No — support broken, close below",
        "default_enabled": False,
        "sort_order": 10,
    },
    {
        "key": "gold_htf_1w_gold_silver",
        "label": "Gold/Silver Ratio (1W)",
        "asset_target": "single",
        "tv_symbol": "TVC:GOLD/TVC:SILVER",
        "tv_timeframe": "1W",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🥈 Gold/Silver ratio — flat or falling?",
        "tooltip": (
            "Open TVC:GOLD/TVC:SILVER 1W. "
            "Falling ratio = silver keeping pace = healthy metals momentum. "
            "Rising sharply = gold running alone = weaker signal."
        ),
        "answer_bullish": "🟢 Yes — flat or falling",
        "answer_partial": "🟡 Slightly rising",
        "answer_bearish": "🔴 No — rising sharply",
        "default_enabled": False,
        "sort_order": 11,
    },
]


# ---------------------------------------------------------------------------
# Seed function
# ---------------------------------------------------------------------------

#: Fields that are always synced on upsert (everything except the PK / conflict key).
_UPSERT_SYNC_FIELDS = [
    "label",
    "asset_target",
    "tv_symbol",
    "tv_timeframe",
    "timeframe_level",
    "score_block",
    "question",
    "tooltip",
    "answer_bullish",
    "answer_partial",
    "answer_bearish",
    "default_enabled",
    "sort_order",
]


def seed_market_analysis(session: Session) -> None:
    """Insert or update modules and indicators.

    Strategy: ON CONFLICT DO UPDATE on the unique keys so that every
    seed run keeps metadata (sort_order, question, default_enabled …)
    in sync with the canonical definitions above.  Rows in the DB that
    no longer exist in the seed are left untouched (safe for prod data).
    """
    # ── Step 1 — modules (upsert description / flags) ──────────────────
    set_module = {
        col: getattr(insert(MarketAnalysisModule).excluded, col)
        for col in ["description", "is_dual", "asset_a", "asset_b", "is_active", "sort_order"]
    }
    stmt = (
        insert(MarketAnalysisModule)
        .values(MODULES)
        .on_conflict_do_update(index_elements=["name"], set_=set_module)
    )
    session.execute(stmt)
    session.flush()

    # ── Step 2 — resolve module IDs ────────────────────────────────────
    module_rows = session.query(MarketAnalysisModule).filter(
        MarketAnalysisModule.name.in_([m["name"] for m in MODULES])
    ).all()
    module_ids = {m.name: m.id for m in module_rows}

    crypto_id = module_ids["Crypto"]
    gold_id   = module_ids["Gold"]

    # ── Step 3 — indicators (upsert all metadata fields) ───────────────
    crypto_rows = [{**ind, "module_id": crypto_id} for ind in CRYPTO_INDICATORS]
    gold_rows   = [{**ind, "module_id": gold_id}   for ind in GOLD_INDICATORS]

    for batch in (crypto_rows, gold_rows):
        ins = insert(MarketAnalysisIndicator).values(batch)
        set_ind = {col: getattr(ins.excluded, col) for col in _UPSERT_SYNC_FIELDS}
        stmt = ins.on_conflict_do_update(
            index_elements=["module_id", "key"],
            set_=set_ind,
        )
        session.execute(stmt)

    session.flush()
    logger.info(
        "Market analysis seeded (upsert) — Crypto: %d indicators, Gold: %d indicators",
        len(crypto_rows),
        len(gold_rows),
    )
