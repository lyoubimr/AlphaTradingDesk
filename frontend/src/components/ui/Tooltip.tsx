// ── Tooltip component ──────────────────────────────────────────────────────
// Hover over the "?" icon to see the tooltip text.
import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { cn } from '../../lib/cn'

interface TooltipProps {
  text: string
  /** Width in pixels (default 240). */
  maxWidth?: number
  className?: string
}

export function Tooltip({ text, maxWidth = 240, className }: TooltipProps) {
  const [open, setOpen] = useState(false)

  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-brand-400 transition-colors cursor-help"
        aria-label="More info"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <span
          style={{ width: `${maxWidth}px` }}
          className="
            absolute left-5 top-1/2 -translate-y-1/2 z-50
            text-xs leading-relaxed
            bg-surface-700 text-slate-200 border border-surface-500
            rounded-lg px-3 py-2 shadow-xl
          "
        >
          {text}
        </span>
      )}
    </span>
  )
}
