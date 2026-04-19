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
    <div className="space-y-2">
      {data.map((err, i) => {
        const intensity = Math.min(err.count / (data[0]?.count ?? 1), 1)
        const bg = `rgba(239,68,68,${0.04 + intensity * 0.12})`
        return (
          <div
            key={err.tag}
            className="flex items-center justify-between rounded-lg px-3 py-2 border border-surface-800"
            style={{ background: bg }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-xs font-bold text-slate-500 w-4 shrink-0">#{i + 1}</span>
              <span className="text-sm text-slate-200 truncate">{err.tag.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-center gap-4 shrink-0 ml-3">
              <span className="text-sm font-semibold text-red-400">{err.count}×</span>
              {err.last_seen && (
                <span className="text-xs text-slate-600">
                  Last: {new Date(err.last_seen).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
