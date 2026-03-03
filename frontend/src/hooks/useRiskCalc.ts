// ── useRiskCalc ───────────────────────────────────────────────────────────
// Pure reactive risk calculator — Fixed Fractional formula.
//
// Formulas:
//   risk_amount  = capital × (risk_pct / 100)
//   lot_size     = risk_amount / |entry - stop_loss|
//
// Returns null values when inputs are incomplete or invalid.

import { useMemo } from 'react'

export interface RiskCalcInput {
  capital: number | null        // profile.capital_current (numeric)
  risk_pct: number | null       // e.g. 2.0
  entry: number | null
  stop_loss: number | null
}

export interface RiskCalcResult {
  risk_amount: number | null    // in account currency
  lot_size: number | null       // units / lots
  risk_reward: number | null    // filled externally when TP is provided
  sl_distance: number | null    // |entry - stop_loss|
  valid: boolean
}

export function useRiskCalc({
  capital,
  risk_pct,
  entry,
  stop_loss,
}: RiskCalcInput): RiskCalcResult {
  return useMemo(() => {
    const empty: RiskCalcResult = {
      risk_amount: null,
      lot_size: null,
      risk_reward: null,
      sl_distance: null,
      valid: false,
    }

    if (
      capital == null || capital <= 0 ||
      risk_pct == null || risk_pct <= 0 ||
      entry == null || entry <= 0 ||
      stop_loss == null || stop_loss <= 0
    ) return empty

    const sl_distance = Math.abs(entry - stop_loss)
    if (sl_distance === 0) return empty

    const risk_amount = capital * (risk_pct / 100)
    const lot_size    = risk_amount / sl_distance

    return {
      risk_amount,
      lot_size,
      risk_reward: null,   // caller fills this from TP price
      sl_distance,
      valid: true,
    }
  }, [capital, risk_pct, entry, stop_loss])
}
