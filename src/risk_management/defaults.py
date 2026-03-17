"""
Phase 3 — Default Risk Settings config (JSONB).

This is the canonical default injected when a profile has no row in
risk_settings yet.  The service layer merges user overrides on top of this
dict so every key is guaranteed to exist at runtime.

Regime factor semantics
-----------------------
  NORMAL   = 1.00   true neutral — no penalty, no boost
  TRENDING = 1.50   sweet spot   — significant boost
  ACTIVE   = 1.20   market moving — light bonus
  CALM     = 0.60   low activity — slight reduction
  EXTREME  = 0.50   danger       — strong reduction
  DEAD     = 0.30   dead market  — near-block

All values are configurable per-profile from the Risk Settings UI.
"""

from __future__ import annotations

# Regime factor map applied to both market_vi and pair_vi criteria.
_VI_FACTORS: dict[str, float] = {
    "DEAD": 0.30,
    "CALM": 0.60,
    "NORMAL": 1.00,
    "TRENDING": 1.50,
    "ACTIVE": 1.20,
    "EXTREME": 0.50,
}

DEFAULT_RISK_CONFIG: dict = {
    "criteria": {
        # Market-wide VI regime (read from Redis cache)
        "market_vi": {
            "enabled": True,
            "weight": 0.20,
            "factors": dict(_VI_FACTORS),
        },
        # Pair-specific VI regime (fetched live or from Redis)
        "pair_vi": {
            "enabled": True,
            "weight": 0.25,
            "factors": dict(_VI_FACTORS),
        },
        # Trade direction vs. analysed MA direction
        "ma_direction": {
            "enabled": True,
            "weight": 0.20,
            "factors": {
                "aligned": 1.30,
                "neutral": 1.00,
                "opposed": 0.60,
            },
        },
        # Strategy historical win-rate (neutral when insufficient data)
        "strategy_wr": {
            "enabled": True,
            "weight": 0.20,
            "min_factor": 0.50,   # wr = 0% → factor 0.50
            "max_factor": 1.50,   # wr = 100% → factor 1.50
        },
        # Trader's self-reported confidence score (0–100)
        "confidence": {
            "enabled": True,
            "weight": 0.15,
            "min_factor": 0.50,   # confidence = 0 → factor 0.50
            "max_factor": 1.50,   # confidence = 100 → factor 1.50
        },
    },
    # Hard upper bound on the multiplier regardless of individual criteria.
    # Range validated server-side: [1.0, 3.0]
    "global_multiplier_max": 2.0,
    # Risk Guard — blocks trade if effective risk > concurrent budget remaining.
    "risk_guard": {
        "enabled": True,
        "force_allowed": True,       # False = strict discipline, force=True ignored
        "hard_block_at_zero": False,  # True = block even base risk when budget = 0
    },
    # Dashboard alert banner triggered when budget usage crosses the threshold.
    "alert_banner": {
        "enabled": True,
        "trigger_threshold_pct": 100.0,  # 80.0 = early warning before full saturation
    },
}
