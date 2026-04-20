// ── RepeatErrors ──────────────────────────────────────────────────────────
// Table of repeat mistake tags ranked by occurrence count
import type { RepeatError } from '../../../types/api'

interface Props { data: RepeatError[] }

export function RepeatErrors({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-slate-500 text-sm py-6 text-center">
        No repeat errors detected — great discipline!
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      {data.map((err, i) => {
        const intensity = Math.min(err.error_count / (data[0]?.error_count ?? 1), 1)
        const barWidth = Math.round(intensity * 100)
        return (
          <div
            key={err.tag}
            className="rounded-lg px-3 py-2 border border-red-950/50 bg-red-950/10 hover:bg-red-950/20 transition-colors group"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] font-bold text-red-900 w-4 shrink-0">#{i + 1}</span>
                <span className="text-sm text-slate-200 truncate capitalize">{err.tag.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-sm font-bold text-red-400">{err.error_count}×</span>
                {err.last_seen && (
                  <span className="text-[10px] text-slate-600">
                    {new Date(err.last_seen).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  </span>
                )}
              </div>
            </div>
            {/* Intensity bar */}
            <div className="h-0.5 w-full bg-red-950/40 rounded-full">
              <div
                className="h-0.5 rounded-full bg-red-500/60 transition-all duration-500"
                style={{ width: `${barWidth}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
