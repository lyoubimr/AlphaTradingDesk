"""
Top EMA setups per timeframe: breakouts and retests on each timeframe's reference EMA.

Pure ranking logic over the `pairs` of a watchlist snapshot (no I/O). The signals come
from `indicators.compute_ema_score`; the reference EMA per timeframe is 1H→99, 4H→200, 1D→99.
"""

from __future__ import annotations

from datetime import UTC, datetime

# ema_signal → (tier, direction)
#   prime  — breakout/breakdown followed by a wick retest that held (best entry context)
#   fresh  — price just crossed the reference EMA
#   retest — wick touched the reference EMA with no recent cross
SETUP_SIGNALS: dict[str, tuple[str, str]] = {
    "retest_after_breakout_up": ("prime", "long"),
    "retest_after_breakdown_down": ("prime", "short"),
    "breakout_up": ("fresh", "long"),
    "breakdown_down": ("fresh", "short"),
    "retest_up": ("retest", "long"),
    "retest_down": ("retest", "short"),
}
TIER_ORDER = {"prime": 0, "fresh": 1, "retest": 2}

# snapshot timeframe → pinned-pair timeframe label
EMA_SETUP_TFS: dict[str, str] = {"1d": "1D", "4h": "4H", "1h": "1H"}
EMA_REF_PERIOD: dict[str, int] = {"1h": 99, "4h": 200, "1d": 99}

# A snapshot older than this no longer reflects the latest candle (≈1.5 × cadence).
STALE_AFTER_SECONDS: dict[str, int] = {"1h": 90 * 60, "4h": 6 * 3600, "1d": 36 * 3600}

# Dead markets have no activity to trade, so a "signal" there is noise.
EXCLUDED_REGIMES = frozenset({"dead"})


def rank_setups(
    pairs: list[dict], *, long_only: bool, top: int
) -> tuple[list[dict], int, int]:
    """Return (top setups, total setups, prime setups) from a snapshot's pairs.

    Order: tier (prime → fresh → retest), then volatility score descending.
    """
    candidates: list[dict] = []
    for pair in pairs:
        meta = SETUP_SIGNALS.get(pair.get("ema_signal") or "")
        if meta is None or pair.get("regime") in EXCLUDED_REGIMES:
            continue
        tier, direction = meta
        if long_only and direction != "long":
            continue
        candidates.append({**pair, "tier": tier, "direction": direction})

    candidates.sort(key=lambda c: (TIER_ORDER[c["tier"]], -float(c.get("vi_score") or 0.0)))
    prime_total = sum(1 for c in candidates if c["tier"] == "prime")
    return candidates[:top], len(candidates), prime_total


def snapshot_age_seconds(generated_at: datetime, now: datetime | None = None) -> int:
    ref = now or datetime.now(UTC)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    return max(int((ref - generated_at).total_seconds()), 0)
