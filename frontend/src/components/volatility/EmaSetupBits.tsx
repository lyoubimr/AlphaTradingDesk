// Small building blocks shared by the EMA setup rows (badges, pin and chart buttons).
import { ExternalLink, Flame, Loader2, Pin, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '../../lib/cn'
import { splitPair, toTradingViewSymbol } from '../../lib/krakenSymbols'
import { OUTCOME_META, PIN_TTL_LABEL, TIER_META, TV_INTERVAL } from '../../lib/emaSetups'
import type { EmaOutcome, EmaSetupTF, EmaSetupTier } from '../../types/api'

type Direction = 'long' | 'short'

export function DirectionIcon({ direction }: { direction: Direction }) {
  const long = direction === 'long'
  return (
    <span
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
        long ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400',
      )}
      title={long ? 'Long setup' : 'Short setup'}
    >
      {long ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
    </span>
  )
}

export function PairName({ pair }: { pair: string }) {
  const { base, quote, isPerp } = splitPair(pair)
  return (
    <>
      <span className="text-sm font-semibold text-slate-100">
        {base}<span className="font-normal text-slate-500">{quote ? `/${quote}` : ''}</span>
      </span>
      {isPerp && (
        <span className="rounded bg-surface-700/70 px-1 text-[9px] font-medium tracking-wide text-slate-400">PERP</span>
      )}
    </>
  )
}

export function TierBadge({ tier, direction, label }: { tier: EmaSetupTier; direction: Direction; label?: string }) {
  const long = direction === 'long'
  const style =
    tier === 'prime'
      ? long
        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_-2px_rgba(16,185,129,0.55)]'
        : 'border-rose-400/60 bg-rose-500/15 text-rose-300 shadow-[0_0_12px_-2px_rgba(244,63,94,0.55)]'
      : tier === 'fresh'
        ? long ? 'border-sky-500/40 bg-sky-500/10 text-sky-300' : 'border-orange-500/40 bg-orange-500/10 text-orange-300'
        : 'border-surface-600 bg-surface-700/60 text-slate-300'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', style)} title={TIER_META[tier].hint}>
      {tier === 'prime' && <Flame size={10} />}
      {TIER_META[tier].label}{label ? ` · ${label}` : ''}
    </span>
  )
}

const OUTCOME_STYLE: Record<EmaOutcome, string> = {
  holding: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
  neutral: 'border-surface-600 bg-surface-700/60 text-slate-300',
  unknown: 'border-dashed border-surface-600 text-slate-500',
}

export function OutcomeBadge({ outcome, nowLabel }: { outcome: EmaOutcome; nowLabel: string }) {
  return (
    <span
      className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', OUTCOME_STYLE[outcome])}
      title={`${OUTCOME_META[outcome].hint} Now: ${nowLabel}.`}
    >
      {OUTCOME_META[outcome].label}
    </span>
  )
}

export function RowActions({ pair, timeframe, pinned, busy, onTogglePin }: {
  pair: string
  timeframe: EmaSetupTF
  pinned: boolean
  busy: boolean
  onTogglePin: () => void
}) {
  const tvUrl =
    `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(toTradingViewSymbol(pair))}` +
    `&interval=${TV_INTERVAL[timeframe]}`
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <a
        href={tvUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-surface-700 hover:text-brand-400"
        title="Open on TradingView"
      >
        <ExternalLink size={14} />
      </a>
      <button
        type="button"
        onClick={onTogglePin}
        disabled={busy}
        className={cn(
          'rounded-md p-1.5 transition-colors disabled:opacity-50',
          pinned ? 'text-amber-400 hover:bg-amber-400/10' : 'text-slate-500 hover:bg-surface-700 hover:text-amber-300',
        )}
        title={pinned ? 'Pinned — click to unpin' : `Pin to watch (${PIN_TTL_LABEL[timeframe]})`}
        aria-pressed={pinned}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Pin size={14} className={pinned ? 'fill-amber-400' : ''} />}
      </button>
    </div>
  )
}
