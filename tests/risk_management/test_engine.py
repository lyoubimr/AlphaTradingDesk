"""
P3-2 — Unit tests for the Dynamic Risk Engine.

Pure unit tests — no DB, no HTTP, no Redis.
All inputs are injected directly into compute_risk_multiplier().

Covered cases (8 minimum per plan):
  1. All criteria enabled + all favourable → multiplier ≥ 1.40
  2. All criteria enabled + all unfavourable → multiplier ≤ 0.55
  3. Strategy WR neutral when strategy_has_stats=False
  4. Confidence None → confidence criterion uses neutral factor (1.0)
  5. MA direction "aligned" → factor 1.30
  6. Disabled criterion not included in calculation
  7. Budget blocking triggered when effective risk > budget
  8. global_multiplier_max is respected (hard ceiling)
  9. NORMAL regime → factor 1.00 (true neutral, no penalty)
 10. TRENDING regime → factor 1.50 (significant boost)
"""

from __future__ import annotations

from src.risk_management.defaults import DEFAULT_RISK_CONFIG
from src.risk_management.engine import compute_risk_multiplier

# ── Helpers ───────────────────────────────────────────────────────────────────

def _run(
    *,
    config: dict | None = None,
    market_vi_regime: str | None = "NORMAL",
    pair_vi_regime: str | None = "NORMAL",
    ma_direction_match: str | None = "neutral",
    strategy_wr: float | None = None,
    strategy_has_stats: bool = False,
    confidence_score: int | None = None,
    base_risk_pct: float = 2.0,
    capital: float = 10_000.0,
    budget_remaining_pct: float = 10.0,
):
    return compute_risk_multiplier(
        config=config if config is not None else {},
        market_vi_regime=market_vi_regime,
        pair_vi_regime=pair_vi_regime,
        ma_direction_match=ma_direction_match,
        strategy_wr=strategy_wr,
        strategy_has_stats=strategy_has_stats,
        confidence_score=confidence_score,
        base_risk_pct=base_risk_pct,
        capital=capital,
        budget_remaining_pct=budget_remaining_pct,
    )


# ── Case 1: all favourable → multiplier ≥ 1.40 ───────────────────────────────

def test_all_favourable_multiplier_significant():
    """TRENDING + TRENDING + aligned + 100% WR + confidence 10 → big boost."""
    result = _run(
        market_vi_regime="TRENDING",
        pair_vi_regime="TRENDING",
        ma_direction_match="aligned",
        strategy_wr=1.0,
        strategy_has_stats=True,
        confidence_score=10,
        budget_remaining_pct=10.0,
    )
    assert result.multiplier >= 1.40, (
        f"Expected multiplier ≥ 1.40 for all-favourable conditions, got {result.multiplier}"
    )
    assert result.adjusted_risk_pct > result.base_risk_pct


# ── Case 2: all unfavourable → multiplier ≤ 0.55 ─────────────────────────────

def test_all_unfavourable_multiplier_reduced():
    """EXTREME + DEAD + opposed + 0% WR + confidence 0 → strong reduction."""
    result = _run(
        market_vi_regime="EXTREME",
        pair_vi_regime="DEAD",
        ma_direction_match="opposed",
        strategy_wr=0.0,
        strategy_has_stats=True,
        confidence_score=0,
        budget_remaining_pct=10.0,
    )
    assert result.multiplier <= 0.55, (
        f"Expected multiplier ≤ 0.55 for all-unfavourable conditions, got {result.multiplier}"
    )
    assert result.adjusted_risk_pct < result.base_risk_pct


# ── Case 3: strategy WR neutral when insufficient stats ───────────────────────

def test_strategy_wr_neutral_when_no_stats():
    """strategy_has_stats=False → WR criterion contributes factor 1.0."""
    result_no_stats = _run(
        strategy_wr=0.0,
        strategy_has_stats=False,
        confidence_score=5,
        ma_direction_match="neutral",
    )
    result_explicit_neutral = _run(
        strategy_wr=0.5,    # 50% WR → factor 1.0 on default min=0.5/max=1.5 scale
        strategy_has_stats=True,
        confidence_score=5,
        ma_direction_match="neutral",
    )

    swr_detail_no_stats = next(c for c in result_no_stats.criteria if c.name == "strategy_wr")
    assert swr_detail_no_stats.factor == 1.0, (
        f"Expected WR factor 1.0 when no stats, got {swr_detail_no_stats.factor}"
    )
    assert swr_detail_no_stats.value_label == "N/A (insufficient data)"

    swr_detail_neutral = next(c for c in result_explicit_neutral.criteria if c.name == "strategy_wr")
    assert abs(swr_detail_neutral.factor - 1.0) < 1e-6


# ── Case 4: confidence None → neutral ─────────────────────────────────────────

