"""
Seed data: intraday-focused Market Analysis modules (S/R 4H + 1H workflow).

  1. Crypto Pulse (1H)    — 6 questions, ~3 min, refreshed every session
  2. Crypto HTF (1D/4H)   — 7 questions, ~4 min, swing / weekly context

Level hierarchy used by every question:
  4H zone  = bias + location
  1H level = trigger + entry timing
  4H + 1H confluence = A+ ; a 1H signal against a 4H level is counter-trend (🟡 at best).

Tooltips are written in the same vocabulary as the trading strategies
(S/R deviation & retest, S/R flip & retest, CHOCH HL/LH, SFP, liquidity pool & key level reclaim).
"""
from __future__ import annotations

PULSE_MODULE_NAME = "Crypto Pulse (1H)"
HTF_MODULE_NAME = "Crypto HTF (1D/4H)"

_RULE_1H = (
    "\n\nLevel hierarchy: the 4H zone gives the bias/location, the 1H level is the "
    "trigger/entry timing. 4H + 1H confluence = A+. A 1H signal against a 4H level is "
    "counter-trend → 🟡 at best."
)
_RULE_1D = (
    "\n\nLevel hierarchy: the 1D zone gives the bias, the 4H level is the trigger/location. "
    "1D + 4H confluence = A+. A 4H signal against a 1D level is counter-trend → 🟡 at best."
)

NEW_MODULES: list[dict] = [
    {
        "name": PULSE_MODULE_NAME,
        "description": "Intraday pulse — USDT.D · BTC · TOTAL2 · BTC.D on 1H vs 4H/1H S/R (~3 min)",
        "is_dual": True,
        "asset_a": "Market / BTC",
        "asset_b": "Alts",
        "is_active": True,
        "sort_order": 1,
        "stale_hours": 48,
        "warn_hours": 30,
    },
    {
        "name": HTF_MODULE_NAME,
        "description": "Swing context — 1D structure + 4H reaction at key levels (~4 min)",
        "is_dual": True,
        "asset_a": "Market / BTC",
        "asset_b": "Alts",
        "is_active": True,
        "sort_order": 2,
        "stale_hours": 72,
        "warn_hours": 24,
    },
]

