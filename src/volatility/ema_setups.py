"""
Top EMA setups per timeframe: breakouts and retests on each timeframe's reference EMA.

Pure ranking / timeline logic over the `pairs` of watchlist snapshots (no I/O). The signals come
from `indicators.compute_ema_score`; the reference EMA per timeframe is 1H→99, 4H→200, 1D→99.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

Outcome = Literal["holding", "failed", "neutral", "unknown"]

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

# How far back "earlier" setups are kept: 1H = 1 day, 4H = 2 days, 1D = 5 days.
HISTORY_HOURS: dict[str, int] = {"1h": 24, "4h": 48, "1d": 5 * 24}

# Dead markets have no activity to trade, so a "signal" there is noise.
EXCLUDED_REGIMES = frozenset({"dead"})

# What the pair looks like NOW tells whether an earlier setup followed through.
_FOLLOW_THROUGH: dict[str, frozenset[str]] = {
    "long": frozenset({"above_all", "breakout_up", "retest_up", "retest_after_breakout_up"}),
    "short": frozenset({"below_all", "breakdown_down", "retest_down", "retest_after_breakdown_down"}),
}
_REVERSAL: dict[str, frozenset[str]] = {"long": _FOLLOW_THROUGH["short"], "short": _FOLLOW_THROUGH["long"]}


def _classify(pair: dict, *, long_only: bool) -> tuple[str, str] | None:
    meta = SETUP_SIGNALS.get(pair.get("ema_signal") or "")
    if meta is None or pair.get("regime") in EXCLUDED_REGIMES:
        return None
    if long_only and meta[1] != "long":
        return None
    return meta


def rank_setups(
    pairs: list[dict], *, long_only: bool, top: int
) -> tuple[list[dict], int, int]:
    """Return (top setups, total setups, prime setups) from a snapshot's pairs.

    Order: tier (prime → fresh → retest), then volatility score descending.
    """
    candidates: list[dict] = []
    for pair in pairs:
        meta = _classify(pair, long_only=long_only)
        if meta is None:
            continue
        tier, direction = meta
        candidates.append({**pair, "tier": tier, "direction": direction})

    candidates.sort(key=lambda c: (TIER_ORDER[c["tier"]], -float(c.get("vi_score") or 0.0)))
    prime_total = sum(1 for c in candidates if c["tier"] == "prime")
    return candidates[:top], len(candidates), prime_total


def assess_outcome(direction: str, current_signal: str | None) -> Outcome:
    """Did an earlier setup follow through? Judged from the pair's signal in the latest snapshot.

    holding — still on the setup's side of the EMAs; failed — flipped to the opposite side;
    neutral — in between (mixed); unknown — the pair is absent from the latest snapshot.
    """
    if current_signal is None:
        return "unknown"
    if current_signal in _FOLLOW_THROUGH[direction]:
        return "holding"
    if current_signal in _REVERSAL[direction]:
        return "failed"
    return "neutral"


def build_timeline(
    snapshots: list[tuple[datetime, list[dict]]], *, long_only: bool
) -> list[dict]:
    """Group the setups seen across snapshots (oldest → newest) by (pair, direction).

    Each entry: pair, direction, tier (latest), best_tier, latest_signal, path (distinct signals in
    order, e.g. breakout → retest after breakout), first_seen, last_seen, streak_start (start of the
    unbroken run ending at last_seen), times_seen, active (present in the newest snapshot).
    """
    entries: dict[tuple[str, str], dict] = {}
    last_idx = len(snapshots) - 1
    for idx, (ts, pairs) in enumerate(snapshots):
        for pair in pairs:
            meta = _classify(pair, long_only=long_only)
            if meta is None:
                continue
            tier, direction = meta
            signal = pair["ema_signal"]
            entry = entries.get((pair["pair"], direction))
            if entry is None:
                entry = {
                    "pair": pair["pair"], "direction": direction, "best_tier": tier,
                    "first_seen": ts, "streak_start": ts, "times_seen": 0, "path": [], "_last_idx": -1,
                }
                entries[(pair["pair"], direction)] = entry
            if entry["_last_idx"] != idx - 1:  # gap → a new run starts
                entry["streak_start"] = ts
            entry["_last_idx"] = idx
            entry["last_seen"] = ts
            entry["times_seen"] += 1
            entry["tier"] = tier
            entry["latest_signal"] = signal
            if TIER_ORDER[tier] < TIER_ORDER[entry["best_tier"]]:
                entry["best_tier"] = tier
            if not entry["path"] or entry["path"][-1] != signal:
                entry["path"].append(signal)

    for entry in entries.values():
        entry["active"] = entry.pop("_last_idx") == last_idx
    return list(entries.values())


def snapshot_age_seconds(generated_at: datetime, now: datetime | None = None) -> int:
    ref = now or datetime.now(UTC)
    if generated_at.tzinfo is None:
        generated_at = generated_at.replace(tzinfo=UTC)
    return max(int((ref - generated_at).total_seconds()), 0)
