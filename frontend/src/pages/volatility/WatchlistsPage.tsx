// ── WatchlistsPage ────────────────────────────────────────────────────────
// Page /volatility/pairs — per-TF pair watchlists.
//
// Layout:
//   • 4 TF summary cards (15m / 1h / 4h / 1d) — click to switch active TF
//   • Table: # | Pair | VI | Regime | EMA | 24h% | TF+1 | ⚠
//   • Regime filter pills + sort by column + TV download

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Loader2, AlertTriangle, Download, ArrowUpDown } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { volatilityApi } from '../../lib/api'
import type { WatchlistOut, WatchlistPairOut } from '../../types/api'

const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const
type TF = typeof TIMEFRAMES[number]

const REGIMES = ['ALL', 'DEAD', 'CALM', 'NORMAL', 'TRENDING', 'ACTIVE', 'EXTREME'] as const

const REGIME_COLOR_HEX: Record<string, string> = {
  DEAD:     '#a1a1aa',
  CALM:     '#0ea5e9',
  NORMAL:   '#10b981',
  TRENDING: '#eab308',
  ACTIVE:   '#f97316',
  EXTREME:  '#ef4444',
}

const REGIME_EMOJI: Record<string, string> = {
  DEAD: '⬜', CALM: '💧', NORMAL: '✅', TRENDING: '📈', ACTIVE: '⚡', EXTREME: '🔥',
}

const EMA_DISPLAY: Record<string, { label: string; color: string; symbol: string }> = {
  above_all:   { label: 'Above All',  color: '#10b981', symbol: '▲' },
  below_all:   { label: 'Below All',  color: '#ef4444', symbol: '▼' },
  breakout_up: { label: 'Breakout ↑', color: '#0ea5e9', symbol: '🚀' },
  mixed:       { label: 'Mixed',      color: '#71717a', symbol: '∿' },
}

type SortKey = 'vi_score' | 'change_24h' | 'pair'

// ── Helpers ───────────────────────────────────────────────────────────────

function alertIcon(p: WatchlistPairOut): string {
  if (p.regime === 'EXTREME') return '⚠️'
  if (p.regime === 'DEAD')    return '⛔'
  if (p.alert)                return '🔔'
  return ''
}

function formatPair(symbol: string): { base: string; quote: string } {
  if (symbol.endsWith('USDT')) return { base: symbol.slice(0, -4), quote: 'USDT' }
  if (symbol.endsWith('BUSD')) return { base: symbol.slice(0, -4), quote: 'BUSD' }
  return { base: symbol, quote: '' }
}

