// ── TagInsights ───────────────────────────────────────────────────────────
// Side-by-side: top tags on winners vs top tags on losers
import type { TagFrequency } from '../../../types/api'

interface Props {
  winners: TagFrequency[]
  losers: TagFrequency[]
}

function TagList({ tags, color }: { tags: TagFrequency[]; color: string }) {
  if (tags.length === 0) return <div className="text-slate-600 text-xs py-4 text-center">No data</div>
  const max = tags[0]?.count ?? 1
  return (
    <ul className="space-y-1.5">
      {tags.slice(0, 8).map(t => (
        <li key={t.tag} className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex justify-between mb-0.5">
              <span className="text-xs text-slate-300 truncate">{t.tag.replace(/_/g, ' ')}</span>
              <span className="text-xs text-slate-500 ml-2 shrink-0">{t.count}</span>
            </div>
            <div className="h-1 rounded-full bg-surface-800">
              <div
                className="h-1 rounded-full"
                style={{ width: `${(t.count / max) * 100}%`, background: color }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

export function TagInsights({ winners, losers }: Props) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
          Winning trades
        </div>
        <TagList tags={winners} color="#10b981" />
      </div>
      <div>
        <div className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">
          Losing trades
        </div>
        <TagList tags={losers} color="#ef4444" />
      </div>
    </div>
  )
}
