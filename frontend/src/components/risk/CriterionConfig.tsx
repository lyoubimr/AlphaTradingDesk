// ── CriterionConfig ──────────────────────────────────────────────────────────
// Reusable row: enabled toggle + label + weight input for a single risk criterion.

import { cn } from '../../lib/cn'

interface CriterionConfigProps {
  label: string
  enabled: boolean
  weight: number
  onToggle: (enabled: boolean) => void
  onWeightChange: (weight: number) => void
}

export function CriterionConfig({
  label,
  enabled,
  weight,
  onToggle,
  onWeightChange,
}: CriterionConfigProps) {
  return (
    <div className="flex items-center gap-4 py-2.5 border-b border-zinc-800 last:border-0">
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          enabled ? 'bg-emerald-500' : 'bg-zinc-700',
        )}
        title={enabled ? 'Disable criterion' : 'Enable criterion'}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            enabled ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>

      <span className={cn('flex-1 text-sm', enabled ? 'text-zinc-200' : 'text-zinc-500')}>
        {label}
      </span>

      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500">Weight</label>
        <input
          type="number"
          min={0.01}
          max={1}
          step={0.05}
          value={weight}
          disabled={!enabled}
          onChange={e => onWeightChange(parseFloat(e.target.value) || 0)}
          className="w-20 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-sm text-zinc-200 text-right disabled:opacity-40"
        />
      </div>
    </div>
  )
}
