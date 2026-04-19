// ── WRBarChart ───────────────────────────────────────────────────────────────
// Custom HTML horizontal bar rows — strategy / session / pair
import type { WRByStat } from '../../../types/api'

interface Props {
  data: WRByStat[]
  maxItems?: number
}

export function WRBarChart({ data, maxItems = 12 }: Props) {
  // Composite score: volume × win-rate — rewards both high-trade-count AND high-WR
  const active = data
    .filter(d => d.trades > 0)
    .sort((a, b) =>
      (b.trades * (b.wr_pct ?? 50)) - (a.trades * (a.wr_pct ?? 50))
    )
    .slice(0, maxItems)

  if (active.length === 0) return (
    <div className="text-slate-600 text-sm py-8 text-center">No data</div>
  )

  const maxTrades = active[0].trades

  return (
    <div className="space-y-1.5">
      {active.map(row => {
        const wr = row.wr_pct ?? 0
        const pnl = row.avg_pnl ?? 0
        const barColor = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'
        const pnlColor = pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
        const barPct = Math.round(wr)
        const widthPct = (row.trades / maxTrades) * 100

        return (
          <div key={row.label} className="flex items-center gap-2 group hover:bg-surface-800/60 rounded-lg px-2 py-1.5 transition-colors">
            {/* Label */}
            <div className="w-24 shrink-0 truncate text-xs text-slate-400 group-hover:text-slate-200 transition-colors text-right pr-1.5">
              {row.label}
            </div>
            {/* Bar track */}
            <div className="flex-1 h-5 bg-surface-700 rounded relative overflow-hidden">
              <div
                className="h-full rounded transition-all duration-500"
                style={{ width: `${barPct}%`, background: barColor, opacity: 0.85 }}
              />
              {/* Volume indicator under bar */}
              <div
                className="absolute bottom-0 left-0 h-0.5 rounded opacity-30"
                style={{ width: `${widthPct}%`, background: barColor }}
              />
            </div>
            {/* WR% */}
            <span className="w-10 shrink-0 text-xs font-bold tabular-nums text-right" style={{ color: barColor }}>
              {wr.toFixed(0)}%
            </span>
            {/* Trades */}
            <span className="w-14 shrink-0 text-[10px] text-slate-500 tabular-nums text-right">
              {row.trades}tr
            </span>
            {/* Avg PnL */}
            <span className={`w-16 shrink-0 text-[10px] font-medium tabular-nums text-right ${pnlColor}`}>
              {pnl >= 0 ? '+$' : '-$'}{Math.abs(pnl).toFixed(0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

