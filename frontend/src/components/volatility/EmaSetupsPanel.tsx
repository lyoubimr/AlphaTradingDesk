// ── EmaSetupsPanel ────────────────────────────────────────────────────────────
// Top breakout / retest setups on each timeframe's reference EMA (1D · 4H · 1H),
// with one-click pinning. Used on the Dashboard, the Ritual and the Watchlists page.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ChevronDown, ChevronRight, ExternalLink, Flame, Loader2,
  Pin, RefreshCw, TrendingDown, TrendingUp, Zap,
} from 'lucide-react'
import { ritualApi, volatilityApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import { splitPair, toTradingViewSymbol } from '../../lib/krakenSymbols'
import {
  PIN_TTL_LABEL, TIER_META, TV_INTERVAL, formatAge, setupKey, signalLabel, splitNewSetups,
} from '../../lib/emaSetups'
import { Tooltip } from '../ui/Tooltip'
import type { EmaSetupOut, EmaSetupTF, EmaSetupsOut, PinnedTF } from '../../types/api'

interface Props {
  profileId: number
  isSpot: boolean
  /** Rows per timeframe (default 5). */
  top?: number
  /** Adds a collapse chevron to the header (state is remembered). */
  collapsible?: boolean
  /** Show the "View all" link to the Watchlists page. */
  showViewAll?: boolean
  /** Reload when this value changes (e.g. after a pin made elsewhere). */
  refreshKey?: number
  onPinsChanged?: () => void
  className?: string
}

const TFS_CONTRACTS: EmaSetupTF[] = ['1D', '4H', '1H']
const TFS_SPOT: EmaSetupTF[] = ['1D', '4H']
const REFRESH_MS = 5 * 60 * 1000

const REGIME_COLOR: Record<string, string> = {
  dead: '#64748b', calm: '#38bdf8', normal: '#a3a3a3', trending: '#34d399', active: '#fbbf24', explosive: '#f87171',
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

// ── Row ──────────────────────────────────────────────────────────────────────

function SetupRow({ setup, isNew, busy, onTogglePin }: {
  setup: EmaSetupOut
  isNew: boolean
  busy: boolean
  onTogglePin: (s: EmaSetupOut) => void
}) {
  const { base, quote, isPerp } = splitPair(setup.pair)
  const long = setup.direction === 'long'
  const pinned = setup.pin_id != null
  const regimeColor = REGIME_COLOR[setup.regime] ?? '#a3a3a3'
  const tvUrl =
    `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(toTradingViewSymbol(setup.pair))}` +
    `&interval=${TV_INTERVAL[setup.timeframe]}`

  const badgeStyle =
    setup.tier === 'prime'
      ? long
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-400/60 shadow-[0_0_12px_-2px_rgba(16,185,129,0.55)]'
        : 'bg-rose-500/15 text-rose-300 border-rose-400/60 shadow-[0_0_12px_-2px_rgba(244,63,94,0.55)]'
      : setup.tier === 'fresh'
        ? long ? 'bg-sky-500/10 text-sky-300 border-sky-500/40' : 'bg-orange-500/10 text-orange-300 border-orange-500/40'
        : 'bg-surface-700/60 text-slate-300 border-surface-600'

  return (
    <li
      className={cn(
        'group relative flex items-center gap-3 rounded-lg border pl-3 pr-2 py-2 transition-colors',
        'border-surface-700/70 bg-surface-900/40 hover:bg-surface-800/80 hover:border-surface-600',
        setup.tier === 'prime' && (long ? 'border-l-2 border-l-emerald-400' : 'border-l-2 border-l-rose-400'),
      )}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
          long ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400',
        )}
        title={long ? 'Long setup' : 'Short setup'}
      >
        {long ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold text-slate-100">
            {base}<span className="text-slate-500 font-normal">{quote ? `/${quote}` : ''}</span>
          </span>
          {isPerp && <span className="rounded bg-surface-700/70 px-1 text-[9px] font-medium tracking-wide text-slate-400">PERP</span>}
          <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', badgeStyle)}>
            {setup.tier === 'prime' && <Flame size={10} />}
            {TIER_META[setup.tier].label} · {signalLabel(setup.signal)}
          </span>
          {isNew && setup.tier !== 'retest' && (
            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-300">NEW</span>
          )}
        </div>
        <p className="mt-0.5 text-[10px] text-slate-500">
          vs EMA{setup.ema_ref_period} · {setup.timeframe}
        </p>
      </div>

      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <div className="w-20" title={`Volatility ${setup.vi_score.toFixed(2)} · ${setup.regime}`}>
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-mono text-slate-300">{setup.vi_score.toFixed(2)}</span>
            <span style={{ color: regimeColor }} className="capitalize">{setup.regime}</span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-surface-700">
            <div className="h-1 rounded-full" style={{ width: `${Math.min(setup.vi_score, 1) * 100}%`, background: regimeColor }} />
          </div>
        </div>
        <span
          className={cn(
            'w-14 text-right font-mono text-[11px]',
            setup.change_24h == null ? 'text-slate-600' : setup.change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400',
          )}
          title="24h change"
        >
          {setup.change_24h == null ? '—' : `${setup.change_24h >= 0 ? '+' : ''}${setup.change_24h.toFixed(2)}%`}
        </span>
      </div>

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
          onClick={() => onTogglePin(setup)}
          disabled={busy}
          className={cn(
            'rounded-md p-1.5 transition-colors disabled:opacity-50',
            pinned ? 'text-amber-400 hover:bg-amber-400/10' : 'text-slate-500 hover:bg-surface-700 hover:text-amber-300',
          )}
          title={pinned ? 'Pinned — click to unpin' : `Pin to watch (${PIN_TTL_LABEL[setup.timeframe]})`}
          aria-pressed={pinned}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Pin size={14} className={pinned ? 'fill-amber-400' : ''} />}
        </button>
      </div>
    </li>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function EmaSetupsPanel({
  profileId, isSpot, top = 5, collapsible = false, showViewAll = false, refreshKey = 0, onPinsChanged, className,
}: Props) {
  const tfs = isSpot ? TFS_SPOT : TFS_CONTRACTS
  const tfStorageKey = 'atd.emaSetups.tf'
  const openStorageKey = `atd.emaSetups.open.${profileId}`
  const seenStorageKey = `atd.emaSetups.seen.${profileId}`

  const [data, setData] = useState<EmaSetupsOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [newKeys, setNewKeys] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<boolean>(() => !collapsible || readJson<boolean>(openStorageKey, true))
  const [activeTf, setActiveTf] = useState<EmaSetupTF>(() => {
    const saved = readJson<string>(tfStorageKey, '4H')
    return (tfs as string[]).includes(saved) ? (saved as EmaSetupTF) : tfs[0]
  })
  const loadSeq = useRef(0)

  const load = useCallback(async (silent: boolean) => {
    const seq = ++loadSeq.current
    if (silent) setRefreshing(true)
    try {
      const res = await volatilityApi.getEmaSetups(profileId, top, tfs.map(t => t.toLowerCase()))
      if (seq !== loadSeq.current) return
      setData(res)
      setError(null)

      const keys = res.timeframes.flatMap(t => t.setups.filter(s => s.tier !== 'retest').map(setupKey))
      const { newKeys: fresh, nextSeen } = splitNewSetups(keys, readJson<Record<string, number>>(seenStorageKey, {}), Date.now())
      writeJson(seenStorageKey, nextSeen)
      // keep badges for the whole visit even though they are marked as seen right away
      setNewKeys(prev => new Set([...prev, ...fresh]))
    } catch (e) {
      if (seq === loadSeq.current) setError(e instanceof Error ? e.message : 'Failed to load setups')
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setRefreshing(false) }
    }
  }, [profileId, top, tfs, seenStorageKey])

  useEffect(() => { void load(false) }, [load, refreshKey])

  useEffect(() => {
    const id = window.setInterval(() => { void load(true) }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const current = useMemo(() => data?.timeframes.find(t => t.timeframe === activeTf), [data, activeTf])

  const chooseTf = (tf: EmaSetupTF) => { setActiveTf(tf); writeJson(tfStorageKey, tf) }
  const toggleOpen = () => { const next = !open; setOpen(next); writeJson(openStorageKey, next) }

  const togglePin = async (setup: EmaSetupOut) => {
    const key = setupKey(setup)
    setBusyKey(key)
    setActionError(null)
    try {
      let pinId: number | null
      if (setup.pin_id != null) {
        await ritualApi.removePinned(profileId, setup.pin_id)
        pinId = null
      } else {
        const created = await ritualApi.addPinned(profileId, {
          pair: setup.pair, timeframe: setup.timeframe as PinnedTF, note: null, source: 'watchlist',
        })
        pinId = created.id
      }
      setData(prev => prev && {
        ...prev,
        timeframes: prev.timeframes.map(t => t.timeframe !== setup.timeframe ? t : {
          ...t,
          setups: t.setups.map(s => s.pair === setup.pair ? { ...s, pin_id: pinId } : s),
        }),
      })
      onPinsChanged?.()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Pin action failed')
    } finally {
      setBusyKey(null)
    }
  }

  const prime = data?.prime_total ?? 0
  const refEmas = isSpot ? '1D: EMA99 · 4H: EMA200' : '1D / 1H: EMA99 · 4H: EMA200'

  return (
    <section className={cn('rounded-xl border border-surface-700 bg-surface-800 overflow-hidden', className)}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <button
          type="button"
          onClick={collapsible ? toggleOpen : undefined}
          className={cn('flex min-w-0 items-center gap-2 text-left', collapsible ? 'cursor-pointer' : 'cursor-default')}
          aria-expanded={open}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400"><Zap size={15} /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              EMA Setups
              {prime > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                  {prime} prime
                </span>
              )}
            </span>
            <span className="block truncate text-[10px] text-slate-500">Breakouts &amp; retests on the key EMA · {refEmas}</span>
          </span>
          {collapsible && (open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />)}
        </button>

        <div className="ml-auto flex items-center gap-2">
          {current?.generated_at && (
            <span
              className={cn('hidden items-center gap-1 text-[10px] sm:flex', current.is_stale ? 'text-amber-400' : 'text-slate-500')}
              title={current.is_stale ? 'The latest snapshot is older than expected — the next analysis run may be late.' : 'Time since the latest volatility snapshot (not real-time).'}
            >
              {current.is_stale && <AlertTriangle size={10} />}
              {current.is_stale ? 'Stale · ' : 'Updated '}{formatAge(current.age_minutes)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={refreshing || loading}
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-surface-700 hover:text-slate-200 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <Tooltip
            maxWidth={300}
            text={`Prime: ${TIER_META.prime.hint}  Fresh: ${TIER_META.fresh.hint}  Retest: ${TIER_META.retest.hint}  Ranked by tier, then volatility. Dead markets are hidden.`}
          />
        </div>
      </div>

      {open && (
        <div className="border-t border-surface-700/70 px-4 pb-4 pt-3">
          {/* Timeframe tabs */}
          <div role="tablist" className="mb-3 flex items-center gap-1.5">
            {tfs.map(tf => {
              const t = data?.timeframes.find(x => x.timeframe === tf)
              const active = tf === activeTf
              return (
                <button
                  key={tf}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => chooseTf(tf)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors',
                    active
                      ? 'border-brand-500/60 bg-brand-500/15 text-brand-300'
                      : 'border-surface-700 text-slate-500 hover:border-surface-600 hover:text-slate-300',
                  )}
                >
                  {tf}
                  {t && t.total > 0 && (
                    <span className={cn('rounded-full px-1.5 text-[10px]', t.prime_total > 0 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-surface-700 text-slate-400')}>
                      {t.prime_total > 0 ? `🔥${t.prime_total}` : t.total}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Body */}
          {loading && !data ? (
            <ul className="space-y-2" aria-busy="true">
              {Array.from({ length: Math.min(top, 4) }).map((_, i) => (
                <li key={i} className="h-[46px] animate-pulse rounded-lg bg-surface-700/40" />
              ))}
            </ul>
          ) : error ? (
            <div className="flex items-center gap-2 rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-xs text-red-300">
              <AlertTriangle size={13} className="shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => void load(false)} className="font-semibold underline underline-offset-2">Retry</button>
            </div>
          ) : current && current.setups.length > 0 ? (
            <>
              <ul className="space-y-1.5">
                {current.setups.map(s => (
                  <SetupRow
                    key={setupKey(s)}
                    setup={s}
                    isNew={newKeys.has(setupKey(s))}
                    busy={busyKey === setupKey(s)}
                    onTogglePin={togglePin}
                  />
                ))}
              </ul>
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                <span>Showing {current.setups.length} of {current.total} on {activeTf}</span>
                {showViewAll && (
                  <Link to="/volatility/pairs" className="flex items-center gap-0.5 text-brand-400 hover:text-brand-300">
                    All watchlists <ChevronRight size={10} />
                  </Link>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-surface-700 px-4 py-6 text-center">
              <p className="text-xs text-slate-400">
                {current?.generated_at
                  ? `No breakout or retest on the EMA${activeTf === '4H' ? 200 : 99} right now on ${activeTf}.`
                  : `No volatility snapshot for ${activeTf} yet — run the pair analysis first.`}
              </p>
              {current?.generated_at && (
                <p className="mt-1 text-[10px] text-slate-600">
                  Checked {formatAge(current.age_minutes)} — setups appear after a candle closes near the EMA.
                </p>
              )}
            </div>
          )}

          {actionError && <p className="mt-2 text-[11px] text-red-400">{actionError}</p>}
        </div>
      )}
    </section>
  )
}
