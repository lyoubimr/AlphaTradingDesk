// ── MarketVIPage ─────────────────────────────────────────────────────────────
// Page /volatility/market — Market VI dashboard.
//
// Layout:
//   • Default view: Aggregated Market VI gauge (cross-TF 25/40/25/10)
//       + 4 TF mini-cards (15m / 1h / 4h / 1d)
//   • TF selector: drill-down into a single timeframe
//       → Gauge + session sparkline + components breakdown + pair context

import { useEffect, useRef, useState, useCallback } from 'react'
import { RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { MarketVIGauge } from '../../components/volatility/MarketVIGauge'
import { RegimeBadge } from '../../components/volatility/RegimeBadge'
import { VISparkline } from '../../components/volatility/VISparkline'
import { VIHistoryChart } from '../../components/volatility/VIHistoryChart'
import { volatilityApi } from '../../lib/api'
import type { AggregatedMarketVIOut, MarketVIOut, PairVIOut, TFComponentOut } from '../../types/api'

const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const
type TF = typeof TIMEFRAMES[number]
const REFRESH_MS = 60_000  // 60s auto-refresh

interface SparkPoint { score: number; ts: number }

// Regime → Tailwind text color for score numbers
const REGIME_SCORE_COLOR: Record<string, string> = {
  DEAD:     'text-zinc-400',
  CALM:     'text-sky-400',
  NORMAL:   'text-emerald-400',
  TRENDING: 'text-yellow-400',
  ACTIVE:   'text-orange-400',
  EXTREME:  'text-red-400',
}

// Regime → hex color (inline style — avoids Tailwind JIT purge of dynamic class names)
const REGIME_COLOR_HEX: Record<string, string> = {
  DEAD:     '#a1a1aa',  // zinc-400 — brighter than zinc-500 for dark theme
  CALM:     '#0ea5e9',
  NORMAL:   '#10b981',
  TRENDING: '#eab308',
  ACTIVE:   '#f97316',
  EXTREME:  '#ef4444',
}

// Regime → standalone emoji (hero display only)
const REGIME_EMOJI: Record<string, string> = {
  DEAD:     '⬜',
  CALM:     '💧',
  NORMAL:   '✅',
  TRENDING: '📈',
  ACTIVE:   '⚡',
  EXTREME:  '🔥',
}

// Regime → one-line trading description shown in the hero card
const REGIME_DESCRIPTION: Record<string, string> = {
  DEAD:     'Market asleep — stay flat, zero edge',
  CALM:     'Low momentum — reduce size, scalp only',
  NORMAL:   'Standard conditions — apply usual strategy',
  TRENDING: 'Strong momentum — favor trend-following',
  ACTIVE:   'High activity — breakouts frequent, tight SL',
  EXTREME:  'Extreme volatility — minimize exposure',
}

// ── Component label map ────────────────────────────────────────────────────

const COMPONENT_LABELS: Record<string, string> = {
  rvol:      'Relative Volume',
  mfi:       'Money Flow Index',
  atr:       'ATR Normalised',
  bb_width:  'Bollinger Width',
  ema_score: 'EMA Score',
  depth:     'Order Book Depth',
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ComponentBar({ name, value }: { name: string; value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  const barColor =
    pct >= 80 ? 'bg-red-400' :
    pct >= 60 ? 'bg-orange-400' :
    pct >= 40 ? 'bg-yellow-400' :
    pct >= 20 ? 'bg-emerald-400' :
                'bg-zinc-500'

  return (
    <div className="flex items-center gap-3">
      <span className="w-36 text-xs text-zinc-400 truncate">{COMPONENT_LABELS[name] ?? name}</span>
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-mono text-zinc-300">{pct}</span>
    </div>
  )
}

function PairContextCard({ pair }: { pair: PairVIOut }) {
  return (
    <div className="bg-surface-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-zinc-200">{pair.pair}</span>
        <RegimeBadge regime={pair.regime} size="sm" />
      </div>
      <div className="text-2xl font-mono font-bold text-zinc-100">
        {(pair.vi_score * 100).toFixed(0)}
        <span className="text-sm font-normal text-zinc-500 ml-1">/ 100</span>
      </div>
      {pair.components?.ema_signal && (
        <span className="text-xs text-zinc-400">
          EMA: {String(pair.components.ema_signal).replace('_', ' ')}
        </span>
      )}
    </div>
  )
}

// ── TF mini-card (used in aggregated view) ───────────────────────────────

function TFMiniCard({ component, onClick, active }: {
  component: TFComponentOut
  onClick: () => void
  active: boolean
}) {
  const pct = Math.round(component.vi_score * 100)
  const scoreColor = REGIME_SCORE_COLOR[component.regime] ?? 'text-zinc-300'
  const borderColor = REGIME_COLOR_HEX[component.regime] ?? '#71717a'
  const emoji = REGIME_EMOJI[component.regime] ?? ''
  return (
    <button
      onClick={onClick}
      style={{ borderLeftColor: borderColor }}
      className={`relative text-left p-4 rounded-xl border border-zinc-800 border-l-4 transition-all ${
        active ? 'bg-zinc-800' : 'bg-zinc-950 hover:bg-zinc-900'
      }`}
    >
      {/* TF label + weight pill */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-mono font-bold text-zinc-400 uppercase tracking-widest">{component.tf}</span>
        <span
          className="text-xs font-mono rounded px-1.5 py-0.5 border"
          style={{ color: borderColor, borderColor: `${borderColor}50`, background: `${borderColor}12` }}
        >
          {Math.round(component.weight * 100)}%
        </span>
      </div>
      {/* Score with glow */}
      <div
        className={`text-4xl font-black font-mono leading-none mb-1 ${scoreColor}`}
        style={{ textShadow: `0 0 24px ${borderColor}55` }}
      >
        {pct}
      </div>
      <div className="text-xs font-mono text-zinc-600 mb-3">/100</div>
      {/* Regime — emoji + text, no badge component = no truncation */}
      <div className="flex items-center gap-1.5">
        <span className="text-base leading-none">{emoji}</span>
        <span className="text-xs font-bold tracking-wider" style={{ color: borderColor }}>
          {component.regime}
        </span>
      </div>
    </button>
  )
}

// ── Main page component ───────────────────────────────────────────────────

export function MarketVIPage() {
  // null = aggregated view, otherwise a TF drill-down
  const [activeTF, setActiveTF] = useState<TF | null>(null)

  const [aggregated, setAggregated] = useState<AggregatedMarketVIOut | null>(null)
  const [tfData, setTfData] = useState<MarketVIOut | null>(null)
  const [pairsData, setPairsData] = useState<PairVIOut[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sparkPoints, setSparkPoints] = useState<SparkPoint[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAggregated = useCallback(async () => {
    try {
      setError(null)
      const agg = await volatilityApi.getAggregatedMarketVI()
      setAggregated(agg)
      setSparkPoints((prev) => {
        const point = { score: agg.vi_score, ts: Date.now() }
        return [...prev.slice(-47), point]
      })
    } catch {
      setError('No aggregated data yet — run at least one VI compute cycle.')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTF = useCallback(async (tf: TF) => {
    try {
      setError(null)
      const [marketVI, pairsVI] = await Promise.allSettled([
        volatilityApi.getMarketVI(tf),
        volatilityApi.getPairsVI(tf),
      ])
      if (marketVI.status === 'fulfilled') {
        const snap = marketVI.value
        setTfData(snap)
        setSparkPoints((prev) => {
          const point = { score: snap.vi_score, ts: Date.now() }
          return [...prev.slice(-47), point]
        })
      } else {
        setError(`No data available for ${tf} — VI engine has not run yet.`)
      }
      if (pairsVI.status === 'fulfilled') {
        const btc = pairsVI.value.pairs.find((p) =>
          p.pair.toLowerCase().includes('btc') || p.pair.toLowerCase().includes('xbt')
        )
        const eth = pairsVI.value.pairs.find((p) => p.pair.toLowerCase().includes('eth'))
        setPairsData([btc, eth].filter(Boolean) as PairVIOut[])
      }
    } catch {
      setError('Network error — check that the backend is reachable.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load + auto-refresh
  useEffect(() => {
    setLoading(true)
    setSparkPoints([])

    // Pre-populate sparkline from DB history (up to 48 points)
    const historyTF = activeTF ?? 'aggregated'
    volatilityApi.getMarketVIHistory(historyTF, 48)
      .then((snaps) => {
        setSparkPoints(snaps.map((s) => ({ score: s.vi_score, ts: new Date(s.timestamp).getTime() })))
      })
      .catch(() => {/* no history yet — sparkline will fill in real time */})

    if (activeTF === null) {
      fetchAggregated()
      intervalRef.current = setInterval(fetchAggregated, REFRESH_MS)
    } else {
      fetchTF(activeTF)
      intervalRef.current = setInterval(() => fetchTF(activeTF), REFRESH_MS)
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [activeTF, fetchAggregated, fetchTF])

  const handleManualRefresh = () => {
    setLoading(true)
    if (activeTF === null) fetchAggregated()
    else fetchTF(activeTF)
  }

  // BTC components proxy for the TF drill-down view
  const btcComponents = pairsData.find((p) =>
    p.pair.toLowerCase().includes('btc') || p.pair.toLowerCase().includes('xbt')
  )?.components ?? {}
  const componentEntries = Object.entries(btcComponents)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => ({ name: k, value: v as number }))
    .sort((a, b) => b.value - a.value)

  // Display score + regime for the hero gauge
  const heroScore = activeTF === null ? (aggregated?.vi_score ?? null) : (tfData?.vi_score ?? null)
  const heroRegime = activeTF === null ? (aggregated?.regime ?? '') : (tfData?.regime ?? '')
  const heroTs = activeTF === null ? (aggregated?.timestamp ?? '') : (tfData?.timestamp ?? '')
  const heroColor = REGIME_COLOR_HEX[heroRegime] ?? '#a1a1aa'

  return (
    <div className="space-y-5">
      {/* ── Topbar ── */}
      <div className="flex items-center justify-between">
        <PageHeader
          icon="📊"
          title="Crypto Market VI"
          subtitle="Binance Futures — crypto volatility index"
        />
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            <button
              onClick={() => { setActiveTF(null); setSparkPoints([]) }}
              className={`px-3 py-1 text-xs font-mono rounded-md transition-colors ${
                activeTF === null ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >ALL</button>
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => { setActiveTF(t); setSparkPoints([]) }}
                className={`px-3 py-1 text-xs font-mono rounded-md transition-colors ${
                  t === activeTF ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >{t}</button>
            ))}
          </div>
          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && !loading && (
        <div className="flex items-center gap-3 p-4 bg-amber-950 border border-amber-800 rounded-lg text-amber-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && heroScore === null ? (
        <div className="flex justify-center items-center h-48">
          <Loader2 size={32} className="animate-spin text-zinc-500" />
        </div>
      ) : heroScore !== null ? (
        <>
          {/* ── 2-col layout: hero gauge left | sparkline + cards right ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* ── Left col — gauge card ── */}
            <div
              className="relative lg:col-span-1 rounded-xl border border-zinc-800 border-l-4 p-5 flex flex-col items-center gap-3"
              style={{
                borderLeftColor: heroColor,
                background: `linear-gradient(160deg, ${heroColor}10 0%, transparent 60%)`,
              }}
            >
              {/* Shimmer top */}
              <div className="absolute inset-x-0 top-0 h-px opacity-50" style={{ background: `linear-gradient(90deg, transparent, ${heroColor}, transparent)` }} />
              <MarketVIGauge score={heroScore} size={190} />
              {/* Regime emoji + label */}
              <div className="flex items-center gap-2">
                <span className="text-2xl leading-none">{REGIME_EMOJI[heroRegime] ?? ''}</span>
                <span
                  className="text-2xl font-black tracking-tight leading-none"
                  style={{ color: heroColor, textShadow: `0 0 30px ${heroColor}50` }}
                >
                  {heroRegime || '—'}
                </span>
              </div>
              {/* Description */}
              <p className="text-xs text-zinc-400 text-center px-2 leading-relaxed">
                {REGIME_DESCRIPTION[heroRegime] ?? ''}
              </p>
              {/* Meta */}
              <div className="w-full border-t border-zinc-800 pt-3 flex flex-col items-center gap-1.5">
                <div className="flex flex-wrap justify-center items-center gap-2">
                  <span
                    className="text-xs font-mono rounded px-2 py-0.5 border"
                    style={{ color: heroColor, borderColor: `${heroColor}40`, background: `${heroColor}10` }}
                  >
                    {activeTF ? activeTF.toUpperCase() : 'AGGREGATED'}
                  </span>
                  <span className="text-xs font-mono text-zinc-500">
                    raw <span className="text-zinc-300">{heroScore.toFixed(3)}</span>
                  </span>
                </div>
                <span className="text-xs text-zinc-600">
                  {heroTs ? new Date(heroTs).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                </span>
                {activeTF === null && aggregated?.is_weekend && (
                  <span className="mt-1 text-xs text-amber-400 bg-amber-950 border border-amber-800 px-2 py-0.5 rounded-full">
                    🌙 Weekend weights (75 / 25)
                  </span>
                )}
              </div>
            </div>

            {/* ── Right col — sparkline + TF cards / components ── */}
            <div className="lg:col-span-2 flex flex-col gap-4">

              {/* Sparkline */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-zinc-400">📈 Session trend</span>
                  <span className="text-xs font-mono text-zinc-600">{sparkPoints.length} pts</span>
                </div>
                <VISparkline points={sparkPoints} height={80} color={heroColor} />
              </div>

              {/* TF breakdown — aggregated view */}
              {activeTF === null && aggregated && aggregated.tf_components.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-semibold text-zinc-400 mb-3">⏱ Per-TF breakdown — click to drill down</p>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {aggregated.tf_components.map((c) => (
                      <TFMiniCard
                        key={c.tf}
                        component={c}
                        active={activeTF === c.tf}
                        onClick={() => { setActiveTF(c.tf as TF); setSparkPoints([]) }}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Components — TF drill-down */}
              {activeTF !== null && componentEntries.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <p className="text-xs font-semibold text-zinc-400 mb-4">Components — BTC proxy ({activeTF})</p>
                  <div className="flex flex-col gap-3">
                    {componentEntries.map(({ name, value }) => (
                      <ComponentBar key={name} name={name} value={value} />
                    ))}
                  </div>
                </div>
              )}

            </div>
          </div>

          {/* ── Pair context (TF drill-down only) ── */}
          {activeTF !== null && pairsData.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Key pairs context</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {pairsData.map((p) => (
                  <PairContextCard key={p.pair} pair={p} />
                ))}
              </div>
            </div>
          )}

          {/* ── History charts ── */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">History</p>
            {activeTF === null ? (
              /* ALL view: aggregated (full-size) + 4 TF mini charts */
              <div className="space-y-4">
                <VIHistoryChart timeframe="aggregated" defaultColor={heroColor} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {TIMEFRAMES.map((tf) => (
                    <VIHistoryChart key={tf} timeframe={tf} compact />
                  ))}
                </div>
              </div>
            ) : (
              /* TF drill-down: single chart for that TF */
              <VIHistoryChart timeframe={activeTF} defaultColor={heroColor} />
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

