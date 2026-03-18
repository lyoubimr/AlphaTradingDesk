"""
Phase 3 — Dynamic Risk Multiplier Engine (P3-2).

Pure computation — no I/O, no DB, no HTTP.
Takes pre-resolved inputs and returns a fully populated RiskMultiplierResult.

Design principles
-----------------
- Never raises exceptions: missing/None inputs produce neutral factors (1.0).
- Weight normalisation happens at runtime, not at configuration time.
  Users can enable/disable criteria without re-normalising weights manually.
- global_multiplier_max is the hard ceiling applied AFTER weighting.
- budget_remaining_pct is injected by the caller (service layer) so the
  engine stays pure and testable without a DB connection.

Factor semantics
----------------
  factor > 1.0   boost   — conditions are favourable
  factor = 1.0   neutral — no adjustment
  factor < 1.0   reduce  — conditions are unfavourable

Multiplier formula
------------------
  enabled = [c for c in criteria if c.enabled]
  total_w = Σ weight_i   (for enabled criteria)

  multiplier = Σ (factor_i × weight_i) / total_w
  multiplier = min(multiplier, global_multiplier_max)
"""

from __future__ import annotations

import copy

from src.risk_management.defaults import DEFAULT_RISK_CONFIG
from src.risk_management.schemas import CriterionDetail, RiskMultiplierResult