PULSE_INDICATORS: list[dict] = [
    {
        "key": "pulse_usdtd_levels",
        "label": "USDT.D — reaction at 4H/1H S/R",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:USDT.D",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "participation",
        "question": "💵 USDT.D 1H — how is it reacting at its 4H/1H S/R?",
        "tooltip": (
            "Open CRYPTOCAP:USDT.D on 1H with your 4H and 1H S/R drawn.\n"
            "USDT.D rising = money leaving to stables (risk-off). Falling = risk-on.\n"
            "✅ Bullish: S/R deviation + rejection at a 4H/1H resistance, or LL/LH below it.\n"
            "🟡 Neutral: ranging between 1H S/R, no acceptance above/below.\n"
            "🔴 Bearish: accepted above resistance (break + retest holding as support) or HH/HL."
            + _RULE_1H
        ),
        "answer_bullish": "🟢 Rejected at 4H/1H resistance (deviation + rejection) or LL/LH below it — risk-on",
        "answer_partial": "🟡 Ranging between 1H S/R, no acceptance above/below — no signal",
        "answer_bearish": "🔴 Accepted above 4H/1H resistance (break + retest holding) or HH/HL — risk-off",
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "pulse_btc_structure",
        "label": "BTC — 1H structure vs 4H zone",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "trend",
        "question": "₿ BTC 1H structure — where is price versus the 4H zone?",
        "tooltip": (
            "Open BTCUSDT on 1H, mark the nearest 4H zone and the 1H S/R.\n"
            "✅ Bullish: HH/HL holding above a 4H support, or an S/R flip confirmed on 1H "
            "(CHOCH LH/HL), no 4H resistance directly overhead.\n"
            "🟡 Neutral: mid-range between 4H S/R, or 1H structure against the 4H bias — no edge.\n"
            "🔴 Bearish: LH/LL, or CHOCH HL/LH with the 4H support lost — bearish continuation."
            + _RULE_1H
        ),
        "answer_bullish": "🟢 HH/HL above 4H support / 1H S/R flip confirmed — no 4H resistance overhead",
        "answer_partial": "🟡 Mid-range between 4H S/R, or 1H against the 4H bias — no edge",
        "answer_bearish": "🔴 LH/LL, or CHOCH HL/LH with 4H support lost — bearish continuation",
        "default_enabled": True,
        "sort_order": 2,
    },
    {
        "key": "pulse_btc_level_reaction",
        "label": "BTC — reaction at the nearest key level",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🎯 BTC — what is price doing at the nearest key level (1H, or 4H if close)?",
        "tooltip": (
            "Look at the closest level (1H S/R or 4H zone, whichever is nearer) and read the reaction.\n"
            "✅ Bullish: low deviation (SFP) + reclaim, or S/R flip + retest holding, strong rebound.\n"
            "🟡 Neutral: wicking/compressing into the level — no deviation, reclaim or flip confirmed yet.\n"
            "🔴 Bearish: high deviation rejected, failed reclaim, or level lost on a 1H close "
            "with follow-through down."
            + _RULE_1H
        ),
        "answer_bullish": "🟢 Low deviation (SFP) + reclaim, or S/R flip + retest holding — strong rebound",
        "answer_partial": "🟡 Wicking/compressing into the level — nothing confirmed yet",
        "answer_bearish": "🔴 High deviation rejected, failed reclaim, or level lost on 1H close + follow-through",
        "default_enabled": True,
        "sort_order": 3,
    },
    {
        "key": "pulse_total2_structure",
        "label": "TOTAL2 — 1H structure vs 4H zone",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "trend",
        "question": "🌐 TOTAL2 1H structure — where is price versus the 4H zone?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL2 on 1H (alts market cap, BTC excluded) with your 4H/1H S/R.\n"
            "✅ Bullish: HH/HL above a 4H support, or retest of a flipped level holding. 1H and 4H aligned.\n"
            "🟡 Neutral: range/compression inside a 4H zone, or 1H against the 4H bias — selective only.\n"
            "🔴 Bearish: LH/LL, or a 4H level lost with no reclaim — alts structurally weak."
            + _RULE_1H
        ),
        "answer_bullish": "🟢 HH/HL above 4H support, flipped level holding — 1H and 4H aligned",
        "answer_partial": "🟡 Range/compression inside a 4H zone, or 1H against 4H — selective only",
        "answer_bearish": "🔴 LH/LL, or 4H level lost with no reclaim — alts structurally weak",
        "default_enabled": True,
        "sort_order": 4,
    },
    {
        "key": "pulse_total2_level_reaction",
        "label": "TOTAL2 — reaction at the nearest key level",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🎯 TOTAL2 — what is price doing at the nearest key level (1H, or 4H if close)?",
        "tooltip": (
            "Read the reaction at the closest 1H S/R or 4H zone on CRYPTOCAP:TOTAL2.\n"
            "✅ Bullish: liquidity sweep + key level reclaim, or S/R flip + retest with a strong rebound.\n"
            "🟡 Neutral: no confirmed reaction yet, price still between levels.\n"
            "🔴 Bearish: failed reclaim or breakdown on a 1H close, retest rejected."
            + _RULE_1H
        ),
        "answer_bullish": "🟢 Liquidity sweep + key level reclaim, or S/R flip + retest — strong rebound",
        "answer_partial": "🟡 No confirmed reaction yet — price still between levels",
        "answer_bearish": "🔴 Failed reclaim or breakdown on a 1H close — retest rejected",
        "default_enabled": True,
        "sort_order": 5,
    },
    {
        "key": "pulse_btcd_levels",
        "label": "BTC.D — reaction at 4H/1H S/R",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:BTC.D",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "participation",
        "question": "🔃 BTC.D 1H — how is it reacting at its 4H/1H S/R?",
        "tooltip": (
            "Open CRYPTOCAP:BTC.D on 1H with your 4H/1H S/R.\n"
            "BTC.D falling = rotation into alts. Rising = BTC absorbing liquidity.\n"
            "✅ Bullish (for alts): rejected at resistance (deviation + rejection) or LL/LH.\n"
            "🟡 Neutral: ranging, no rotation — alts follow BTC only.\n"
            "🔴 Bearish (for alts): accepted above resistance or HH/HL — alts bleed."
            + _RULE_1H
        ),
        "answer_bullish": "🟢 Rejected at resistance or LL/LH — rotation into alts",
        "answer_partial": "🟡 Ranging, no rotation — alts follow BTC only",
        "answer_bearish": "🔴 Accepted above resistance or HH/HL — BTC absorbing liquidity, alts bleed",
        "default_enabled": True,
        "sort_order": 6,
    },
]

