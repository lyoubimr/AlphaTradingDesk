"""The AI prompt flags small samples and enforces the structured output format."""

from __future__ import annotations

from src.analytics.ai_service import MIN_SAMPLE, _build_prompt
from src.analytics.schemas import (
    DirectionRow,
    KPISummary,
    PerformanceReport,
    ReviewRateOut,
    StrategySessionCell,
    StrategySessionRow,
    TradeTypeRow,
    WRByStat,
)


def _report() -> PerformanceReport:
    return PerformanceReport(
        profile_id=1,
        period="30d",
        generated_at="2026-11-04T00:00:00",
        kpi=KPISummary(total_trades=13, disciplined_trades=9, disciplined_wr=66.7, raw_wr=46.2),
        equity_curve=[],
        wr_by_strategy=[
            WRByStat(label="Fib 0.618 retest", trades=6, wins=4, losses=2, wr_pct=66.7, avg_pnl=5.0, total_pnl=30.0),
            WRByStat(label="Wolf trendline", trades=2, wins=0, losses=2, wr_pct=0.0, avg_pnl=-6.0, total_pnl=-12.0),
        ],
        wr_by_session=[WRByStat(label="Weekend", trades=2, wins=0, losses=2, wr_pct=0.0, avg_pnl=-9.4, total_pnl=-18.8)],
        wr_by_hour=[],
        pair_leaderboard=[],
        tp_hit_rates=[],
        drawdown=[],
        trade_type_dist=[TradeTypeRow(trade_type="swing", count=4, wins=4, wr_pct=100.0, avg_pnl=12.8)],
        rr_scatter=[],
        direction_bias=[DirectionRow(direction="long", trades=9, wins=5, wr_pct=55.6, total_pnl=40.0)],
        top_tags_winners=[],
        top_tags_losers=[],
        repeat_errors=[],
        review_rate=ReviewRateOut(total_closed=13, reviewed_count=10, review_rate_pct=76.9),
        wr_by_strategy_session=[
            StrategySessionRow(strategy="Fib 0.618 retest", cells=[StrategySessionCell(session="London", trades=3, wins=3, wr_pct=100.0)]),
        ],
    )


def test_small_samples_are_flagged_and_large_ones_are_not():
    prompt = _build_prompt(_report())
    flag = f"[n<{MIN_SAMPLE}]"

    assert any(flag in ln for ln in prompt.splitlines() if ln.strip().startswith("Wolf trendline:"))
    assert any(flag in ln for ln in prompt.splitlines() if ln.strip().startswith("Weekend:"))
    assert any(flag in ln for ln in prompt.splitlines() if ln.strip().startswith("swing:"))
    assert any("London: 3t 100.0%" in ln and flag in ln for ln in prompt.splitlines())
    big = next(ln for ln in prompt.splitlines() if ln.strip().startswith("Fib 0.618 retest: 6 trades"))
    assert flag not in big
    long_row = next(ln for ln in prompt.splitlines() if ln.strip().startswith("long:"))
    assert flag not in long_row


def test_prompt_defines_the_output_format_and_ends_with_the_reminder():
    prompt = _build_prompt(_report())

    for heading in ("## ✅ What's working", "## ⚠️ What needs fixing", "## 🎯 Actions", "## 🔎 Too early to tell"):
        assert heading in prompt
    assert prompt.index("OUTPUT FORMAT") < prompt.index("=== DATA ===")
    assert prompt.rstrip().endswith("strictly in the OUTPUT FORMAT.")
    assert "Disciplined WR: 66.7%" in prompt
