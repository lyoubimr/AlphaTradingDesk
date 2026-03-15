#!/usr/bin/env python3
"""
analyze_volatility.py — AlphaTradingDesk volatility deep-analysis script.

Pulls Market VI + Watchlist data from the last N hours, computes stats,
and outputs both a human-readable report AND a formatted Perplexity AI prompt.

Usage:
    APP_ENV=dev python scripts/analyze_volatility.py [--hours 24] [--out report.md]

Outputs:
    - stdout  : human-readable summary
    - report.md (or --out path) : full markdown report + AI prompt
"""

import argparse
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

# ── Bootstrap app path ────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

os.environ.setdefault("APP_ENV", "dev")

from src.core.database import get_session_factory  # noqa: E402
from src.volatility.models import (  # noqa: E402
    MarketVISnapshot,
    WatchlistSnapshot,
)

# ─────────────────────────────────────────────────────────────────────────────


def fmt_pct(v: float) -> str:
    return f"{round(v * 100):>3d}"


def arrow(a: float, b: float) -> str:
    diff = b - a
    if abs(diff) < 0.01:
        return "→"
    return "↑" if diff > 0 else "↓"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--out", type=str, default="scripts/volatility_report.md")
    args = parser.parse_args()

    since = datetime.now(UTC) - timedelta(hours=args.hours)

    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        # ── 1. Market VI snapshots ────────────────────────────────────────────
        mvi_rows = (
            db.query(MarketVISnapshot)
            .filter(MarketVISnapshot.timestamp >= since)
            .order_by(MarketVISnapshot.timeframe, MarketVISnapshot.timestamp)
            .all()
        )

        mvi_by_tf: dict[str, list] = {}
        for r in mvi_rows:
            mvi_by_tf.setdefault(r.timeframe, []).append(r)

        # ── 2. Watchlist snapshots ────────────────────────────────────────────
        wl_rows = (
            db.query(WatchlistSnapshot)
            .filter(WatchlistSnapshot.generated_at >= since)
            .order_by(WatchlistSnapshot.timeframe, WatchlistSnapshot.generated_at)
            .all()
        )

        wl_by_tf: dict[str, list] = {}
        for r in wl_rows:
            wl_by_tf.setdefault(r.timeframe, []).append(r)

    finally:
        db.close()

    now_str = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    report_lines: list[str] = []
    ap = report_lines.append

    ap(f"# AlphaTradingDesk — Volatility Analysis Report")
    ap(f"**Generated:** {now_str}  |  **Window:** last {args.hours}h\n")

    # ── Section 1: Market VI ──────────────────────────────────────────────────
    ap("## 1. Market VI — Binance Futures composite score\n")
    ap("| TF | Snaps | Min | Avg | Max | StdDev | First→Last | Regime drift |")
    ap("|----:|------:|----:|----:|----:|-------:|:-----------|:-------------|")

    for tf in ["15m", "1h", "4h", "1d", "aggregated"]:
        rows = mvi_by_tf.get(tf, [])
        if not rows:
            ap(f"| {tf} | 0 | — | — | — | — | — | — |")
            continue
        scores = [float(r.vi_score) for r in rows]
        regimes = [r.regime for r in rows]
        s_min = min(scores) * 100
        s_avg = sum(scores) / len(scores) * 100
        s_max = max(scores) * 100
        import statistics
        s_std = statistics.stdev(scores) * 100 if len(scores) > 1 else 0.0
        first_r = regimes[0]
        last_r  = regimes[-1]
        drift = f"{first_r} → {last_r}" if first_r != last_r else first_r
        trend = arrow(scores[0], scores[-1])
        ap(f"| {tf} | {len(rows)} | {s_min:.0f} | {s_avg:.1f} | {s_max:.0f} | {s_std:.1f} | {scores[0]*100:.0f} {trend} {scores[-1]*100:.0f} | {drift} |")

    ap("")

    # ── Section 2: Regime timeline (15m — most granular) ─────────────────────
    ap("## 2. Market VI 15m — Regime timeline (most recent 20)\n")
    rows_15m = mvi_by_tf.get("15m", [])[-20:]
    if rows_15m:
        ap("| Time (UTC) | Score | Regime |")
        ap("|:-----------|------:|:-------|")
        for r in rows_15m:
            ts = r.timestamp.strftime("%m-%d %H:%M")
            score = round(float(r.vi_score) * 100)
            ap(f"| {ts} | {score:>3d} | {r.regime} |")
    ap("")

    # ── Section 3: Watchlist analysis ────────────────────────────────────────
    ap("## 3. Watchlist Snapshots — Pair count & regime distribution\n")
    ap("| TF | Snaps | Min pairs | Avg pairs | Max pairs | Dominant regimes seen |")
    ap("|----:|------:|----------:|----------:|----------:|:----------------------|")

    for tf in ["15m", "1h", "4h", "1d", "1w"]:
        rows = wl_by_tf.get(tf, [])
        if not rows:
            continue
        sizes = [len(r.pairs) if r.pairs else 0 for r in rows]
        regimes_seen = list(dict.fromkeys(r.regime for r in rows))
        ap(f"| {tf} | {len(rows)} | {min(sizes)} | {sum(sizes)//len(sizes)} | {max(sizes)} | {', '.join(regimes_seen[:5])} |")

    ap("")

    # ── Section 4: Watchlist 15m chronological size ───────────────────────────
    ap("## 4. Watchlist 15m — Size over time (all snapshots)\n")
    ap("| Time (UTC) | Pairs | Dominant regime |")
    ap("|:-----------|------:|:----------------|")
    for r in wl_by_tf.get("15m", []):
        ts  = r.generated_at.strftime("%m-%d %H:%M")
        sz  = len(r.pairs) if r.pairs else 0
        ap(f"| {ts} | {sz:>4d} | {r.regime} |")
    ap("")

    # ── Section 5: Per-pair regime breakdown (latest 15m snapshot) ────────────
    ap("## 5. Latest 15m Watchlist — Regime breakdown per pair\n")
    latest_15m = (wl_by_tf.get("15m") or [None])[-1]
    if latest_15m and latest_15m.pairs:
        regime_counts: dict[str, int] = {}
        for p in latest_15m.pairs:
            reg = p.get("regime", "UNKNOWN")
            regime_counts[reg] = regime_counts.get(reg, 0) + 1
        ap(f"**Snapshot:** {latest_15m.generated_at.strftime('%Y-%m-%d %H:%M UTC')}  "
           f"**Total pairs:** {len(latest_15m.pairs)}  "
           f"**Dominant:** {latest_15m.regime}\n")
        ap("| Regime | Count | % |")
        ap("|:-------|------:|--:|")
        total = len(latest_15m.pairs)
        for reg, cnt in sorted(regime_counts.items(), key=lambda x: -x[1]):
            ap(f"| {reg} | {cnt} | {cnt/total*100:.0f}% |")
        ap("")
        ap("**Top 15 pairs by VI score:**\n")
        ap("| # | Pair | VI | Regime | EMA signal |")
        ap("|--:|:-----|---:|:-------|:-----------|")
        top = sorted(latest_15m.pairs, key=lambda x: x.get("vi_score", 0), reverse=True)[:15]
        for i, p in enumerate(top, 1):
            vi = round(p.get("vi_score", 0) * 100)
            ap(f"| {i} | {p.get('pair','')} | {vi} | {p.get('regime','')} | {p.get('ema_signal','')} |")
    ap("")

    # ── Section 6: Key observations & recommendations ─────────────────────────
    ap("## 6. Key Observations & Recommendations\n")

    mvi_15m_scores = [float(r.vi_score) for r in mvi_by_tf.get("15m", [])]
    wl_15m_sizes   = [len(r.pairs) if r.pairs else 0 for r in wl_by_tf.get("15m", [])]

    obs: list[str] = []

    if mvi_15m_scores:
        import statistics
        std = statistics.stdev(mvi_15m_scores) * 100 if len(mvi_15m_scores) > 1 else 0
        trend = (mvi_15m_scores[-1] - mvi_15m_scores[0]) * 100
        obs.append(
            f"**Market VI 15m** — StdDev={std:.1f} pts over {args.hours}h. "
            f"Trend: {'+' if trend>0 else ''}{trend:.0f} pts ({mvi_15m_scores[0]*100:.0f}→{mvi_15m_scores[-1]*100:.0f}). "
            + ("⚠️ HIGH NOISE — consider increasing rolling_window." if std > 10 else "✅ Normal variance.")
        )

    if wl_15m_sizes:
        size_range = max(wl_15m_sizes) - min(wl_15m_sizes)
        obs.append(
            f"**Watchlist 15m size** — Range {min(wl_15m_sizes)}→{max(wl_15m_sizes)} (Δ={size_range} pairs). "
            + (
                "⚠️ LARGE VARIATION — content_filter too restrictive (e.g. TRENDING only)? "
                "Consider adding ACTIVE/NORMAL to content_filter or using a min_pairs_threshold."
                if size_range > 100
                else "✅ Stable."
            )
        )

    for o in obs:
        ap(f"- {o}")
    ap("")

    # ── Section 7: AI Prompt ───────────────────────────────────────────────────
    ap("---")
    ap("## 7. Deep Analysis Prompt (for Perplexity / Claude / ChatGPT)\n")
    ap("> Copy-paste the block below as your prompt:\n")
    ap("```")
    ap("You are a quantitative crypto trading system analyst.")
    ap("I am running AlphaTradingDesk, a Kraken Futures volatility scanner.")
    ap("The system computes a Volatility Index (VI, 0–100) across 4 timeframes (15m, 1h, 4h, 1d),")
    ap("using 5 indicators: RVOL (relative volume), MFI (money flow index), ATR% (normalised ATR),")
    ap("BB Width (Bollinger bandwidth), and EMA positioning.")
    ap("The Market VI aggregates ~50 Binance Futures pairs into a composite score.")
    ap("A watchlist is generated from ~325 Kraken Futures pairs, filtered by per-pair VI regime.")
    ap("")
    ap("Here is the data from the last " + str(args.hours) + "h:\n")

    # Inline the key stats
    for tf in ["15m", "1h", "4h", "aggregated"]:
        rows = mvi_by_tf.get(tf, [])
        if not rows:
            continue
        scores = [float(r.vi_score) for r in rows]
        import statistics
        std_val = statistics.stdev(scores) * 100 if len(scores) > 1 else 0.0
        ap(f"Market VI {tf.upper()}: {len(rows)} snaps | min={min(scores)*100:.0f} avg={sum(scores)/len(scores)*100:.1f} max={max(scores)*100:.0f} stddev={std_val:.1f}")
        ap(f"  Regime drift: {rows[0].regime} → {rows[-1].regime}")

    ap("")
    for tf in ["15m", "1h", "4h"]:
        rows = wl_by_tf.get(tf, [])
        if not rows:
            continue
        sizes = [len(r.pairs) if r.pairs else 0 for r in rows]
        ap(f"Watchlist {tf.upper()}: {len(rows)} snaps | pairs min={min(sizes)} avg={sum(sizes)//len(sizes)} max={max(sizes)}")
        ap(f"  Dominant regimes: {', '.join(dict.fromkeys(r.regime for r in rows))}")

    if latest_15m and latest_15m.pairs:
        ap(f"\nLatest 15m watchlist ({latest_15m.generated_at.strftime('%Y-%m-%d %H:%M UTC')}): {len(latest_15m.pairs)} pairs")
        top5 = sorted(latest_15m.pairs, key=lambda x: x.get("vi_score", 0), reverse=True)[:5]
        ap("Top 5: " + ", ".join(f"{p['pair']}(VI={round(p.get('vi_score',0)*100)},regime={p.get('regime','')})" for p in top5))

    ap("")
    ap("Questions for analysis:")
    ap("1. Is the Market VI signal reliable given this level of variance? What could cause stddev > 10 on 15m?")
    ap("2. The watchlist size varies from " + str(min(wl_15m_sizes) if wl_15m_sizes else 0) +
       " to " + str(max(wl_15m_sizes) if wl_15m_sizes else 0) +
       " pairs on 15m. Is this level of variation normal for a crypto volatility scanner?")
    ap("3. Should the regime content_filter for the watchlist use ['TRENDING'] only, or include other regimes?")
    ap("4. What rolling_window (currently 20 candles) would you recommend to balance responsiveness vs noise?")
    ap("5. Are there structural improvements to the indicator weights (RVOL/MFI/ATR/BB) to improve signal quality?")
    ap("6. How should the Binance Market VI pairs be weighted? Should BTC/ETH have higher weight?")
    ap("7. Based on this data, is the system trend-following, mean-reverting, or noise?")
    ap("```")

    report = "\n".join(report_lines)

    # ── Write report ──────────────────────────────────────────────────────────
    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")

    # ── Print summary to stdout ───────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  ALPHATRADINGDESK — Volatility Analysis [{now_str}]")
    print(f"  Window: last {args.hours}h")
    print(f"{'='*70}\n")

    print("MARKET VI (Binance composite, 50 pairs):")
    for tf in ["15m", "1h", "4h", "1d", "aggregated"]:
        rows = mvi_by_tf.get(tf, [])
        if not rows:
            continue
        scores = [float(r.vi_score) for r in rows]
        import statistics
        std = statistics.stdev(scores) * 100 if len(scores) > 1 else 0
        print(f"  {tf:>10s}: {len(rows):>3d} snaps | avg={sum(scores)/len(scores)*100:>5.1f} | "
              f"range=[{min(scores)*100:.0f},{max(scores)*100:.0f}] | "
              f"std={std:.1f} | {rows[0].regime}→{rows[-1].regime}")

    print("\nWATCHLIST (Kraken Futures, per-pair VI):")
    for tf in ["15m", "1h", "4h", "1d", "1w"]:
        rows = wl_by_tf.get(tf, [])
        if not rows:
            continue
        sizes = [len(r.pairs) if r.pairs else 0 for r in rows]
        regimes = list(dict.fromkeys(r.regime for r in rows))
        print(f"  {tf:>10s}: {len(rows):>3d} snaps | pairs avg={sum(sizes)//len(sizes):>3d} "
              f"min={min(sizes):>3d} max={max(sizes):>3d} | regimes: {', '.join(regimes[:4])}")

    print("\nOBSERVATIONS:")
    for o in obs:
        # strip markdown
        clean = o.replace("**", "").replace("⚠️", "!").replace("✅", "OK")
        print(f"  {clean}")

    print(f"\nFull report written to: {out_path}")
    print(f"Report includes AI prompt for deep analysis.\n")


if __name__ == "__main__":
    main()
