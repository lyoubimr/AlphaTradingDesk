// ── InfoBubble component ───────────────────────────────────────────────────
// Small "?" icon that shows a tooltip on hover/focus. Accessible.
import { useState } from 'react'
import { Info } from 'lucide-react'
import { cn } from '../../lib/cn'

interface InfoBubbleProps {
  text: string
  side?: 'right' | 'left' | 'top'
  className?: string
}

export function InfoBubble({ text, side = 'right', className }: InfoBubbleProps) {
  const [open, setOpen] = useState(false)

  const positionClass =
    side === 'right' ? 'left-6 top-1/2 -translate-y-1/2' :
    side === 'left'  ? 'right-6 top-1/2 -translate-y-1/2' :
                       'bottom-6 left-1/2 -translate-x-1/2'

  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-600 hover:text-brand-400 transition-colors cursor-help outline-none"
        aria-label="More information"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={cn(
            'absolute z-50 w-64 text-xs leading-relaxed',
            'bg-surface-700 text-slate-300 border border-surface-500',
            'rounded-lg px-3 py-2 shadow-2xl shadow-black/60',
            'pointer-events-none whitespace-normal',
            positionClass,
          )}
        >
          {text}
        </span>
      )}
    </span>
  )
}
