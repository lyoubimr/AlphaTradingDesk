// ── Badge component ────────────────────────────────────────────────────────
import { cn } from '../../lib/cn'

type BadgeVariant = 'default' | 'bull' | 'bear' | 'neutral' | 'soon' | 'phase'

interface BadgeProps {
  label: string
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-surface-600 text-slate-300 border border-surface-500',
  bull:    'bg-bull-dim/40 text-green-400 border border-green-700/40',
  bear:    'bg-bear-dim/40 text-red-400 border border-red-700/40',
  neutral: 'bg-amber-900/40 text-amber-400 border border-amber-700/40',
  soon:    'bg-surface-600 text-slate-500 border border-dashed border-surface-500 italic',
  phase:   'bg-brand-900/50 text-brand-400 border border-brand-700/50',
}

export function Badge({ label, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none tracking-wide',
      variantStyles[variant],
      className,
    )}>
      {label}
    </span>
  )
}
