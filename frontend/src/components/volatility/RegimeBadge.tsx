// ── RegimeBadge ─────────────────────────────────────────────────────────────
// Colored badge + emoji + tooltip for a VI regime label.

import { cn } from '../../lib/cn'
import type { VIRegime } from '../../types/api'

export interface RegimeConfig {
  label: string
  emoji: string
  border: string
  bg: string
  text: string
  tooltip: string
}

const REGIME_MAP: Record<string, RegimeConfig> = {
  DEAD: {
    label: 'DEAD',     emoji: '⬜',
    border: 'border border-zinc-500', bg: 'bg-zinc-900/80', text: 'text-zinc-300',
    tooltip: 'Dead market — Avoid · Zero volume, volatility collapsed',
  },
  CALM: {
    label: 'CALM',     emoji: '💧',
    border: 'border border-sky-600',  bg: 'bg-sky-950/80',  text: 'text-sky-300',
    tooltip: 'Calm market — Cautious scalping · Low momentum, reduce size',
  },
  NORMAL: {
    label: 'NORMAL',   emoji: '✅',
    border: 'border border-emerald-600', bg: 'bg-emerald-950/80', text: 'text-emerald-300',
    tooltip: 'Normal conditions — Standard strategy · Good liquidity',
  },
  TRENDING: {
    label: 'TRENDING', emoji: '📈',
    border: 'border border-yellow-500', bg: 'bg-yellow-950/80', text: 'text-yellow-300',
    tooltip: 'Trending market — Favor trend-following · High momentum',
  },
  ACTIVE: {
    label: 'ACTIVE',   emoji: '⚡',
    border: 'border border-orange-500', bg: 'bg-orange-950/80', text: 'text-orange-300',
    tooltip: 'Active market — Frequent breakouts · Tight risk management',
  },
  EXTREME: {
    label: 'EXTREME',  emoji: '🔥',
    border: 'border border-red-500',   bg: 'bg-red-950/80',   text: 'text-red-300',
    tooltip: 'Extreme volatility — Reduce positions · Gaps and false breakouts likely',
  },
}

const FALLBACK: RegimeConfig = {
  label: '—',     emoji: '',
  border: 'border border-zinc-700', bg: 'bg-zinc-900', text: 'text-zinc-500',
  tooltip: 'Unknown regime',
}

interface Props {
  regime: VIRegime | string
  size?: 'sm' | 'md' | 'lg'
  showTooltip?: boolean
  showEmoji?: boolean
}

export function RegimeBadge({ regime, size = 'md', showTooltip = true, showEmoji = true }: Props) {
  const cfg = REGIME_MAP[regime] ?? FALLBACK

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs gap-1',
    md: 'px-2.5 py-1 text-xs font-semibold gap-1.5',
    lg: 'px-3.5 py-1.5 text-sm font-bold gap-2',
  }[size]

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full tracking-wide',
        cfg.bg, cfg.border, cfg.text, sizeClasses,
      )}
      title={showTooltip ? cfg.tooltip : undefined}
    >
      {showEmoji && cfg.emoji && <span className="leading-none">{cfg.emoji}</span>}
      {cfg.label}
    </span>
  )
}
