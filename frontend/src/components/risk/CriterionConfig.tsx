// ── CriterionConfig ──────────────────────────────────────────────────────────
// Reusable row: enabled toggle + label + weight slider (%) for a single risk criterion.

import { cn } from '../../lib/cn'

interface CriterionConfigProps {
  label: string
  enabled: boolean
  weight: number          // stored as 0.0 – 1.0; displayed as integer %
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
  const pct = Math.round(weight * 100)

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-surface-700 last:border-none">
      {/* Toggle */}
      <button
        type="button"
        onClick={() => onToggle(!enabled)}
        className={cn(
          'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
          enabled ? 'bg-brand-500' : 'bg-surface-600',
        )}
        title={enabled ? 'Disable criterion' : 'Enable criterion'}
      >
        <span
          className={cn(
            'pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
            enabled ? 'translate-x-4' : 'translate-x-1',
          )}
        />
      </button>

      {/* Label */}
      <span className={cn('flex-1 text-xs', enabled ? 'text-slate-300' : 'text-slate-600')}>
        {label}
      </span>

      {/* Weight slider + % display */}
      <div className={cn('flex items-center gap-2 shrink-0', !enabled && 'opacity-40')}>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct}
          disabled={!enabled}
          onChange={e => onWeightChange(parseInt(e.target.value) / 100)}
          className="w-24 accent-brand-500"
        />
        <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{pct}%</span>
      </div>
    </div>
  )
}
