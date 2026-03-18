"""
Phase 2 — Volatility indicator computation (P2-5).

Pure pandas/numpy functions — no I/O, no DB, no HTTP.
Each function takes a DataFrame built from OHLCV candles and returns a float (0.0–1.0)
or a dict (EMA score).

Inputs
------
  candles: list of OHLCV dicts [{"t": ms, "o", "h", "l", "c", "v": float}]
  Minimum 20 candles for any meaningful result; 220 recommended (covers EMA-200).

Normalization strategy
----------------------
  All 4 volatility indicators (RVOL, MFI, ATR, BB) are **percentile-ranked**
  over the full available window.  Percentile rank is self-adapting to recent
  market conditions — no hard-coded clip values, clean 0–1 output.

  EMA score (0–100) is NOT included in the VI average (doc: dotted arrow).
  It is stored in `components` for watchlist ranking only.

VI Score aggregation
--------------------
  vi_score = mean(active_scores)   where active = indicators with enabled=True
  EMA is excluded from the average regardless of enabled flag.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ── Defaults ─────────────────────────────────────────────────────────────────
_DEFAULT_ENABLED: dict = {
    "rvol": True,
    "mfi": True,
    "atr": True,
    "bb": True,
    "ema": True,
}

_MIN_CANDLES = 20  # minimum required for any computation


# ── Internal helpers ──────────────────────────────────────────────────────────

def _ohlcv_to_df(candles: list[dict]) -> pd.DataFrame:
    """Convert list of OHLCV dicts to a typed DataFrame."""
    df = pd.DataFrame(candles)
    df = df.rename(columns={"t": "time", "o": "open", "h": "high",
                             "l": "low", "c": "close", "v": "volume"})
    for col in ("open", "high", "low", "close", "volume"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    return df.reset_index(drop=True)


def _pct_rank(series: pd.Series) -> float:
    """Percentile rank of the last value in series (0.0–1.0).

    Returns 0.5 when the series is too short for meaningful ranking.
    Uses all prior values as the reference set (self-adapting window).
    """
    arr = series.dropna().values
    if len(arr) < 2:
        return 0.5
    last = float(arr[-1])
    rank = float(np.sum(arr[:-1] < last) / max(len(arr) - 1, 1))
    return float(np.clip(rank, 0.0, 1.0))


# ── Individual indicators ─────────────────────────────────────────────────────

def compute_rvol(df: pd.DataFrame, window: int = 20) -> float:
    """Relative Volume: current bar volume / rolling mean(volume, window).

    Percentile-ranked over the full window → 0.0–1.0.
    High value = unusually high volume activity.
    """
    rvol_raw = df["volume"] / df["volume"].rolling(window=window, min_periods=1).mean()
    return round(_pct_rank(rvol_raw), 4)


def compute_mfi(df: pd.DataFrame, period: int = 14) -> float:
    """Money Flow Index (14 periods), normalized for volatility.

    MFI extremes (< 20 or > 80) = strong buying or selling pressure → high vol.
    Deviation series: abs(mfi_raw - 50) / 50  →  0 at neutral, 1 at extreme.
    Percentile-ranked over the full window, consistent with RVOL / ATR / BB.

    Why percentile-rank?
      Without it, a crypto perp that *always* trades with MFI 70–80 would
      produce a near-constant 0.4–0.6 component regardless of whether current
      pressure is actually unusual. Percentile-ranking makes MFI self-adapting
      to each pair's own historical pressure distribution, matching the
      methodology of the other three indicators.
    """
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    rmf = tp * df["volume"]
    prev_tp = tp.shift(1)
    pos_mf = rmf.where(tp > prev_tp, 0.0).rolling(window=period, min_periods=1).sum()
    neg_mf = rmf.where(tp < prev_tp, 0.0).rolling(window=period, min_periods=1).sum()
    # Money Flow Ratio — guard against zero denominator
    mfr = pos_mf / neg_mf.replace(0.0, np.nan)
    mfi_raw = 100.0 - (100.0 / (1.0 + mfr))
    mfi_raw = mfi_raw.fillna(50.0)
    # Deviation from neutral: 0 = no pressure, 1 = max one-sided pressure
    mfi_dev = (mfi_raw - 50.0).abs() / 50.0
    return round(_pct_rank(mfi_dev), 4)


def compute_atr_norm(df: pd.DataFrame, period: int = 14) -> float:
    """ATR(14) normalized by close price, percentile-ranked → 0.0–1.0.

    ATR % = atr(14) / close.  High value = wide candle ranges = high vol.
    Wilder's EMA (ewm with adjust=False) matches the standard definition.
    """
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    atr = tr.ewm(span=period, adjust=False).mean()
    atr_pct = atr / df["close"].replace(0.0, np.nan)
    return round(_pct_rank(atr_pct), 4)


def compute_bb_width(df: pd.DataFrame, period: int = 20, std_dev: float = 2.0) -> float:
    """Bollinger Band width: (upper − lower) / middle, percentile-ranked → 0.0–1.0.

    Expanding bands = higher volatility in the market.
    """
    sma = df["close"].rolling(window=period, min_periods=1).mean()
    std = df["close"].rolling(window=period, min_periods=1).std(ddof=0).fillna(0.0)
    upper = sma + std_dev * std
    lower = sma - std_dev * std
    bb_w = (upper - lower) / sma.replace(0.0, np.nan)
    return round(_pct_rank(bb_w), 4)


def compute_ema_score(
    df: pd.DataFrame,
    periods: tuple[int, int, int] = (21, 55, 200),
    ema_ref: int | None = None,
    retest_tolerance: float | None = None,
) -> dict:
    """EMA position score — directional signal for watchlist ranking.

    Score: 0.0–1.0 (bidirectional, same scale as VI score)
        0.00 = price below all EMAs  (fully bearish)
        0.50 = neutral (price above some, below others)
        1.00 = price above all EMAs  (fully bullish)

    Weights: EMA21=50%, EMA55=30%, EMA200=20%
    Periods are Fibonacci-aligned: 21 · 55 · 200 (same standard set as ema_ref).

    ema_ref: TF-specific reference EMA for crossover/retest signal detection.
        Defaults to periods[0] when not supplied.
        Recommended per TF: 15m→55, 1h→99, 4h→200, 1d→99, 1w→55.

    retest_tolerance: maximum % distance from ema_ref (as a fraction, e.g. 0.01 = 1%) to
        classify the candle as a retest. Comes from per-pair DB config
        (ema_retest_tolerance per TF). Falls back to 0.005 (0.5%) when absent.

    Signal labels (ema_ref-based, used as the watchlist `ema_signal` column):
        above_all      — price > all 3 scoring EMAs  (state, no alert)
        below_all      — price < all 3 scoring EMAs  (state, no alert)
        breakout_up    — price crossed ema_ref upward within last 3 bars
        breakdown_down — price crossed ema_ref downward within last 3 bars
        retest_up      — price within retest_tolerance above ema_ref (testing support)
        retest_down    — price within retest_tolerance below ema_ref (testing resistance)
        mixed          — everything else              (no alert)

    Returns:
        {"score": float (0.0–1.0), "signal": str, "ema_ref_period": int}

    NOT included in VI average — bonus signal for watchlist ranking only.
    """
    close = df["close"]
    last = float(close.iloc[-1])
    ema_weights = [0.5, 0.3, 0.2]
    emas = [float(close.ewm(span=p, adjust=False).mean().iloc[-1]) for p in periods]

    # Score: sum of weights for EMAs below current price → 0.0–1.0
    score = round(sum(w * (1.0 if last > e else 0.0) for w, e in zip(ema_weights, emas)), 2)

    # Signal detection — ref EMA crossover + retest take priority over positional state.
    # ema_ref: TF-specific reference EMA (15m→55, 1h→99, 4h→200, 1d→99, 1w→55)
    # NOTE: checked BEFORE above_all / below_all so retest_up/down on EMA200 is not
    # swallowed by above_all when price is just above EMA200 (and also above EMA20/50).
    ref = ema_ref if ema_ref is not None else periods[0]
    above = [last > e for e in emas]
    ref_ema_series = close.ewm(span=ref, adjust=False).mean()
    ref_ema_val = float(ref_ema_series.iloc[-1])
    if len(ref_ema_series) >= 3:
        prev_close_3 = float(close.iloc[-3])
        prev_ref_ema_3 = float(ref_ema_series.iloc[-3])
        if prev_close_3 < prev_ref_ema_3 and last > ref_ema_val:
            signal = "breakout_up"
        elif prev_close_3 > prev_ref_ema_3 and last < ref_ema_val:
            signal = "breakdown_down"
        elif ref_ema_val > 0 and abs(last - ref_ema_val) / ref_ema_val < (retest_tolerance or 0.005):
            # within retest_tolerance of ref EMA — retest regardless of other EMAs
            signal = "retest_up" if last >= ref_ema_val else "retest_down"
        elif all(above):
            signal = "above_all"
        elif not any(above):
            signal = "below_all"
        else:
            signal = "mixed"
    else:
        # Fallback when not enough bars for crossover check
        if all(above):
            signal = "above_all"
        elif not any(above):
            signal = "below_all"
        else:
            signal = "mixed"

    return {"score": score, "signal": signal, "ema_ref_period": ref}


# ── VI aggregation ────────────────────────────────────────────────────────────

# Default indicator weights — stored in DB under per_pair.indicator_weights.
# Override via volatility settings UI: Settings → Volatility → Per-pair indicators.
_DEFAULT_INDICATOR_WEIGHTS: dict[str, float] = {
    "rvol": 0.35,      # Relative Volume  — primary volume signal
    "mfi": 0.10,       # Money Flow Index — reduced (noisy on crypto perps)
    "atr": 0.35,       # ATR %            — primary range/volatility signal
    "bb_width": 0.20,  # BB Width         — compression detector
}


def compute_vi_score(
    candles: list[dict],
    enabled: dict | None = None,
    ema_ref: int | None = None,
    indicator_weights: dict | None = None,
    retest_tolerance: float | None = None,
) -> dict:
    """Compute VI score for a single instrument from OHLCV candles.

    Args:
        candles:            list of OHLCV dicts, ordered oldest → newest.
                            220 candles recommended (covers EMA-200 convergence).
        enabled:            indicator on/off flags — defaults to all True.
        indicator_weights:  per-indicator weights from DB settings (per_pair.indicator_weights).
                            Falls back to _DEFAULT_INDICATOR_WEIGHTS when absent.
                            Disabled indicators are excluded and weights are renormalized.
        retest_tolerance:   per-TF retest proximity threshold (fraction, e.g. 0.01 = 1%).
                            Comes from per-pair DB config (ema_retest_tolerance).
                            Falls back to 0.005 inside compute_ema_score when absent.

    Returns:
        {
            "vi_score":   float (0.000–1.000),  ← weighted avg of active RVOL/MFI/ATR/BB
            "rvol":       float (0–1) | absent if disabled,
            "mfi":        float (0–1) | absent if disabled,
            "atr":        float (0–1) | absent if disabled,
            "bb_width":   float (0–1) | absent if disabled,
            "ema_score":  float (0.0–1.0) | absent if disabled,
            "ema_signal": str             | absent if disabled,
        }
        On insufficient data:
            {"vi_score": 0.5, "error": "insufficient_data", "candles": n}
    """
    cfg: dict = {**_DEFAULT_ENABLED, **(enabled or {})}

    if len(candles) < _MIN_CANDLES:
        return {"vi_score": 0.5, "error": "insufficient_data", "candles": len(candles)}

    df = _ohlcv_to_df(candles)
    components: dict = {}
    active_scores: list[float] = []

    if cfg.get("rvol", True):
        v = compute_rvol(df)
        components["rvol"] = v
        active_scores.append(v)

    if cfg.get("mfi", True):
        v = compute_mfi(df)
        components["mfi"] = v
        active_scores.append(v)

    if cfg.get("atr", True):
        v = compute_atr_norm(df)
        components["atr"] = v
        active_scores.append(v)

    if cfg.get("bb", True):
        v = compute_bb_width(df)
        components["bb_width"] = v
        active_scores.append(v)

    # EMA: computed and stored, but NOT included in VI average
    # (watchlist ranking boost — dotted arrow in architecture doc)
    if cfg.get("ema", True):
        ema = compute_ema_score(df, ema_ref=ema_ref, retest_tolerance=retest_tolerance)
        components["ema_score"] = ema["score"]
        components["ema_signal"] = ema["signal"]
        components["ema_ref_period"] = ema["ema_ref_period"]

    # Weighted average — weights come from DB settings (per_pair.indicator_weights).
    # Falls back to _DEFAULT_INDICATOR_WEIGHTS. Disabled indicators are excluded
    # and remaining weights are renormalized to sum = 1.0 automatically.
    weights = {**_DEFAULT_INDICATOR_WEIGHTS, **(indicator_weights or {})}
    _KEYS = ["rvol", "mfi", "atr", "bb_width"]  # canonical order
    active_keys = [k for k in _KEYS if k in components and isinstance(components.get(k), float)]
    if active_keys:
        raw_total = sum(weights.get(k, 0.25) for k in active_keys)
        vi = round(sum(weights.get(k, 0.25) / raw_total * components[k] for k in active_keys), 3)
    else:
        vi = 0.5
    return {"vi_score": vi, **components}
