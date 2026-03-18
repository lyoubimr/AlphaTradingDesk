// ── RiskAlertBanner ─────────────────────────────────────────────────────────
// Amber warning banner — fires when alert_risk_saturated=true (configurable
// threshold, not hard limit).  Shown above the dashboard widgets.
// The red "limit exceeded" banner (RiskExceededBanner) is separate.

import { AlertTriangle } from 'lucide-react'
import type { RiskBudgetOut } from '../../types/api'

interface Props {
  budget: RiskBudgetOut | null
}

export function RiskAlertBanner({ budget }: Props) {
  if (!budget || !budget.alert_risk_saturated) return null

  const usedPct      = budget.concurrent_risk_used_pct.toFixed(1)
  const thresholdPct = budget.alert_threshold_pct.toFixed(1)
  const maxPct       = budget.max_concurrent_risk_pct.toFixed(1)

  return (
    <div className="flex items-start gap-3 mb-5 px-4 py-3 rounded-xl bg-amber-900/20 border border-amber-700/40 text-sm text-amber-300">
      <AlertTriangle size={18} className="shrink-0 mt-0.5 text-amber-400" />
      <div>
        <p className="font-semibold">⚠️ Risk saturation alert</p>
        <p className="text-xs text-amber-400/80 mt-0.5">
          Portfolio risk at <strong>{usedPct}%</strong> — above your alert threshold of{' '}
          <strong>{thresholdPct}%</strong> (max {maxPct}%).
          {budget.pending_trades_count > 0 && (
            <> &nbsp;{budget.pending_trades_count} pending order{budget.pending_trades_count > 1 ? 's' : ''} included.</>
          )}
          {!budget.force_allowed && (
            <> New trades will be blocked until the budget frees up.</>
          )}
        </p>
      </div>
    </div>
  )
}