HTF_INDICATORS: list[dict] = [
    {
        "key": "htf_btc_structure_1d",
        "label": "BTC — 1D structure vs 1D S/R",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "₿ BTC 1D — structure versus the 1D S/R?",
        "tooltip": (
            "Open BTCUSDT on 1D with your 1D S/R.\n"
            "✅ Bullish: HH/HL above a 1D support, no 1D resistance directly overhead.\n"
            "🟡 Neutral: range inside a 1D zone.\n"
            "🔴 Bearish: LH/LL, or 1D support lost (CHOCH HL/LH)."
            + _RULE_1D
        ),
        "answer_bullish": "🟢 HH/HL above 1D support — no 1D resistance overhead",
        "answer_partial": "🟡 Range inside a 1D zone",
        "answer_bearish": "🔴 LH/LL, or 1D support lost (CHOCH HL/LH)",
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "htf_btc_level_reaction_4h",
        "label": "BTC — 4H reaction at the 4H/1D level",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "🎯 BTC 4H — what is price doing at the 4H/1D level?",
        "tooltip": (
            "Open BTCUSDT on 4H and read the reaction at the nearest 4H/1D level.\n"
            "✅ Bullish: low deviation + reclaim, or S/R flip + retest holding.\n"
            "🟡 Neutral: no confirmed reaction yet.\n"
            "🔴 Bearish: high deviation rejected, or failed reclaim."
            + _RULE_1D
        ),
        "answer_bullish": "🟢 Low deviation + reclaim, or S/R flip + retest holding",
        "answer_partial": "🟡 No confirmed reaction yet",
        "answer_bearish": "🔴 High deviation rejected, or failed reclaim",
        "default_enabled": True,
        "sort_order": 2,
    },
    {
        "key": "htf_btc_volume_obv_1d",
        "label": "BTC — 1D volume / OBV confirmation",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 BTC 1D — do volume and OBV confirm the move?",
        "tooltip": (
            "Open BTCUSDT on 1D with Volume and OBV.\n"
            "✅ Bullish: volume expanding with the move, OBV confirming (breaks the same way).\n"
            "🟡 Neutral: flat — no confirmation either way.\n"
            "🔴 Bearish: divergence, or volume fading on the move."
        ),
        "answer_bullish": "🟢 Volume expanding with the move, OBV confirming",
        "answer_partial": "🟡 Flat — no confirmation either way",
        "answer_bearish": "🔴 Divergence, or volume fading on the move",
        "default_enabled": True,
        "sort_order": 3,
    },
    {
        "key": "htf_usdtd_1d",
        "label": "USDT.D — 1D reaction at S/R",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:USDT.D",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "💵 USDT.D 1D — how is it reacting at its S/R?",
        "tooltip": (
            "Open CRYPTOCAP:USDT.D on 1D.\n"
            "✅ Bullish: rejected at 1D resistance, or LL/LH — risk-on.\n"
            "🟡 Neutral: ranging.\n"
            "🔴 Bearish: accepted above 1D resistance, HH/HL — risk-off."
            + _RULE_1D
        ),
        "answer_bullish": "🟢 Rejected at 1D resistance, or LL/LH — risk-on",
        "answer_partial": "🟡 Ranging",
        "answer_bearish": "🔴 Accepted above 1D resistance, HH/HL — risk-off",
        "default_enabled": True,
        "sort_order": 4,
    },
    {
        "key": "htf_total2_structure_1d",
        "label": "TOTAL2 — 1D structure vs 1D S/R",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🌐 TOTAL2 1D — structure versus the 1D S/R?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL2 on 1D.\n"
            "✅ Bullish: HH/HL above a 1D support, flipped level holding.\n"
            "🟡 Neutral: range or compression.\n"
            "🔴 Bearish: LH/LL, or a 1D level lost without reclaim."
            + _RULE_1D
        ),
        "answer_bullish": "🟢 HH/HL above 1D support, flipped level holding",
        "answer_partial": "🟡 Range or compression",
        "answer_bearish": "🔴 LH/LL, or 1D level lost without reclaim",
        "default_enabled": True,
        "sort_order": 5,
    },
    {
        "key": "htf_total2_level_reaction_4h",
        "label": "TOTAL2 — 4H reaction at the 4H/1D level",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "🎯 TOTAL2 4H — what is price doing at the 4H/1D level?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL2 on 4H and read the reaction at the nearest 4H/1D level.\n"
            "✅ Bullish: liquidity sweep + key level reclaim, or S/R flip + retest.\n"
            "🟡 Neutral: no confirmed reaction yet.\n"
            "🔴 Bearish: failed reclaim or breakdown on a 4H close."
            + _RULE_1D
        ),
        "answer_bullish": "🟢 Liquidity sweep + key level reclaim, or S/R flip + retest",
        "answer_partial": "🟡 No confirmed reaction yet",
        "answer_bearish": "🔴 Failed reclaim or breakdown on a 4H close",
        "default_enabled": True,
        "sort_order": 6,
    },
    {
        "key": "htf_btcd_1d",
        "label": "BTC.D — 1D reaction at S/R",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:BTC.D",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🔃 BTC.D 1D — how is it reacting at its S/R?",
        "tooltip": (
            "Open CRYPTOCAP:BTC.D on 1D.\n"
            "✅ Bullish (for alts): rejected at resistance, or LL/LH — alts rotation.\n"
            "🟡 Neutral: ranging.\n"
            "🔴 Bearish (for alts): accepted above resistance, HH/HL — alts bleed."
            + _RULE_1D
        ),
        "answer_bullish": "🟢 Rejected at resistance, or LL/LH — alts rotation",
        "answer_partial": "🟡 Ranging",
        "answer_bearish": "🔴 Accepted above resistance, HH/HL — alts bleed",
        "default_enabled": True,
        "sort_order": 7,
    },
]
