// ── WatchlistsPage ────────────────────────────────────────────────────────
// Page /volatility/pairs — snapshot history tree + pair detail panel.
//
// Left panel  : snapshots grouped by date → TF, click item to load pairs
// Right panel : pair table for selected snapshot + regime filter + Kraken export

import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  RefreshCw, Loader2, AlertTriangle, Download, ArrowUpDown, Play,
  ChevronDown, ChevronRight, BookOpen,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { Tooltip } from '../../components/ui/Tooltip'
import { VolatilityLegendPanel } from '../../components/volatility/VolatilityLegendPanel'
import { volatilityApi } from '../../lib/api'
import type { WatchlistOut, WatchlistPairOut, WatchlistMetaOut } from '../../types/api'

const TIMEFRAMES = ['15m', '1h', '4h', '1d', '1w'] as const
type TF = typeof TIMEFRAMES[number]

const REGIMES = ['ALL', 'DEAD', 'CALM', 'NORMAL', 'TRENDING', 'ACTIVE', 'EXTREME'] as const

// Reference EMA per TF used for signal detection (matches backend _TF_EMA_REF)
const TF_EMA_REF: Record<string, number> = { '15m': 55, '1h': 99, '4h': 200, '1d': 99, '1w': 55 }
// Superior TF mapping for TF+1 column header label
const TF_NEXT: Record<string, string> = { '15m': '1h', '1h': '4h', '4h': '1d', '1d': '1w' }

const REGIME_COLOR_HEX: Record<string, string> = {
  DEAD:     '#a1a1aa',
  CALM:     '#0ea5e9',
  NORMAL:   '#10b981',
  TRENDING: '#818cf8',  // indigo-400 — gem color — sweet spot trading regime
  ACTIVE:   '#f59e0b',  // amber-400  — elevated but not alarming
  EXTREME:  '#ef4444',
}

const REGIME_EMOJI: Record<string, string> = {
  DEAD: '⬜', CALM: '💧', NORMAL: '📊', TRENDING: '💎', ACTIVE: '⚠️', EXTREME: '🚫',
}

const EMA_DISPLAY: Record<string, { label: string; color: string; symbol: string }> = {
  above_all:      { label: 'Above All',   color: '#10b981', symbol: '▲'  },
  below_all:      { label: 'Below All',   color: '#ef4444', symbol: '▼'  },
  breakout_up:    { label: 'Breakout ↑',  color: '#0ea5e9', symbol: '🚀' },
  breakdown_down: { label: 'Breakdown ↓', color: '#f97316', symbol: '💥' },
  retest_up:      { label: 'Retest ↑',    color: '#a855f7', symbol: '🔄' },
  retest_down:    { label: 'Retest ↓',    color: '#c084fc', symbol: '🔁' },
  mixed:          { label: 'Mixed',       color: '#71717a', symbol: '∿'  },
}

const REGIME_DESCRIPTION: Record<string, string> = {
  DEAD:     'Market asleep — stay flat, zero edge',
  CALM:     'Low momentum — reduce size, scalp only',
  NORMAL:   'Standard conditions — apply usual strategy',
  TRENDING: 'Strong momentum — favor trend-following',
  ACTIVE:   'High activity — breakouts frequent, tight SL',
  EXTREME:  'Extreme volatility — minimize exposure',
}

const EMA_TOOLTIP: Record<string, string> = {
  above_all:      'Price above EMA 20, 50 & 200 — full bull alignment',
  below_all:      'Price below EMA 20, 50 & 200 — full bear alignment',
  breakout_up:    'Price crossed above ref EMA (EMA 50 on 15m · EMA 100 on 1h · EMA 200 on 4h/1d) in the last 3 bars',
  breakdown_down: 'Price crossed below ref EMA (EMA 50 on 15m · EMA 100 on 1h · EMA 200 on 4h/1d) in the last 3 bars',
  retest_up:      'Price ≤ 0.5% above ref EMA — testing it as support',
  retest_down:    'Price ≤ 0.5% below ref EMA — testing it as resistance',
  mixed:          'Price position mixed relative to EMAs 20 / 50 / 200',
}

type SortKey = 'vi_score' | 'change_24h' | 'pair' | 'ema_score'

// ── Helpers ───────────────────────────────────────────────────────────────

function alertIcon(p: WatchlistPairOut): string {
  if (p.regime === 'EXTREME') return '⚠️'
  if (p.regime === 'DEAD')    return '⛔'
  if (p.alert)                return '🔔'
  return ''
}

