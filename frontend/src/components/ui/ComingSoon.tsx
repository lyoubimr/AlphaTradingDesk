// ── ComingSoon block ───────────────────────────────────────────────────────
// Used inside placeholder pages to indicate a feature is in progress.
import { Construction } from 'lucide-react'
import { cn } from '../../lib/cn'

interface ComingSoonProps {
  feature?: string
  phase?: string
  className?: string
}

export function ComingSoon({ feature, phase, className }: ComingSoonProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center gap-4 py-20',
      'rounded-2xl border border-dashed border-surface-600 bg-surface-800/40',
      'text-slate-600',
      className,
    )}>
      <Construction size={40} strokeWidth={1.2} className="text-surface-500" />
      <div className="text-center">
        <p className="text-sm font-medium text-slate-500">
          {feature ?? 'This feature'} is under construction
        </p>
        {phase && (
          <p className="text-xs text-slate-600 mt-1">Planned for {phase}</p>
        )}
      </div>
    </div>
  )
}
