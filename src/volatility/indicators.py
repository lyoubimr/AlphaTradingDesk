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
    Normalization: abs(mfi_raw - 50) / 50  →  0 at neutral, 1 at extreme.
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
    last_mfi = float(mfi_raw.iloc[-1])
    return round(abs(last_mfi - 50.0) / 50.0, 4)


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
    periods: tuple[int, int, int] = (20, 50, 200),
) -> dict:
    """EMA position score — directional signal for watchlist ranking.

    Score: 0.0–1.0 (bidirectional, same scale as VI score)
        0.00 = price below all EMAs  (fully bearish)
        0.50 = neutral (price above some, below others)
        1.00 = price above all EMAs  (fully bullish)

    Weights: EMA20=50%, EMA50=30%, EMA200=20%

    Signal labels (EMA20-based, used as the watchlist `alert` column):
        above_all      — price > all 3 EMAs        (state, no alert)
        below_all      — price < all 3 EMAs        (state, no alert)
        breakout_up    — price crossed EMA20 upward within last 3 bars
        breakdown_down — price crossed EMA20 downward within last 3 bars
        retest_up      — price ≤ 0.5% above EMA20 (testing support)
        retest_down    — price ≤ 0.5% below EMA20 (testing resistance)
        mixed          — everything else            (no alert)

    Returns:
        {"score": float (0.0–1.0), "signal": str}

    NOT included in VI average — bonus signal for watchlist ranking only.
    """
    close = df["close"]
    last = float(close.iloc[-1])
    ema_weights = [0.5, 0.3, 0.2]
    emas = [float(close.ewm(span=p, adjust=False).mean().iloc[-1]) for p in periods]

    # Score: sum of weights for EMAs below current price → 0.0–1.0
    score = round(sum(w * (1.0 if last > e else 0.0) for w, e in zip(ema_weights, emas)), 2)

    # Signal detection — EMA20 crossover + retest
    above = [last > e for e in emas]
    if all(above):
        signal = "above_all"
    elif not any(above):
        signal = "below_all"
    else:
        ema20_series = close.ewm(span=periods[0], adjust=False).mean()
        if len(ema20_series) >= 3:
            prev_close_3 = float(close.iloc[-3])
            prev_ema20_3 = float(ema20_series.iloc[-3])
            if prev_close_3 < prev_ema20_3 and last > emas[0]:
                signal = "breakout_up"
            elif prev_close_3 > prev_ema20_3 and last < emas[0]:
                signal = "breakdown_down"
            elif emas[0] > 0 and abs(last - emas[0]) / emas[0] < 0.005:
                signal = "retest_up" if last >= emas[0] else "retest_down"
            else:
                signal = "mixed"
        else:
            signal = "mixed"

    return {"score": score, "signal": signal}


# ── VI aggregation ────────────────────────────────────────────────────────────

def compute_vi_score(
    candles: list[dict],
    enabled: dict | None = None,
) -> dict:
    """Compute VI score for a single instrument from OHLCV candles.

    Args:
        candles: list of OHLCV dicts, ordered oldest → newest.
                 220 candles recommended (covers EMA-200 convergence).
        enabled: indicator on/off flags — defaults to all True.

    Returns:
        {
            "vi_score":   float (0.000–1.000),  ← mean of active RVOL/MFI/ATR/BB
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
        ema = compute_ema_score(df)
        components["ema_score"] = ema["score"]
        components["ema_signal"] = ema["signal"]

    vi = round(sum(active_scores) / len(active_scores), 3) if active_scores else 0.5
    return {"vi_score": vi, **components}