function formatPair(symbol: string): { base: string; quote: string } {
  // Kraken Futures: PF_XBTUSD, PI_ETHUSD, FF_SOLUSD, etc.
  const kf = symbol.match(/^(?:PF|PI|FF)_([A-Z0-9]+?)(USD|USDT|EUR|GBP|XBT)$/)
  if (kf) return { base: kf[1].replace('XBT', 'BTC'), quote: kf[2] }
  if (symbol.endsWith('USDT')) return { base: symbol.slice(0, -4), quote: 'USDT' }
  if (symbol.endsWith('BUSD')) return { base: symbol.slice(0, -4), quote: 'BUSD' }
  // Plain Kraken perps: XBTUSD, ETHUSD, SOLUSD, etc.
  if (symbol.endsWith('USD'))  return { base: symbol.slice(0, -3).replace('XBT', 'BTC'), quote: 'USD' }
  if (symbol.endsWith('EUR'))  return { base: symbol.slice(0, -3).replace('XBT', 'BTC'), quote: 'EUR' }
  return { base: symbol.replace('XBT', 'BTC'), quote: '' }
}

function downloadKraken(pairs: WatchlistPairOut[], tf: string, dateStr: string) {
  // TradingView Kraken Futures format: strip PF_/PI_/FF_ prefix, XBT→BTC, add .PM suffix
  const toTV = (sym: string) =>
    `KRAKEN:${sym.replace(/^(?:PF|PI|FF)_/, '').replace('XBT', 'BTC').replace('XBT', 'BTC')}.PM`
  const lines = pairs.map((p) => toTV(p.pair)).join('\n')

  // Derive quote currency from first pair (e.g. BTCUSD → USD, ETHUSD → USD)
  const firstSym = pairs[0]?.pair ?? ''
  const quoteMatch = firstSym.replace(/^(?:PF|PI|FF)_/, '').match(/(USDT|USDC|USD|EUR|GBP)$/)
  const devise = quoteMatch ? quoteMatch[1] : 'USD'

  // Filename: kraken_1h_2026-03-15_1430_USD.txt
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`

  const blob  = new Blob([lines], { type: 'text/plain' })
  const url   = URL.createObjectURL(blob)
  const a     = document.createElement('a')
  a.href      = url
  a.download  = `kraken_${tf}_${dateStr}_${hhmm}_${devise}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

function toDateKey(iso: string): string {
  // Use local timezone so midnight UTC doesn't shift the displayed date
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

// ── Sort header ───────────────────────────────────────────────────────────

function SortTh({
  label,
  active,
  desc,
  onClick,
  className,
  tooltip,
}: {
  label: string
  col: SortKey
  active: boolean
  desc: boolean
  onClick: () => void
  className?: string
  tooltip?: React.ReactNode
}) {
  return (
    <th
      onClick={onClick}
      className={`px-4 py-2.5 text-left text-zinc-500 font-mono cursor-pointer hover:text-zinc-300 select-none transition-colors ${className ?? ''}`}
    >
      <span className="flex items-center gap-1">
        {label}
        {active ? (
          <span className="text-zinc-400">{desc ? '↓' : '↑'}</span>
        ) : (
          <ArrowUpDown size={9} className="text-zinc-700" />
        )}
        {tooltip}
      </span>
    </th>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export function WatchlistsPage() {
  const [snapshots, setSnapshots]         = useState<WatchlistMetaOut[]>([])
  const [loading, setLoading]             = useState(true)
  const [selectedId, setSelectedId]       = useState<number | null>(null)
  const [selectedData, setSelectedData]   = useState<WatchlistOut | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [isRunning, setIsRunning]         = useState(false)
  const [runStatus, setRunStatus]         = useState<string | null>(null)
  const [generateTF, setGenerateTF]       = useState<TF>('1h')
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set())
  // Mobile: 'tree' = show snapshot list, 'detail' = show pair table
  const [mobileView, setMobileView]       = useState<'tree' | 'detail'>('tree')
  const [expandedTFs, setExpandedTFs]     = useState<Set<string>>(new Set())
  const [regimeFilters, setRegimeFilters] = useState<Set<string>>(new Set(['ALL']))
  const [emaFilters, setEmaFilters]       = useState<Set<string>>(new Set(['ALL']))
  const [sortKey, setSortKey]             = useState<SortKey>('vi_score')
  const [sortDesc, setSortDesc]           = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [modalViMin, setModalViMin]   = useState(0)
  const [modalViMax, setModalViMax]   = useState(100)
  const [modalRegimes, setModalRegimes]   = useState<Set<string>>(new Set(['ALL']))
  const [viRange, setViRange]         = useState<[number, number]>([0, 100])
  const [showLegend, setShowLegend]   = useState(false)
  const [regimeSameAsTFSup, setRegimeSameAsTFSup] = useState(false)
  // Track whether the initial auto-selection has already been done.
  // Manual refreshes should NOT override the user's current selection.
  const initialLoadedRef = useRef(false)

  // ── Load snapshot list ───────────────────────────────────────────────────

  const handleSelectSnapshot = useCallback(async (id: number, keepFilters = false) => {
    setSelectedId(id)
    setSelectedData(null)
    if (!keepFilters) {
      setRegimeFilters(new Set(['ALL']))
      setEmaFilters(new Set(['ALL']))
      setRegimeSameAsTFSup(false)
    }
    setLoadingDetail(true)
    setMobileView('detail')  // auto-switch to detail panel on mobile after selecting
    try {
      const data = await volatilityApi.getWatchlistById(id)
      setSelectedData(data)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  const fetchSnapshots = useCallback(async () => {
    setLoading(true)
    try {
      const data = await volatilityApi.listWatchlists(30)
      setSnapshots(data)
      // Auto-select the newest snapshot only on the very first load.
      // Manual refreshes keep the current selection intact.
      if (data.length > 0 && !initialLoadedRef.current) {
        initialLoadedRef.current = true
        const firstDate  = toDateKey(data[0].generated_at)
        const firstTFKey = `${firstDate}:${data[0].timeframe}`
        setExpandedDates(new Set([firstDate]))
        setExpandedTFs(new Set([firstTFKey]))
        handleSelectSnapshot(data[0].id)
      }
    } finally {
      setLoading(false)
    }
  }, [handleSelectSnapshot])

  useEffect(() => { fetchSnapshots() }, [fetchSnapshots])

  // ── Generate ─────────────────────────────────────────────────────────────

  // Opens the configuration modal — user picks TF, min VI, regime filters before queuing
  const handleGenerate = useCallback(() => {
    setShowGenerateModal(true)
  }, [])

  // Called when user confirms in the Generate modal
  const handleGenerateConfirm = useCallback(async () => {
    // Apply modal filters to the live display
    setRegimeFilters(new Set(modalRegimes))
    setViRange([modalViMin, modalViMax])

    const tfBefore    = generateTF
    // Capture count BEFORE queuing so we can detect a new snapshot after
    const countBefore = snapshots.filter((s) => s.timeframe === tfBefore).length

    setShowGenerateModal(false)
    setIsRunning(true)
    setRunStatus(null)
    try {
      await volatilityApi.runTask('pairs', generateTF)
      setRunStatus(`⏳ Computing ${generateTF.toUpperCase()} watchlist — data ready in ~30 s`)

      // Poll at 25 s then 45 s to check if a new snapshot landed
      const checkResult = async (attempt: number): Promise<void> => {
        try {
          const newData = await volatilityApi.listWatchlists(30)
          setSnapshots(newData)
          const newer = newData.filter((s) => s.timeframe === tfBefore)
          if (newer.length > countBefore) {
            const newest = newer[0]
            const dk = toDateKey(newest.generated_at)
            setExpandedDates((prev) => new Set([...prev, dk]))
            setExpandedTFs((prev) => new Set([...prev, `${dk}:${newest.timeframe}`]))
            handleSelectSnapshot(newest.id, true /* keepFilters */)
            setRunStatus(
              `✅ ${tfBefore.toUpperCase()} watchlist ready — ${newest.pairs_count} pairs · regime: ${newest.regime}`,
            )
          } else if (attempt < 6) {
            setTimeout(() => checkResult(attempt + 1), 30_000)
          } else {
            setRunStatus(
              '⚠️ No new snapshot detected after ~3 min — Celery worker may be down or still computing',
            )
          }
        } catch {
          setRunStatus('⚠️ Could not verify result — try refreshing manually')
        }
      }
      setTimeout(() => checkResult(1), 30_000)
    } catch {
      setRunStatus('❌ Failed to queue task — check backend logs')
    } finally {
      setIsRunning(false)
    }
  }, [generateTF, modalViMin, modalViMax, modalRegimes, snapshots, handleSelectSnapshot])

  // ── Tree grouping ─────────────────────────────────────────────────────────

  const tree = useMemo(() => {
    const out: Record<string, Record<string, WatchlistMetaOut[]>> = {}
    for (const s of snapshots) {
      const dk = toDateKey(s.generated_at)
      if (!out[dk]) out[dk] = {}
      if (!out[dk][s.timeframe]) out[dk][s.timeframe] = []
      out[dk][s.timeframe].push(s)
    }
    return out
  }, [snapshots])

  const sortedDates = useMemo(
    () => Object.keys(tree).sort((a, b) => b.localeCompare(a)),
    [tree],
  )

  const toggleDate = (dk: string) =>
    setExpandedDates((prev) => {
      const next = new Set(prev)
      if (next.has(dk)) next.delete(dk); else next.add(dk)
      return next
    })

  const toggleTF = (key: string) =>
    setExpandedTFs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d)
    else { setSortKey(key); setSortDesc(true) }
  }

  // ── Detail data ───────────────────────────────────────────────────────────

  const filteredPairs = useMemo<WatchlistPairOut[]>(() => {
    if (!selectedData) return []
    let rows = [...selectedData.pairs]
    if (!regimeFilters.has('ALL')) rows = rows.filter((p) => regimeFilters.has(p.regime))
    if (!emaFilters.has('ALL')) rows = rows.filter((p) => emaFilters.has(p.ema_signal ?? 'mixed'))
    if (regimeSameAsTFSup) rows = rows.filter((p) => p.tf_sup_regime != null && p.regime === p.tf_sup_regime)
    const [viMin, viMax] = viRange
    if (viMin > 0 || viMax < 100) {
      rows = rows.filter((p) => {
        const v = Math.round(p.vi_score * 100)
        return v >= viMin && v <= viMax
      })
    }
    rows.sort((a, b) => {
      if (sortKey === 'pair') {
        return sortDesc ? b.pair.localeCompare(a.pair) : a.pair.localeCompare(b.pair)
      }
      const av = (a[sortKey] ?? -Infinity) as number
      const bv = (b[sortKey] ?? -Infinity) as number
      return sortDesc ? bv - av : av - bv
    })
    return rows
  }, [selectedData, regimeFilters, emaFilters, regimeSameAsTFSup, viRange, sortKey, sortDesc])

  const regimeCounts = useMemo(() => {
    if (!selectedData) return {}
    return selectedData.pairs.reduce<Record<string, number>>((acc, p) => {
      acc[p.regime] = (acc[p.regime] ?? 0) + 1
      return acc
    }, {})
  }, [selectedData])

  const emaCounts = useMemo(() => {
    if (!selectedData) return {}
    return selectedData.pairs.reduce<Record<string, number>>((acc, p) => {
      const sig = p.ema_signal ?? 'mixed'
      acc[sig] = (acc[sig] ?? 0) + 1
      return acc
    }, {})
  }, [selectedData])

  const selectedMeta = snapshots.find((s) => s.id === selectedId) ?? null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100dvh - 80px)', minHeight: '400px' }}>

      {/* ── Topbar ── */}
      <div className="flex items-center justify-between shrink-0">
        <PageHeader
          icon="👁"
          title="Pair Watchlists"
          subtitle="Snapshot history — select a snapshot to inspect pairs"
        />
        <div className="flex items-center gap-2">
          <Link
            to="/volatility/market"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Market VI
          </Link>

          {/* ── TF selector + Generate ── */}
          <div className="flex items-center rounded-lg border border-emerald-800 overflow-hidden">
            <select
              value={generateTF}
              onChange={(e) => setGenerateTF(e.target.value as TF)}
              className="bg-zinc-950 text-emerald-400 text-xs font-mono px-2 py-1.5 border-r border-emerald-800 focus:outline-none cursor-pointer"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf} className="bg-zinc-900">{tf.toUpperCase()}</option>
              ))}
            </select>
            <button
              onClick={handleGenerate}
              disabled={isRunning}
              title="Open generate dialog — choose TF, minimum VI score and regime filters"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950 transition-colors disabled:opacity-50"
            >
              {isRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Generate
            </button>
          </div>

          {/* ── Refresh tree ── */}
          <button
            onClick={fetchSnapshots}
            disabled={loading}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Refresh snapshot list"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>

          {/* ── Legend ── */}
          <div className="relative">
            <button
              onClick={() => setShowLegend((v) => !v)}
              title="Legend — Regimes & EMA signals explained"
              className={`p-1.5 rounded-lg transition-colors ${showLegend ? 'text-zinc-200 bg-zinc-800' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'}`}
            >
              <BookOpen size={14} />
            </button>
            {showLegend && <VolatilityLegendPanel variant="watchlist" onClose={() => setShowLegend(false)} />}
          </div>
        </div>
      </div>

      {/* ── Status banner ── */}
      {runStatus && (
        <div className={`shrink-0 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
          runStatus.startsWith('✅') ? 'bg-emerald-950 border border-emerald-800 text-emerald-300' :
          runStatus.startsWith('❌') || runStatus.startsWith('⚠️') ? 'bg-amber-950 border border-amber-800 text-amber-300' :
          'bg-zinc-900 border border-zinc-700 text-zinc-300'
        }`}>
          {runStatus}
        </div>
      )}

      {/* ── Generate modal ── */}
      {showGenerateModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowGenerateModal(false)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-80 space-y-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-zinc-200">Generate Watchlist</h2>

            {/* Timeframe */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500">Timeframe</label>
              <div className="flex gap-1">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => setGenerateTF(tf)}
                    className={`flex-1 py-1.5 text-xs font-mono rounded border transition-colors ${
                      generateTF === tf
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-500'
                    }`}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* VI score range */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-zinc-500">VI score range (display filter)</label>
                <span className="text-xs font-mono text-zinc-300 tabular-nums">{modalViMin}–{modalViMax}</span>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-600 w-6 shrink-0">Min</span>
                  <input
                    type="range"
                    min={0}
                    max={95}
                    step={5}
                    value={modalViMin}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setModalViMin(v)
                      if (v >= modalViMax) setModalViMax(Math.min(100, v + 5))
                    }}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="text-xs font-mono text-zinc-400 w-5 text-right tabular-nums">{modalViMin}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-600 w-6 shrink-0">Max</span>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={modalViMax}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setModalViMax(v)
                      if (v <= modalViMin) setModalViMin(Math.max(0, v - 5))
                    }}
                    className="flex-1 accent-emerald-500"
                  />
                  <span className="text-xs font-mono text-zinc-400 w-5 text-right tabular-nums">{modalViMax}</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-zinc-700 font-mono select-none">
                <span>0 (all)</span>
                <span>50+ (TRENDING)</span>
                <span>100</span>
              </div>
            </div>

            {/* Regime filter */}
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-500">Regime filter (display only)</label>
              <div className="flex flex-wrap gap-1">
                {(['ALL', 'CALM', 'NORMAL', 'TRENDING', 'ACTIVE', 'EXTREME'] as const).map((r) => {
                  const isActive = modalRegimes.has(r)
                  const rColor   = r !== 'ALL' ? REGIME_COLOR_HEX[r] : undefined
                  return (
                    <button
                      key={r}
                      title={REGIME_DESCRIPTION[r] ?? 'Show all regimes'}
                      onClick={() => {
                        setModalRegimes((prev) => {
                          if (r === 'ALL') return new Set(['ALL'])
                          const next = new Set(prev)
                          next.delete('ALL')
                          if (next.has(r)) { next.delete(r); if (next.size === 0) next.add('ALL') }
                          else next.add(r)
                          return next
                        })
                      }}
                      style={
                        isActive && rColor
                          ? { color: rColor, borderColor: `${rColor}60`, background: `${rColor}14` }
                          : undefined
                      }
                      className={`px-2 py-0.5 text-xs font-mono rounded border transition-colors ${
                        isActive
                          ? 'border-zinc-600 text-zinc-200'
                          : 'border-zinc-800 text-zinc-600 bg-transparent hover:border-zinc-600'
                      }`}
                    >
                      {r !== 'ALL' && REGIME_EMOJI[r]} {r}
                    </button>
                  )
                })}
              </div>
              <p className="text-xs text-zinc-700">Filters apply to the table after generation. The backend always computes all pairs.</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setShowGenerateModal(false)}
                className="flex-1 py-2 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateConfirm}
                disabled={isRunning}
                className="flex-1 py-2 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-950 border border-emerald-800 rounded-lg transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <Play size={10} />
                Generate {generateTF.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Mobile tab bar ── */}
      <div className="flex lg:hidden shrink-0 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900">
        <button
          onClick={() => setMobileView('tree')}
          className={`flex-1 py-2 text-xs font-mono transition-colors ${
            mobileView === 'tree' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          📅 Snapshots
        </button>
        <button
          onClick={() => setMobileView('detail')}
          className={`flex-1 py-2 text-xs font-mono transition-colors ${
            mobileView === 'detail' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          📊 Pairs {selectedData ? `(${filteredPairs.length})` : ''}
        </button>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">

        {/* ── LEFT: snapshot tree ── */}
        <div className={`${
          mobileView === 'tree' ? 'flex' : 'hidden'
        } lg:flex w-full lg:w-64 shrink-0 rounded-xl border border-zinc-800 bg-zinc-950 flex-col overflow-hidden`}>
          <div className="px-3 py-2 border-b border-zinc-800 text-xs text-zinc-500 font-mono uppercase tracking-wider shrink-0">
            Snapshots · last 30 days
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 size={20} className="animate-spin text-zinc-600" />
              </div>
            ) : snapshots.length === 0 ? (
              <div className="p-5 text-xs text-zinc-600 text-center space-y-2">
                <AlertTriangle size={16} className="mx-auto text-amber-600" />
                <p>No snapshots yet.<br />Select a TF and click Generate.</p>
              </div>
            ) : (
              <div className="py-1">
                {sortedDates.map((dk) => {
                  const dateOpen   = expandedDates.has(dk)
                  const tfsInDate  = Object.keys(tree[dk]).sort()
                  const totalCount = tfsInDate.reduce((sum, tf) => sum + tree[dk][tf].length, 0)
                  return (
                    <div key={dk}>
                      {/* Date folder */}
                      <button
                        onClick={() => toggleDate(dk)}
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-zinc-900 transition-colors text-left"
                      >
                        {dateOpen
                          ? <ChevronDown  size={12} className="text-zinc-500 shrink-0" />
                          : <ChevronRight size={12} className="text-zinc-500 shrink-0" />
                        }
                        <span className="text-xs font-mono text-zinc-300">{dk}</span>
                        <span className="ml-auto text-xs text-zinc-600">{totalCount}</span>
                      </button>

                      {dateOpen && tfsInDate.map((tf) => {
                        const tKey   = `${dk}:${tf}`
                        const tfOpen = expandedTFs.has(tKey)
                        const items  = tree[dk][tf]
                        return (
                          <div key={tKey}>
                            {/* TF sub-folder */}
                            <button
                              onClick={() => toggleTF(tKey)}
                              className="w-full flex items-center gap-1.5 pl-6 pr-3 py-1.5 hover:bg-zinc-900 transition-colors text-left"
                            >
                              {tfOpen
                                ? <ChevronDown  size={10} className="text-zinc-600 shrink-0" />
                                : <ChevronRight size={10} className="text-zinc-600 shrink-0" />
                              }
                              <span className="text-xs font-mono font-bold text-zinc-400 uppercase">{tf}</span>
                              <span className="ml-auto text-xs text-zinc-600">{items.length}</span>
                            </button>

                            {tfOpen && items.map((snap) => {
                              const isSelected = snap.id === selectedId
                              const rColor     = REGIME_COLOR_HEX[snap.regime] ?? '#71717a'
                              return (
                                <button
                                  key={snap.id}
                                  onClick={() => handleSelectSnapshot(snap.id)}
                                  style={isSelected ? { borderLeftColor: rColor } : undefined}
                                  className={`w-full flex flex-col pl-10 pr-3 py-1.5 text-left border-l-2 transition-colors ${
                                    isSelected
                                      ? 'bg-zinc-800 border-current'
                                      : 'border-transparent hover:bg-zinc-900'
                                  }`}
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-mono text-zinc-400">
                                      {toTimeLabel(snap.generated_at)}
                                    </span>
                                    <span className="ml-auto text-xs font-mono font-bold" style={{ color: rColor }}>
                                      {REGIME_EMOJI[snap.regime] ?? ''} {snap.regime}
                                    </span>
                                  </div>
                                  <span className="text-xs text-zinc-600">{snap.pairs_count} pairs</span>
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: detail panel ── */}
        <div className={`${
          mobileView === 'detail' ? 'flex' : 'hidden'
        } lg:flex flex-1 min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 flex-col overflow-hidden`}>
          {selectedId === null ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
              <span className="text-4xl">👈</span>
              <span className="text-sm">Select a snapshot from the tree</span>
            </div>
          ) : loadingDetail ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={24} className="animate-spin text-zinc-600" />
            </div>
          ) : !selectedData ? (
            <div className="flex items-center justify-center h-full gap-2">
              <AlertTriangle size={18} className="text-amber-500" />
              <span className="text-sm text-zinc-400">Failed to load snapshot</span>
            </div>
          ) : (
            <>
              {/* ── Detail header ── */}
              <div className="flex flex-col gap-1 px-4 py-2.5 border-b border-zinc-800 shrink-0">
                {/* Row 1: regime filter pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* regime filter pills — multi-select */}
                  <div className="flex gap-1 flex-wrap">
                    {REGIMES.map((r) => {
                      const count   = r === 'ALL' ? selectedData.pairs_count : (regimeCounts[r] ?? 0)
                      const rColor  = r !== 'ALL' ? REGIME_COLOR_HEX[r] : undefined
                      const isActive = regimeFilters.has('ALL') ? r === 'ALL' : regimeFilters.has(r)
                      if (r !== 'ALL' && count === 0) return null
                      return (
                        <button
                          key={r}
                          onClick={() => setRegimeFilters((prev) => {
                            if (r === 'ALL') return new Set(['ALL'])
                            const next = new Set(prev)
                            next.delete('ALL')
                            if (next.has(r)) { next.delete(r); if (next.size === 0) return new Set(['ALL']) }
                            else next.add(r)
                            return next
                          })}
                          className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                            isActive ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                          style={isActive && rColor ? { color: rColor } : {}}
                        >
                          {r !== 'ALL' && REGIME_EMOJI[r]} {r}
                          {r !== 'ALL' && count > 0 && <span className="ml-1 opacity-60">{count}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Row 2: meta + export — single line, right-aligned */}
                <div className="flex items-center justify-end gap-3">
                  <span className="text-xs font-mono text-zinc-600">
                    {filteredPairs.length === selectedData.pairs_count
                      ? `${selectedData.pairs_count} pairs`
                      : `${filteredPairs.length} / ${selectedData.pairs_count}`}
                  </span>
                  {selectedMeta && (
                    <span className="text-xs text-zinc-700">
                      {selectedMeta.timeframe.toUpperCase()} ·{' '}
                      {new Date(selectedData.generated_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    </span>
                  )}
                  <button
                    onClick={() => downloadKraken(
                      filteredPairs,
                      selectedData.timeframe,
                      toDateKey(selectedData.generated_at),
                    )}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                    title="Download TradingView watchlist — active filters applied — KRAKEN:PAIR format (.txt)"
                  >
                    <Download size={11} />
                    Kraken Export
                  </button>
                </div>

                {/* Row 3: EMA filter pills */}
                <div className="flex gap-1 flex-wrap items-center">
                  {(['ALL', ...Object.keys(EMA_DISPLAY)]).map((sig) => {
                    const count    = sig === 'ALL' ? selectedData.pairs_count : (emaCounts[sig] ?? 0)
                    const ema      = sig !== 'ALL' ? EMA_DISPLAY[sig] : undefined
                    const isActive = emaFilters.has('ALL') ? sig === 'ALL' : emaFilters.has(sig)
                    if (sig !== 'ALL' && count === 0) return null
                    return (
                      <button
                        key={sig}
                        onClick={() => setEmaFilters((prev) => {
                          if (sig === 'ALL') return new Set(['ALL'])
                          const next = new Set(prev)
                          next.delete('ALL')
                          if (next.has(sig)) { next.delete(sig); if (next.size === 0) return new Set(['ALL']) }
                          else next.add(sig)
                          return next
                        })}
                        title={EMA_TOOLTIP[sig] ?? 'Show all EMA signals'}
                        className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                          isActive ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                        }`}
                        style={isActive && ema ? { color: ema.color } : {}}
                      >
                        {ema ? `${ema.symbol} ${ema.label}` : 'ALL EMA'}
                        {sig !== 'ALL' && count > 0 && <span className="ml-1 opacity-60">{count}</span>}
                      </button>
                    )
                  })}
                  {/* Same-regime filter — immediately after ALL EMA, separated by a divider */}
                  <span className="text-zinc-800 select-none mx-0.5">|</span>
                  <button
                    onClick={() => setRegimeSameAsTFSup(p => !p)}
                    title="Only pairs where regime at this TF = regime at TF+1 (strong confluence)"
                    className={`px-2 py-0.5 rounded text-xs font-mono border transition-colors ${
                      regimeSameAsTFSup
                        ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                        : 'border-zinc-700 text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    = TF+1
                  </button>
                </div>
              </div>

              {/* ── Pair table ── */}
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-xs min-w-[680px]">
                  <thead className="bg-zinc-900/60 sticky top-0 z-10">
                    <tr className="border-b border-zinc-800">
                      <th className="px-3 py-2.5 text-left text-zinc-600 font-mono w-8">#</th>
                      <SortTh label="PAIR"  col="pair"       active={sortKey === 'pair'}       desc={sortDesc} onClick={() => handleSort('pair')}       className="w-28" />
                      <SortTh label="VI" col="vi_score" active={sortKey === 'vi_score'} desc={sortDesc} onClick={() => handleSort('vi_score')}
                        tooltip={<Tooltip text="Volatility Index 0–100. Formula: mean(RVOL, MFI, ATR, Bollinger Width). EMA score is NOT included — stored for context and ranking boost only." />}
                      />
                      <th className="px-3 py-2.5 text-left text-zinc-500 font-mono">
                        <span className="flex items-center gap-1">
                          REGIME
                          <Tooltip text="DEAD <17 · CALM 17–33 · NORMAL 33–50 · TRENDING 50–67 · ACTIVE 67–83 · EXTREME >83" maxWidth={180} />
                        </span>
                      </th>
                      <th className="px-3 py-2.5 text-left text-zinc-500 font-mono">
                        <span className="flex items-center gap-1">
                          EMA{selectedData ? ` (${TF_EMA_REF[selectedData.timeframe] ?? ''})` : ''}
                          <Tooltip text="Signal vs the ref EMA per TF (configurable — e.g. EMA 200 on 4h). Breakout/retest = price crossing the ref EMA within 3 candles. ▲ above all · ▼ below all · 🚀 breakout · 💥 breakdown · 🔄🔁 retest · ∿ mixed" maxWidth={300} />
                        </span>
                      </th>
                      <SortTh label="EMA%" col="ema_score" active={sortKey === 'ema_score'} desc={sortDesc} onClick={() => handleSort('ema_score')} tooltip={<Tooltip text="EMA Alignment Score (0–100). Price position vs the scoring EMAs (weighted average — e.g. above the longest ref EMA = smaller weight). 100 = above all · 0 = below all. Not included in VI — used for ranking only." maxWidth={260} />} />
                      <SortTh label="24H%" col="change_24h" active={sortKey === 'change_24h'} desc={sortDesc} onClick={() => handleSort('change_24h')} className="w-20" />
                      <th className="px-3 py-2.5 text-left text-zinc-500 font-mono">
                        <span className="flex items-center gap-1">
                          TF+1{selectedData && TF_NEXT[selectedData.timeframe] ? ` (${TF_NEXT[selectedData.timeframe]})` : ''}
                          <Tooltip text="Regime at the next-higher timeframe. Confirms or contradicts the signal." />
                        </span>
                      </th>
                      <th className="px-3 py-2.5 text-center text-zinc-500 font-mono w-10">
                        <span className="flex items-center justify-center gap-1">
                          ⚠
                          <Tooltip text="⚠️ EXTREME · ⛔ DEAD · 🔔 alert" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPairs.map((p, i) => {
                      const viPct      = Math.round(p.vi_score * 100)
                      const rColor     = REGIME_COLOR_HEX[p.regime] ?? '#71717a'
                      const ema        = EMA_DISPLAY[p.ema_signal] ?? EMA_DISPLAY.mixed
                      const tfSupColor = REGIME_COLOR_HEX[p.tf_sup_regime ?? ''] ?? '#71717a'
                      const alert      = alertIcon(p)
                      const { base, quote } = formatPair(p.pair)
                      const chg = p.change_24h
                      const emaPct     = p.ema_score != null ? Math.round(p.ema_score * 100) : null
                      const emaScoreColor = emaPct != null ? (emaPct >= 67 ? '#10b981' : emaPct >= 34 ? '#f59e0b' : '#ef4444') : '#71717a'
                      return (
                        <tr key={p.pair} className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors">
                          <td className="px-3 py-2 text-zinc-700 font-mono">{i + 1}</td>
                          <td className="px-3 py-2 font-mono font-bold text-zinc-200">
                            {base}<span className="text-zinc-600 font-normal">{quote}</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden shrink-0">
                                <div className="h-full rounded-full" style={{ width: `${viPct}%`, background: rColor }} />
                              </div>
                              <span className="font-mono font-black text-sm w-7 text-right" style={{ color: rColor }}>{viPct}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className="font-mono text-xs font-bold tracking-wider" style={{ color: rColor }}>
                              {REGIME_EMOJI[p.regime]} {p.regime}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono cursor-help" style={{ color: ema.color }} title={EMA_TOOLTIP[p.ema_signal] ?? p.ema_signal}>
                            <span className="mr-1">{ema.symbol}</span>{ema.label}
                          </td>
                          <td className="px-3 py-2 font-mono text-right tabular-nums">
                            {emaPct != null
                              ? <span className="text-xs font-bold" style={{ color: emaScoreColor }}>{emaPct}</span>
                              : <span className="text-zinc-700">—</span>
                            }
                          </td>
                          <td className="px-3 py-2 font-mono text-right tabular-nums">
                            {chg !== null
                              ? <span className={chg >= 0 ? 'text-emerald-400' : 'text-red-400'}>{chg >= 0 ? '+' : ''}{chg.toFixed(2)}%</span>
                              : <span className="text-zinc-700">—</span>
                            }
                          </td>
                          <td className="px-3 py-2">
                            {p.tf_sup_regime ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs">{REGIME_EMOJI[p.tf_sup_regime] ?? ''}</span>
                                <span className="font-mono text-xs" style={{ color: tfSupColor }}>{p.tf_sup_regime}</span>
                                {p.tf_sup_vi != null && (
                                  <span className="font-mono text-xs text-zinc-600">({Math.round(p.tf_sup_vi * 100)})</span>
                                )}
                              </div>
                            ) : <span className="text-zinc-700">—</span>}
                          </td>
                          <td className="px-3 py-2 text-center text-base leading-none">{alert}</td>
                        </tr>
                      )
                    })}
                    {filteredPairs.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-zinc-600">
                          No pairs match the filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

