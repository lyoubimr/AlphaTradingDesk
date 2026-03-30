"""
Phase 3 — Pydantic schemas for the Risk Management module.

These are the public contracts used by:
  - engine.py  (internal computation results)
  - router.py  (API request/response bodies)
  - service.py (orchestration layer)

Dataclass-style objects that don't need FastAPI serialisation use plain Python
dataclasses; API-facing objects use Pydantic BaseModel.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic import BaseModel, Field

# ── Engine output ─────────────────────────────────────────────────────────────

@dataclass
class CriterionDetail:
    """Per-criterion breakdown returned by compute_risk_multiplier()."""

    name: str
    enabled: bool
    value_label: str    # human-readable detected value: "TRENDING", "65%", "80/100", …
    factor: float       # computed factor for this criterion (1.0 = neutral)
    weight: float       # normalised weight used in the calculation
    contribution: float # factor * weight  (before dividing by total_weight)


@dataclass
class RiskMultiplierResult:
    """Full result returned by compute_risk_multiplier()."""

    multiplier: float               # final multiplier — can exceed 1.0
    criteria: list[CriterionDetail] = field(default_factory=list)

    # Risk amounts
    base_risk_pct: float = 0.0      # profile.risk_percentage_default
    adjusted_risk_pct: float = 0.0  # base_risk_pct * multiplier
    adjusted_risk_amount: float = 0.0  # adjusted_risk_pct / 100 * capital

    # Budget — live (open/partial, uses current_risk — BE trades = 0)
    budget_remaining_pct: float = 0.0    # max_concurrent - live_used
    budget_remaining_amount: float = 0.0
    budget_blocking: bool = False        # True if effective risk > live budget
    suggested_risk_pct: float = 0.0     # min(adjusted_risk_pct, budget) if blocking

    # Pending LIMITs (potential future risk if all fill simultaneously)
    pending_risk_pct: float = 0.0
    pending_risk_amount: float = 0.0
    budget_remaining_if_pending_fill_pct: float = 0.0
    budget_remaining_if_pending_fill_amount: float = 0.0
    pending_budget_warning: bool = False  # fits now but would overflow if all LIMITs fill


# ── API request/response models ───────────────────────────────────────────────

class CriterionDetailOut(BaseModel):
    """Serialisable version of CriterionDetail for API responses."""

    name: str
    enabled: bool
    value_label: str
    factor: float
    weight: float
    contribution: float

    model_config = {"from_attributes": True}


class RiskAdvisorOut(BaseModel):
    """Response body for GET /api/risk/advisor."""

    base_risk_pct: float
    adjusted_risk_pct: float
    adjusted_risk_amount: float
    multiplier: float
    criteria: list[CriterionDetailOut]

    # Live budget (open/partial trades only, using current_risk)
    budget_remaining_pct: float
    budget_remaining_amount: float
    budget_blocking: bool
    suggested_risk_pct: float

    # Pending LIMIT orders (potential future exposure)
    pending_risk_pct: float = 0.0
    pending_risk_amount: float = 0.0
    budget_remaining_if_pending_fill_pct: float = 0.0
    budget_remaining_if_pending_fill_amount: float = 0.0
    pending_budget_warning: bool = False

    # Guard metadata forwarded to the UI
    force_allowed: bool = True


class RiskBudgetOut(BaseModel):
    """Response body for GET /api/risk/budget/{profile_id}."""

    profile_id: int
    capital_current: float
    risk_pct_default: float
    max_concurrent_risk_pct: float
    # Live risk (open/partial, using current_risk — BE trades count as 0)
    concurrent_risk_used_pct: float
    budget_remaining_pct: float
    budget_remaining_amount: float
    open_trades_count: int
    pending_trades_count: int
    # Pending LIMIT orders (potential future exposure)
    pending_risk_pct: float = 0.0
    pending_risk_amount: float = 0.0
    budget_remaining_if_pending_fill_pct: float = 0.0
    budget_remaining_if_pending_fill_amount: float = 0.0
    alert_risk_saturated: bool
    alert_threshold_pct: float
    force_allowed: bool


class RiskSettingsOut(BaseModel):
    """Response body for GET/PUT /api/risk/settings/{profile_id}."""

    profile_id: int
    config: dict = Field(default_factory=dict)


class RiskSettingsUpdateIn(BaseModel):
    """Request body for PUT /api/risk/settings/{profile_id}.

    Deep-merge semantics: only provided keys are updated; unset keys keep
    their current value.  Full replacement requires sending the entire config.
    """

    config: dict = Field(..., description="Partial or full JSONB config to merge")


class PairVIOut(BaseModel):
    """Response body for GET /api/risk/pair-vi."""

    pair: str
    timeframe: str
    vi_score: float
    regime: str
    ema_score: float | None = None
    ema_signal: str | None = None
    source: str  # "cache" | "live"
    computed_at: str
