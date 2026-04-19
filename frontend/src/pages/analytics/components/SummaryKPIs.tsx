// ── SummaryKPIs ───────────────────────────────────────────────────────────────
// Compact KPI row with info tooltips
import { HelpCircle } from 'lucide-react'
import type { AnalyticsKPISummary } from '../../../types/api'

interface Props { kpi: AnalyticsKPISummary }

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <HelpCircle size={11} className="inline-block ml-1 text-slate-700 hover:text-slate-400 cursor-help align-middle transition-colors" />
      <span className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity
        absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-60 rounded-lg
        bg-surface-700 border border-surface-600 px-3 py-2
        text-xs text-slate-300 shadow-xl pointer-events-none leading-relaxed text-center whitespace-normal">
        {text}
      </span>
    </span>
  )
}

interface KPICardProps {
  label: string
  value: string
  sub?: string
  color: string
  tip: string
}

function KPICard({ label, value, sub, color, tip }: KPICardProps) {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-xl p-3.5 flex flex-col gap-1 hover:border-surface-600 transition-colors">
      <div className="flex items-center gap-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{label}</span>
        <InfoTip text={tip} />
      </div>
      <span className={`text-2xl font-bold tabular-nums leading-none ${color}`}>{value}</span>
      {sub && <span className="text-[11px] text-slate-500 leading-snug">{sub}</span>}
    </div>
  )
}

export function SummaryKPIs({ kpi }: Props) {
  const wrColor = kpi.disciplined_wr == null ? 'text-slate-400'
    : kpi.disciplined_wr >= 55 ? 'text-emerald-400'
    : kpi.disciplined_wr >= 45 ? 'text-amber-400' : 'text-red-400'

  const pfColor = kpi.profit_factor == null ? 'text-slate-400'
    : kpi.profit_factor >= 1.5 ? 'text-emerald-400'
    : kpi.profit_factor >= 1.0 ? 'text-amber-400' : 'text-red-400'

  const exColor = kpi.expectancy == null ? 'text-slate-400'
    : kpi.expectancy > 0 ? 'text-emerald-400' : 'text-red-400'

  const streakColor = kpi.current_streak > 0 ? 'text-emerald-400'
    : kpi.current_streak < 0 ? 'text-red-400' : 'text-slate-400'

  const streakLabel = kpi.current_streak > 0 ? `${kpi.current_streak}W` 
    : kpi.current_streak < 0 ? `${Math.abs(kpi.current_streak)}L` : '–'

  const reviewPct = kpi.total_trades > 0
    ? Math.round((kpi.total_trades - kpi.disciplined_trades) / kpi.total_trades * 100)
    : 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      <KPICard
        label="Disciplined WR"
        value={kpi.disciplined_wr != null ? `${kpi.disciplined_wr}%` : '—'}
        sub={kpi.raw_wr != null ? `Raw: ${kpi.raw_wr}% (all)` : undefined}
        color={wrColor}
        tip="Win rate on disciplined trades only — excludes break-even trades and sessions where your strategy rules were broken."
      />
      <KPICard
        label="Expectancy"
        value={kpi.expectancy != null ? `${kpi.expectancy >= 0 ? '+$' : '-$'}${Math.abs(kpi.expectancy).toFixed(0)}` : '—'}
        sub={kpi.avg_win_pnl != null && kpi.avg_loss_pnl != null
          ? `W: +$${kpi.avg_win_pnl.toFixed(0)} · L: -$${Math.abs(kpi.avg_loss_pnl).toFixed(0)}`
          : undefined}
        color={exColor}
        tip="Average monetary gain per disciplined trade. Formula: (WR × avg_win) + (LR × avg_loss). Positive = edge."
      />
      <KPICard
        label="Profit Factor"
        value={kpi.profit_factor != null ? kpi.profit_factor.toFixed(2) : '—'}
        sub={kpi.profit_factor != null
          ? kpi.profit_factor >= 2 ? 'Excellent' : kpi.profit_factor >= 1.5 ? 'Strong' : kpi.profit_factor >= 1 ? 'Profitable' : 'Losing'
          : undefined}
        color={pfColor}
        tip="Total gross profit ÷ total gross loss. Above 1.0 = profitable. Target: >1.5 (strong), >2.0 (excellent)."
      />
      <KPICard
        label="Current Streak"
        value={streakLabel}
        sub={`Best ${kpi.best_win_streak}W  |  Worst ${Math.abs(kpi.worst_loss_streak)}L`}
        color={streakColor}
        tip="Your current consecutive win or loss streak. Helps spot hot/cold runs and emotional state."
      />
      <KPICard
        label="Disciplined Trades"
        value={`${kpi.disciplined_trades}`}
        sub={`${kpi.total_trades} total · ${reviewPct}% filtered`}
        color="text-slate-200"
        tip="Trades counted toward disciplined stats — total trades minus break-even and strategy-broken sessions."
      />
      <KPICard
        label="Review Coverage"
        value={kpi.total_trades > 0
          ? `${Math.round(kpi.disciplined_trades / kpi.total_trades * 100)}%`
          : '—'}
        sub={`${kpi.total_trades} closed trades`}
        color="text-violet-400"
        tip="Percentage of closed trades included in performance analysis. Higher = more accurate stats."
      />
    </div>
  )
}

