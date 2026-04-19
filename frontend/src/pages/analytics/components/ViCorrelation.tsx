// ── ViCorrelation ────────────────────────────────────────────────────────────
// Trade performance segmented by Volatility Index bucket
import type { VIBucket } from '../../../types/api'
import { InfoTip } from './SummaryKPIs'

interface Props { data: VIBucket[] }

const BUCKET_META: Record<string, { label: string; range: string; color: string; bg: string; border: string }> = {
  Calm:    { label: 'Calm',    range: 'VI < 0.33',        color: '#10b981', bg: 'bg-emerald-950/30', border: 'border-emerald-900/40' },
  Normal:  { label: 'Normal',  range: '0.33 – 0.50',      color: '#3b82f6', bg: 'bg-blue-950/30',    border: 'border-blue-900/40' },
  Active:  { label: 'Active',  range: '0.50 – 0.67',      color: '#f59e0b', bg: 'bg-amber-950/30',   border: 'border-amber-900/40' },
  Extreme: { label: 'Extreme', range: 'VI ≥ 0.67',        color: '#ef4444', bg: 'bg-red-950/30',     border: 'border-red-900/40' },
}

export function ViCorrelation({ data }: Props) {
  if (!data || data.length === 0) return (
    <div className="text-slate-600 text-sm py-8 text-center">
      No volatility correlation data — VI snapshots may not overlap with your trades.
    </div>
  )

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-600 leading-relaxed">
        Performance split by market volatility at trade entry time (±3h window, 1h VI snapshot).
        <InfoTip text="Volatility Index (VI) score from your volatility snapshots. Buckets: Calm (<0.33), Normal (0.33-0.50), Active (0.50-0.67), Extreme (≥0.67)." />
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['Calm', 'Normal', 'Active', 'Extreme'] as const).map(bucket => {
          const d = data.find(b => b.bucket === bucket)
          const meta = BUCKET_META[bucket]
          if (!d) {
            return (
              <div
                key={bucket}
                className={`rounded-xl border ${meta.border} ${meta.bg} p-4 opacity-40`}
              >
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: meta.color }}>
                  {meta.label}
                </div>
                <div className="text-[10px] text-slate-600">{meta.range}</div>
                <div className="mt-3 text-slate-600 text-xs">No trades</div>
              </div>
            )
          }
          const wr = d.wr_pct ?? 0
          const pnl = d.avg_pnl ?? 0
          const pnlColor = pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
          const wrColor = wr >= 55 ? 'text-emerald-400' : wr >= 45 ? 'text-amber-400' : 'text-red-400'

          return (
            <div
              key={bucket}
              className={`rounded-xl border ${meta.border} ${meta.bg} p-4 hover:opacity-90 transition-opacity`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: meta.color }}>
                  {meta.label}
                </span>
                <span className="text-[9px] text-slate-600">{meta.range}</span>
              </div>
              {/* WR */}
              <div className={`text-3xl font-bold tabular-nums leading-tight mt-2 ${wrColor}`}>
                {wr.toFixed(0)}%
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">win rate</div>
              {/* Divider */}
              <div className="border-t border-surface-700 my-2.5" />
              {/* Stats row */}
              <div className="flex justify-between text-[11px]">
                <div>
                  <div className={`font-semibold tabular-nums ${pnlColor}`}>
                    {pnl >= 0 ? '+$' : '-$'}{Math.abs(pnl).toFixed(0)}
                  </div>
                  <div className="text-slate-600 text-[9px]">avg PnL</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold text-slate-300 tabular-nums">{d.trades}</div>
                  <div className="text-slate-600 text-[9px]">trades</div>
                </div>
              </div>
              {/* VI avg indicator */}
              {d.avg_vi != null && (
                <div className="mt-2">
                  <div className="h-1 bg-surface-700 rounded-full overflow-hidden">
                    <div
                      className="h-1 rounded-full"
                      style={{ width: `${Math.min(d.avg_vi * 100, 100)}%`, background: meta.color }}
                    />
                  </div>
                  <div className="text-[9px] text-slate-600 mt-0.5 text-right">
                    avg VI {d.avg_vi.toFixed(3)}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
