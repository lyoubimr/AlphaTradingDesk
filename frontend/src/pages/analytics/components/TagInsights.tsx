// ── TagInsights ───────────────────────────────────────────────────────────
// Side-by-side: top tags on winners vs top tags on losers, with tag tooltips
import type { TagFrequency } from '../../../types/api'

// Explanations for known tristate / special review tags
const TAG_TOOLTIPS: Record<string, string> = {
  smart_exit: '⏩ Smart early exit — intentional, disciplined close before TP (cutting loss or locking gains at logical level)',
  early_exit: '⚠️ Bad early exit — undisciplined panic exit before TP, driven by emotion not plan',
  revenge_trade: '💢 Trade entered to recover a loss immediately — not in the trading plan',
  fomo: '📈 Entered out of fear of missing a move, without waiting for confirmation',
  over_leveraged: '⚡ Position size exceeded the risk plan for this trade',
  add_to_winner: '✅ Scaled into a profitable trade at a logical level',
  news_driven: '📰 Trade triggered or affected by a news event',
}

interface Props {
  winners: TagFrequency[]
  losers: TagFrequency[]
}

function TagTooltipLabel({ tag }: { tag: string }) {
  const tip = TAG_TOOLTIPS[tag]
  const label = tag.replace(/_/g, ' ')
  if (!tip) return <span className="text-xs text-slate-300 truncate">{label}</span>
  return (
    <span className="group relative inline-flex items-center gap-0.5">
      <span className="text-xs text-slate-300 truncate">{label}</span>
      <span className="text-slate-700 cursor-help text-[9px] ml-0.5">ⓘ</span>
      <span className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity
        absolute bottom-full left-0 mb-1.5 z-50 w-64 rounded-lg
        bg-surface-700 border border-surface-600 px-2.5 py-2
        text-[11px] text-slate-300 shadow-xl pointer-events-none leading-snug whitespace-normal">
        {tip}
      </span>
    </span>
  )
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
              <TagTooltipLabel tag={t.tag} />
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

interface Props {
  winners: TagFrequency[]
  losers: TagFrequency[]
}