function downloadTV(pairs: WatchlistPairOut[], tf: string) {
  const lines = pairs.map((p) => `BINANCE:${p.pair}`).join('\n')
  const blob = new Blob([lines], { type: 'text/plain' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `watchlist_${tf}_${new Date().toISOString().slice(0, 10)}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

// ── TF Summary card ──────────────────────────────────────────────────────

function TFCard({
  tf,
  data,
  hasError,
  active,
  loading,
  onClick,
}: {
  tf: TF
  data: WatchlistOut | undefined
  hasError: boolean
  active: boolean
  loading: boolean
  onClick: () => void
}) {
  const color = REGIME_COLOR_HEX[data?.regime ?? ''] ?? '#71717a'
  return (
    <button
      onClick={onClick}
      style={{ borderLeftColor: active ? color : 'transparent' }}
      className={`text-left p-3 rounded-xl border border-zinc-800 border-l-4 transition-all ${
        active ? 'bg-zinc-800' : 'bg-zinc-950 hover:bg-zinc-900'
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest">{tf}</span>
        {loading && !data ? (
          <Loader2 size={10} className="animate-spin text-zinc-600" />
        ) : data ? (
          <span className="text-xs font-mono text-zinc-500">{data.pairs_count} pairs</span>
        ) : null}
      </div>
      {hasError && !data ? (
        <span className="text-xs text-zinc-700">No data yet</span>
      ) : data ? (
        <>
          <div className="flex items-center gap-1.5">
            <span className="text-base leading-none">{REGIME_EMOJI[data.regime] ?? ''}</span>
            <span className="text-xs font-bold tracking-wider" style={{ color }}>{data.regime}</span>
          </div>
          <div className="text-xs text-zinc-700 mt-0.5">
            {new Date(data.generated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} UTC
          </div>
        </>
      ) : (
        <span className="text-xs text-zinc-700">Loading…</span>
      )}
    </button>
  )
}

// ── Sort header ───────────────────────────────────────────────────────────

function SortTh({
  label,
  col,
  active,
  desc,
  onClick,
  className,
}: {
  label: string
  col: SortKey
  active: boolean
  desc: boolean
  onClick: () => void
  className?: string
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
      </span>
    </th>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

export function WatchlistsPage() {
  const [activeTF, setActiveTF] = useState<TF>('1h')
  const [watchlists, setWatchlists] = useState<Partial<Record<TF, WatchlistOut>>>({})
  const [loading, setLoading] = useState(true)
  const [errors, setErrors]   = useState<Partial<Record<TF, boolean>>>({})
  const [regimeFilter, setRegimeFilter] = useState<string>('ALL')
  const [sortKey, setSortKey]   = useState<SortKey>('vi_score')
  const [sortDesc, setSortDesc] = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const results = await Promise.allSettled(
      TIMEFRAMES.map((tf) => volatilityApi.getWatchlist(tf))
    )
    const wl: Partial<Record<TF, WatchlistOut>> = {}
    const errs: Partial<Record<TF, boolean>>    = {}
    results.forEach((r, i) => {
      const tf = TIMEFRAMES[i]
      if (r.status === 'fulfilled') wl[tf]   = r.value
      else                          errs[tf] = true
    })
    setWatchlists(wl)
    setErrors(errs)
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((d) => !d)
    else { setSortKey(key); setSortDesc(true) }
  }

  const activeData = watchlists[activeTF]

  const filteredPairs = useMemo<WatchlistPairOut[]>(() => {
    if (!activeData) return []
    let rows = [...activeData.pairs]
    if (regimeFilter !== 'ALL') rows = rows.filter((p) => p.regime === regimeFilter)
    rows.sort((a, b) => {
      if (sortKey === 'pair') {
        return sortDesc
          ? b.pair.localeCompare(a.pair)
          : a.pair.localeCompare(b.pair)
      }
      const av = (a[sortKey] ?? -Infinity) as number
      const bv = (b[sortKey] ?? -Infinity) as number
      return sortDesc ? bv - av : av - bv
    })
    return rows
  }, [activeData, regimeFilter, sortKey, sortDesc])

  const regimeCounts = useMemo(() => {
    if (!activeData) return {}
    return activeData.pairs.reduce<Record<string, number>>((acc, p) => {
      acc[p.regime] = (acc[p.regime] ?? 0) + 1
      return acc
    }, {})
  }, [activeData])

  return (
    <div className="space-y-5">
      {/* ── Topbar ── */}
      <div className="flex items-center justify-between">
        <PageHeader
          icon="👁"
          title="Pair Watchlists"
          subtitle="Per-TF volatility ranking — all selected pairs"
        />
        <div className="flex items-center gap-2">
          <Link
            to="/volatility/market"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Market VI
          </Link>
          <button
            onClick={fetchAll}
            disabled={loading}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      {/* ── TF Summary Strip ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {TIMEFRAMES.map((tf) => (
          <TFCard
            key={tf}
            tf={tf}
            data={watchlists[tf]}
            hasError={!!errors[tf]}
            active={tf === activeTF}
            loading={loading}
            onClick={() => setActiveTF(tf)}
          />
        ))}
      </div>

      {/* ── Active TF content ── */}
      {loading && !activeData ? (
        <div className="flex justify-center items-center h-48">
          <Loader2 size={28} className="animate-spin text-zinc-600" />
        </div>
      ) : errors[activeTF] && !activeData ? (
        <div className="flex items-center gap-3 p-6 rounded-xl border border-zinc-800 text-zinc-500 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          No watchlist data for {activeTF.toUpperCase()} — the Celery pair task has not run yet.
          Wait for the next scheduled run or check Celery logs.
        </div>
      ) : activeData ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">

          {/* ── Filter + stats bar ── */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-zinc-800">
            <div className="flex gap-1 flex-wrap">
              {REGIMES.map((r) => {
                const count  = r === 'ALL' ? activeData.pairs_count : (regimeCounts[r] ?? 0)
                const rColor = r !== 'ALL' ? REGIME_COLOR_HEX[r] : undefined
                const isActive = r === regimeFilter
                if (r !== 'ALL' && count === 0) return null
                return (
                  <button
                    key={r}
                    onClick={() => setRegimeFilter(r)}
                    className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                      isActive ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                    style={isActive && rColor ? { color: rColor } : {}}
                  >
                    {r !== 'ALL' && REGIME_EMOJI[r]} {r}
                    {r !== 'ALL' && count > 0 && (
                      <span className="ml-1 opacity-60">{count}</span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-zinc-600 font-mono">
                {filteredPairs.length === activeData.pairs_count
                  ? `${activeData.pairs_count} pairs`
                  : `${filteredPairs.length} / ${activeData.pairs_count}`}
              </span>
              <span className="text-xs text-zinc-700">
                {new Date(activeData.generated_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
              </span>
              <button
                onClick={() => downloadTV(activeData.pairs, activeTF)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                title="Download TradingView watchlist (.txt)"
              >
                <Download size={11} />
                TV Export
              </button>
            </div>
          </div>

          {/* ── Table ── */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[700px]">
              <thead className="bg-zinc-900/50">
                <tr className="border-b border-zinc-800">
                  <th className="px-4 py-2.5 text-left text-zinc-600 font-mono w-10">#</th>
                  <SortTh label="PAIR"   col="pair"      active={sortKey === 'pair'}      desc={sortDesc} onClick={() => handleSort('pair')}      className="w-32" />
                  <SortTh label="VI"     col="vi_score"  active={sortKey === 'vi_score'}  desc={sortDesc} onClick={() => handleSort('vi_score')}  className="w-36" />
                  <th className="px-4 py-2.5 text-left text-zinc-500 font-mono">REGIME</th>
                  <th className="px-4 py-2.5 text-left text-zinc-500 font-mono">EMA</th>
                  <SortTh label="24H%"  col="change_24h" active={sortKey === 'change_24h'} desc={sortDesc} onClick={() => handleSort('change_24h')} className="w-24" />
                  <th className="px-4 py-2.5 text-left text-zinc-500 font-mono">TF+1</th>
                  <th className="px-4 py-2.5 text-center text-zinc-500 font-mono w-12">⚠</th>
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

                  return (
                    <tr
                      key={p.pair}
                      className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors"
                    >
                      {/* rank */}
                      <td className="px-4 py-2.5 text-zinc-700 font-mono">{i + 1}</td>

                      {/* pair */}
                      <td className="px-4 py-2.5 font-mono font-bold text-zinc-200">
                        {base}
                        <span className="text-zinc-600 font-normal text-xs">{quote}</span>
                      </td>

                      {/* VI score + bar */}
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden shrink-0">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{ width: `${viPct}%`, background: rColor }}
                            />
                          </div>
                          <span
                            className="font-mono font-black text-sm w-7 text-right leading-none"
                            style={{ color: rColor }}
                          >
                            {viPct}
                          </span>
                        </div>
                      </td>

                      {/* regime */}
                      <td className="px-4 py-2.5">
                        <span
                          className="font-mono text-xs font-bold tracking-wider"
                          style={{ color: rColor }}
                        >
                          {REGIME_EMOJI[p.regime]} {p.regime}
                        </span>
                      </td>

                      {/* EMA signal */}
                      <td className="px-4 py-2.5 font-mono" style={{ color: ema.color }}>
                        <span className="mr-1">{ema.symbol}</span>
                        {ema.label}
                      </td>

                      {/* 24h% */}
                      <td className="px-4 py-2.5 font-mono text-right tabular-nums">
                        {chg !== null ? (
                          <span className={chg >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </td>

                      {/* TF+1 regime */}
                      <td className="px-4 py-2.5">
                        {p.tf_sup_regime ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs leading-none">{REGIME_EMOJI[p.tf_sup_regime] ?? ''}</span>
                            <span
                              className="font-mono text-xs"
                              style={{ color: tfSupColor }}
                            >
                              {p.tf_sup_regime}
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-700">—</span>
                        )}
                      </td>

                      {/* alert */}
                      <td className="px-4 py-2.5 text-center text-base leading-none">
                        {alert}
                      </td>
                    </tr>
                  )
                })}

                {filteredPairs.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-10 text-center text-zinc-600"
                    >
                      No pairs match the filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  )
}
