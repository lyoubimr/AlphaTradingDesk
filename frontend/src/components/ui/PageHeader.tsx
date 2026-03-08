// ── PageHeader component ───────────────────────────────────────────────────
// Consistent page header: icon + title + optional badge + optional tooltip
import { type ReactNode } from 'react'
import { Badge } from './Badge'
import { InfoBubble } from './InfoBubble'

interface PageHeaderProps {
  icon: string          // emoji icon
  title: string
  subtitle?: string
  badge?: string        // e.g. "Phase 1" or "Coming Soon"
  badgeVariant?: 'default' | 'bull' | 'bear' | 'neutral' | 'soon' | 'phase'
  info?: string         // tooltip text
  actions?: ReactNode   // top-right slot
}

export function PageHeader({
  icon,
  title,
  subtitle,
  badge,
  badgeVariant = 'default',
  info,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-8">
      <div className="flex items-center gap-3">
        <span className="text-3xl leading-none select-none" aria-hidden="true">{icon}</span>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-100 leading-tight">{title}</h1>
            {badge && <Badge label={badge} variant={badgeVariant} />}
            {info && <InfoBubble text={info} />}
          </div>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
