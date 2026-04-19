// ── SummaryKPIs ──────────────────────────────────────────────────────────
// Top-row KPI cards: WR, Expectancy, Profit Factor, Streak
import type { AnalyticsKPISummary } from '../../../types/api'

interface Props {
  kpi: AnalyticsKPISummary
}

function KPICard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-surface-900 border border-surface-800 rounded-lg p-4">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color ?? 'text-slate-100'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export function SummaryKPIs({ kpi }: Props) {
  const wrColor = kpi.disciplined_wr == null ? 'text-slate-400'
    : kpi.disciplined_wr >= 55 ? 'text-emerald-400'
    : kpi.disciplined_wr >= 45 ? 'text-amber-400'
    : 'text-red-400'

  const pfColor = kpi.profit_factor == null ? 'text-slate-400'
    : kpi.profit_factor >= 1.5 ? 'text-emerald-400'
    : kpi.profit_factor >= 1.0 ? 'text-amber-400'
    : 'text-red-400'

  const exColor = kpi.expectancy == null ? 'text-slate-400'
    : kpi.expectancy > 0 ? 'text-emerald-400'
    : 'text-red-400'

  const streakColor = kpi.current_streak > 0 ? 'text-emerald-400'
    : kpi.current_streak < 0 ? 'text-red-400'
    : 'text-slate-400'

  const streakLabel = kpi.current_streak > 0
    ? `${kpi.current_streak}W streak`
    : kpi.current_streak < 0
    ? `${Math.abs(kpi.current_streak)}L streak`
    : 'No streak'

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      <div className="col-span-2 sm:col-span-2">
        <KPICard
          label="Disciplined WR"
          value={kpi.disciplined_wr != null ? `${kpi.disciplined_wr}%` : '—'}
          sub={kpi.raw_wr != null ? `${kpi.raw_wr}% all trades` : undefined}
          color={wrColor}
        />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <KPICard
          label="Expectancy"
          value={kpi.expectancy != null ? `${kpi.expectancy > 0 ? '+' : ''}${kpi.expectancy}` : '—'}
          sub={kpi.avg_win_pnl != null && kpi.avg_loss_pnl != null
            ? `W: +${kpi.avg_win_pnl} · L: ${kpi.avg_loss_pnl}`
            : undefined}
          color={exColor}
        />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <KPICard
          label="Profit Factor"
          value={kpi.profit_factor != null ? kpi.profit_factor.toFixed(2) : '—'}
          color={pfColor}
        />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <KPICard
          label="Current Streak"
          value={streakLabel}
          sub={`Best: ${kpi.best_win_streak}W  Worst: ${Math.abs(kpi.worst_loss_streak)}L`}
          color={streakColor}
        />
      </div>
      <div className="col-span-2 sm:col-span-2">
        <KPICard
          label="Total Trades"
          value={String(kpi.total_trades)}
          sub={`Disciplined: ${kpi.disciplined_trades}`}
        />
      </div>
    </div>
  )
}
