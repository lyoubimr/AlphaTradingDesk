// ── TPHitRateChart ────────────────────────────────────────────────────────────
// Stat cards: TP1 / TP2 / TP3 — hero metric is hits/total (not the %)
// TP1 also shows early_exits: trades closed before reaching TP1.
import type { TPHitRate } from '../../../types/api'

interface Props { data: TPHitRate[] }

const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa']

export function TPHitRateChart({ data }: Props) {
  if (data.length === 0) return (
    <div className="text-slate-600 text-sm py-8 text-center">No TP data</div>
  )

  return (
    <div className="grid grid-cols-3 gap-3">
      {data.map((d, i) => {
        const pct = d.hit_rate_pct ?? 0
        const color = COLORS[i] ?? '#6366f1'
        const qualityColor = pct >= 60 ? 'text-emerald-400' : pct >= 40 ? 'text-amber-400' : 'text-red-400'
        const earlyExits = d.tp_number === 1 ? (d.early_exits ?? 0) : 0
        return (
          <div
            key={d.tp_number}
            className="bg-surface-800 border border-surface-700 rounded-xl p-4 flex flex-col items-center gap-2.5 hover:border-surface-600 transition-colors"
          >
            {/* Label */}
            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color }}>
              TP {d.tp_number}
            </span>
            {/* Hero: hits / total */}
            <div className="flex items-baseline gap-1">
              <span className={`text-3xl font-bold tabular-nums leading-none ${qualityColor}`}>
                {d.hits}
              </span>
              <span className="text-base font-semibold text-slate-500 tabular-nums">
                / {d.total}
              </span>
            </div>
            {/* Label under hero */}
            <span className="text-[10px] text-slate-500 text-center leading-snug">
              {d.tp_number === 1
                ? 'trades reached TP1'
                : `of TP${d.tp_number - 1} hits reached TP${d.tp_number}`}
            </span>
            {/* Early exits badge — TP1 only */}
            {earlyExits > 0 && (
              <span className="text-[10px] text-amber-500/80 tabular-nums">
                {earlyExits} closed before TP1
              </span>
            )}
            {/* Progress bar + % */}
            <div className="w-full space-y-1">
              <div className="w-full h-1.5 rounded-full bg-surface-700">
                <div
                  className="h-1.5 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(pct, 100)}%`, background: color }}
                />
              </div>
              <div className="text-right text-[10px] font-medium tabular-nums" style={{ color }}>
                {pct.toFixed(0)}%
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
