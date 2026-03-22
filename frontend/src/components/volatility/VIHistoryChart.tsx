// ── VIHistoryChart ────────────────────────────────────────────────────────
// Recharts AreaChart for Market VI historical snapshots.
// Fetches /volatility/market/{timeframe}/history with a `since` param derived
// from the selected range (1h | 6h | 24h | 7d | 30d | 60d | 90d).

import { useEffect, useState, useMemo } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Customized,
  usePlotArea,
  useActiveTooltipCoordinate,
} from 'recharts'
import { Loader2, AlertTriangle, Bell, Lightbulb } from 'lucide-react'
import { volatilityApi } from '../../lib/api'
import type { MarketVIOut } from '../../types/api'

// ── Types ──────────────────────────────────────────────────────────────────

type Range = '1h' | '6h' | '24h' | '7d' | '30d' | '60d' | '90d'

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
  /** if provided, enables right-click alert creation + smart proposals */
  onCreateAlert?: (level: number, timeframe: string, tolerance?: number) => void
}

// ── Constants ─────────────────────────────────────────────────────────────

const RANGE_MS: Record<Range, number> = {
  '1h':  1  * 60 * 60 * 1000,
  '6h':  6  * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '60d': 60 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
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

// ── Smart level detection ─────────────────────────────────────────────────

interface ProposedLevel {
  level: number
  touches: number
  direction: string
  tolerance: number  // ±zone radius used for visit counting
}

function detectKeyLevels(data: ChartPoint[]): ProposedLevel[] {
  if (data.length < 15) return []
  const scores = data.map(d => d.score)
  const rawMin = Math.min(...scores)
  const rawMax = Math.max(...scores)
  const range  = rawMax - rawMin

  // Adaptive tolerance: 5% of visible range, clamped [2, 5]
  const clusterTol = Math.max(2, Math.min(5, range * 0.05))
  // visitTol = same as clusterTol — avoids zones overlapping & dual direction hits
  const visitTol = clusterTol

  // Step 1: local extrema (window ±2)
  const maxima: number[] = []
  const minima: number[] = []
  for (let i = 2; i < scores.length - 2; i++) {
    const v = scores[i]
    const isMax = v >= scores[i-1] && v >= scores[i+1] && v >= scores[i-2] && v >= scores[i+2]
    const isMin = v <= scores[i-1] && v <= scores[i+1] && v <= scores[i-2] && v <= scores[i+2]
    if (isMax) maxima.push(v)
    else if (isMin) minima.push(v)
  }

  // Step 2: cluster sorted values so nearby peaks (32.4, 32.5, 33.1) merge
  function cluster(values: number[], direction: string) {
    const sorted = [...values].sort((a, b) => a - b)
    const clusters: { sum: number; count: number; direction: string }[] = []
    for (const v of sorted) {
      const avg = (c: { sum: number; count: number }) => c.sum / c.count
      const existing = clusters.find(c => Math.abs(avg(c) - v) <= clusterTol)
      if (existing) { existing.sum += v; existing.count++ }
      else clusters.push({ sum: v, count: 1, direction })
    }
    return clusters
  }

  // Step 3: count how many times VI enters the zone (entry from outside = 1 visit)
  function countVisits(level: number): number {
    let visits = 0
    let inside = false
    for (const s of scores) {
      const inZone = Math.abs(s - level) <= visitTol
      if (inZone && !inside) { visits++; inside = true }
      else if (!inZone) inside = false
    }
    return visits
  }

  // Per-level tolerance: proportional to the level value, capped at clusterTol
  // VI=8→±1, VI=24→±2, VI=42→±3, VI=62–88→±4 (with clusterTol=4)
  const levelTol = (level: number) => Math.max(1, Math.min(clusterTol, Math.round(level * 0.07)))

  const raw: ProposedLevel[] = [
    ...cluster(maxima, 'resistance'),
    ...cluster(minima, 'support'),
  ]
    .map(c => {
      const level = Math.round(c.sum / c.count)
      return {
        level,
        touches:   countVisits(level),
        direction: c.direction,
        tolerance: levelTol(level),
      }
    })
    .filter(r => r.touches >= 2)
    .sort((a, b) => b.touches - a.touches)

  // Step 4: dedup — walk sorted-by-touches list, skip any level within clusterTol
  // of an already-kept level. This removes: duplicate directions on same level,
  // and neighbouring levels too close to be meaningfully distinct.
  const results: ProposedLevel[] = []
  for (const r of raw) {
    if (!results.some(kept => Math.abs(kept.level - r.level) <= clusterTol)) {
      results.push(r)
    }
    if (results.length >= 7) break
  }

  // Always include the absolute min/max if not already covered
  const minRounded = Math.round(rawMin)
  const maxRounded = Math.round(rawMax)
  if (!results.some(r => Math.abs(r.level - minRounded) <= clusterTol)) {
    results.push({ level: minRounded, touches: countVisits(minRounded), direction: 'support',    tolerance: levelTol(minRounded) })
  }
  if (!results.some(r => Math.abs(r.level - maxRounded) <= clusterTol)) {
    results.push({ level: maxRounded, touches: countVisits(maxRounded), direction: 'resistance', tolerance: levelTol(maxRounded) })
  }

  return results
}

// ── Crosshair — Recharts v3 hooks: usePlotArea + useActiveTooltipCoordinate ───────
// • coord.y  = active tooltip y (mouse position inside plot area)
// • plotArea = {x, y, width, height} of the SVG plot area
// These hooks resolve the v2 cursor issue where points[0].y was always 0

function ChartCrosshair() {
  const plotArea = usePlotArea()
  const coord = useActiveTooltipCoordinate()
  if (!coord || !plotArea) return null
  const { x: px, y: py, width: pw, height: ph } = plotArea
  return (
    <g pointerEvents="none">
      <line x1={coord.x} y1={py} x2={coord.x} y2={py + ph}
        stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={px} y1={coord.y} x2={px + pw} y2={coord.y}
        stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
    </g>
  )
}

// ── Last-score badge label — TradingView-style on right edge ──────────────────
// Rendered as the `label` of the last-score ReferenceLine.
// viewBox.y = SVG y of the reference line; viewBox.x + viewBox.width = right edge.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LastScoreLabel({ viewBox, value, color }: any) {
  if (!viewBox || value == null) return null
  const { x, y, width } = viewBox as { x: number; y: number; width: number }
  const bx = x + width + 4   // 4px gap right of plot
  const bw = 28, bh = 15
  return (
    <g pointerEvents="none">
      <rect x={bx} y={y - bh / 2} width={bw} height={bh} rx={3}
        fill={color} fillOpacity={0.9} />
      <text x={bx + bw / 2} y={y} textAnchor="middle" dominantBaseline="middle"
        fill="#09090b" fontSize={9} fontFamily="monospace" fontWeight="bold">
        {value}
      </text>
    </g>
  )
}

