// ── MarketVIPage ─────────────────────────────────────────────────────────────
// Page /volatility/market — Market VI dashboard.
//
// Layout:
//   • Default view: Aggregated Market VI gauge (cross-TF 25/40/25/10)
//       + 4 TF mini-cards (15m / 1h / 4h / 1d)
//   • TF selector: drill-down into a single timeframe
//       → Gauge + session sparkline + components breakdown + pair context

import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { RefreshCw, Loader2, AlertTriangle, Play, BookOpen, Bell } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { Tooltip } from '../../components/ui/Tooltip'
import { MarketVIGauge } from '../../components/volatility/MarketVIGauge'
import { VISparkline } from '../../components/volatility/VISparkline'
import { VIHistoryChart } from '../../components/volatility/VIHistoryChart'
import { VolatilityLegendPanel } from '../../components/volatility/VolatilityLegendPanel'
import { volatilityApi } from '../../lib/api'
import { useProfile } from '../../context/ProfileContext'
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
  TRENDING: 'text-indigo-400',    // indigo — gem color — sweet spot trading regime
  ACTIVE:   'text-amber-400',     // amber — elevated but not alarming
  EXTREME:  'text-red-400',
}

// Regime → hex color (inline style — avoids Tailwind JIT purge of dynamic class names)
const REGIME_COLOR_HEX: Record<string, string> = {
  DEAD:     '#a1a1aa',  // zinc-400 — brighter than zinc-500 for dark theme
  CALM:     '#0ea5e9',
  NORMAL:   '#10b981',  // emerald-500 — standard green
  TRENDING: '#818cf8',  // indigo-400 — gem color — sweet spot trading regime
  ACTIVE:   '#f59e0b',  // amber-400  — elevated but not alarming
  EXTREME:  '#ef4444',
}

