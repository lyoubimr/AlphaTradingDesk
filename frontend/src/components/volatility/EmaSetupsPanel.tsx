// ── EmaSetupsPanel ────────────────────────────────────────────────────────────
// Top breakout / retest setups on each timeframe's reference EMA (1D · 4H · 1H) plus the
// setups of the last hours/days, with follow-through and one-click pinning.
// Used on the Dashboard, the Ritual and the Watchlists page.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ChevronDown, ChevronRight, History, RefreshCw, Zap } from 'lucide-react'
import { ritualApi, volatilityApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import {
  TIER_META, filterEarlier, formatAge, setupKey, splitNewSetups, summarizeFollowThrough,
  type OutcomeFilter, type TierFilter,
} from '../../lib/emaSetups'
import { Tooltip } from '../ui/Tooltip'
import type { EmaSetupTF, EmaSetupsOut, PinnedTF } from '../../types/api'
import { ActiveRow, EarlierRow } from './EmaSetupRows'

interface Props {
  profileId: number
  isSpot: boolean
  /** Active rows per timeframe (default 5). */
  top?: number
  /** Earlier setups loaded per timeframe (default 15). */
  historyTop?: number
  /** Whether the "Earlier" section starts expanded (the user's last choice wins). */
  earlierOpenByDefault?: boolean
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
const EARLIER_PREVIEW = 6

const TIER_FILTERS: { value: TierFilter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'prime', label: 'Prime' },
  { value: 'fresh', label: 'Fresh' }, { value: 'retest', label: 'Retest' },
]
const OUTCOME_FILTERS: { value: OutcomeFilter; label: string }[] = [
  { value: 'all', label: 'Any outcome' }, { value: 'holding', label: 'Holding' }, { value: 'failed', label: 'Failed' },
]

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

function windowLabel(hours: number): string {
  return hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours} h`
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-[10px] font-semibold transition-colors',
        active ? 'border-brand-500/60 bg-brand-500/15 text-brand-300' : 'border-surface-700 text-slate-500 hover:border-surface-600 hover:text-slate-300',
      )}
    >
      {children}
    </button>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────

export function EmaSetupsPanel({
  profileId, isSpot, top = 5, historyTop = 15, earlierOpenByDefault = false, collapsible = false,
  showViewAll = false, refreshKey = 0, onPinsChanged, className,
}: Props) {
  const tfs = isSpot ? TFS_SPOT : TFS_CONTRACTS
  const tfStorageKey = 'atd.emaSetups.tf'
  const earlierStorageKey = 'atd.emaSetups.earlier'
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
  const [earlierOpen, setEarlierOpen] = useState<boolean>(() => readJson<boolean>(earlierStorageKey, earlierOpenByDefault))
  const [showAllEarlier, setShowAllEarlier] = useState(false)
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all')
  const [activeTf, setActiveTf] = useState<EmaSetupTF>(() => {
    const saved = readJson<string>(tfStorageKey, '4H')
    return (tfs as string[]).includes(saved) ? (saved as EmaSetupTF) : tfs[0]
  })
  const loadSeq = useRef(0)

  const load = useCallback(async (silent: boolean) => {
    const seq = ++loadSeq.current
    if (silent) setRefreshing(true)
    try {
      const res = await volatilityApi.getEmaSetups(profileId, top, tfs.map(t => t.toLowerCase()), historyTop)
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
  }, [profileId, top, historyTop, tfs, seenStorageKey])

  useEffect(() => { void load(false) }, [load, refreshKey])

  useEffect(() => {
    const id = window.setInterval(() => { void load(true) }, REFRESH_MS)
    return () => window.clearInterval(id)
  }, [load])

  const current = useMemo(() => data?.timeframes.find(t => t.timeframe === activeTf), [data, activeTf])
  const followThrough = useMemo(() => summarizeFollowThrough(current?.earlier ?? []), [current])
  const filteredEarlier = useMemo(
    () => filterEarlier(current?.earlier ?? [], tierFilter, outcomeFilter),
    [current, tierFilter, outcomeFilter],
  )
  const visibleEarlier = showAllEarlier ? filteredEarlier : filteredEarlier.slice(0, EARLIER_PREVIEW)

  const chooseTf = (tf: EmaSetupTF) => { setActiveTf(tf); setShowAllEarlier(false); writeJson(tfStorageKey, tf) }
  const toggleOpen = () => { const next = !open; setOpen(next); writeJson(openStorageKey, next) }
  const toggleEarlier = () => { const next = !earlierOpen; setEarlierOpen(next); writeJson(earlierStorageKey, next) }

  const togglePin = async (pair: string, pinId: number | null) => {
    const key = `${activeTf}|${pair}`
    setBusyKey(key)
    setActionError(null)
    try {
      let nextPinId: number | null
      if (pinId != null) {
        await ritualApi.removePinned(profileId, pinId)
        nextPinId = null
      } else {
        const created = await ritualApi.addPinned(profileId, {
          pair, timeframe: activeTf as PinnedTF, note: null, source: 'watchlist',
        })
        nextPinId = created.id
      }
      // a pin belongs to pair + timeframe, so every row of that pair on this tab follows it
      setData(prev => prev && {
        ...prev,
        timeframes: prev.timeframes.map(t => t.timeframe !== activeTf ? t : {
          ...t,
          setups: t.setups.map(s => s.pair === pair ? { ...s, pin_id: nextPinId } : s),
          earlier: t.earlier.map(e => e.pair === pair ? { ...e, pin_id: nextPinId } : e),
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
  const hasEarlier = (current?.earlier_total ?? 0) > 0
  const decided = followThrough.holding + followThrough.failed

  return (
    <section className={cn('overflow-hidden rounded-xl border border-surface-700 bg-surface-800', className)}>
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
            maxWidth={320}
            text={`Prime: ${TIER_META.prime.hint}  Fresh: ${TIER_META.fresh.hint}  Retest: ${TIER_META.retest.hint}  Ranked by tier, then volatility. Dead markets are hidden. "Earlier" keeps setups from past runs and shows whether the pair is still on the setup's side of the EMAs.`}
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
          ) : (
            <>
              {/* Active now */}
              {current && current.setups.length > 0 ? (
                <>
                  <ul className="space-y-1.5">
                    {current.setups.map(s => (
                      <ActiveRow
                        key={setupKey(s)}
                        setup={s}
                        latestIso={current.generated_at}
                        isNew={newKeys.has(setupKey(s))}
                        busy={busyKey === `${activeTf}|${s.pair}`}
                        onTogglePin={togglePin}
                      />
                    ))}
                  </ul>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Showing {current.setups.length} of {current.total} active on {activeTf}</span>
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

              {/* Earlier setups */}
              {hasEarlier && current && (
                <div className="mt-4 border-t border-surface-700/60 pt-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <button
                      type="button"
                      onClick={toggleEarlier}
                      aria-expanded={earlierOpen}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-slate-100"
                    >
                      {earlierOpen ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
                      <History size={13} className="text-slate-500" />
                      Earlier · last {windowLabel(current.history_hours)}
                      <span className="rounded-full bg-surface-700 px-1.5 text-[10px] font-medium text-slate-400">{current.earlier_total}</span>
                    </button>

                    {decided > 0 && (
                      <div
                        className="ml-auto flex items-center gap-2"
                        title={`${followThrough.holding} holding · ${followThrough.failed} failed · ${followThrough.neutral} mixed · ${followThrough.unknown} no data. Follow-through = holding ÷ (holding + failed).`}
                      >
                        <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-surface-700">
                          <div className="bg-emerald-500" style={{ width: `${(followThrough.holding / current.earlier.length) * 100}%` }} />
                          <div className="bg-slate-500/60" style={{ width: `${(followThrough.neutral / current.earlier.length) * 100}%` }} />
                          <div className="bg-rose-500" style={{ width: `${(followThrough.failed / current.earlier.length) * 100}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-400">
                          <span className="font-semibold text-slate-200">{followThrough.rate}%</span> followed through
                          <span className="text-slate-600"> ({followThrough.holding}/{decided})</span>
                        </span>
                      </div>
                    )}
                  </div>

                  {earlierOpen && (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {TIER_FILTERS.map(f => (
                          <Chip key={f.value} active={tierFilter === f.value} onClick={() => setTierFilter(f.value)}>{f.label}</Chip>
                        ))}
                        <span className="mx-1 h-3 w-px bg-surface-700" />
                        {OUTCOME_FILTERS.map(f => (
                          <Chip key={f.value} active={outcomeFilter === f.value} onClick={() => setOutcomeFilter(f.value)}>{f.label}</Chip>
                        ))}
                      </div>

                      {visibleEarlier.length > 0 ? (
                        <ul className="space-y-1.5">
                          {visibleEarlier.map(e => (
                            <EarlierRow
                              key={`${e.pair}|${e.direction}`}
                              item={e}
                              busy={busyKey === `${activeTf}|${e.pair}`}
                              onTogglePin={togglePin}
                            />
                          ))}
                        </ul>
                      ) : (
                        <p className="rounded-lg border border-dashed border-surface-700 px-3 py-4 text-center text-[11px] text-slate-500">
                          No earlier setup matches these filters.
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>
                          Showing {visibleEarlier.length} of {filteredEarlier.length}
                          {current.earlier_total > current.earlier.length && ` · ${current.earlier_total - current.earlier.length} older not loaded`}
                        </span>
                        {filteredEarlier.length > EARLIER_PREVIEW && (
                          <button
                            type="button"
                            onClick={() => setShowAllEarlier(v => !v)}
                            className="font-semibold text-brand-400 hover:text-brand-300"
                          >
                            {showAllEarlier ? 'Show less' : `Show all ${filteredEarlier.length}`}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {actionError && <p className="mt-2 text-[11px] text-red-400">{actionError}</p>}
        </div>
      )}
    </section>
  )
}
