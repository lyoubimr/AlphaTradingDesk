"""
Seed: market_analysis_modules + market_analysis_indicators  (v5)

──────────────────────────────────────────────────────────────────────────────
Modules:
  1. Crypto  — dual (BTC + Alts) — default-on set: 25 indicators (15 core + 10 enrichment)
  2. Gold    — single (XAUUSD)   — default-on set: 12 indicators

──────────────────────────────────────────────────────────────────────────────
Design rules (v4):

  ❌ NEVER direct price questions (no "BTC > $80k?")
  ✅ Structure via HH/HL or LL/LH — always relative, never absolute price
  ✅ Deviation implicit in structure/S/R questions — no standalone deviation indicator
  ✅ TOTAL integrated in BTC trend block (not standalone participation)
  ✅ TOTAL2 integrated in Alts trend block (not standalone participation)
  ✅ USDT.D as shared macro filter (scored on both BTC and Alts sides)

  TF levels — keys use generic htf/mtf/ltf (NOT 1d/4h etc.)
  The actual tv_timeframe field stores the concrete TF for TradingView links.

  Default TF mapping:
    HTF = 1D (Daily)    — trend direction, macro structure, TOTAL/TOTAL2 breadth
    MTF = 4H (4-Hour)   — momentum, S/R reaction, volume conviction
    LTF = 1H (1-Hour)   — entry timing: BOS/CHoCH + deviation reclaim/upthrust

  ⚙️ TF mapping is configurable in MarketAnalysisSettings (Phase 1 default).
     Changing the tv_timeframe field in Settings overrides these defaults.

  score_block:
    'trend'         → structure (HH/HL + deviation context), S/R reaction, TOTAL/TOTAL2
    'momentum'      → volume, OBV divergence, 4H structure
    'participation' → BTC.D, USDT.D (macro filter), BTC↔BTC.D correlation

  Composite formula:
    0.45 × Trend + 0.30 × Momentum + 0.25 × Participation
  Thresholds:
    ≥ 65 BULLISH | 35–64 NEUTRAL | ≤ 34 BEARISH

  Answer structure: always 3 choices (bullish/partial/bearish = 2/1/0)
    Keep answers specific and actionable — no vague "Mixed"

  Questions: emoji-first, max ~8 words, no direct price mention
  Tooltips: step-by-step "how to read", specific symbol + indicator to open
  Deviation context: embedded in structure + S/R tooltips where relevant

──────────────────────────────────────────────────────────────────────────────
Analysis flow (v4 — HTF = 1D):
  1. TREND      — 1D structure (HH/HL vs LL/LH) + TOTAL/TOTAL2 breadth
  2. S/R        — 4H key level + reaction quality (+ deviation awareness)
  3. VOLUME     — 1D + 4H volume direction + OBV (1D + 4H)
  4. LTF        — 1H BOS/CHoCH + deviation reclaim / upthrust detection
  5. BREADTH    — BTC.D + USDT.D macro filter
  6. CORRELATION — BTC ↔ BTC.D scenario → final conclusion

──────────────────────────────────────────────────────────────────────────────
Idempotent: ON CONFLICT DO UPDATE on (name) for modules, (module_id, key) for indicators.
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
        "description": "",
        "is_dual": True,
        "asset_a": "BTC",
        "asset_b": "Alts",
        "is_active": True,
        "sort_order": 1,
    },
    {
        "name": "Gold",
        "description": "",
        "is_dual": False,
        "asset_a": "XAUUSD",
        "asset_b": None,
        "is_active": True,
        "sort_order": 2,
    },
]


# ---------------------------------------------------------------------------
# Crypto indicators  (v4)
# ---------------------------------------------------------------------------
# Score A = BTC side  (asset_target = 'a')
# Score B = Alts side (asset_target = 'b')
#
# Analysis flow (reflected in sort_order):
#   1-2   TREND — 1D structure BTC (+ TOTAL breadth confirmation)    (trend block)
#   3-4   TREND — 1D structure Alts (ETH/BTC + TOTAL2 breadth)       (trend block)
#   5-6   S/R   — 4H key level + reaction BTC + ETH (dev-aware)      (trend block)
#   7-10  VOLUME / OBV — conviction on 1D + 4H                       (momentum block)
#   11-12 LTF ENTRY — 1H BOS/CHoCH + deviation (BTC + ETH)          (momentum block)
#   13-14 BREADTH — USDT.D + BTC.D macro filter                      (participation block)
#   15    CORRELATION — BTC ↔ BTC.D scenario                         (participation block)
# ---------------------------------------------------------------------------

CRYPTO_INDICATORS: list[dict] = [

    # ── TREND 1-2 — BTC 1D Structure + TOTAL Breadth ─────────────────────
    # Both go to score A (BTC side) / trend block.
    # TOTAL embedded here: if market cap is not expanding, the BTC structure signal is weaker.

    {
        "key": "btc_htf_structure",
        "label": "BTC Structure (HTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "📈 BTC 1D — HH/HL intact, structure bullish?",
        "tooltip": (
            "Open BTCUSDT on the 1D chart.\n"
            "✅ Bullish: the last 2–3 daily swing lows are higher than the previous (HH/HL chain). "
            "The sequence of swing highs is also rising — clear uptrend structure.\n"
            "🟡 Ranging: no clear swing structure — price oscillating inside a defined range. "
            "The 1D candles are overlapping, no trending sequence of highs or lows.\n"
            "🔴 Bearish: last 2–3 swing highs are lower (LL/LH chain). "
            "OR: a significant daily support level was closed below.\n\n"
            "📌 Deviation awareness: if price is making a short-term LL below a prior swing low "
            "but then immediately reclaims it with a strong bullish daily close → this is a deviation "
            "(stop hunt / liquidity sweep), NOT a trend change. Mark it as 🟡 Ranging, not bearish.\n"
            "Do NOT look at the price level in absolute terms — only the sequence of highs and lows."
        ),
        "answer_bullish": "🟢 HH/HL — uptrend, above MAs",
        "answer_partial": "🟡 Ranging / no clear 1D structure",
        "answer_bearish": "🔴 LL/LH — downtrend or below MAs",
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "btc_htf_total",
        "label": "TOTAL Market Cap — BTC Trend Context (HTF)",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:TOTAL",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🌍 TOTAL 1D — uptrend, confirming BTC?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL on the 1D chart (total crypto market cap).\n"
            "This is used to CONFIRM BTC's 1D trend — a BTC uptrend is stronger when "
            "the total crypto market cap is also rising.\n"
            "✅ Bullish: TOTAL in an uptrend (HH/HL on 1D), breaking above a prior daily "
            "resistance, or just bouncing off 1D support with expanding volume. "
            "Rising TOTAL = new capital entering the space, not just BTC rotating internally.\n"
            "🟡 Ranging: TOTAL consolidating inside a known daily range. "
            "BTC may still move independently. Not a red flag — often a base.\n"
            "🔴 Bearish: TOTAL making LL/LH on 1D or closed below a key daily support. "
            "Capital leaving broadly — BTC structure signal is less trustworthy.\n\n"
            "📌 Key question: is BTC's structure consistent with broad market direction, "
            "or is BTC moving alone? TOTAL answers this."
        ),
        "answer_bullish": "🟢 TOTAL uptrend / expanding — confirms BTC",
        "answer_partial": "🟡 TOTAL ranging / consolidating",
        "answer_bearish": "🔴 TOTAL downtrend / broken support",
        "default_enabled": True,
        "sort_order": 2,
    },

    # ── TREND 3-4 — Alts 1D Structure + TOTAL2 Breadth ───────────────────
    # Both go to score B (Alts side) / trend block.

    {
        "key": "alts_htf_structure",
        "label": "Alts Structure — ETH/BTC (HTF)",
        "asset_target": "b",
        "tv_symbol": "ETHBTC",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🔀 ETH/BTC 1D — HH/HL or bouncing off support?",
        "tooltip": (
            "Open ETHBTC on the 1D chart (NOT ETHUSD — we want relative performance vs BTC).\n"
            "ETH/BTC measures whether capital is rotating OUT of BTC and INTO alts.\n"
            "✅ Bullish: ETH/BTC forming HH/HL on 1D, or bouncing from a clean 1D support "
            "(prior swing low, flat base). A 1D bullish engulfing off support = high conviction.\n"
            "🟡 Flat: ETH/BTC ranging sideways on 1D — alts moving with BTC, no rotation signal.\n"
            "🔴 Bearish: ETH/BTC making LL/LH on 1D, or closing below a key 1D support. "
            "BTC is outperforming; capital not rotating into alts.\n\n"
            "📌 Deviation awareness: a wick below a key 1D support on ETH/BTC that immediately "
            "recovers within the same candle = liquidity sweep (deviation), not a true breakdown. "
            "Only count as bearish if the 1D CANDLE CLOSES below the level.\n"
            "This is the primary alt season indicator — weight it heavily in your analysis."
        ),
        "answer_bullish": "🟢 HH/HL — uptrend or bouncing from 1D support",
        "answer_partial": "🟡 Flat / sideways — no rotation signal",
        "answer_bearish": "🔴 LL/LH — BTC outperforming, alts weak",
        "default_enabled": True,
        "sort_order": 3,
    },
    {
        "key": "alts_htf_total2",
        "label": "TOTAL2 — Alts Market Cap (HTF)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "🌐 TOTAL2 1D — uptrend, making HH?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL2 on the 1D chart (all crypto market cap EXCLUDING BTC).\n"
            "TOTAL2 tells you whether ALTS as a class are attracting fresh capital — "
            "independent of BTC's price action.\n"
            "✅ Bullish: TOTAL2 making HH/HL on 1D, or breaking above a prior daily resistance. "
            "Expanding TOTAL2 with BTC.D falling = confirmed alt season signal.\n"
            "🟡 Flat: TOTAL2 consolidating while BTC moves — alts lagging, not joining yet. "
            "Could be early rotation, or a BTC-only rally.\n"
            "🔴 Bearish: TOTAL2 making LL/LH on 1D while BTC holds or rises — "
            "capital concentrated in BTC only, alts being distributed.\n\n"
            "📌 Best signal: TOTAL2 breaks a multi-day consolidation range to the upside "
            "on above-average volume = alt season in progress."
        ),
        "answer_bullish": "🟢 TOTAL2 uptrend / breaking out",
        "answer_partial": "🟡 TOTAL2 flat / lagging BTC",
        "answer_bearish": "🔴 TOTAL2 downtrend / alts weak",
        "default_enabled": True,
        "sort_order": 4,
    },

    # ── S/R 5-6 — 4H Key Level + Reaction Quality ─────────────────────────
    # Question: what TYPE of S/R is nearest AND how is price reacting?
    # No specific price levels — only structure-derived levels.
    # Deviation context: embedded in tooltips — a wick through a level + close back above = deviation.

    {
        "key": "btc_mtf_sr_reaction",
        "label": "BTC S/R Reaction (MTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "trend",
        "question": "🧱 BTC 4H — key level holding or broken?",
        "tooltip": (
            "Open BTCUSDT 4H.\n"
            "Find the nearest 4H key level: swing high/low, supply/demand zone, "
            "equal highs/lows (EQH/EQL), or a filled 4H Fair Value Gap (FVG).\n\n"
            "✅ Bullish — 3 scenarios:\n"
            "  1. Bounce: price touched a 4H demand zone and produced a bullish engulfing "
            "     or a BOS upward — buyers absorbed supply cleanly.\n"
            "  2. Deviation reclaim: price WICKED below a 4H support (stop hunt / equal lows "
            "     swept) but the 4H CANDLE CLOSED back above the level — liquidity grab, "
            "     the level remains valid. Score as bullish if the close is strong.\n"
            "  3. Resistance flip: a prior 4H resistance was broken with a close above "
            "     and price is now retesting it as support — bullish structure continuation.\n\n"
            "🟡 In-between: price mid-range between two 4H zones, no level being tested. "
            "No edge on 4H — rely on 1D trend for direction.\n\n"
            "� Bearish — 2 scenarios:\n"
            "  1. Support broken: 4H candle CLOSED below the demand zone (not just a wick). "
            "     The level failed — look for a retest from below as new resistance.\n"
            "  2. Upthrust / false breakout: price WICKED above a 4H resistance "
            "     (equal highs / supply zone swept) but the 4H candle CLOSED BACK BELOW "
            "     the level — distribution signal. Bearish if a BOS downward follows.\n\n"
            "📌 Rule: a wick NEVER equals a structural break — only 4H candle closes count."
        ),
        "answer_bullish": "🟢 4H level holding — bounce, reclaim, or flip",
        "answer_partial": "🟡 Mid-range — no 4H level interaction",
        "answer_bearish": "🔴 4H level broken (close) or upthrust signal",
        "default_enabled": True,
        "sort_order": 5,
    },
    {
        "key": "alts_mtf_sr_reaction",
        "label": "ETH S/R Reaction (MTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "trend",
        "question": "🧱 ETH 4H — key level holding or broken?",
        "tooltip": (
            "Open ETHUSD 4H.\n"
            "Find the nearest 4H key level: swing low, 4H demand zone, equal lows (EQL), "
            "prior 4H resistance flipped to support, or a 4H FVG that was filled.\n\n"
            "✅ Bullish — 3 scenarios:\n"
            "  1. Demand bounce: ETH touched the 4H demand zone and produced a bullish "
            "     engulfing or BOS upward on 4H. Buyers absorbed the supply.\n"
            "  2. Equal lows deviation: ETH wicked below 4H equal lows (stop hunt) "
            "     but the 4H CANDLE CLOSED back above — liquidity sweep, not a break. "
            "     If a BOS upward follows: high-conviction entry zone.\n"
            "  3. Resistance-turned-support: prior 4H resistance broken and now retested "
            "     from above — clean structure continuation entry.\n\n"
            "🟡 In-between: ETH mid-range, no 4H zone being actively tested. "
            "Rely on 1D structure and ETHBTC trend for direction.\n\n"
            "🔴 Bearish — 2 scenarios:\n"
            "  1. Support broken: 4H candle CLOSED below the demand zone — level invalidated, "
            "     watch for bearish retest from below.\n"
            "  2. Upthrust above supply: ETH wicked above a 4H supply / equal highs "
            "     but 4H candle CLOSED back below — distribution, not a bullish breakout. "
            "     Bearish if confirmed by a BOS downward.\n\n"
            "📌 If ETH shows a 4H deviation reclaim aligned with a 1D bullish structure "
            "and ETHBTC bouncing = highest quality alt entry context."
        ),
        "answer_bullish": "🟢 4H level holding — bounce, reclaim, or flip",
        "answer_partial": "🟡 Mid-range — no 4H zone interaction",
        "answer_bearish": "🔴 4H level broken (close) or upthrust signal",
        "default_enabled": True,
        "sort_order": 6,
    },

    # ── VOLUME / OBV 7-10 — Conviction across 1D + 4H ────────────────────
    # Volume = actual traded volume (candle by candle)
    # OBV = cumulative buying/selling pressure (divergence detection)

    {
        "key": "btc_htf_volume",
        "label": "BTC Volume (HTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 BTC 1D — volume up on green candles?",
        "tooltip": (
            "Open BTCUSDT 1D — enable the Volume indicator.\n"
            "✅ Bullish: the last 2–3 green daily candles have higher volume than the "
            "red candles nearby. Volume expanding on up days = institutional buying, not retail.\n"
            "🟡 Mixed: no clear pattern — green and red candles have similar volume. "
            "Normal during consolidation periods.\n"
            "🔴 Bearish: high volume on red daily candles (selling into rallies), "
            "or a volume spike on a large red candle = distribution signal.\n\n"
            "Tip: volume on the BOS candle (the candle that broke the prior swing high) "
            "is the most important — high volume BOS = strong institutional participation."
        ),
        "answer_bullish": "🟢 Volume up on green days — buying conviction",
        "answer_partial": "🟡 Mixed — no clear volume pattern",
        "answer_bearish": "🔴 High volume on red days — distribution",
        "default_enabled": True,
        "sort_order": 7,
    },
    {
        "key": "btc_htf_obv",
        "label": "BTC OBV (HTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 BTC OBV 1D — confirming or diverging?",
        "tooltip": (
            "Open BTCUSDT 1D — add the OBV (On-Balance Volume) indicator.\n"
            "✅ Bullish: OBV is making higher highs alongside price — "
            "no divergence, accumulation confirmed. OBV breaking above its own resistance "
            "before price = strong leading signal.\n"
            "🟡 Lagging: OBV is flat while price moves — inconclusive. "
            "Watch for a few more days before scoring this block.\n"
            "🔴 Bearish divergence: price making higher highs BUT OBV making lower highs "
            "— distribution signal. Smart money selling into the retail rally.\n\n"
            "⚠️ A bearish OBV divergence on 1D while the 1D trend still looks like HH/HL "
            "is a WARNING — score the trend block normally but flag this in your notes."
        ),
        "answer_bullish": "🟢 OBV confirms — making higher highs",
        "answer_partial": "🟡 OBV flat / lagging — inconclusive",
        "answer_bearish": "🔴 Bearish divergence — OBV falling while price rises",
        "default_enabled": True,
        "sort_order": 8,
    },
    {
        "key": "btc_mtf_volume",
        "label": "BTC Volume (MTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "📊 BTC 4H — volume confirms last move?",
        "tooltip": (
            "Open BTCUSDT 4H — enable Volume.\n"
            "✅ Bullish: the last bullish impulse on 4H (BOS up or swing high taken) was done on "
            "higher volume than the pullback candles. High volume up, low volume retracement.\n"
            "🟡 Mixed: choppy volume — no clear relationship between direction and volume.\n"
            "🔴 Bearish: the last significant 4H down move had higher volume than the bounce. "
            "Or: price retesting a level on declining volume (losing conviction).\n\n"
            "Tip: a 4H BOS on low volume is suspect — could be a false break or a deviation. "
            "Always require above-average volume on the BOS candle for high conviction."
        ),
        "answer_bullish": "🟢 Volume up on impulse — move confirmed",
        "answer_partial": "🟡 Choppy volume — no clear signal",
        "answer_bearish": "🔴 Volume up on dumps — bearish pressure",
        "default_enabled": True,
        "sort_order": 9,
    },
    {
        "key": "alts_htf_obv",
        "label": "ETH OBV (HTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "📊 ETH OBV 1D — confirming or diverging?",
        "tooltip": (
            "Open ETHUSD 1D — add OBV.\n"
            "✅ Bullish: ETH OBV making higher highs with price — accumulation in progress. "
            "If ETH OBV leads price up (OBV breaks out before price moves) = very strong signal.\n"
            "🟡 Lagging: OBV flat or ambiguous — wait for more data.\n"
            "🔴 Bearish divergence: ETH price rising but OBV falling — "
            "alts being distributed into strength. Likely to roll over soon.\n\n"
            "Key scenario: if ETH OBV diverges while BTC OBV confirms → BTC-only move. "
            "Avoid alt longs in this case, even if 1D structure looks bullish."
        ),
        "answer_bullish": "🟢 ETH OBV confirms — accumulation",
        "answer_partial": "🟡 OBV flat / lagging",
        "answer_bearish": "🔴 ETH OBV diverges — distribution signal",
        "default_enabled": True,
        "sort_order": 10,
    },

    # ── LTF 11-12 — Entry Timing: BOS/CHoCH + Deviation (BTC + ETH) ─────────
    # 1H covers: BOS up / CHoCH (entry trigger) + bearish deviation reclaim (bullish)
    # + upthrust/false breakout above resistance (bearish signal).
    # No separate 1H S/R indicator — deviation IS the S/R interaction at LTF.

    {
        "key": "btc_ltf_structure",
        "label": "BTC Entry Timing (LTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🎯 BTC 1H — BOS/CHoCH, reclaim, or upthrust?",
        "tooltip": (
            "Open BTCUSDT 1H. This question covers 4 scenarios — pick the one that matches:\n\n"
            "✅ Bullish — 2 scenarios:\n"
            "  1. BOS upward / CHoCH: price broke the last 1H swing high with a bullish close "
            "     (BOS). OR: first higher high after a 1H downtrend (CHoCH = trend reversal).\n"
            "  2. Bearish deviation → reclaim (MOST IMPORTANT): price wicked BELOW a key 1H "
            "     support (equal lows swept, prior swing low raided) — a stop hunt — but the 1H "
            "     candle CLOSED BACK ABOVE the level. If a 1H BOS upward follows the reclaim: "
            "     this is a high-conviction long entry. The bearish move was a trap.\n\n"
            "🟡 Ranging: 1H is coiling between two levels, no BOS in either direction. "
            "No entry trigger yet — let the 1H define direction before pressing the button.\n\n"
            "🔴 Bearish — 2 scenarios:\n"
            "  1. BOS downward / CHoCH bearish: 1H candle closed below the last swing low. "
            "     Even if 4H/1D are bullish: LTF says wait — entry timing is wrong.\n"
            "  2. Upthrust / false breakout (TRAP): price wicked ABOVE a key 1H resistance "
            "     (equal highs raided, supply zone swept) but the 1H candle CLOSED BACK BELOW "
            "     — distribution signal. A BOS downward after this = confirmed rejection.\n\n"
            "⚠️ This is ENTRY TIMING only — never override the 4H/1D bias on a 1H signal alone.\n"
            "A reclaim after a stop hunt (scenario 2 bullish) is often the best entry of the day."
        ),
        "answer_bullish": "🟢 BOS/CHoCH up or deviation reclaim — entry aligned",
        "answer_partial": "🟡 Ranging — no 1H directional trigger yet",
        "answer_bearish": "🔴 BOS down, CHoCH, or upthrust — wait",
        "default_enabled": True,
        "sort_order": 11,
    },
    {
        "key": "alts_ltf_structure",
        "label": "ETH Entry Timing (LTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🎯 ETH 1H — BOS/CHoCH, reclaim, or upthrust?",
        "tooltip": (
            "Open ETHUSD 1H. Same 4-scenario framework as BTC 1H:\n\n"
            "✅ Bullish — 2 scenarios:\n"
            "  1. BOS upward / CHoCH: ETH broke the last 1H swing high with a close above "
            "     (BOS). OR: first higher high after a 1H downtrend (CHoCH).\n"
            "  2. Bearish deviation → reclaim: ETH wicked below 1H equal lows or a prior "
            "     1H swing low (stop hunt), but the 1H candle CLOSED back above. "
            "     If a 1H BOS upward follows: premium alt entry. "
            "     When ETH reclaims + BTC 1H also reclaims = both confirming = max conviction.\n\n"
            "🟡 Ranging: ETH 1H coiling with no BOS — entry not confirmed. "
            "Form your bias from 4H ETH and ETHBTC trend first.\n\n"
            "🔴 Bearish — 2 scenarios:\n"
            "  1. BOS downward / CHoCH bearish: 1H candle closed below the last swing low. "
            "     Wait — even if 1D is bullish, the 1H entry timing is not ready.\n"
            "  2. Upthrust: ETH wicked above 1H equal highs or supply zone but 1H candle "
            "     CLOSED BACK BELOW — trap. If BOS downward follows = avoid alts.\n\n"
            "⚠️ Check BTC 1H too — if ETH reclaims but BTC 1H shows upthrust, it's a conflict. "
            "Both aligned = high quality. One conflicting = reduce size or wait."
        ),
        "answer_bullish": "🟢 BOS/CHoCH up or deviation reclaim — entry aligned",
        "answer_partial": "🟡 Ranging — no 1H directional trigger yet",
        "answer_bearish": "🔴 BOS down, CHoCH, or upthrust — wait",
        "default_enabled": True,
        "sort_order": 12,
    },

    # ── BREADTH 13-14 — Macro filter: USDT.D + BTC.D ─────────────────────
    # USDT.D → shared macro filter, scored on BTC side (score A) — affects all crypto.
    # BTC.D → Alts side (score B) — BTC eating market share is bad for alts.

    {
        "key": "btc_participation_usdt_d",
        "label": "USDT Dominance — Macro Filter (HTF)",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:USDT.D",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "💵 USDT.D 1D — falling or at resistance?",
        "tooltip": (
            "Open CRYPTOCAP:USDT.D on 1D.\n"
            "USDT Dominance = % of crypto market cap held in Tether. "
            "Rising = investors moving to safety (bearish crypto broadly). "
            "Falling = risk-on, money leaving stables and entering crypto assets.\n"
            "✅ Bullish: USDT.D in a 1D downtrend (LL/LH), or at a 1D resistance "
            "and rejecting it with a bearish engulfing candle — money flowing into crypto.\n"
            "🟡 Flat: USDT.D sideways on 1D — neither risk-on nor risk-off signal.\n"
            "🔴 Bearish: USDT.D rising on 1D or breaking above a prior 1D resistance — "
            "investors fleeing to safety = macro headwind for ALL crypto (BTC and alts).\n\n"
            "📌 USDT.D divergence warning: if USDT.D rises WHILE crypto also rises → "
            "unsustainable rally, likely distribution. Score as 🔴 bearish in that case."
        ),
        "answer_bullish": "🟢 USDT.D falling / rejecting — risk-on",
        "answer_partial": "🟡 USDT.D flat / sideways",
        "answer_bearish": "🔴 USDT.D rising — risk-off signal",
        "default_enabled": True,
        "sort_order": 13,
    },
    {
        "key": "alts_participation_btcd",
        "label": "BTC Dominance — Alts Filter (HTF)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:BTC.D",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🔃 BTC.D 1D — falling, rejecting resistance?",
        "tooltip": (
            "Open CRYPTOCAP:BTC.D on 1D.\n"
            "BTC Dominance = BTC's share of total crypto market cap.\n"
            "✅ Bullish (for alts): BTC.D is falling or rejecting a key 1D resistance — "
            "capital rotating from BTC into altcoins. The lower BTC.D falls, the stronger the alt season.\n"
            "🟡 Flat: BTC.D ranging on 1D — no clear rotation yet. Alts move with BTC only.\n"
            "🔴 Bearish (for alts): BTC.D rising on 1D or breaking above a key resistance — "
            "BTC eating market share, alts underperform.\n\n"
            "📌 Highest conviction signal: BTC.D rejection from a major 1D resistance "
            "WHILE ETH/BTC is bouncing from 1D support simultaneously = "
            "both indicators confirm rotation. This is the strongest alt entry context."
        ),
        "answer_bullish": "🟢 BTC.D falling / rejecting resistance",
        "answer_partial": "🟡 BTC.D ranging — no rotation signal",
        "answer_bearish": "🔴 BTC.D rising — BTC dominance increasing",
        "default_enabled": True,
        "sort_order": 14,
    },

    # ── CORRELATION 15 — BTC ↔ BTC.D scenario (final conclusion input) ───
    # This single indicator captures the interaction between BTC price structure
    # and BTC.D direction — the most important alt season / crypto health signal.

    {
        "key": "correlation_btc_btcd",
        "label": "BTC ↔ BTC.D Correlation",
        "asset_target": "a",
        "tv_symbol": "CRYPTOCAP:BTC.D",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🔗 BTC ↔ BTC.D — rotation or leadership?",
        "tooltip": (
            "Open both BTCUSDT and CRYPTOCAP:BTC.D side by side on 1D.\n"
            "Compare their DIRECTION over the last 3–5 daily candles:\n\n"
            "✅ Bullish (rotation — best for alts):\n"
            "  • BTC trending up AND BTC.D trending down → capital flowing broadly into alts\n"
            "  • BTC ranging/flat AND BTC.D trending down → capital rotating from BTC to alts\n\n"
            "🟡 Mixed (BTC leadership or uncertainty):\n"
            "  • BTC up AND BTC.D up → BTC outperforming, alts lagging (BTC-only rally)\n"
            "  • BTC up AND BTC.D flat → BTC moving, alts neutral\n"
            "  • Both flat/ranging → wait, no directional signal\n\n"
            "🔴 Risk-off (avoid longs):\n"
            "  • BTC down AND BTC.D rising → flight to BTC relative strength (alts weaker)\n"
            "  • BTC down AND BTC.D down → broad capitulation — everything weak\n\n"
            "This is the synthesis indicator — it reads the INTERACTION, not individual values."
        ),
        "answer_bullish": "🟢 BTC up + BTC.D down — broad rotation into alts",
        "answer_partial": "🟡 BTC up + BTC.D flat/up — BTC leadership only",
        "answer_bearish": "🔴 BTC down or BTC.D spiking — risk-off / broad weakness",
        "default_enabled": True,
        "sort_order": 15,
    },

    # ── Optional indicators (default OFF) ─────────────────────────────────

    {
        "key": "alts_participation_others",
        "label": "Others Cap (HTF)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:OTHERS",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "🎲 OTHERS — trending up, no blow-off top?",
        "tooltip": (
            "Open CRYPTOCAP:OTHERS on 1D (small-caps outside top 10).\n"
            "OTHERS moves LAST in a bull cycle — if it's already vertical, "
            "you are likely late in the alt season cycle.\n"
            "✅ Bullish: OTHERS rising steadily day by day, no vertical blow-off. "
            "Early upturn from a flat base = beginning of the small-cap rotation.\n"
            "🟡 Lagging: OTHERS still flat while large-caps move — "
            "small-caps have not rotated yet. Still early for small-cap alts.\n"
            "🔴 Bearish: OTHERS vertical on 1D or already rolled over from a parabolic run. "
            "If OTHERS had a parabolic move and is now declining = late cycle, reduce risk.\n"
            "Use this as a cycle timing signal, not an entry trigger."
        ),
        "answer_bullish": "🟢 OTHERS steady uptrend — no blow-off yet",
        "answer_partial": "🟡 OTHERS flat / just starting to move",
        "answer_bearish": "🔴 OTHERS vertical or already correcting",
        "default_enabled": False,
        "sort_order": 18,
    },
    {
        "key": "btc_mtf_obv",
        "label": "BTC OBV (MTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "📊 BTC OBV 4H — uptrend, no divergence?",
        "tooltip": (
            "Open BTCUSDT 4H — add OBV.\n"
            "✅ Bullish: OBV on 4H is in an uptrend — each 4H OBV peak is higher than the last. "
            "Confirms that 4H buying pressure is consistent.\n"
            "🟡 Flat: OBV sideways — balance between buyers and sellers on 4H.\n"
            "🔴 Bearish divergence: 4H price moving up but OBV on 4H is declining — "
            "loss of buying volume behind the move. Often precedes a short-term reversal.\n\n"
            "Pro tip: if both 1D OBV and 4H OBV show bearish divergence at the same time = "
            "strong early warning of a trend weakening."
        ),
        "answer_bullish": "🟢 OBV 4H uptrend — buying accumulation",
        "answer_partial": "🟡 OBV flat / indecisive",
        "answer_bearish": "🔴 OBV 4H bearish divergence",
        "default_enabled": False,
        "sort_order": 20,
    },
    {
        "key": "alts_mtf_volume",
        "label": "ETH Volume (MTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "📊 ETH 4H — volume up on bullish moves?",
        "tooltip": (
            "Open ETHUSD 4H — enable Volume.\n"
            "✅ Bullish: green 4H candles on ETH have higher volume than the red ones. "
            "Impulse moves (BOS up) done on expanding volume.\n"
            "🟡 Mixed: similar volume on both up and down candles — no conviction either way.\n"
            "🔴 Bearish: ETH down moves on 4H have higher volume — sellers are more active.\n\n"
            "If ETH 4H volume is bearish but ETHUSD is still at a 4H support: "
            "be very cautious with alt longs — volume context overrides price context here."
        ),
        "answer_bullish": "🟢 Volume confirms bullish 4H moves",
        "answer_partial": "🟡 Mixed — no clear volume signal",
        "answer_bearish": "🔴 Volume up on sell candles — bearish",
        "default_enabled": False,
        "sort_order": 21,
    },

    # ── ENRICHMENT v5 — 2026-04 (10 new indicators, all default_enabled=True) ──
    #
    # BTC side (a):
    #   23 — btc_mtf_structure_sequence  : 4H HH/HL or LH/LL sequence (trend block)
    #   25 — btc_mtf_candle_quality      : 4H body acceptance vs wick rejection (momentum)
    #   27 — btc_htf_obv_type            : OBV divergence type — hidden bull / regular bear (momentum)
    #
    # Alts side (b):
    #   50 — alts_ltf_micro_structure    : ETH 1H micro HH/HL at level (momentum)
    #   52 — alts_ltf_test_quality_1h    : ETH 1H body vs wick at S/R (momentum)
    #   54 — alts_ltf_candle_followthrough: ETH 1H candle after test — expansion or stall (momentum)
    #   56 — alts_ltf_volume_at_level    : ETH 1H volume at level — conviction or fakeout (momentum)
    #   58 — alts_ltf_15m_structure      : ETH 15min HH/HL confirms 1H (momentum)
    #   60 — alts_mtf_total2_4h          : TOTAL2 4H alt market tailwind (trend)
    #   62 — alts_htf_ethbtc_obv         : ETHBTC OBV 1D relative accumulation (participation)
    # ──────────────────────────────────────────────────────────────────────────

    # ── BTC MTF: 4H structure sequence (sort 23) ──────────────────────────
    {
        "key": "btc_mtf_structure_sequence",
        "label": "BTC 4H Structure Sequence (MTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "trend",
        "question": "🌊 BTC 4H — clear HH/HL sequence or LH/LL downtrend?",
        "tooltip": (
            "Open BTCUSDT 4H — no indicators needed, just swing highs and lows.\n"
            "btc_mtf_sr_reaction (#5) tells you if a specific level is holding or broken. "
            "This question reads the SEQUENCE of 4H swing points — the 4H trend STATE.\n\n"
            "✅ Bullish: the last 2–3 4H swing lows are higher than the previous (HL chain), "
            "AND the swing highs are also rising (HH chain). Clear 4H uptrend.\n\n"
            "🟡 Ranging: 4H swing highs and lows at roughly equal levels (Equal Highs / Equal Lows). "
            "No trending sequence. A bounce from a level inside this context may not follow through.\n\n"
            "🔴 Bearish: the last 2–3 4H swing highs are lower (LH chain) and swing lows are also "
            "falling (LL chain). Clear 4H downtrend — good context for shorts.\n\n"
            "⚠️ A level hold (#5 bullish) inside a 4H LH/LL = dead cat bounce, not a trend continuation. "
            "A level hold inside 4H HH/HL = high-conviction long entry. "
            "A level break inside 4H LH/LL = high-conviction short entry."
        ),
        "answer_bullish": "🟢 Clear HH/HL — 4H uptrend active",
        "answer_partial": "🟡 Equal highs/lows — 4H ranging",
        "answer_bearish": "🔴 LH/LL confirmed — 4H downtrend active",
        "default_enabled": True,
        "sort_order": 23,
    },

    # ── BTC MTF: 4H candle quality at level (sort 25) ─────────────────────
    {
        "key": "btc_mtf_candle_quality",
        "label": "BTC 4H Candle Quality at Level (MTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "🕯️ BTC 4H — full body acceptance or wick-only rejection?",
        "tooltip": (
            "Open BTCUSDT 4H — look at the most recent candle that interacted with the key level.\n"
            "btc_mtf_sr_reaction (#5) records the OUTCOME (holding / broken / reclaim). "
            "This question records the CANDLE ANATOMY — body vs wick commitment.\n\n"
            "✅ Bullish — body commitment:\n"
            "  Full 4H body CLOSED above the level (support case) or above the breakout point. "
            "  Buyers committed. This is acceptance, not just a temporary wick poke.\n\n"
            "🟡 Partial — wick present, body partially in zone:\n"
            "  Long wick at support/resistance, body partially overlapping the zone. "
            "  Mixed — neither side committed yet.\n\n"
            "🔴 Bearish — wick-only, no body follow-through:\n"
            "  Candle wicked through the level but BODY closed back inside the prior range. "
            "  Classic stop hunt / false break. No directional commitment.\n\n"
            "📌 VSA rule: body close = commitment. Wick = test or stop hunt. "
            "Bearish here = good context for short entries (body close below level)."
        ),
        "answer_bullish": "🟢 Full body close above/away — acceptance",
        "answer_partial": "🟡 Long wick, body partially in zone — indecision",
        "answer_bearish": "🔴 Wick-only / body back in range — no commitment",
        "default_enabled": True,
        "sort_order": 25,
    },

    # ── BTC HTF: OBV divergence TYPE (sort 27) ────────────────────────────
    {
        "key": "btc_htf_obv_type",
        "label": "BTC OBV Divergence Type (HTF)",
        "asset_target": "a",
        "tv_symbol": "BTCUSDT",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "🔍 BTC OBV 1D — hidden bull div or regular bearish divergence?",
        "tooltip": (
            "Open BTCUSDT 1D — add OBV indicator.\n"
            "btc_htf_obv (#8) records whether OBV confirms, is flat, or diverges. "
            "This question identifies WHICH TYPE of divergence — a separate analytical step.\n\n"
            "✅ Bullish — 2 scenarios:\n"
            "  1. Hidden bullish divergence: price makes a Higher Low (HL), OBV also makes a HL "
            "     → continuation signal. The pullback is being absorbed, trend continues up.\n"
            "  2. OBV slope turning up after a sustained decline: OBV was falling for weeks "
            "     and is now flattening or making higher lows → early accumulation signal.\n\n"
            "🟡 Partial: OBV slope is flat or ambiguous — no divergence type identifiable. "
            "Normal during consolidation. Score btc_htf_obv first.\n\n"
            "🔴 Bearish: Regular bearish divergence — price makes a Higher High (HH) "
            "but OBV makes a Lower High (LH) → distribution signal. "
            "Smart money selling into the retail rally. Good context for short entries.\n\n"
            "⚠️ Treating all divergences the same is a category error: "
            "hidden bullish = add to longs. Regular bearish = distribution warning / short context."
        ),
        "answer_bullish": "🟢 Hidden bull div or slope turning up — continuation",
        "answer_partial": "🟡 Flat / ambiguous — no divergence type",
        "answer_bearish": "🔴 Regular bearish div (HH price / LH OBV) — distribution",
        "default_enabled": True,
        "sort_order": 27,
    },

    # ── Alts LTF: ETH 1H micro structure at level (sort 50) ───────────────
    {
        "key": "alts_ltf_micro_structure",
        "label": "ETH 1H Micro Structure at Level (LTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🏗️ ETH 1H — micro HH/HL or LH/LL at the test zone?",
        "tooltip": (
            "Open ETHUSD 1H — look at the swing structure AT the level being tested.\n"
            "alts_ltf_structure (#12) reads for BOS/CHoCH EVENTS (when a break occurs). "
            "This question reads the ongoing HH/HL STATE before or during the BOS.\n\n"
            "✅ Bullish:\n"
            "  A 1H higher low has formed at or near the tested level — price dropped to the zone "
            "  but printed a HL above the previous swing low. "
            "  Micro inverse H&S forming = absorption in progress (Wyckoff Phase C).\n\n"
            "🟡 Partial (slow bleed / rounded):\n"
            "  Price grinding slowly into the level without forming a clear HL. "
            "  Selling pressure not yet exhausted — wait for a HL before entering.\n\n"
            "🔴 Bearish:\n"
            "  Hard 1H lower high rejection at or near the level, or expanding volatility downward. "
            "  Pattern consistent with a distribution top — good context for short entries.\n\n"
            "📌 Wyckoff: sharp impulse into level + HL formation = buyers stepping in (Spring). "
            "Slow grind = no absorption, level likely to fail."
        ),
        "answer_bullish": "🟢 1H HL forming at level — absorption in progress",
        "answer_partial": "🟡 Slow bleed / no clear HL — absorption unclear",
        "answer_bearish": "🔴 Hard LH rejection / expanding volatility down",
        "default_enabled": True,
        "sort_order": 50,
    },

    # ── Alts LTF: ETH 1H candle quality at S/R (sort 52) ─────────────────
    {
        "key": "alts_ltf_test_quality_1h",
        "label": "ETH 1H Test Quality at S/R (LTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🕯️ ETH 1H — body acceptance or wick rejection at the level?",
        "tooltip": (
            "Open ETHUSD 1H — examine the CANDLE BODY vs WICK at the key S/R level.\n"
            "alts_mtf_sr_reaction (#6) reads the 4H level outcome. "
            "This zooms into the 1H candle anatomy at the same area.\n\n"
            "✅ Bullish — body commitment above level:\n"
            "  Full 1H BODY CLOSED above the support/demand zone. "
            "  Buyers committed — the level was accepted and closed above. "
            "  Distinctly stronger than a wick poke.\n\n"
            "🟡 Partial — wick present, body partially overlapping:\n"
            "  Long lower wick at support with body partially in zone. "
            "  Test occurred but no strong commitment either way yet — wait one more candle.\n\n"
            "🔴 Bearish — body closed through the level:\n"
            "  Full 1H body CLOSED BELOW the support zone. Not just a wick — "
            "  this is directional commitment to the downside. Short context.\n\n"
            "📌 VSA: a wick into support ≠ a body close above it. "
            "Wick = stop hunt / test. Body close = directional commitment."
        ),
        "answer_bullish": "🟢 Full body close above/away — buyers committed",
        "answer_partial": "🟡 Long wick, body overlapping zone — indecision",
        "answer_bearish": "🔴 Body closed below level — sellers committed",
        "default_enabled": True,
        "sort_order": 52,
    },

    # ── Alts LTF: ETH 1H follow-through candle after test (sort 54) ───────
    {
        "key": "alts_ltf_candle_followthrough",
        "label": "ETH 1H Follow-Through After Test (LTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🚀 ETH 1H — expansion or stall on the candle after the test?",
        "tooltip": (
            "Open ETHUSD 1H — look at the candle AFTER the level was first tested.\n"
            "alts_ltf_test_quality_1h reads the FIRST reaction candle at the level. "
            "This reads the NEXT candle — the market's verdict on whether the test held.\n\n"
            "✅ Bullish — expansion away from level:\n"
            "  Engulfing candle, wide bullish body, or clear expansion away from the zone. "
            "  Wyckoff Spring SOS: a valid spring requires a follow-through impulse. "
            "  Do not enter on the test candle — wait for this expansion confirmation.\n\n"
            "🟡 Partial — indecision / compression:\n"
            "  Inside bar, doji, or narrow body. No follow-through yet. "
            "  Level may still hold — wait for additional candles before entering.\n\n"
            "🔴 Bearish — continuation into/through the level:\n"
            "  Bearish candle after the test, or next candle takes out the test candle low. "
            "  The spring failed — level is breaking. Good short context.\n\n"
            "📌 Rule: wait for this candle before pressing any entry button."
        ),
        "answer_bullish": "🟢 Engulfing / expansion away — follow-through confirmed",
        "answer_partial": "🟡 Inside bar / doji — no follow-through yet",
        "answer_bearish": "🔴 Bearish candle after test — level failing",
        "default_enabled": True,
        "sort_order": 54,
    },

    # ── Alts LTF: ETH 1H volume at level (sort 56) ────────────────────────
    {
        "key": "alts_ltf_volume_at_level",
        "label": "ETH 1H Volume at Level (LTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🔊 ETH 1H — volume expanding on rejection or fading?",
        "tooltip": (
            "Open ETHUSD 1H — enable Volume indicator.\n"
            "alts_htf_obv (#10) reads the Daily OBV trend. "
            "This is a spot volume check at a specific 1H candle — event-based, not trend-based.\n\n"
            "✅ Bullish — conviction on the rejection/bounce:\n"
            "  Volume spike on the rejection or bounce candle at support. "
            "  VSA: high volume at support = institutional absorption. "
            "  Volume expanding + price holds = real demand present.\n\n"
            "🟡 Partial — average / neutral volume:\n"
            "  Normal volume at the level — no special reading. "
            "  Move is unconvincing but not outright negative. Watch the next candle.\n\n"
            "🔴 Bearish — heavy volume on dumps or thin volume on bounces:\n"
            "  High volume on the dump INTO the level with no price recovery = supply overwhelming demand. "
            "  OR thin volume on the bounce candle = fakeout risk, no real buyers. Short context.\n\n"
            "📌 Most actionable filter: high-volume rejection candle at 1H support "
            "is the strongest pre-long-entry signal. Inverse = short signal."
        ),
        "answer_bullish": "🟢 Volume spike on rejection — conviction present",
        "answer_partial": "🟡 Average volume — no special signal",
        "answer_bearish": "🔴 Volume on dumps / thin on bounces — fakeout risk",
        "default_enabled": True,
        "sort_order": 56,
    },

    # ── Alts LTF: ETH 15min structure confirmation (sort 58) ──────────────
    {
        "key": "alts_ltf_15m_structure",
        "label": "ETH 15min Structure Confirmation (LTF)",
        "asset_target": "b",
        "tv_symbol": "ETHUSD",
        "tv_timeframe": "15",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "🔬 ETH 15min — HH/HL sequence confirming 1H direction?",
        "tooltip": (
            "Open ETHUSD 15min — look at the swing structure.\n"
            "This is the only 15min question in the system — the final timing gate before entry.\n\n"
            "✅ Bullish — 15min aligned with 1H:\n"
            "  15min printing HH/HL sequence in the same direction as the 1H bullish bias. "
            "  Multi-timeframe alignment: 1H bullish + 15min bullish = enter on next 15min HL.\n\n"
            "🟡 Partial — 15min ranging / inside bars:\n"
            "  15min is coiling or consolidating near the level. 1H idea may still be valid "
            "  but timing not confirmed — wait for 15min to print direction.\n\n"
            "🔴 Bearish — 15min diverging from 1H:\n"
            "  15min making LH/LL while 1H is bullish. Entry is premature. "
            "  This often means a stop-hunt / double-bottom sweep is coming before the real move. "
            "  Bearish 15min structure = good short context OR wait for 15min to flip before long.\n\n"
            "⚠️ If 15min is still bearish and you enter anyway: you will get stopped by the "
            "liquidity sweep that triggers the real 1H move. Wait for 15min to flip first."
        ),
        "answer_bullish": "🟢 15min HH/HL confirmed — timing aligned",
        "answer_partial": "🟡 15min ranging — confirmation pending",
        "answer_bearish": "🔴 15min LH/LL — entry premature, wait or short",
        "default_enabled": True,
        "sort_order": 58,
    },

    # ── Alts MTF: TOTAL2 4H trend (sort 60) ───────────────────────────────
    {
        "key": "alts_mtf_total2_4h",
        "label": "TOTAL2 4H — Alt Market Trend (MTF)",
        "asset_target": "b",
        "tv_symbol": "CRYPTOCAP:TOTAL2",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "trend",
        "question": "🌬️ TOTAL2 4H — alt market trending or bleeding?",
        "tooltip": (
            "Open CRYPTOCAP:TOTAL2 on the 4H chart.\n"
            "alts_htf_total2 (#4) reads TOTAL2 on the Daily for macro trend context. "
            "This reads TOTAL2 on 4H — the execution timeframe — catching the case where "
            "the Daily is bullish but the current week is an alt-bleed.\n\n"
            "✅ Bullish — broad alt bid confirmed:\n"
            "  TOTAL2 4H in an uptrend: HH/HL sequence, or breaking above a 4H consolidation range. "
            "  Rising TOTAL2 4H = broad alt participation, not just an ETH-specific move.\n\n"
            "🟡 Partial — choppy / no clear direction:\n"
            "  TOTAL2 4H inside a messy range — overlapping candles, no trending sequence. "
            "  ETH may still offer an individual setup, but the alt tailwind is absent.\n\n"
            "🔴 Bearish — alt bleed in progress:\n"
            "  TOTAL2 4H in a LH/LL downtrend or below a broken 4H support. "
            "  An ETH bounce in this context is likely isolated, not an alt rotation. "
            "  Good context for shorts on mid-cap alts (AVAX, FET, ONT).\n\n"
            "📌 Key filter for mid-cap entries: if TOTAL2 4H is bearish, "
            "even a clean ETH 4H setup has lower follow-through probability across alts."
        ),
        "answer_bullish": "🟢 TOTAL2 4H uptrend / HH — broad alt bid",
        "answer_partial": "🟡 TOTAL2 4H choppy / ranging — no tailwind",
        "answer_bearish": "🔴 TOTAL2 4H downtrend / LH — alt bleed active",
        "default_enabled": True,
        "sort_order": 60,
    },

    # ── Alts HTF: ETHBTC OBV relative accumulation (sort 62) ──────────────
    {
        "key": "alts_htf_ethbtc_obv",
        "label": "ETH/BTC OBV — Relative Accumulation (HTF)",
        "asset_target": "b",
        "tv_symbol": "ETHBTC",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "⚖️ ETH/BTC OBV 1D — rotation into alts or BTC still dominant?",
        "tooltip": (
            "Open ETHBTC on the 1D chart — add the OBV indicator.\n"
            "This reads RELATIVE accumulation: is money flowing into ETH faster than BTC?\n"
            "Completely different from alts_htf_obv (#10) which reads ETH/USD OBV (absolute).\n\n"
            "✅ Bullish — rotation into alts confirmed:\n"
            "  ETHBTC OBV making Higher Highs — relative buying pressure on ETH vs BTC. "
            "  When combined with BTC.D falling (#14): double confirmation of genuine alt rotation. "
            "  This is the highest-conviction alt long context.\n\n"
            "🟡 Partial — no clear rotation:\n"
            "  ETHBTC OBV flat — ETH and BTC moving together at the same pace. "
            "  No rotation signal. Alts will move with BTC but not outperform.\n\n"
            "🔴 Bearish — BTC dominance persists:\n"
            "  ETHBTC OBV declining — money flowing into BTC faster than ETH. "
            "  Even if ETHUSD looks bullish, the move is BTC-driven, not alt rotation. "
            "  Bearish ETHBTC OBV = avoid alt longs, good context for BTC-relative shorts on alts.\n\n"
            "📌 ETH/USD can rise while ETHBTC OBV falls — that is a BTC-led rally, not alt season. "
            "This question separates those two scenarios definitively."
        ),
        "answer_bullish": "🟢 ETHBTC OBV making HH — rotation into alts active",
        "answer_partial": "🟡 ETHBTC OBV flat — no clear rotation signal",
        "answer_bearish": "🔴 ETHBTC OBV declining — BTC dominance persists",
        "default_enabled": True,
        "sort_order": 62,
    },
]




# ---------------------------------------------------------------------------
# Gold indicators  (v4)
# ---------------------------------------------------------------------------
# Single-asset module (asset_target = 'single')
#
# Gold macro drivers:
#   - DXY (inverse)    : stronger dollar → gold falls
#   - US10Y yields     : higher yields → gold less attractive (opportunity cost)
#   - Real rates       : negative real rates → best for gold
#   - VIX              : moderate fear (15–30) = gold safe-haven bid
#   - Silver / Gold ratio : falling = silver joining = healthy metals rally
#   - Gold/Silver ratio on TradingView: XAUUSD/XAGUSD or TVC:GOLD/TVC:SILVER
#   - TVC:GVZ          : Gold Volatility Index (implied vol for gold options)
#
# TF mapping (aligned with Crypto module):
#   HTF = 1D (Daily)   — macro trend, structure, volume
#   MTF = 4H (4-Hour)  — S/R reaction, entry zone
#   LTF = 1H (1-Hour)  — entry timing (BOS/CHoCH + 1H S/R)
# ---------------------------------------------------------------------------

GOLD_INDICATORS: list[dict] = [

    # ── TREND 1-2 — 1D Structure ──────────────────────────────────────────

    {
        "key": "gold_htf_structure",
        "label": "Gold Structure (HTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "\U0001f4c8 Gold 1D \u2014 HH/HL intact, structure bullish?",
        "tooltip": (
            "Open XAUUSD on the 1D chart.\n"
            "\u2705 Bullish: sequence of higher highs and higher lows on daily candles. "
            "The last 2\u20133 daily swing lows are all above the prior ones — clean HH/HL chain.\n"
            "\U0001f7e1 Ranging: XAUUSD inside a multi-day rectangle \u2014 accumulation or distribution. "
            "Note: Gold often consolidates in wide ranges before big moves.\n"
            "\U0001f534 Bearish: LL/LH sequence on 1D, or a daily close below the last major swing low "
            "= trend change signal. Only candle closes count.\n\n"
            "\U0001f4cc Deviation awareness: if price briefly wicks below a prior 1D swing low "
            "but the 1D candle CLOSES above it \u2192 this is a liquidity sweep, not a trend break. "
            "Do NOT look at the price level in absolute terms \u2014 only the sequence of highs/lows."
        ),
        "answer_bullish": "\U0001f7e2 HH/HL \u2014 uptrend, structure intact",
        "answer_partial": "\U0001f7e1 Ranging / consolidating",
        "answer_bearish": "\U0001f534 LL/LH \u2014 downtrend or below MAs",
        "default_enabled": True,
        "sort_order": 1,
    },
    {
        "key": "gold_mtf_structure",
        "label": "Gold Structure (MTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "trend",
        "question": "\U0001f4c8 Gold 4H \u2014 HH/HL or BOS upward?",
        "tooltip": (
            "Open XAUUSD 4H.\n"
            "\u2705 Bullish: 4H is making HH/HL or a clear BOS upward happened recently. "
            "Each 4H swing low is higher than the previous.\n"
            "\U0001f7e1 Ranging: 4H consolidating. Common before major sessions (London/NY open). "
            "Not bearish by itself.\n"
            "\U0001f534 Bearish: LL/LH on 4H, or BOS downward with a 4H close below prior swing low. "
            "If 4H breaks below a previous swing low = avoid longs.\n\n"
            "\U0001f4cc Deviation: a 4H wick below the prior swing low that CLOSES back above = "
            "liquidity grab, not a bearish BOS. Score as \U0001f7e1 Ranging unless momentum confirms down.\n"
            "4H structure on Gold is very fast \u2014 re-check before each session."
        ),
        "answer_bullish": "\U0001f7e2 HH/HL \u2014 uptrend / BOS up on 4H",
        "answer_partial": "\U0001f7e1 Ranging / no clear 4H direction",
        "answer_bearish": "\U0001f534 LL/LH \u2014 downtrend / BOS down on 4H",
        "default_enabled": True,
        "sort_order": 2,
    },

    # ── S/R 3-4 — Key Level + Reaction ────────────────────────────────────

    {
        "key": "gold_htf_sr_reaction",
        "label": "Gold S/R Reaction (HTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "trend",
        "question": "\U0001f9f1 Gold 1D \u2014 at support, clean bounce?",
        "tooltip": (
            "Open XAUUSD 1D.\n"
            "Identify the nearest key level (swing high/low, prior all-time high, "
            "round psychological numbers: 2000 / 2500 / 3000 / 3500).\n"
            "\u2705 Bullish: price at or just bounced from a 1D support level with a clear "
            "rejection candle (hammer, bullish engulfing). Buyers defended the level.\n"
            "\U0001f7e1 In-between: price between levels \u2014 no key S/R nearby, or level is there "
            "but no clear reaction yet (candle still forming or ambiguous).\n"
            "\U0001f534 Bearish: 1D close below support level (not just a wick), or approaching "
            "strong resistance with no bullish reaction candle.\n\n"
            "\U0001f4cc Round numbers (2000, 2500, 3000) are MAJOR S/R for Gold \u2014 "
            "always check if price is near these. A wick through and close above = deviation."
        ),
        "answer_bullish": "\U0001f7e2 At support \u2014 clean bounce, buyers in control",
        "answer_partial": "\U0001f7e1 Between levels \u2014 no clear reaction",
        "answer_bearish": "\U0001f534 1D close below support or at strong resistance",
        "default_enabled": True,
        "sort_order": 3,
    },
    {
        "key": "gold_mtf_sr_reaction",
        "label": "Gold S/R Reaction (MTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "trend",
        "question": "\U0001f9f1 Gold 4H \u2014 at demand zone, bullish?",
        "tooltip": (
            "Open XAUUSD 4H.\n"
            "Find the nearest 4H demand zone or 4H swing low that price is testing.\n"
            "\u2705 Bullish: Gold is bouncing from a 4H demand zone or a 4H support level "
            "with a clear BOS upward or bullish engulfing candle on 4H.\n"
            "\U0001f7e1 In-between: Gold is mid-range, no key 4H level is being tested.\n"
            "\U0001f534 Bearish: 4H demand zone swept through with a 4H close below, "
            "or Gold is at 4H supply showing a rejection candle.\n\n"
            "\U0001f4cc Deviation rule: a 4H wick through 4H equal lows or a demand zone "
            "that CLOSES BACK ABOVE = liquidity grab. Score as \U0001f7e2 if close is convincing.\n"
            "London session open (07:30\u201309:00 UTC) is the best time to observe "
            "4H S/R reactions on Gold."
        ),
        "answer_bullish": "\U0001f7e2 At 4H demand \u2014 bullish reaction or BOS up",
        "answer_partial": "\U0001f7e1 No key 4H level interaction",
        "answer_bearish": "\U0001f534 4H support closed below or rejecting supply",
        "default_enabled": True,
        "sort_order": 4,
    },

    # ── VOLUME / OBV 5-7 — Conviction (1D + 4H) ──────────────────────────

    {
        "key": "gold_htf_volume",
        "label": "Gold Volume (HTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "\U0001f4ca Gold 1D \u2014 volume up on green candles?",
        "tooltip": (
            "Open XAUUSD 1D \u2014 enable Volume.\n"
            "\u2705 Bullish: green daily candles have higher volume than red candles. "
            "Institutional demand = net buyers each day.\n"
            "\U0001f7e1 Mixed: volume is similar on both green and red days \u2014 neutral signal. "
            "Normal during consolidation phases.\n"
            "\U0001f534 Bearish: high volume on red daily candles = institutions selling / distributing. "
            "Watch for: large bearish candle on highest daily volume in weeks = warning.\n\n"
            "Note: Gold volume is less liquid than crypto \u2014 spikes often tied to Fed decisions, "
            "CPI/PPI releases, or geopolitical events. Context matters."
        ),
        "answer_bullish": "\U0001f7e2 Volume up on green days \u2014 institutional demand",
        "answer_partial": "\U0001f7e1 Mixed \u2014 no clear volume signal",
        "answer_bearish": "\U0001f534 High volume on red days \u2014 distribution",
        "default_enabled": True,
        "sort_order": 5,
    },
    {
        "key": "gold_htf_obv",
        "label": "Gold OBV (HTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "momentum",
        "question": "\U0001f4ca Gold OBV 1D \u2014 confirming, no divergence?",
        "tooltip": (
            "Open XAUUSD 1D \u2014 add OBV.\n"
            "\u2705 Bullish: OBV is in an uptrend, making higher highs alongside price. "
            "OBV leading price up (OBV breaks out before price) = very strong signal.\n"
            "\U0001f7e1 Flat: OBV moving sideways \u2014 neither confirming nor diverging. Neutral.\n"
            "\U0001f534 Bearish divergence: Gold price rising but OBV declining = "
            "smart money selling into retail buying. Often precedes a pullback.\n\n"
            "Gold OBV divergences are especially reliable \u2014 "
            "central banks / institutions leave footprints in volume data."
        ),
        "answer_bullish": "\U0001f7e2 OBV uptrend \u2014 confirms price rise",
        "answer_partial": "\U0001f7e1 OBV flat / inconclusive",
        "answer_bearish": "\U0001f534 Bearish divergence \u2014 OBV declining",
        "default_enabled": True,
        "sort_order": 6,
    },
    {
        "key": "gold_mtf_volume",
        "label": "Gold Volume (MTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "\U0001f4ca Gold 4H \u2014 volume confirms last move?",
        "tooltip": (
            "Open XAUUSD 4H \u2014 enable Volume.\n"
            "\u2705 Bullish: the last bullish 4H impulse (BOS up or swing high taken) "
            "happened on higher volume than the pullback candles.\n"
            "\U0001f7e1 Mixed: similar volume on ups and downs \u2014 no momentum signal.\n"
            "\U0001f534 Bearish: 4H breakdowns happen on higher volume than bounces \u2014 "
            "sellers are more aggressive than buyers on this timeframe.\n\n"
            "Tip: check for volume expansion around London Open (07:30 UTC) "
            "and NY Open (13:30 UTC) \u2014 these are when institutional orders hit Gold."
        ),
        "answer_bullish": "\U0001f7e2 Volume confirms bullish 4H impulses",
        "answer_partial": "\U0001f7e1 Mixed volume \u2014 no clear conviction",
        "answer_bearish": "\U0001f534 Volume confirms bearish 4H moves",
        "default_enabled": True,
        "sort_order": 7,
    },

    # ── MACRO DRIVERS 8-10 — DXY, Yields, VIX ────────────────────────────
    # These are in the 'participation' block — macro context for Gold bias.

    {
        "key": "gold_macro_dxy",
        "label": "DXY \u2014 US Dollar Index (HTF)",
        "asset_target": "single",
        "tv_symbol": "TVC:DXY",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "\U0001f4b5 DXY 1D \u2014 downtrend or rejecting resistance?",
        "tooltip": (
            "Open TVC:DXY on 1D. Gold and USD are strongly inversely correlated.\n"
            "\u2705 Bullish (for Gold): DXY is in a 1D downtrend (LL/LH) or "
            "rejecting a major 1D resistance level \u2014 a weaker dollar = higher gold in USD terms.\n"
            "\U0001f7e1 Neutral: DXY ranging sideways on 1D \u2014 no directional signal for Gold macro.\n"
            "\U0001f534 Bearish (for Gold): DXY in an uptrend on 1D or breaking above resistance \u2014 "
            "strong dollar = headwind for gold prices.\n\n"
            "Important: check if DXY is at a MAJOR 1D resistance (prior swing high, "
            "multi-month level). A DXY rejection from there = very bullish for Gold."
        ),
        "answer_bullish": "\U0001f7e2 DXY downtrend / rejecting resistance",
        "answer_partial": "\U0001f7e1 DXY sideways \u2014 no direction",
        "answer_bearish": "\U0001f534 DXY uptrend / breaking out",
        "default_enabled": True,
        "sort_order": 8,
    },
    {
        "key": "gold_macro_yields",
        "label": "US 10Y Yield (HTF)",
        "asset_target": "single",
        "tv_symbol": "TVC:US10Y",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "\U0001f4c9 US 10Y yields 1D \u2014 falling or capped?",
        "tooltip": (
            "Open TVC:US10Y on 1D (US 10-Year Treasury Yield).\n"
            "\u2705 Bullish (for Gold): yields are falling on 1D (bond prices rising) or capped "
            "at a resistance level \u2014 lower yields = lower opportunity cost of holding gold = bullish.\n"
            "Extra bullish: if REAL yields (10Y - inflation) are negative = "
            "gold is the best store of value.\n"
            "\U0001f7e1 Neutral: yields flat / ranging on 1D \u2014 no clear direction.\n"
            "\U0001f534 Bearish (for Gold): yields rising aggressively on 1D \u2014 "
            "investors prefer bonds over gold for yield. "
            "Rising yields + rising DXY = double headwind for Gold.\n\n"
            "Watch: 4\u20135% on the 10Y = major resistance for yields = potential bullish pivot for Gold."
        ),
        "answer_bullish": "\U0001f7e2 Yields falling / capped \u2014 lower opportunity cost",
        "answer_partial": "\U0001f7e1 Yields flat / ranging",
        "answer_bearish": "\U0001f534 Yields rising \u2014 headwind for Gold",
        "default_enabled": True,
        "sort_order": 9,
    },
    {
        "key": "gold_macro_vix",
        "label": "VIX \u2014 Equity Volatility (HTF)",
        "asset_target": "single",
        "tv_symbol": "CBOE:VIX",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "\U0001f630 VIX 1D \u2014 15\u201330? (mild fear = gold bid)",
        "tooltip": (
            "Open CBOE:VIX on 1D (S&P 500 implied volatility index).\n"
            "Gold benefits from MILD fear \u2014 not panic, not complacency.\n"
            "\u2705 Bullish (for Gold): VIX between 15\u201330. Investors are cautious "
            "and seeking safe-haven assets, but not in full panic mode.\n"
            "\U0001f7e1 Complacent: VIX < 15 \u2014 equity markets complacent, "
            "no safe-haven demand for Gold. Gold becomes pure speculation.\n"
            "\U0001f534 Panic: VIX > 35 \u2014 extreme panic selling. In severe crashes, "
            "EVERYTHING including Gold is sold for liquidity. "
            "After VIX spike resolves, Gold often recovers faster than equities.\n\n"
            "Key scenario: equity markets starting to decline (VIX rising from 15\u219225) "
            "= best entry window for Gold longs."
        ),
        "answer_bullish": "\U0001f7e2 VIX 15\u201330 \u2014 mild fear, safe-haven bid",
        "answer_partial": "\U0001f7e1 VIX < 15 \u2014 complacency, no safe-haven bid",
        "answer_bearish": "\U0001f534 VIX > 35 \u2014 panic, everything sells",
        "default_enabled": True,
        "sort_order": 10,
    },

    # ── LTF 11-12 — Entry timing: BOS/CHoCH + 1H S/R reaction ─────────────

    {
        "key": "gold_ltf_structure",
        "label": "Gold Entry Timing (LTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "\U0001f3af Gold 1H \u2014 BOS upward or CHoCH?",
        "tooltip": (
            "Open XAUUSD 1H.\n"
            "\u2705 Bullish: BOS upward (1H swing high broken with a bullish close) or "
            "CHoCH (first higher high after a 1H downtrend). "
            "Aligned with 4H bullish structure = high-quality entry.\n"
            "\U0001f7e1 Ranging: 1H in a rectangle \u2014 no directional 1H signal. "
            "Wait for London Open to resolve direction.\n"
            "\U0001f534 Bearish: 1H BOS down or CHoCH bearish. "
            "Even if 1D is bullish, 1H tells you the entry is not now \u2014 wait.\n\n"
            "\u26a0\ufe0f Use ONLY for entry timing \u2014 NEVER override a 4H or 1D bias "
            "based on a 1H signal alone."
        ),
        "answer_bullish": "\U0001f7e2 BOS / CHoCH upward \u2014 1H entry aligned with 4H",
        "answer_partial": "\U0001f7e1 Ranging \u2014 no 1H directional signal yet",
        "answer_bearish": "\U0001f534 BOS / CHoCH downward \u2014 wait for setup",
        "default_enabled": True,
        "sort_order": 11,
    },
    {
        "key": "gold_ltf_sr_reaction",
        "label": "Gold 1H S/R \u2014 Trend via Level Reaction (LTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "1H",
        "timeframe_level": "ltf",
        "score_block": "momentum",
        "question": "\U0001f9f1 Gold 1H \u2014 at demand zone, not supply?",
        "tooltip": (
            "Open XAUUSD 1H.\n"
            "Check whether Gold 1H is pulling back into a demand zone or running into supply.\n"
            "\u2705 Bullish: Gold is at a 1H demand zone (prior 1H swing low, 1H FVG, "
            "or OTE retracement zone) and showing early reaction. "
            "Good risk/reward entry area \u2014 define stop below the zone.\n"
            "\U0001f7e1 In-between: Gold between 1H levels \u2014 no clear zone interaction. "
            "Rely on 4H and 1D structure for direction.\n"
            "\U0001f534 Bearish: Gold is at a 1H supply zone showing rejection, or broke below "
            "a 1H demand zone with a close. Avoid longs \u2014 short-term path is lower.\n\n"
            "\U0001f4cc Paired with Gold 1H BOS/CHoCH: if BOTH show bullish = highest quality 1H entry. "
            "If they conflict = wait. Never enter when 1H S/R says supply."
        ),
        "answer_bullish": "\U0001f7e2 At 1H demand \u2014 good RR, reactive zone",
        "answer_partial": "\U0001f7e1 Between levels \u2014 no 1H zone edge",
        "answer_bearish": "\U0001f534 At 1H supply \u2014 wait for BOS above it",
        "default_enabled": True,
        "sort_order": 12,
    },

    # ── Optional indicators (default OFF) ─────────────────────────────────

    {
        "key": "gold_macro_silver_ratio",
        "label": "Gold/Silver Ratio (HTF)",
        "asset_target": "single",
        "tv_symbol": "TVC:GOLD/TVC:SILVER",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "\U0001f948 Gold/Silver ratio \u2014 flat or falling?",
        "tooltip": (
            "Open TVC:GOLD / TVC:SILVER on 1D (ratio of gold price to silver price).\n"
            "\u2705 Bullish: the ratio is FALLING or flat \u2014 Silver is keeping pace with Gold "
            "or outperforming it. Confirms a broad precious metals rally, not just Gold alone.\n"
            "\U0001f7e1 Slightly rising: Gold outperforming Silver a bit \u2014 still healthy but "
            "Silver is lagging. Could mean the rally is Gold-specific (safe-haven) "
            "rather than a broad metals bull.\n"
            "\U0001f534 Sharply rising: Gold is running far ahead of Silver \u2014 "
            "historically signals a fear-driven safe-haven rally that may not be sustained. "
            "Often precedes a Gold correction once fear subsides.\n\n"
            "Historical note: ratio > 80 = Gold historically expensive vs Silver."
        ),
        "answer_bullish": "\U0001f7e2 Ratio flat or falling \u2014 Silver keeping up",
        "answer_partial": "\U0001f7e1 Ratio slightly rising \u2014 Gold leading",
        "answer_bearish": "\U0001f534 Ratio sharply rising \u2014 fear-driven, unsustainable",
        "default_enabled": False,
        "sort_order": 13,
    },
    {
        "key": "gold_macro_gvz",
        "label": "Gold Volatility Index GVZ (HTF)",
        "asset_target": "single",
        "tv_symbol": "TVC:GVZ",
        "tv_timeframe": "1D",
        "timeframe_level": "htf",
        "score_block": "participation",
        "question": "\U0001f4ca GVZ 1D \u2014 moderate, not spiking?",
        "tooltip": (
            "Open TVC:GVZ on 1D (CBOE Gold Volatility Index \u2014 implied vol for Gold options).\n"
            "GVZ measures expected volatility in Gold prices over the next 30 days.\n"
            "\u2705 Bullish: GVZ between 12\u201320 and rising from a low \u2014 "
            "moderate vol expansion alongside an uptrend = healthy momentum. "
            "Traders positioned for upside.\n"
            "\U0001f7e1 Low: GVZ < 12 \u2014 Gold is complacent, low vol = no big move expected imminently. "
            "Could be coiling before a breakout.\n"
            "\U0001f534 Spiking: GVZ > 25\u201330 in a spike \u2014 extreme fear/uncertainty in Gold. "
            "Often means a sharp move (either direction) is occurring or imminent. "
            "After a GVZ spike resolves, the direction usually becomes clear.\n\n"
            "Tip: GVZ spike + bullish price action = conviction long setup."
        ),
        "answer_bullish": "\U0001f7e2 GVZ 12\u201320, rising \u2014 healthy vol expansion",
        "answer_partial": "\U0001f7e1 GVZ < 12 \u2014 low vol, coiling",
        "answer_bearish": "\U0001f534 GVZ > 25, spiking \u2014 extreme uncertainty",
        "default_enabled": False,
        "sort_order": 14,
    },
    {
        "key": "gold_mtf_obv",
        "label": "Gold OBV (MTF)",
        "asset_target": "single",
        "tv_symbol": "XAUUSD",
        "tv_timeframe": "4H",
        "timeframe_level": "mtf",
        "score_block": "momentum",
        "question": "\U0001f4ca Gold OBV 4H \u2014 uptrend, no divergence?",
        "tooltip": (
            "Open XAUUSD 4H \u2014 add OBV.\n"
            "\u2705 Bullish: OBV 4H is in an uptrend \u2014 each 4H OBV peak is higher. "
            "Confirms that 4H buying volume is consistent and not fading.\n"
            "\U0001f7e1 Flat: OBV sideways \u2014 volume balanced between buyers and sellers on 4H.\n"
            "\U0001f534 Bearish divergence: 4H price moving up but OBV declining \u2014 "
            "loss of buying volume behind the move. "
            "If confirmed on 1D as well = high-confidence reversal signal."
        ),
        "answer_bullish": "\U0001f7e2 OBV 4H uptrend \u2014 buying pressure consistent",
        "answer_partial": "\U0001f7e1 OBV 4H flat / indecisive",
        "answer_bearish": "\U0001f534 OBV 4H bearish divergence",
        "default_enabled": False,
        "sort_order": 15,
    },
]


# ---------------------------------------------------------------------------
# Seed function
# ---------------------------------------------------------------------------

#: Structural fields synced on every upsert — safe to overwrite because they are
#: never edited by the user through the UI.
_UPSERT_SYNC_FIELDS = [
    "asset_target",
    "tv_symbol",
    "tv_timeframe",
    "timeframe_level",
    "score_block",
    "default_enabled",
    "sort_order",
]

#: Text fields seeded only on INSERT — user edits via the Settings UI survive
#: restarts and CD deploys.
_INSERT_ONLY_FIELDS = [
    "label",
    "question",
    "tooltip",
    "answer_bullish",
    "answer_partial",
    "answer_bearish",
]


def seed_market_analysis(session: Session) -> None:
    """Insert or update modules and indicators.

    Strategy:
    - Structural fields (tv_symbol, score_block, sort_order …) are always
      synced via ON CONFLICT DO UPDATE so the seed stays canonical.
    - Text fields edited by the user (label, question, tooltip, answer_*)
      are only written on first INSERT — user changes survive restarts and
      CD deploys.
    - Rows in the DB that no longer exist in the seed are left untouched.
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

    # ── Step 3 — indicators (insert all fields; update structural fields only) ──
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
