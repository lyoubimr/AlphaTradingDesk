// ── StatCard component ─────────────────────────────────────────────────────
// KPI card used on the Dashboard (and possibly other pages).
import { type ReactNode } from 'react'
import { InfoBubble } from './InfoBubble'
import { cn } from '../../lib/cn'

interface StatCardProps {
  label: string
  value: ReactNode
  sub?: string
  info?: string
  accent?: 'bull' | 'bear' | 'neutral' | 'brand' | 'blue'
  /** Override value font size. Default: 'text-2xl'. Use 'text-base' or 'text-sm' for long values. */
  valueSize?: string
  className?: string
}

const accentBorder: Record<string, string> = {
  bull:    'border-t-green-500',
  bear:    'border-t-red-500',
  neutral: 'border-t-amber-500',
  brand:   'border-t-brand-500',
  blue:    'border-t-blue-500',
}

export function StatCard({ label, value, sub, info, accent, valueSize, className }: StatCardProps) {
  return (
    <div className={cn(
      'rounded-xl bg-surface-800 border border-surface-700 p-4',
      'flex flex-col gap-1',
      accent ? `border-t-2 ${accentBorder[accent]}` : '',
      className,
    )}>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          {label}
        </span>
        {info && <InfoBubble text={info} />}
      </div>
      <div className={cn(valueSize ?? 'text-2xl', 'font-semibold text-slate-100 tabular-nums')}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-slate-500">{sub}</div>
      )}
    </div>
  )
}
