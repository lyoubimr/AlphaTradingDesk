// ── Tooltip component ──────────────────────────────────────────────────────
// Hover over the "?" icon to see the tooltip text.
// Uses position:fixed so the popup escapes sticky/overflow-auto parent containers
// (e.g. sticky thead inside overflow-y-auto table wrappers).
import { useState, useRef } from 'react'
import { HelpCircle } from 'lucide-react'
import { cn } from '../../lib/cn'

interface TooltipProps {
  text: string
  /** Width in pixels (default 240). */
  maxWidth?: number
  className?: string
}

export function Tooltip({ text, maxWidth = 240, className }: TooltipProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.top + r.height / 2, left: r.right + 8 })
    }
  }

  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={handleOpen}
        onMouseLeave={() => setPos(null)}
        onFocus={handleOpen}
        onBlur={() => setPos(null)}
        className="text-slate-500 hover:text-brand-400 transition-colors cursor-help"
        aria-label="More info"
      >
        <HelpCircle size={14} />
      </button>
      {pos && (
        <span
          className="fixed z-[9999] text-xs leading-relaxed bg-surface-700 text-slate-200 border border-surface-500 rounded-lg px-3 py-2 shadow-xl"
          style={{ width: `${maxWidth}px`, top: pos.top, left: pos.left, transform: 'translateY(-50%)' }}
        >
          {text}
        </span>
      )}
    </span>
  )
}