// ── Y-axis tick — regime ticks in grey, S/R levels in amber ───────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomYAxisTick({ x, y, payload, showSmart, labelledLevels }: any) {
  if (payload == null || x == null || y == null) return null
  const isSR = showSmart && (labelledLevels as Set<number>)?.has(payload.value as number)
  return (
    <text x={x} y={y} dy={3} textAnchor="end" fill={isSR ? '#f59e0b' : '#52525b'} fontSize={10} fontFamily="monospace">
      {payload.value}
    </text>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function VIHistoryChart({ timeframe, defaultColor = '#a1a1aa', compact = false, onCreateAlert }: Props) {
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

  // ── Alert feature state ───────────────────────────────────────────────
  const [showSmart, setShowSmart] = useState(false)
  const [hoveredScore, setHoveredScore] = useState<number | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; level: number } | null>(null)

  // Adaptive Y-axis: pad ±12% of range, clamped to [0, 100]
  const scores = data.map(d => d.score)
  const rawMin = scores.length ? Math.min(...scores) : 0
  const rawMax = scores.length ? Math.max(...scores) : 100
  const padding = Math.max(5, (rawMax - rawMin) * 0.12)
  const domainMin = Math.max(0, Math.floor(rawMin - padding))
  const domainMax = Math.min(100, Math.ceil(rawMax + padding))
  const visibleTicks = [0, 17, 33, 50, 67, 83, 100].filter(t => t >= domainMin && t <= domainMax)

  // Smart level detection (memoised on data change)
  const proposedLevels = useMemo(() => detectKeyLevels(data), [data])

  // Collision-avoidance: only show floating label for levels far enough apart.
  // Most-touched levels win priority. Gap ≥ 8% of visible domain range.
  const labelledLevels = useMemo(() => {
    if (!showSmart || proposedLevels.length === 0) return new Set<number>()
    const minGap = Math.max(4, Math.round((domainMax - domainMin) * 0.08))
    const byTouches = [...proposedLevels].sort((a, b) => b.touches - a.touches)
    const kept: number[] = []
    for (const pl of byTouches) {
      if (!kept.some(v => Math.abs(v - pl.level) < minGap)) kept.push(pl.level)
    }
    return new Set(kept)
  }, [proposedLevels, showSmart, domainMin, domainMax])

  // Combined Y-axis ticks: regime thresholds (grey) + labelled S/R levels (amber)
  const allYTicks = useMemo(() => {
    const regimeTicks = [0, 17, 33, 50, 67, 83, 100].filter(t => t >= domainMin && t <= domainMax)
    const srTicks = showSmart ? Array.from(labelledLevels) : []
    return Array.from(new Set([...regimeTicks, ...srTicks])).sort((a, b) => a - b)
  }, [showSmart, labelledLevels, domainMin, domainMax])

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 mb-3">
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

          {/* Range selector */}
          <div className="flex gap-0.5 bg-zinc-900 border border-zinc-800 rounded-md p-0.5 overflow-x-auto max-w-[180px] sm:max-w-none scrollbar-none">
            {(['1h', '6h', '24h', '7d', '30d', '60d', '90d'] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-2 py-0.5 text-xs font-mono rounded transition-colors shrink-0 ${
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
              margin={{ top: 6, right: compact ? 4 : 40, bottom: 0, left: -14 }}
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

              {/* Last-score line — persistent, stays visible even during hover */}
              {!compact && lastScore !== null && (
                <ReferenceLine
                  y={lastScore}
                  stroke={activeColor}
                  strokeDasharray="3 3"
                  strokeOpacity={0.7}
                  label={{
                    content: (props: any) => (
                      <LastScoreLabel {...props} value={Math.round(lastScore)} color={activeColor} />
                    ),
                  }}
                />
              )}

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

              {/* Smart proposal level reference lines — values shown on Y-axis, no floating labels */}
              {showSmart && proposedLevels.map(pl => (
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
                ticks={compact ? [domainMin, Math.round((domainMin + domainMax) / 2), domainMax] : allYTicks}
                minTickGap={compact ? 12 : 4}
                tick={compact
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ? ({ fill: '#52525b', fontSize: 10, fontFamily: 'monospace' } as any)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  : (props: any) => <CustomYAxisTick {...props} showSmart={showSmart} labelledLevels={labelledLevels} />
                }
                axisLine={false}
                tickLine={false}
                width={compact ? 24 : 36}
              />

              <Tooltip
                content={(props) => hoveredScore !== null ? <CustomTooltip {...props} /> : null}
                cursor={false}
              />

              {/* Crosshair via Recharts v3 hooks — rendered inside chart SVG */}
              <Customized component={ChartCrosshair} />

              <Area
                type="monotone"
                dataKey="score"
                stroke={activeColor}
                strokeWidth={compact ? 1.5 : 2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={hoveredScore !== null ? { r: 4, fill: activeColor, strokeWidth: 0 } : false}
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
                onClick={() => { onCreateAlert?.(ctxMenu.level, timeframe); setCtxMenu(null) }}
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
        <div className="mt-2 pt-2 border-t border-zinc-800 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-zinc-600">
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
                onClick={() => onCreateAlert?.(pl.level, timeframe, pl.tolerance)}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left"
              >
                <div>
                  <p className="text-xs font-mono font-bold text-amber-300">
                    VI {pl.level}
                    <span className="text-amber-500/60 font-normal"> ±{pl.tolerance.toFixed(0)}</span>
                  </p>
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