def test_confidence_none_is_neutral():
    result = _run(confidence_score=None)
    conf_detail = next(c for c in result.criteria if c.name == "confidence")
    assert conf_detail.factor == 1.0
    assert conf_detail.value_label == "N/A"


# ── Case 5: MA direction aligned → factor 1.30 ───────────────────────────────

def test_ma_direction_aligned_factor():
    result = _run(ma_direction_match="aligned")
    ma_detail = next(c for c in result.criteria if c.name == "ma_direction")
    assert abs(ma_detail.factor - 1.30) < 1e-6
    assert "Aligned" in ma_detail.value_label


def test_ma_direction_opposed_factor():
    result = _run(ma_direction_match="opposed")
    ma_detail = next(c for c in result.criteria if c.name == "ma_direction")
    assert abs(ma_detail.factor - 0.60) < 1e-6


# ── Case 6: disabled criterion not included in calculation ────────────────────

def test_disabled_criterion_excluded():
    """Disabling all criteria except market_vi should make it the sole driver."""
    import copy
    cfg = copy.deepcopy(DEFAULT_RISK_CONFIG)
    cfg["criteria"]["pair_vi"]["enabled"] = False
    cfg["criteria"]["ma_direction"]["enabled"] = False
    cfg["criteria"]["strategy_wr"]["enabled"] = False
    cfg["criteria"]["confidence"]["enabled"] = False

    result = _run(
        config=cfg,
        market_vi_regime="TRENDING",  # factor 1.50
        budget_remaining_pct=10.0,
    )

    # With only market_vi enabled and TRENDING → multiplier = 1.50
    assert abs(result.multiplier - 1.50) < 1e-4, (
        f"Expected 1.50 with only market_vi TRENDING, got {result.multiplier}"
    )

    # Disabled criteria have contribution = 0.0
    for c in result.criteria:
        if not c.enabled:
            assert c.contribution == 0.0


# ── Case 7: budget blocking ───────────────────────────────────────────────────

def test_budget_blocking_triggered():
    """adjusted_risk_amount > budget_remaining_amount → budget_blocking = True."""
    result = _run(
        market_vi_regime="TRENDING",
        pair_vi_regime="TRENDING",
        ma_direction_match="aligned",
        strategy_wr=1.0,
        strategy_has_stats=True,
        confidence_score=10,
        base_risk_pct=2.0,
        capital=10_000.0,
        budget_remaining_pct=0.5,  # only 0.5% = 50€ remaining
    )
    # adjusted_risk would be ~2.9% = 290€ >> 50€ budget
    assert result.budget_blocking is True
    assert result.suggested_risk_pct <= result.budget_remaining_pct + 1e-9
    assert result.suggested_risk_pct < result.adjusted_risk_pct


def test_no_budget_blocking_when_budget_sufficient():
    result = _run(
        base_risk_pct=2.0,
        capital=10_000.0,
        budget_remaining_pct=10.0,  # 1000€ remaining — plenty
    )
    assert result.budget_blocking is False
    assert result.suggested_risk_pct == result.adjusted_risk_pct


# ── Case 8: global_multiplier_max is respected ───────────────────────────────

def test_global_multiplier_max_ceiling():
    import copy
    cfg = copy.deepcopy(DEFAULT_RISK_CONFIG)
    cfg["global_multiplier_max"] = 1.10  # very low cap

    result = _run(
        config=cfg,
        market_vi_regime="TRENDING",
        pair_vi_regime="TRENDING",
        ma_direction_match="aligned",
        strategy_wr=1.0,
        strategy_has_stats=True,
        confidence_score=10,
        budget_remaining_pct=10.0,
    )
    assert result.multiplier <= 1.10 + 1e-6, (
        f"Multiplier {result.multiplier} exceeds global_multiplier_max 1.10"
    )


# ── Case 9: NORMAL regime → true neutral (1.00) ───────────────────────────────

def test_normal_regime_is_true_neutral():
    """NORMAL regime should produce factor 1.0 — no penalty, no boost."""
    result = _run(
        market_vi_regime="NORMAL",
        pair_vi_regime="NORMAL",
        ma_direction_match="neutral",
        strategy_wr=None,
        strategy_has_stats=False,
        confidence_score=None,
    )
    # All criteria neutral → multiplier = 1.0
    assert abs(result.multiplier - 1.0) < 1e-6
    assert abs(result.adjusted_risk_pct - result.base_risk_pct) < 1e-6


# ── Case 10: TRENDING regime → significant boost (1.50) ──────────────────────

def test_trending_regime_factor():
    result = _run(market_vi_regime="TRENDING")
    mvi_detail = next(c for c in result.criteria if c.name == "market_vi")
    assert abs(mvi_detail.factor - 1.50) < 1e-6
    assert mvi_detail.value_label == "TRENDING"
