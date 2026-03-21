// ── VIHistoryChart ────────────────────────────────────────────────────────
// Recharts AreaChart for Market VI historical snapshots.
// Fetches /volatility/market/{timeframe}/history with a `since` param derived
// from the selected range (1h | 6h | 24h | 7d | 30d).

import { useEffect, useState } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { Loader2, AlertTriangle } from 'lucide-react'
import { volatilityApi } from '../../lib/api'
import type { MarketVIOut } from '../../types/api'

// ── Types ──────────────────────────────────────────────────────────────────

type Range = '1h' | '6h' | '24h' | '7d' | '30d'

interface ChartPoint {
  ts: number
  score: number
  regime: string
  rawTs: string
}

interface Props {
  /** timeframe slug: '15m' | '1h' | '4h' | '1d' | 'aggregated' */
  timeframe: string
  /** fallback accent color if no data yet */
  defaultColor?: string
  /** compact mode: smaller chart height, used in grid layout */
  compact?: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────

const RANGE_MS: Record<Range, number> = {
  '1h':  1  * 60 * 60 * 1000,
  '6h':  6  * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
}

// Regime thresholds on 0-100 scale
const REGIME_THRESHOLDS = [17, 33, 50, 67, 83]

const REGIME_COLOR_HEX: Record<string, string> = {
  DEAD:     '#a1a1aa',
  CALM:     '#0ea5e9',
  NORMAL:   '#10b981',
  TRENDING: '#818cf8',  // indigo-400 — gem color
  ACTIVE:   '#f59e0b',  // amber-400
  EXTREME:  '#ef4444',
}

// Threshold → faint label to show on reference line
const THRESHOLD_LABELS: Record<number, string> = {
  17: 'CALM',
  33: 'NORMAL',
  50: 'TRENDING',
  67: 'ACTIVE',
  83: 'EXTREME',
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatXTick(ts: number, range: Range): string {
  const d = new Date(ts)
  if (range === '1h' || range === '6h' || range === '24h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Custom tooltip ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload }: { active?: boolean; payload?: any[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as ChartPoint
  const color = REGIME_COLOR_HEX[d.regime] ?? '#a1a1aa'
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none"
      style={{ background: '#181818', border: '1px solid #3f3f46' }}
    >
      <div className="text-zinc-400 mb-1.5">
        {new Date(d.rawTs).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
      </div>
      <div
        className="text-xl font-black font-mono leading-none"
        style={{ color, textShadow: `0 0 12px ${color}60` }}
      >
        {d.score.toFixed(1)}
        <span className="text-xs font-normal text-zinc-600 ml-1">/100</span>
      </div>
      <div className="font-bold tracking-widest text-xs mt-0.5" style={{ color }}>
        {d.regime}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function VIHistoryChart({ timeframe, defaultColor = '#a1a1aa', compact = false }: Props) {
  const [range, setRange] = useState<Range>('24h')
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)

    const since = new Date(Date.now() - RANGE_MS[range]).toISOString()
    volatilityApi.getMarketVIHistory(timeframe, 500, since)
      .then((snaps: MarketVIOut[]) => {
        if (cancelled) return
        setData(
          snaps.map((s) => ({
            ts:     new Date(s.timestamp).getTime(),
            score:  parseFloat((s.vi_score * 100).toFixed(2)),
            regime: s.regime,
            rawTs:  s.timestamp,
          }))
        )
      })
      .catch(() => {
        if (!cancelled) setError('No history data available.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [timeframe, range])

  // Derive accent color from last data point's regime
  const lastRegime = data[data.length - 1]?.regime ?? ''
  const activeColor = REGIME_COLOR_HEX[lastRegime] ?? defaultColor

  // Unique gradient id (no special chars)
  const gradientId = `vihist-${timeframe.replace(/[^a-z0-9]/gi, '')}`

  const chartHeight = compact ? 150 : 220
  const tfLabel = timeframe === 'aggregated' ? 'AGG' : timeframe.toUpperCase()

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-mono font-bold px-2 py-0.5 rounded border"
            style={{ color: activeColor, borderColor: `${activeColor}40`, background: `${activeColor}12` }}
          >
            {tfLabel}
          </span>
          <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">
            History
          </span>
          {data.length > 0 && !loading && lastRegime && (
            <span className="text-xs font-bold" style={{ color: activeColor }}>
              · {lastRegime}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Smart proposals toggle (non-compact only) */}
          {!compact && onCreateAlert && (
            <button
              onClick={() => setShowSmart(v => !v)}
              title={showSmart ? 'Hide smart suggestions' : 'Show smart alert suggestions'}
              className={`p-1.5 rounded transition-colors ${
                showSmart ? 'text-amber-400 bg-amber-500/10 border border-amber-500/20' : 'text-zinc-600 hover:text-zinc-300'
              }`}
            >
              <Lightbulb size={13} />
            </button>
          )}

          {/* Range selector */}}
        <div className="flex gap-0.5 bg-zinc-900 border border-zinc-800 rounded-md p-0.5">
          {(['1h', '6h', '24h', '7d', '30d'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-xs font-mono rounded transition-colors ${
                r === range
                  ? 'bg-zinc-700 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex justify-center items-center" style={{ height: chartHeight }}>
          <Loader2 size={22} className="animate-spin text-zinc-600" />
        </div>
      ) : error || data.length === 0 ? (
        <div
          className="flex items-center justify-center gap-2 text-zinc-600 text-xs"
          style={{ height: chartHeight }}
        >
          <AlertTriangle size={13} />
          {error ?? 'No data in this time range.'}
        </div>
      ) : (
        <div
          className="relative"
          onContextMenu={onCreateAlert ? (e) => {
            e.preventDefault()
            if (hoveredScore !== null) {
              setCtxMenu({ x: e.clientX, y: e.clientY, level: Math.round(hoveredScore) })
            }
          } : undefined}
        >
          <ResponsiveContainer width="100%" height={chartHeight}>
            <AreaChart
              data={data}
              margin={{ top: 6, right: 4, bottom: 0, left: -14 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onMouseMove={(e: any) => {
                if (e?.activePayload?.[0]?.value != null) {
                  setHoveredScore(e.activePayload[0].value as number)
                }
              }}
              onMouseLeave={() => setHoveredScore(null)}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={activeColor} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={activeColor} stopOpacity={0.03} />
                </linearGradient>
              </defs>

              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#27272a"
                vertical={false}
              />

              {/* Regime boundary reference lines */}
              {REGIME_THRESHOLDS.filter(t => t > domainMin && t < domainMax).map((t) => (
                <ReferenceLine
                  key={t}
                  y={t}
                  stroke="#3f3f46"
                  strokeDasharray="4 3"
                  label={compact ? undefined : {
                    value: THRESHOLD_LABELS[t],
                    position: 'insideTopRight',
                    fill: '#52525b',
                    fontSize: 9,
                    fontFamily: 'monospace',
                  }}
                />
              ))}

              {/* Smart proposal level reference lines */}
              {proposedLevels.map(pl => (
                <ReferenceLine
                  key={`smart-${pl.level}`}
                  y={pl.level}
                  stroke="#f59e0b"
                  strokeDasharray="2 4"
                  strokeOpacity={0.5}
                />
              ))}

              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(v) => formatXTick(v as number, range)}
                tick={{ fill: '#52525b', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
                minTickGap={compact ? 50 : 40}
              />

              <YAxis
                domain={[domainMin, domainMax]}
                ticks={compact ? [domainMin, Math.round((domainMin + domainMax) / 2), domainMax] : visibleTicks}
                tick={{ fill: '#52525b', fontSize: 10, fontFamily: 'monospace' }}
                axisLine={false}
                tickLine={false}
                width={compact ? 22 : 28}
              />

              <Tooltip
                content={<CustomTooltip />}
                cursor={<CrosshairCursor />}
              />

              <Area
                type="monotone"
                dataKey="score"
                stroke={activeColor}
                strokeWidth={compact ? 1.5 : 2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, fill: activeColor, strokeWidth: 0 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>

          {/* Right-click context menu */}
          {ctxMenu && (
            <div
              style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
              className="rounded-lg shadow-2xl bg-zinc-900 border border-zinc-700 py-1 min-w-[180px]"
            >
              <p className="px-3 pt-1 pb-0.5 text-[10px] text-zinc-600 font-mono uppercase tracking-wider">Chart alert</p>
              <button
                type="button"
                onClick={() => { onCreateAlert?.(ctxMenu.level); setCtxMenu(null) }}
                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-xs text-slate-300 w-full text-left transition-colors"
              >
                <Bell size={12} className="text-amber-400 shrink-0" />
                Set alert at VI = {ctxMenu.level}
              </button>
              <button
                type="button"
                onClick={() => setCtxMenu(null)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-xs text-zinc-500 w-full text-left transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats bar */}
      {data.length > 0 && !loading && (
        <div className="mt-2 pt-2 border-t border-zinc-800 flex gap-4 text-xs font-mono text-zinc-600">
          <span>{data.length} pts</span>
          <span>
            min <span className="text-zinc-400">{Math.min(...data.map((d) => d.score)).toFixed(0)}</span>
          </span>
          <span>
            max <span className="text-zinc-400">{Math.max(...data.map((d) => d.score)).toFixed(0)}</span>
          </span>
          <span>
            now{' '}
            <span className="font-bold" style={{ color: activeColor }}>
              {data[data.length - 1].score.toFixed(1)}
            </span>
          </span>
          {onCreateAlert && hoveredScore !== null && (
            <span className="ml-auto text-zinc-500">
              VI <span className="text-zinc-300">{hoveredScore.toFixed(1)}</span>
              <span className="text-zinc-700"> · right-click to set alert</span>
            </span>
          )}
        </div>
      )}

      {/* Smart proposals panel */}
      {showSmart && !compact && proposedLevels.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={12} className="text-amber-400" />
            <p className="text-xs font-semibold text-amber-400">Smart suggestions</p>
            <span className="text-[10px] text-zinc-600">levels with repeated VI bounces in this range</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {proposedLevels.map(pl => (
              <button
                key={pl.level}
                type="button"
                onClick={() => onCreateAlert?.(pl.level)}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left"
              >
                <div>
                  <p className="text-xs font-mono font-bold text-amber-300">VI {pl.level}</p>
                  <p className="text-[10px] text-zinc-600">{pl.touches}× touched · {pl.direction}</p>
                </div>
                <Bell size={12} className="text-amber-500/60 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
      {showSmart && !compact && proposedLevels.length === 0 && data.length >= 15 && (
        <p className="mt-3 text-[11px] text-zinc-600 italic">
          No significant level detected in this range — try a wider range (7d, 30d).
        </p>
      )}
    </div>
  )
}