# Sentinels used when a regime string is not in the factor map
_NEUTRAL_FACTOR = 1.0


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into a copy of base."""
    result = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _resolve_config(raw_config: dict) -> dict:
    """Merge raw_config on top of DEFAULT_RISK_CONFIG to fill missing keys."""
    return _deep_merge(DEFAULT_RISK_CONFIG, raw_config)


# ── Per-criterion factor resolvers ────────────────────────────────────────────

def _factor_vi(regime: str | None, factors: dict[str, float]) -> tuple[float, str]:
    """Return (factor, value_label) for a VI regime string."""
    if regime is None:
        return _NEUTRAL_FACTOR, "No data"
    regime_upper = regime.upper()
    factor = factors.get(regime_upper, _NEUTRAL_FACTOR)
    return factor, regime_upper


def _factor_ma_direction(
    direction_match: str | None,
    factors: dict[str, float],
) -> tuple[float, str]:
    """
    Return (factor, value_label) for MA direction alignment.

    direction_match: "aligned" | "opposed" | "neutral" | None
    None and unknown values → neutral.
    """
    if direction_match is None:
        return _NEUTRAL_FACTOR, "N/A"
    key = direction_match.lower()
    factor = factors.get(key, _NEUTRAL_FACTOR)
    label_map = {"aligned": "Aligned ↑", "opposed": "Opposed ↓", "neutral": "Neutral"}
    label = label_map.get(key, direction_match)
    return factor, label


def _factor_strategy_wr(
    strategy_wr: float | None,
    strategy_has_stats: bool,
    min_factor: float,
    max_factor: float,
) -> tuple[float, str]:
    """
    Linear interpolation of the strategy win-rate into a factor.

    Returns neutral (1.0) when:
    - strategy_has_stats is False  (insufficient trade count)
    - strategy_wr is None
    """
    if not strategy_has_stats or strategy_wr is None:
        return _NEUTRAL_FACTOR, "N/A (insufficient data)"
    wr_clamped = _clamp(strategy_wr, 0.0, 1.0)
    factor = min_factor + wr_clamped * (max_factor - min_factor)
    factor = _clamp(factor, min_factor, max_factor)
    label = f"{round(wr_clamped * 100)}%"
    return factor, label


def _factor_confidence(
    confidence_score: int | None,
    min_factor: float,
    max_factor: float,
) -> tuple[float, str]:
    """
    Linear interpolation of the confidence score (1–10) into a factor.

    Returns neutral (1.0) when confidence_score is None.
    """
    if confidence_score is None:
        return _NEUTRAL_FACTOR, "N/A"
    score_clamped = _clamp(float(confidence_score), 0.0, 10.0)
    factor = min_factor + (score_clamped / 10.0) * (max_factor - min_factor)
    factor = _clamp(factor, min_factor, max_factor)
    label = f"{int(score_clamped)}/10"
    return factor, label


# ── Main entry point ──────────────────────────────────────────────────────────

def compute_risk_multiplier(
    config: dict,
    *,
    market_vi_regime: str | None,
    pair_vi_regime: str | None,
    ma_direction_match: str | None,
    strategy_wr: float | None,
    strategy_has_stats: bool,
    confidence_score: int | None,
    base_risk_pct: float,
    capital: float,
    budget_remaining_pct: float,
) -> RiskMultiplierResult:
    """
    Compute the dynamic risk multiplier and return the full breakdown.

    Parameters
    ----------
    config               : risk_settings.config for this profile (may be partial —
                           missing keys are filled from DEFAULT_RISK_CONFIG)
    market_vi_regime     : e.g. "TRENDING" — from Redis cache; None → neutral
    pair_vi_regime       : e.g. "ACTIVE"   — fetched live; None → neutral
    ma_direction_match   : "aligned" | "neutral" | "opposed" | None
    strategy_wr          : win-rate 0.0–1.0; None if no strategy selected
    strategy_has_stats   : False when trades_count < min_trades_for_stats
    confidence_score     : 1–10; None if not provided
    base_risk_pct        : profile.risk_percentage_default
    capital              : profile.capital_current
    budget_remaining_pct : max_concurrent_risk_pct - concurrent_risk_used_pct
                           (injected by service layer)

    Returns
    -------
    RiskMultiplierResult with every field populated.  Never raises.
    """
    cfg = _resolve_config(config)
    criteria_cfg = cfg["criteria"]
    global_max = float(cfg.get("global_multiplier_max", 2.0))

    details: list[CriterionDetail] = []

    # ── 1. market_vi ─────────────────────────────────────────────────────────
    mvi_cfg = criteria_cfg["market_vi"]
    mvi_factor, mvi_label = _factor_vi(market_vi_regime, mvi_cfg["factors"])
    details.append(CriterionDetail(
        name="market_vi",
        enabled=bool(mvi_cfg["enabled"]),
        value_label=mvi_label,
        factor=mvi_factor,
        weight=float(mvi_cfg["weight"]),
        contribution=0.0,  # filled after normalisation
    ))

    # ── 2. pair_vi ───────────────────────────────────────────────────────────
    pvi_cfg = criteria_cfg["pair_vi"]
    pvi_factor, pvi_label = _factor_vi(pair_vi_regime, pvi_cfg["factors"])
    details.append(CriterionDetail(
        name="pair_vi",
        enabled=bool(pvi_cfg["enabled"]),
        value_label=pvi_label,
        factor=pvi_factor,
        weight=float(pvi_cfg["weight"]),
        contribution=0.0,
    ))

    # ── 3. ma_direction ──────────────────────────────────────────────────────
    ma_cfg = criteria_cfg["ma_direction"]
    ma_factor, ma_label = _factor_ma_direction(ma_direction_match, ma_cfg["factors"])
    details.append(CriterionDetail(
        name="ma_direction",
        enabled=bool(ma_cfg["enabled"]),
        value_label=ma_label,
        factor=ma_factor,
        weight=float(ma_cfg["weight"]),
        contribution=0.0,
    ))

    # ── 4. strategy_wr ───────────────────────────────────────────────────────
    swr_cfg = criteria_cfg["strategy_wr"]
    swr_factor, swr_label = _factor_strategy_wr(
        strategy_wr,
        strategy_has_stats,
        float(swr_cfg["min_factor"]),
        float(swr_cfg["max_factor"]),
    )
    details.append(CriterionDetail(
        name="strategy_wr",
        enabled=bool(swr_cfg["enabled"]),
        value_label=swr_label,
        factor=swr_factor,
        weight=float(swr_cfg["weight"]),
        contribution=0.0,
    ))

    # ── 5. confidence ────────────────────────────────────────────────────────
    conf_cfg = criteria_cfg["confidence"]
    conf_factor, conf_label = _factor_confidence(
        confidence_score,
        float(conf_cfg["min_factor"]),
        float(conf_cfg["max_factor"]),
    )
    details.append(CriterionDetail(
        name="confidence",
        enabled=bool(conf_cfg["enabled"]),
        value_label=conf_label,
        factor=conf_factor,
        weight=float(conf_cfg["weight"]),
        contribution=0.0,
    ))

    # ── Weight normalisation + multiplier calculation ─────────────────────────
    enabled = [d for d in details if d.enabled]

    if not enabled:
        # All criteria disabled — fall back to neutral multiplier
        multiplier = _NEUTRAL_FACTOR
    else:
        total_weight = sum(d.weight for d in enabled)

        if total_weight == 0.0:
            multiplier = _NEUTRAL_FACTOR
        else:
            multiplier = sum(d.factor * d.weight for d in enabled) / total_weight

        # Fill normalised contribution on enabled criteria
        for d in enabled:
            d.contribution = round(d.factor * d.weight / total_weight, 6)

    multiplier = _clamp(multiplier, 0.0, global_max)

    # ── Derived risk amounts ──────────────────────────────────────────────────
    adjusted_risk_pct = base_risk_pct * multiplier
    adjusted_risk_amount = adjusted_risk_pct / 100.0 * capital

    budget_remaining_amount = budget_remaining_pct / 100.0 * capital
    effective_risk_amount = adjusted_risk_amount

    budget_blocking = effective_risk_amount > budget_remaining_amount and budget_remaining_pct >= 0
    suggested_risk_pct = (
        budget_remaining_pct if budget_blocking else adjusted_risk_pct
    )

    return RiskMultiplierResult(
        multiplier=round(multiplier, 6),
        criteria=details,
        base_risk_pct=base_risk_pct,
        adjusted_risk_pct=round(adjusted_risk_pct, 6),
        adjusted_risk_amount=round(adjusted_risk_amount, 4),
        budget_remaining_pct=round(budget_remaining_pct, 6),
        budget_remaining_amount=round(budget_remaining_amount, 4),
        budget_blocking=budget_blocking,
        suggested_risk_pct=round(suggested_risk_pct, 6),
    )
