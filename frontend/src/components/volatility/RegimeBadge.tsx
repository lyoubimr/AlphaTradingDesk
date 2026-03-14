// ── RegimeBadge ─────────────────────────────────────────────────────────────
// Colored badge + tooltip for a VI regime label.
// No emoji prefix — color conveys meaning per spec.

import { cn } from '../../lib/cn'
import type { VIRegime } from '../../types/api'

export interface RegimeConfig {
  label: string
  color: string   // Tailwind bg class
  text: string    // Tailwind text class
  tooltip: string
}

const REGIME_MAP: Record<string, RegimeConfig> = {
  // English labels — returned by backend score_to_regime()
  DEAD: {
    label: 'DEAD',
    color: 'bg-zinc-700',
    text: 'text-zinc-300',
    tooltip: 'Dead market — Avoid · Zero volume, volatility collapsed',
  },
  CALM: {
    label: 'CALM',
    color: 'bg-sky-900',
    text: 'text-sky-300',
    tooltip: 'Calm market — Cautious scalping · Low momentum, reduce size',
  },
  NORMAL: {
    label: 'NORMAL',
    color: 'bg-emerald-900',
    text: 'text-emerald-300',
    tooltip: 'Normal conditions — Standard strategy · Good liquidity',
  },
  TRENDING: {
    label: 'TRENDING',
    color: 'bg-yellow-900',
    text: 'text-yellow-300',
    tooltip: 'Trending market — Favor trend-following · High momentum',
  },
  ACTIVE: {
    label: 'ACTIVE',
    color: 'bg-orange-900',
    text: 'text-orange-300',
    tooltip: 'Active market — Frequent breakouts · Tight risk management',
  },
  EXTREME: {
    label: 'EXTREME',
    color: 'bg-red-900',
    text: 'text-red-300',
    tooltip: 'Extreme volatility — Reduce positions · Gaps and false breakouts likely',
  },
}

const FALLBACK: RegimeConfig = {
  label: '—',
  color: 'bg-zinc-800',
  text: 'text-zinc-400',
  tooltip: 'Unknown regime',
}

interface Props {
  regime: VIRegime | string
  size?: 'sm' | 'md' | 'lg'
  showTooltip?: boolean
}

export function RegimeBadge({ regime, size = 'md', showTooltip = true }: Props) {
  const cfg = REGIME_MAP[regime] ?? FALLBACK

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs font-semibold',
    lg: 'px-3 py-1.5 text-sm font-semibold',
  }[size]

  return (
    <span
      className={cn('inline-block rounded-full tracking-wide', cfg.color, cfg.text, sizeClasses)}
      title={showTooltip ? cfg.tooltip : undefined}
    >
      {cfg.label}
    </span>
  )
}