// Regime → standalone emoji (hero display only)
const REGIME_EMOJI: Record<string, string> = {
  DEAD:     '⬜',
  CALM:     '💧',
  NORMAL:   '📊',
  TRENDING: '💎',
  ACTIVE:   '⚠️',
  EXTREME:  '🚫',
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

// ── Sub-components ─────────────────────────────────────────────────────────

// ── Pair symbol formatter (Kraken Futures: PF_XBTUSD → XBT/USD) ──────────
function formatPair(symbol: string): { base: string; quote: string } {
  const kf = symbol.match(/^(?:PF|PI|FF)_([A-Z0-9]+?)(USD|USDT|EUR|GBP|XBT)$/)
  if (kf) return { base: kf[1].replace('XBT', 'BTC'), quote: kf[2] }
  if (symbol.endsWith('USDT')) return { base: symbol.slice(0, -4), quote: 'USDT' }
  if (symbol.endsWith('BTC'))  return { base: symbol.slice(0, -3), quote: 'BTC'  }
  // Plain Kraken perps: XBTUSD, ETHUSD, etc.
  if (symbol.endsWith('USD'))  return { base: symbol.slice(0, -3).replace('XBT', 'BTC'), quote: 'USD' }
  if (symbol.endsWith('EUR'))  return { base: symbol.slice(0, -3).replace('XBT', 'BTC'), quote: 'EUR' }
  return { base: symbol.replace('XBT', 'BTC'), quote: '' }
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
  const { activeProfileId: profileId } = useProfile()
  const navigate = useNavigate()
  // null = aggregated view, otherwise a TF drill-down
  const [activeTF, setActiveTF] = useState<TF | null>(null)
  const [showLegend, setShowLegend] = useState(false)
  const [showAllPairs, setShowAllPairs] = useState(false)
  const [alertToast, setAlertToast] = useState<string | null>(null)

  const [aggregated, setAggregated] = useState<AggregatedMarketVIOut | null>(null)
  const [tfData, setTfData] = useState<MarketVIOut | null>(null)
  const [pairsData, setPairsData] = useState<PairVIOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sparkPoints, setSparkPoints] = useState<SparkPoint[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAggregated = useCallback(async (skipSpark = false) => {
    try {
      setError(null)
      const [aggResult, pairsResult] = await Promise.allSettled([
        volatilityApi.getAggregatedMarketVI(),
        volatilityApi.getPairsVI('1h'),
      ])
      if (aggResult.status === 'fulfilled') {
        const agg = aggResult.value
        setAggregated(agg)
        if (!skipSpark) {
          setSparkPoints((prev) => {
            const point = { score: agg.vi_score, ts: Date.now() }
            return [...prev.slice(-47), point]
          })
        }
      } else {
        setError('No aggregated data yet — run at least one VI compute cycle.')
      }
      if (pairsResult.status === 'fulfilled') {
        setPairsData(pairsResult.value.pairs)
      }
    } catch {
      setError('No aggregated data yet — run at least one VI compute cycle.')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTF = useCallback(async (tf: TF, skipSpark = false) => {
    try {
      setError(null)
      const [marketVI, pairsVI] = await Promise.allSettled([
        volatilityApi.getMarketVI(tf),
        volatilityApi.getPairsVI(tf),
      ])
      if (marketVI.status === 'fulfilled') {
        const snap = marketVI.value
        setTfData(snap)
        if (!skipSpark) {
          setSparkPoints((prev) => {
            const point = { score: snap.vi_score, ts: Date.now() }
            return [...prev.slice(-47), point]
          })
        }
      } else {
        setError(`No data available for ${tf} — VI engine has not run yet.`)
      }
      if (pairsVI.status === 'fulfilled') {
        setPairsData(pairsVI.value.pairs)  // store ALL pairs
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
    setPairsData([])  // reset stale cross-TF pairs on every TF switch

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
    if (activeTF === null) fetchAggregated(true)
    else fetchTF(activeTF, true)
  }

  const handleRunTask = useCallback(async () => {
    setIsRunning(true)
    setRunStatus(null)
    try {
      if (activeTF === null) {
        // ALL view → queue all 4 timeframes in parallel
        await Promise.allSettled(
          (TIMEFRAMES as readonly string[]).map((tf) => volatilityApi.runTask('market-vi', tf))
        )
        setRunStatus('⏳ Compute queued for ALL timeframes (15m+1h+4h+1d) — data ready in ~60 s')
        setTimeout(() => handleManualRefresh(), 25_000)
        setTimeout(() => { setRunStatus(null); handleManualRefresh() }, 55_000)
      } else {
        await volatilityApi.runTask('market-vi', activeTF)
        setRunStatus(`⏳ Compute queued for Market VI ${activeTF.toUpperCase()} — data ready in ~30 s`)
        setTimeout(() => handleManualRefresh(), 20_000)
        setTimeout(() => { setRunStatus(null); handleManualRefresh() }, 40_000)
      }
    } catch {
      setRunStatus('❌ Failed to queue — check that Celery worker is running')
    } finally {
      setIsRunning(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTF])

  // Display score + regime for the hero gauge
  const heroScore  = activeTF === null ? (aggregated?.vi_score ?? null) : (tfData?.vi_score ?? null)
  const heroRegime = activeTF === null ? (aggregated?.regime ?? '') : (tfData?.regime ?? '')
  const heroTs     = activeTF === null ? (aggregated?.timestamp ?? '') : (tfData?.timestamp ?? '')
  const heroColor  = REGIME_COLOR_HEX[heroRegime] ?? '#a1a1aa'

  // Create alert from chart (right-click or smart suggestion)
  const handleCreateAlert = useCallback(async (level: number, timeframe: string) => {
    if (!profileId) { navigate('/settings/notifications'); return }
    try {
      const current = await volatilityApi.getNotificationSettings(profileId)
      const existing: unknown[] = (current.market_vi_alerts as Record<string, unknown>)?.vi_levels as unknown[] ?? []
      const tfLabel = timeframe === 'aggregated' ? 'AGG' : timeframe.toUpperCase()
      const newLevel = {
        id:           Date.now().toString(),
        label:        `Chart alert VI = ${level} [${tfLabel}]`,
        type:         'crossing',
        value:        level,
        direction:    'both',
        tolerance:    0.5,
        enabled:      true,
        cooldown_min: 30,
        timeframe:    timeframe,
      }
      await volatilityApi.updateNotificationSettings(profileId, {
        market_vi_alerts: {
          ...(current.market_vi_alerts as Record<string, unknown>),
          vi_levels: [...existing, newLevel],
        },
      })
      setAlertToast(`✅ Alert set at VI = ${level}`)
    } catch {
      setAlertToast(`⚠️ Could not save alert — configure in Settings`)
    }
    setTimeout(() => setAlertToast(null), 4000)
  }, [profileId, navigate])

  return (
    <div className="space-y-4">
      {/* ── Topbar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <PageHeader
          icon="📊"
          title="Market VI"
          subtitle="Kraken Futures — crypto volatility index"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            <button
              onClick={() => { setActiveTF(null); setSparkPoints([]) }}
              className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                activeTF === null ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >ALL</button>
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => { setActiveTF(t); setSparkPoints([]) }}
                className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors ${
                  t === activeTF ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >{t}</button>
            ))}
          </div>
          <button
            onClick={handleRunTask}
            disabled={isRunning}
            title={activeTF === null
              ? 'Queue compute_market_vi for all 4 TFs (15m+1h+4h+1d) — ~60 s'
              : `Queue compute_market_vi for ${activeTF} — ~30 s`
            }
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-lg border border-emerald-800 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950 transition-colors disabled:opacity-50"
          >
            {isRunning ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            Run {activeTF ? activeTF.toUpperCase() : 'ALL'}
          </button>
          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Refresh displayed data"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          {/* Legend panel */}
          <div className="relative">
            <button
              onClick={() => setShowLegend((v) => !v)}
              className={`p-2 rounded-lg transition-colors ${
                showLegend ? 'text-zinc-200 bg-zinc-700' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
              title="Legend — Regimes & EMA signals"
            >
              <BookOpen size={14} />
            </button>
            {showLegend && <VolatilityLegendPanel onClose={() => setShowLegend(false)} />}
          </div>
        </div>
      </div>

      {/* ── Alert toast ── */}
      {alertToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl text-sm text-slate-200">
          <Bell size={14} className="text-amber-400 shrink-0" />
          {alertToast}
          <button onClick={() => navigate('/settings/notifications')} className="ml-2 text-xs text-brand-400 hover:underline">Configure</button>
        </div>
      )}

      {/* ── Status banner ── */}
      {runStatus && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-300">
          {runStatus}
        </div>
      )}

      {/* ── Regime legend ── */}
      <div className="flex items-center gap-1 flex-wrap">
        {([
          { regime: 'DEAD',     label: '< 17',  color: '#a1a1aa' },
          { regime: 'CALM',     label: '17–33', color: '#0ea5e9' },
          { regime: 'NORMAL',   label: '33–50', color: '#10b981' },
          { regime: 'TRENDING', label: '50–67', color: '#059669' },
          { regime: 'ACTIVE',   label: '67–83', color: '#f59e0b' },
          { regime: 'EXTREME',  label: '> 83',  color: '#ef4444' },
        ] as const).map(({ regime, label, color }) => (
          <span
            key={regime}
            title={REGIME_DESCRIPTION[regime]}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-xs font-mono cursor-help"
          >
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
            <span style={{ color }}>{regime}</span>
            <span className="text-zinc-600">{label}</span>
          </span>
        ))}
      </div>

      {/* ── Error ── */}
      {error && !loading && (
        <div className="flex items-center gap-3 p-4 bg-amber-950 border border-amber-800 rounded-lg text-amber-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <div className="flex-1">
            {error}
            <p className="text-xs text-amber-400/70 mt-1">Click <strong>Run</strong> to trigger a compute cycle, or wait for the scheduled Celery beat.</p>
          </div>
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
              {/* Tooltip on score */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-600 font-mono">composite VI score</span>
                <Tooltip text="Weighted average of Kraken Futures pair VI scores. Formula: mean(RVOL, MFI, ATR, Bollinger Width). EMA score is stored but NOT included — it is only used as a ranking boost in watchlists." maxWidth={260} />
              </div>
              {/* Regime emoji + label */}
              <div className="flex items-center gap-2">
                <span className="text-2xl leading-none">{REGIME_EMOJI[heroRegime] ?? ''}</span>
                <span
                  className="text-2xl font-black tracking-tight leading-none"
                  style={{ color: heroColor, textShadow: `0 0 30px ${heroColor}50` }}
                >
                  {heroRegime || '—'}
                </span>
                <Tooltip text={`DEAD <17 | CALM 17–33 | NORMAL 33–50 | TRENDING 50–67 | ACTIVE 67–83 | EXTREME >83`} maxWidth={180} />
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
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-zinc-600">{sparkPoints.length} pts</span>
                    <Tooltip text="Score sampled each auto-refresh cycle (60 s). Shows intra-session VI evolution." />
                  </div>
                </div>
                <VISparkline points={sparkPoints} height={80} color={heroColor} />
              </div>

              {/* TF breakdown — aggregated view */}
              {activeTF === null && aggregated && aggregated.tf_components.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-xs font-semibold text-zinc-400">⏱ Per-TF breakdown — click to drill down</p>
                    <Tooltip text={`Weekday: 15m×25% + 1h×40% + 4h×25% + 1d×10%. Weekend: 15m×75% + 1h×25% + 4h×0% + 1d×0%. Configurable in Settings.`} maxWidth={230} />
                    {aggregated.is_weekend && (
                      <span className="ml-auto text-xs text-amber-400 bg-amber-950 border border-amber-800 px-2 py-0.5 rounded-full">
                        🌙 Weekend — 4h/1d inactive
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
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

            </div>
          </div>

          {/* ── History charts ── */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">History</p>
            {activeTF === null ? (
              <div className="space-y-4">
                <VIHistoryChart timeframe="aggregated" defaultColor={heroColor} onCreateAlert={handleCreateAlert} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {TIMEFRAMES.map((tf) => (
                    <VIHistoryChart key={tf} timeframe={tf} compact />
                  ))}
                </div>
              </div>
            ) : (
              <VIHistoryChart timeframe={activeTF} defaultColor={heroColor} onCreateAlert={handleCreateAlert} />
            )}
          </div>

          {/* ── Binance key pairs context (BTC + ETH) ── */}
          {activeTF !== null && tfData?.components && (() => {
            const KEY_SYMBOLS = ['BTCUSDT', 'ETHUSDT']
            const cards = KEY_SYMBOLS
              .map((sym) => ({ sym, vi: tfData.components?.[sym] }))
              .filter(({ vi }) => typeof vi === 'number') as { sym: string; vi: number }[]
            if (cards.length === 0) return null
            return (
              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Key pairs context — Binance</p>
                <div className="grid grid-cols-2 gap-3">
                  {cards.map(({ sym, vi }) => {
                    const base = sym.replace(/USDT$/, '')
                    const viPct = Math.round(vi * 100)
                    const color = viPct >= 70 ? '#ef4444' : viPct >= 50 ? '#f59e0b' : viPct >= 30 ? '#0ea5e9' : '#71717a'
                    return (
                      <div key={sym} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex flex-col gap-2">
                        <span className="text-sm font-semibold text-zinc-200">
                          {base}<span className="text-zinc-500 font-normal text-xs">USDT</span>
                        </span>
                        <div className="text-2xl font-mono font-bold" style={{ color }}>
                          {viPct}<span className="text-sm font-normal text-zinc-500 ml-1">/ 100</span>
                        </div>
                        <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all" style={{ width: `${viPct}%`, background: color }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ── Binance pairs — Market VI input ── */}
          {activeTF !== null && tfData?.components && Object.keys(tfData.components).length > 0 && (() => {
            const sorted = Object.entries(tfData.components)
              .filter(([, v]) => v !== null)
              .map(([symbol, vi]) => ({ symbol, vi: vi as number }))
              .sort((a, b) => b.vi - a.vi)
            const rows = showAllPairs ? sorted : sorted.slice(0, 10)
            return (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    Binance pairs — Market VI input ({sorted.length} pairs)
                  </p>
                  <Tooltip text="The ~50 Binance Futures pairs used to compute the Market VI. Each pair contributes its own VI score to the weighted average." maxWidth={240} />
                </div>
                <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/60">
                        <th className="px-3 py-2 text-left text-zinc-600 font-mono w-8">#</th>
                        <th className="px-3 py-2 text-left text-zinc-500 font-mono">PAIR</th>
                        <th className="px-3 py-2 text-right text-zinc-400 font-mono font-bold">VI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ symbol, vi }, i) => {
                        const viPct = Math.round(vi * 100)
                        const barColor = viPct >= 70 ? '#ef4444' : viPct >= 50 ? '#f59e0b' : viPct >= 30 ? '#0ea5e9' : '#71717a'
                        return (
                          <tr key={symbol} className="border-b border-zinc-900 hover:bg-zinc-900/40 transition-colors">
                            <td className="px-3 py-2 text-zinc-700 font-mono">{i + 1}</td>
                            <td className="px-3 py-2 font-mono font-bold text-zinc-200">
                              {symbol.replace(/USDT$/, '')}<span className="text-zinc-600 font-normal text-[11px]">USDT</span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${viPct}%`, background: barColor }} />
                                </div>
                                <span className="font-mono font-black w-5 text-right tabular-nums" style={{ color: barColor }}>{viPct}</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {sorted.length > 10 && (
                    <div className="border-t border-zinc-800 px-4 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-zinc-600 font-mono">
                        {showAllPairs ? `All ${sorted.length} pairs shown` : `Showing 10 / ${sorted.length}`}
                      </span>
                      <button
                        onClick={() => setShowAllPairs((v) => !v)}
                        className="text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
                      >
                        {showAllPairs ? '▲ Show top 10' : `▼ Show all ${sorted.length} pairs`}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* ── Top Pairs ranked table ── */}
          {pairsData.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                    🏆 Top Pairs — {activeTF ? activeTF.toUpperCase() : '1H'}
                  </p>
                  <Tooltip text="Top 10 pairs by VI score. Data from Kraken Futures. Click 'View full watchlist' for all pairs, filters and TV export." />
                </div>
                <Link
                  to="/volatility/pairs"
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  View full watchlist →
                </Link>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/50">
                      <th className="px-3 py-2 text-left text-zinc-600 font-mono w-8">#</th>
                      <th className="px-3 py-2 text-left text-zinc-500 font-mono">PAIR</th>
                      <th className="px-3 py-2 text-left text-zinc-500 font-mono">VI</th>
                      <th className="px-3 py-2 text-left text-zinc-500 font-mono">REGIME</th>
                      <th className="px-3 py-2 text-left text-zinc-500 font-mono">EMA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pairsData]
                      .sort((a, b) => b.vi_score - a.vi_score)
                      .slice(0, 10)
                      .map((p, i) => {
                        const viPct = Math.round(p.vi_score * 100)
                        const rColor = REGIME_COLOR_HEX[p.regime] ?? '#71717a'
                        const { base, quote } = formatPair(p.pair)
                        const emaSig = (p.components?.ema_signal as string | undefined) ?? 'mixed'
                        const EMA_SYMBOL: Record<string, string> = {
                          above_all: '▲', below_all: '▼', breakout_up: '🚀',
                          breakdown_down: '💥', retest_up: '🔄', retest_down: '🔁', mixed: '∿',
                        }
                        const EMA_COLOR: Record<string, string> = {
                          above_all: '#10b981', below_all: '#ef4444', breakout_up: '#0ea5e9',
                          breakdown_down: '#f97316', retest_up: '#a855f7', retest_down: '#c084fc', mixed: '#71717a',
                        }
                        return (
                          <tr key={p.pair} className="border-b border-zinc-900 hover:bg-zinc-900/40 transition-colors">
                            <td className="px-3 py-2 text-zinc-700 font-mono">{i + 1}</td>
                            <td className="px-3 py-2 font-mono font-bold text-zinc-200">
                              {base}<span className="text-zinc-600 text-xs font-normal">{quote}</span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${viPct}%`, background: rColor }} />
                                </div>
                                <span className="font-mono font-black w-5 text-right" style={{ color: rColor }}>{viPct}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 font-mono font-bold" style={{ color: rColor }}>
                              {REGIME_EMOJI[p.regime]} {p.regime}
                            </td>
                            <td className="px-3 py-2 font-mono" style={{ color: EMA_COLOR[emaSig] ?? '#71717a' }}>
                              {EMA_SYMBOL[emaSig] ?? '∿'} {emaSig}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
