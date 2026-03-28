// ── AutomationStatusBadge ────────────────────────────────────────────────────
// Compact badge showing role + status for a Kraken order in trade lists / panels
// ────────────────────────────────────────────────────────────────────────────

import { cn } from '../../lib/cn'
import type { KrakenOrderRole, KrakenOrderStatus } from '../../types/api'

const ROLE_LABELS: Record<KrakenOrderRole, string> = {
  entry: 'Entry',
  sl:    'SL',
  tp1:   'TP1',
  tp2:   'TP2',
  tp3:   'TP3',
}

const STATUS_STYLES: Record<KrakenOrderStatus, string> = {
  open:      'bg-blue-500/15 border-blue-500/40 text-blue-300',
  filled:    'bg-emerald-500/15 border-emerald-500/40 text-emerald-300',
  cancelled: 'bg-slate-500/15 border-slate-500/40 text-slate-400',
  error:     'bg-red-500/15 border-red-500/40 text-red-300',
}

interface Props {
  role:   KrakenOrderRole
  status: KrakenOrderStatus
  size?:  'sm' | 'xs'
}

export function AutomationStatusBadge({ role, status, size = 'sm' }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-mono font-medium leading-none',
        size === 'xs' ? 'px-1 py-0.5 text-[10px]' : 'px-1.5 py-0.5 text-[11px]',
        STATUS_STYLES[status],
      )}
    >
      {ROLE_LABELS[role]}
      <span className="opacity-60">·</span>
      {status}
    </span>
  )
}
