// ── MarketVIPage ─────────────────────────────────────────────────────────────
// Page /volatility/market — Market VI dashboard.
//
// Layout :
//   • TF selector (15m / 1h / 4h / 1d)
//   • Hero card : Gauge + regime badge + timestamp
//   • Sparkline (live session accumulated readings)
//   • Components breakdown (RVOL / MFI / ATR / BB / EMA)
//   • Pair context : BTC + ETH VI cards

import { useEffect, useRef, useState, useCallback } from 'react'
import { RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { MarketVIGauge } from '../../components/volatility/MarketVIGauge'
import { RegimeBadge } from '../../components/volatility/RegimeBadge'
import { VISparkline } from '../../components/volatility/VISparkline'
import { volatilityApi } from '../../lib/api'
import type { MarketVIOut, PairVIOut } from '../../types/api'

const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const
type TF = typeof TIMEFRAMES[number]
const REFRESH_MS = 60_000  // 60s auto-refresh

interface SparkPoint { score: number; ts: number }

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

// ── Main page component ───────────────────────────────────────────────────

export function MarketVIPage() {
  const [tf, setTf] = useState<TF>('1h')
  const [data, setData] = useState<MarketVIOut | null>(null)
  const [pairsData, setPairsData] = useState<PairVIOut[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sparkPoints, setSparkPoints] = useState<SparkPoint[]>([])
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchData = useCallback(async (timeframe: TF) => {
    try {
      setError(null)
      const [marketVI, pairsVI] = await Promise.allSettled([
        volatilityApi.getMarketVI(timeframe),
        volatilityApi.getPairsVI(timeframe),
      ])

      if (marketVI.status === 'fulfilled') {
        const snap = marketVI.value
        setData(snap)
        setSparkPoints((prev) => {
          const point = { score: snap.vi_score, ts: Date.now() }
          // Keep at most 48 readings (48× 60s = ~48 min buffer)
          return [...prev.slice(-47), point]
        })
      } else {
        setError('No data available — VI engine has not run yet.')
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

  // Initial + auto-refresh
  useEffect(() => {
    setLoading(true)
    setSparkPoints([])
    fetchData(tf)
    intervalRef.current = setInterval(() => fetchData(tf), REFRESH_MS)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [tf, fetchData])

  const handleManualRefresh = () => {
    setLoading(true)
    fetchData(tf)
  }

  // Components to display — read from BTC pair as proxy (MarketVIOut has no components field)
  // numericComponents left unused intentionally — breakdown uses btcComponents below
  // Actually read from pair components if available... but MarketVIOut doesn't expose them.
  // Only show breakdown if we have it. MarketVIOut currently has no components field.
  // Components are available on PairVIOut — use BTC as proxy if available.
  const btcComponents = pairsData.find((p) =>
    p.pair.toLowerCase().includes('btc') || p.pair.toLowerCase().includes('xbt')
  )?.components ?? {}

  const componentEntries = Object.entries(btcComponents)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => ({ name: k, value: v as number }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageHeader
          icon="🌊"
          title="Market VI"
          subtitle="Volatility Index — aggregated market score"
        />
        <div className="flex items-center gap-2">
          {/* TF selector */}
          <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`px-3 py-1 text-xs font-mono rounded-md transition-colors ${
                  t === tf
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {/* Manual refresh */}
          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {loading
              ? <Loader2 size={14} className="animate-spin" />
              : <RefreshCw size={14} />
            }
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && !loading && (
        <div className="flex items-center gap-3 p-4 bg-amber-950 border border-amber-800 rounded-lg text-amber-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Hero card */}
      {loading && !data ? (
        <div className="flex justify-center items-center h-48">
          <Loader2 size={32} className="animate-spin text-zinc-500" />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Gauge + regime */}
          <div className="lg:col-span-1 bg-surface-900 border border-zinc-800 rounded-xl p-6 flex flex-col items-center gap-4">
            <MarketVIGauge score={data.vi_score} size={180} />
            <RegimeBadge regime={data.regime} size="lg" />
            <p className="text-xs text-zinc-500 text-center">
              {tf.toUpperCase()} · {new Date(data.timestamp).toLocaleString(undefined, {
                dateStyle: 'short', timeStyle: 'short',
              })}
            </p>
            <p className="text-xs text-zinc-600 text-center">
              Auto-refresh every 60s
            </p>
          </div>

          {/* Sparkline + components */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* Sparkline */}
            <div className="bg-surface-900 border border-zinc-800 rounded-xl p-4">
              <p className="text-xs font-medium text-zinc-400 mb-3">Session trend</p>
              <VISparkline points={sparkPoints} width={480} height={52} />
            </div>

            {/* Components breakdown */}
            {componentEntries.length > 0 && (
              <div className="bg-surface-900 border border-zinc-800 rounded-xl p-4">
                <p className="text-xs font-medium text-zinc-400 mb-4">Components — BTC proxy ({tf})</p>
                <div className="flex flex-col gap-3">
                  {componentEntries.map(({ name, value }) => (
                    <ComponentBar key={name} name={name} value={value} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Pair context */}
      {pairsData.length > 0 && (
        <div>
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
            Key pairs context
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {pairsData.map((p) => (
              <PairContextCard key={p.pair} pair={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
