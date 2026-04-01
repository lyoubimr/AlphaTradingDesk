// ── VIHistoryChart ────────────────────────────────────────────────────────
// Recharts AreaChart for Market VI historical snapshots.
// Fetches /volatility/market/{timeframe}/history with a `since` param derived
// from the selected range (1h | 6h | 24h | 3d | 7d | 30d | 60d | 90d).

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Customized,
  usePlotArea,
} from 'recharts'
import { Loader2, AlertTriangle, Bell, Lightbulb, Maximize2, X, Pencil } from 'lucide-react'
import { volatilityApi } from '../../lib/api'
import type { MarketVIOut } from '../../types/api'

// ── Types ──────────────────────────────────────────────────────────────────

type Range = '1h' | '6h' | '24h' | '3d' | '7d' | '30d' | '60d' | '90d'

interface ChartPoint {
  ts: number
  score: number
  regime: string
  rawTs: string
}

type PlotArea = { x: number; y: number; width: number; height: number }

interface DrawnSegment {
  x1r: number  // horizontal ratio 0–1 within plot area
  y1r: number  // vertical ratio 0–1 within plot area
  x2r: number
  y2r: number
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
  /** show expand button to open this chart in a fullscreen modal */
  expandable?: boolean
}

// ── Constants ─────────────────────────────────────────────────────────────

const RANGE_MS: Record<Range, number> = {
  '1h':  1  * 60 * 60 * 1000,
  '6h':  6  * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d':  3  * 24 * 60 * 60 * 1000,
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

/** Perpendicular distance from point (mx,my) to segment (x1,y1)-(x2,y2) in px. */
function distToSegmentPx(mx: number, my: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(mx - x1, my - y1)
  const t = Math.max(0, Math.min(1, ((mx - x1) * dx + (my - y1) * dy) / lenSq))
  return Math.hypot(mx - (x1 + t * dx), my - (y1 + t * dy))
}

// Full date+time label for the crosshair X-axis badge
function formatXBadge(ts: number, range: Range): string {
  const d = new Date(ts)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  if (range === '1h' || range === '6h') return time
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${date} ${time}`
}

function formatXTick(ts: number, range: Range): string {
  const d = new Date(ts)
  // 1h / 6h → time only
  if (range === '1h' || range === '6h') {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  // 24h / 3d → date at day boundary (midnight tick), time otherwise — TV style
  if (range === '24h' || range === '3d') {
    if (d.getHours() === 0) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  // 7d / 30d / 60d / 90d → date only
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

// ── ChartOverlay — crosshair + TV-style Y label + drawn segments ──────────
// hoverCoord:  Recharts-snapped data position (vertical crosshair + active dot).
// rawMousePos: actual mouse cursor in SVG coordinates (horizontal crosshair + badge).
// Drawn segments rendered as SVG lines in plot-area ratio coordinates (resize-safe).
// Defined at module level (stable reference) so React never remounts it.
function ChartOverlay({ hoverCoord, rawMousePos, color, domainMin, domainMax, drawMode, pendingPoint, drawnSegments, selectedSegIdx, hoveredTs, range, onPlotArea }: {
  hoverCoord:     { x: number; y: number } | null
  rawMousePos:    { x: number; y: number } | null
  color:          string
  domainMin:      number
  domainMax:      number
  drawMode:       boolean
  pendingPoint:   { xr: number; yr: number } | null
  drawnSegments:  DrawnSegment[]
  selectedSegIdx: number | null
  hoveredTs:      number | null
  range:          Range
  onPlotArea?:    (pa: PlotArea) => void
  [k: string]: unknown
}) {
  const plotArea = usePlotArea()
  if (plotArea && onPlotArea) onPlotArea(plotArea)
  if (!plotArea) return null
  const { x: px, y: py, width: pw, height: ph } = plotArea

  // Clamp raw mouse Y to plot area vertical bounds
  const clampedY = rawMousePos != null
    ? Math.max(py, Math.min(py + ph, rawMousePos.y))
    : null

  // True Y-axis score at actual mouse position (pixel → data domain)
  const crosshairScore = clampedY != null && ph > 0
    ? domainMax - ((clampedY - py) / ph) * (domainMax - domainMin)
    : null

  const showCrosshair = hoverCoord != null && clampedY != null

  // Current mouse as ratio within plot area (for drawing preview line)
  const curXr = rawMousePos != null && pw > 0 ? Math.max(0, Math.min(1, (rawMousePos.x - px) / pw)) : null
  const curYr = clampedY   != null && ph > 0 ? (clampedY - py) / ph : null

  const badgeW = 34
  const badgeH = 14
  const xLabel      = hoveredTs != null ? formatXBadge(hoveredTs, range) : null
  const xBadgeW     = range === '1h' || range === '6h' ? 36 : 76
  const xBadgeH     = 14

  return (
    <g pointerEvents="none">
      {/* User-drawn segments — selected one is brighter + thicker */}
      {drawnSegments.map((seg, i) => {
        const sel = i === (selectedSegIdx as number | null)
        return (
          <line key={`seg-${i}`}
            x1={px + seg.x1r * pw} y1={py + seg.y1r * ph}
            x2={px + seg.x2r * pw} y2={py + seg.y2r * ph}
            stroke={sel ? '#67e8f9' : '#22d3ee'}
            strokeWidth={sel ? 2.5 : 1.5}
            strokeOpacity={sel ? 1 : 0.9}
          />
        )
      })}

      {/* Preview line while placing the second point */}
      {drawMode && pendingPoint != null && curXr != null && curYr != null && (
        <>
          <line
            x1={px + pendingPoint.xr * pw} y1={py + pendingPoint.yr * ph}
            x2={px + curXr * pw}           y2={py + curYr * ph}
            stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.55} strokeDasharray="5 3"
          />
          <circle cx={px + pendingPoint.xr * pw} cy={py + pendingPoint.yr * ph}
            r={3} fill="#22d3ee" fillOpacity={0.85} />
        </>
      )}

      {/* Crosshairs — only when hovering within the chart area */}
      {showCrosshair && (
        <>
          {/* Vertical crosshair — snapped to nearest data point X */}
          <line x1={hoverCoord!.x} y1={py}        x2={hoverCoord!.x} y2={py + ph} stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
          {/* Horizontal crosshair — follows actual mouse Y, not data snap */}
          <line x1={px}            y1={clampedY!}  x2={px + pw}       y2={clampedY!} stroke="#52525b" strokeWidth={1} strokeDasharray="3 3" />
          {/* Active dot — at Recharts-snapped data point */}
          <circle cx={hoverCoord!.x} cy={hoverCoord!.y} r={4} fill={color} />
          {/* TV-style X-axis badge — date/time at vertical crosshair */}
          {xLabel && (
            <g>
              <rect
                x={hoverCoord!.x - xBadgeW / 2} y={py + ph + 2}
                width={xBadgeW} height={xBadgeH} rx={2}
                fill="#27272a" fillOpacity={0.55} stroke={color} strokeWidth={0.8} strokeOpacity={0.6}
              />
              <text
                x={hoverCoord!.x} y={py + ph + 2 + xBadgeH / 2}
                textAnchor="middle" dominantBaseline="middle"
                fill={color} fontSize={9} fontFamily="monospace" fontWeight="bold"
              >
                {xLabel}
              </text>
            </g>
          )}
        </>
      )}

      {/* TV-style Y badge — exact Y-axis value at actual mouse position */}
      {showCrosshair && crosshairScore != null && (
        <g>
          <rect
            x={px + pw + 2} y={clampedY! - badgeH / 2}
            width={badgeW} height={badgeH} rx={2}
            fill="#27272a" stroke={color} strokeWidth={0.8}
          />
          <text
            x={px + pw + 2 + badgeW / 2} y={clampedY!}
            textAnchor="middle" dominantBaseline="middle"
            fill={color} fontSize={9} fontFamily="monospace" fontWeight="bold"
          >
            {crosshairScore.toFixed(1)}
          </text>
        </g>
      )}
    </g>
  )
}

// ── Last-score badge — small pill above the dashed reference line ─────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function LastScoreLabel({ viewBox, value, color }: any) {
  if (!viewBox || value == null) return null
  const { x, y, width } = viewBox as { x: number; y: number; width: number }
  const bx = x + width + 3
  const bw = 22, bh = 11
  return (
    <g pointerEvents="none">
      <rect x={bx} y={y - bh - 3} width={bw} height={bh} rx={2}
        fill={color} fillOpacity={0.85} />
      <text x={bx + bw / 2} y={y - bh / 2 - 3} textAnchor="middle" dominantBaseline="middle"
        fill="#09090b" fontSize={7} fontFamily="monospace" fontWeight="bold">
        {value}
      </text>
    </g>
  )
}

// ── Right-edge badge for S/R levels and user-drawn lines ────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SRLineBadge({ viewBox, value, color }: any) {
  if (!viewBox || value == null) return null
  const { x, y, width } = viewBox as { x: number; y: number; width: number }
  const bx = x + width + 2
  const bw = 24
  const bh = 12
  return (
    <g pointerEvents="none">
      <rect x={bx} y={y - bh / 2} width={bw} height={bh} rx={2}
        fill={color} fillOpacity={0.15} stroke={color} strokeOpacity={0.35} strokeWidth={0.6} />
      <text x={bx + bw / 2} y={y} textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize={9} fontFamily="monospace" fontWeight="bold">
        {value}
      </text>
    </g>
  )
}

// ── Y-axis tick — always grey on the left (S/R values shown orange on right via SRLineBadge) ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomYAxisTick({ x, y, payload, showSmart, srLevelSet }: any) {
  if (payload == null || x == null || y == null) return null
  // S/R level ticks are already labelled on the right side (SRLineBadge) — hide them on the left
  const isSR = showSmart && (srLevelSet as Set<number>)?.has(payload.value as number)
  if (isSR) return null
  return (
    <text x={x} y={y} dy={3} textAnchor="end" fill="#52525b" fontSize={10} fontFamily="monospace">
      {payload.value}
    </text>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export function VIHistoryChart({ timeframe, defaultColor = '#a1a1aa', compact = false, onCreateAlert, expandable = false }: Props) {
  const [range, setRange]   = useState<Range>('24h')
  const [data, setData]     = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)
  const [expanded, setExpanded]             = useState(false)
  const [drawMode, setDrawMode]             = useState(false)
  const [drawnSegments, setDrawnSegments]   = useState<DrawnSegment[]>([])
  const [pendingPoint, setPendingPoint]     = useState<{ xr: number; yr: number } | null>(null)
  const [rawMousePos, setRawMousePos]       = useState<{ x: number; y: number } | null>(null)
  const [selectedSegIdx, setSelectedSegIdx] = useState<number | null>(null)
  const [nearSegment, setNearSegment]       = useState(false)
  const plotAreaRef    = useRef<PlotArea | null>(null)
  const dragRef        = useRef<{ segIdx: number; startXr: number; startYr: number; origSeg: DrawnSegment } | null>(null)
  const dragMovedRef   = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const since = new Date(Date.now() - RANGE_MS[range]).toISOString()
    // Wide ranges need more rows: 1h-resolution data → 7d=168, 30d=720, 90d=2160
    const limit = (['7d', '30d', '60d', '90d'] as Range[]).includes(range) ? 2000 : 500
    volatilityApi.getMarketVIHistory(timeframe, limit, since)
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
      .catch(() => { if (!cancelled) setError('No history data available.') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [timeframe, range])

  // Escape: close modal, cancel pending draw point, or exit draw mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (expanded) setExpanded(false)
      else if (pendingPoint) setPendingPoint(null)
      else if (drawMode) setDrawMode(false)
      else setSelectedSegIdx(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [expanded, drawMode, pendingPoint])

  // Lock body scroll when modal is open so background page can't be scrolled
  useEffect(() => {
    if (!expanded) return
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [expanded])

  const lastRegime  = data[data.length - 1]?.regime ?? ''
  const activeColor = REGIME_COLOR_HEX[lastRegime] ?? defaultColor
  const gradientId  = `vihist-${timeframe.replace(/[^a-z0-9]/gi, '')}`
  const chartHeight = compact ? 150 : 220
  const tfLabel     = timeframe === 'aggregated' ? 'AGG' : timeframe.toUpperCase()

  const [showSmart, setShowSmart]     = useState(false)
  const [hoveredScore, setHoveredScore] = useState<number | null>(null)
  const [hoverCoord, setHoverCoord]   = useState<{ x: number; y: number } | null>(null)
  const [hoveredTs, setHoveredTs]     = useState<number | null>(null)
  const [ctxMenu, setCtxMenu]         = useState<{ x: number; y: number; level: number } | null>(null)

  const scores    = data.map(d => d.score)
  const rawMin    = scores.length ? Math.min(...scores) : 0
  const rawMax    = scores.length ? Math.max(...scores) : 100
  const padding   = Math.max(5, (rawMax - rawMin) * 0.12)
  const domainMin = Math.max(0, Math.floor(rawMin - padding))
  const domainMax = Math.min(100, Math.ceil(rawMax + padding))
  const lastScore = data.length > 0 ? data[data.length - 1].score : null

  const proposedLevels = useMemo(() => detectKeyLevels(data), [data])

  // All detected S/R levels as a Set — used for Y-axis tick coloring (no gap-filter)
  const srLevelSet = useMemo(() => {
    if (!showSmart) return new Set<number>()
    return new Set(proposedLevels.map(pl => pl.level))
  }, [proposedLevels, showSmart])

  // Combined Y-axis ticks: regime thresholds (grey) + ALL S/R levels (amber, no filtering)
  const allYTicks = useMemo(() => {
    const regimeTicks = [0, 17, 33, 50, 67, 83, 100].filter(t => t >= domainMin && t <= domainMax)
    const srTicks     = showSmart ? Array.from(srLevelSet) : []
    return Array.from(new Set([...regimeTicks, ...srTicks])).sort((a, b) => a - b)
  }, [showSmart, srLevelSet, domainMin, domainMax])

  // Capture plot area from ChartOverlay — needed for click → ratio coord conversion
  const handlePlotArea = useCallback((pa: PlotArea) => { plotAreaRef.current = pa }, [])

  // Click on chart: draw mode → place segment points; normal mode → select/deselect handled by onMouseDown
  const handleChartClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Suppress click if we just finished a drag (mousedown+move → mouseup → click)
    if (dragMovedRef.current) { dragMovedRef.current = false; return }
    if (!drawMode) return
    const pa = plotAreaRef.current
    if (!pa) return
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = e.clientX - rect.left
    const svgY = e.clientY - rect.top
    if (svgX < pa.x || svgX > pa.x + pa.width || svgY < pa.y || svgY > pa.y + pa.height) return
    const xr = (svgX - pa.x) / pa.width
    const yr = (svgY - pa.y) / pa.height
    if (!pendingPoint) {
      setPendingPoint({ xr, yr })
    } else {
      setDrawnSegments(prev => [...prev, { x1r: pendingPoint.xr, y1r: pendingPoint.yr, x2r: xr, y2r: yr }])
      setPendingPoint(null)
    }
  }, [drawMode, pendingPoint])

  // ── Chart area (shared between card and modal) ────────────────────────
  const renderChart = (height: number, gId: string) => (
    <div
      className="relative"
      style={drawMode ? { cursor: 'crosshair' } : nearSegment ? { cursor: 'grab' } : undefined}
      onClick={handleChartClick}
      onMouseDown={(e) => {
        if (drawMode) return
        const pa = plotAreaRef.current
        if (!pa || !drawnSegments.length) { setSelectedSegIdx(null); return }
        const rect = e.currentTarget.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        for (let i = 0; i < drawnSegments.length; i++) {
          const seg = drawnSegments[i]
          const x1 = pa.x + seg.x1r * pa.width,  y1 = pa.y + seg.y1r * pa.height
          const x2 = pa.x + seg.x2r * pa.width,  y2 = pa.y + seg.y2r * pa.height
          if (distToSegmentPx(mx, my, x1, y1, x2, y2) < 8) {
            dragRef.current = { segIdx: i, startXr: (mx - pa.x) / pa.width, startYr: (my - pa.y) / pa.height, origSeg: { ...seg } }
            dragMovedRef.current = false
            setSelectedSegIdx(i)
            return
          }
        }
        setSelectedSegIdx(null)
      }}
      onMouseMove={(e) => {
        const rect  = e.currentTarget.getBoundingClientRect()
        const mx    = e.clientX - rect.left
        const my    = e.clientY - rect.top
        setRawMousePos({ x: mx, y: my })
        const pa = plotAreaRef.current
        // ── dragging a segment ──────────────────────────────────────────
        if (dragRef.current && pa) {
          e.preventDefault()
          const curXr = (mx - pa.x) / pa.width
          const curYr = (my - pa.y) / pa.height
          const dx = curXr - dragRef.current.startXr
          const dy = curYr - dragRef.current.startYr
          if (!dragMovedRef.current && (Math.abs(dx) > 0.005 || Math.abs(dy) > 0.005)) dragMovedRef.current = true
          if (dragMovedRef.current) {
            const { origSeg, segIdx } = dragRef.current
            setDrawnSegments(prev => prev.map((s, i) => i !== segIdx ? s : {
              x1r: Math.max(0, Math.min(1, origSeg.x1r + dx)),
              y1r: Math.max(0, Math.min(1, origSeg.y1r + dy)),
              x2r: Math.max(0, Math.min(1, origSeg.x2r + dx)),
              y2r: Math.max(0, Math.min(1, origSeg.y2r + dy)),
            }))
          }
          return
        }
        // ── cursor hint when near a segment ─────────────────────────────
        if (!drawMode && pa && drawnSegments.length) {
          let near = false
          for (const seg of drawnSegments) {
            const x1 = pa.x + seg.x1r * pa.width, y1 = pa.y + seg.y1r * pa.height
            const x2 = pa.x + seg.x2r * pa.width, y2 = pa.y + seg.y2r * pa.height
            if (distToSegmentPx(mx, my, x1, y1, x2, y2) < 8) { near = true; break }
          }
          setNearSegment(near)
        }
      }}
      onMouseUp={() => { dragRef.current = null }}
      onMouseLeave={() => { setRawMousePos(null); dragRef.current = null; dragMovedRef.current = false; setNearSegment(false) }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (drawMode) {
          if (pendingPoint) setPendingPoint(null)
          else setDrawMode(false)
          return
        }
        // Right-click near a segment → delete it
        const pa = plotAreaRef.current
        if (pa && drawnSegments.length) {
          const rect = e.currentTarget.getBoundingClientRect()
          const mx = e.clientX - rect.left
          const my = e.clientY - rect.top
          for (let i = 0; i < drawnSegments.length; i++) {
            const seg = drawnSegments[i]
            const x1 = pa.x + seg.x1r * pa.width, y1 = pa.y + seg.y1r * pa.height
            const x2 = pa.x + seg.x2r * pa.width, y2 = pa.y + seg.y2r * pa.height
            if (distToSegmentPx(mx, my, x1, y1, x2, y2) < 10) {
              setDrawnSegments(prev => prev.filter((_, idx) => idx !== i))
              setSelectedSegIdx(null)
              return
            }
          }
        }
        if (onCreateAlert && hoveredScore !== null) {
          const level = pa && rawMousePos && pa.height > 0
            ? Math.round(domainMax - ((rawMousePos.y - pa.y) / pa.height) * (domainMax - domainMin))
            : Math.round(hoveredScore)
          setCtxMenu({ x: e.clientX, y: e.clientY, level })
        }
      }}
    >
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart
          data={data}
          margin={{ top: 6, right: compact ? 4 : 38, bottom: 0, left: -14 }}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onMouseMove={(e: any) => {
            if (e?.isTooltipActive && e.activeCoordinate?.x != null) {
              const idx: number = e.activeIndex ?? e.activeTooltipIndex
              const score = idx != null && idx >= 0 ? (data[idx]?.score ?? null) : null
              setHoverCoord({ x: e.activeCoordinate.x as number, y: e.activeCoordinate.y as number })
              setHoveredScore(score)
              setHoveredTs(idx != null && idx >= 0 ? (data[idx]?.ts ?? null) : null)
            }
          }}
          onMouseLeave={() => { setHoverCoord(null); setHoveredScore(null); setHoveredTs(null) }}
        >
          <defs>
            <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={activeColor} stopOpacity={0.35} />
              <stop offset="95%" stopColor={activeColor} stopOpacity={0.03} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />

          {/* Last-score dashed reference line */}
          {!compact && lastScore !== null && (
            <ReferenceLine
              y={lastScore}
              stroke={activeColor}
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              label={{
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content: (props: any) => (
                  <LastScoreLabel {...props} value={Math.round(lastScore)} color={activeColor} />
                ),
              }}
            />
          )}

          {/* Regime boundary lines */}
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

          {/* Smart S/R level lines — badge on right edge shows the exact Y value */}
          {showSmart && proposedLevels.map(pl => (
            <ReferenceLine
              key={`smart-${pl.level}`}
              y={pl.level}
              stroke="#f59e0b"
              strokeDasharray="2 4"
              strokeOpacity={0.6}
              label={{
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content: (props: any) => <SRLineBadge {...props} value={pl.level} color="#f59e0b" />,
              }}
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
            minTickGap={compact ? 12 : 2}
            tick={compact
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? ({ fill: '#52525b', fontSize: 10, fontFamily: 'monospace' } as any)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              : (props: any) => <CustomYAxisTick {...props} showSmart={showSmart} srLevelSet={srLevelSet} />
            }
            axisLine={false}
            tickLine={false}
            width={compact ? 24 : 36}
          />

          {/* Crosshair + TV-style Y label + drawn segments */}
          <Customized
            component={ChartOverlay}
            hoverCoord={hoverCoord}
            rawMousePos={rawMousePos}
            color={activeColor}
            domainMin={domainMin}
            domainMax={domainMax}
            drawMode={drawMode}
            pendingPoint={pendingPoint}
            drawnSegments={drawnSegments}
            selectedSegIdx={selectedSegIdx}
            hoveredTs={hoveredTs}
            range={range}
            onPlotArea={handlePlotArea}
          />

          <Area
            type="monotone"
            dataKey="score"
            stroke={activeColor}
            strokeWidth={compact ? 1.5 : 2}
            fill={`url(#${gId})`}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
          className="rounded-lg shadow-2xl bg-zinc-900 border border-zinc-700 py-1 min-w-[190px]"
        >
          <p className="px-3 pt-1 pb-0.5 text-[10px] text-zinc-600 font-mono uppercase tracking-wider">Chart alert</p>
          <button
            type="button"
            onClick={() => { onCreateAlert?.(ctxMenu.level, timeframe); setCtxMenu(null) }}
            className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 text-xs text-slate-300 w-full text-left transition-colors"
          >
            <Bell size={12} className="text-amber-400 shrink-0" />
            Set alert at VI = {ctxMenu.level}
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
  )

  // ── Header (shared, isModal distinguishes expand vs close button) ─────
  const renderHeader = (isModal: boolean) => (
    <div className="flex flex-wrap items-center justify-between gap-y-2 mb-3">
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-mono font-bold px-2 py-0.5 rounded border"
          style={{ color: activeColor, borderColor: `${activeColor}40`, background: `${activeColor}12` }}
        >
          {tfLabel}
        </span>
        <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">History</span>
        {data.length > 0 && !loading && lastRegime && (
          <span className="text-xs font-bold" style={{ color: activeColor }}>· {lastRegime}</span>
        )}
        {drawnSegments.length > 0 && (
          <span
            className="text-[10px] font-mono text-cyan-500 cursor-pointer hover:text-red-400 transition-colors"
            title="Click to clear all drawn lines"
            onClick={() => { setDrawnSegments([]); setPendingPoint(null) }}
          >
            {drawnSegments.length} line{drawnSegments.length > 1 ? 's' : ''} ×
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
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
        {/* Draw tool — click once for first point, click again for second point */}
        {!compact && (
          <button
            onClick={() => { setDrawMode(v => !v); setPendingPoint(null) }}
            title={drawMode ? 'Exit draw mode (Esc or right-click cancels)' : 'Draw a line (click 2 points)'}
            className={`p-1.5 rounded transition-colors ${
              drawMode ? 'text-cyan-400 bg-cyan-500/10 border border-cyan-500/20' : 'text-zinc-600 hover:text-zinc-300'
            }`}
          >
            <Pencil size={13} />
          </button>
        )}

        {/* Range selector */}
        <div className="flex gap-0.5 bg-zinc-900 border border-zinc-800 rounded-md p-0.5 overflow-x-auto max-w-[220px] sm:max-w-none scrollbar-none">
          {(['1h', '6h', '24h', '3d', '7d', '30d', '60d', '90d'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2 py-0.5 text-xs font-mono rounded transition-colors shrink-0 ${
                r === range ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Expand button (card) or close button (modal) */}
        {expandable && !isModal && (
          <button
            onClick={() => setExpanded(true)}
            title="Expand chart"
            className="p-1.5 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <Maximize2 size={13} />
          </button>
        )}
        {isModal && (
          <button
            onClick={() => setExpanded(false)}
            title="Close (Esc)"
            className="p-1.5 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  )

  // ── Body (loading / error / chart) ────────────────────────────────────
  const renderBody = (height: number, gId: string) => {
    if (loading) return (
      <div className="flex justify-center items-center" style={{ height }}>
        <Loader2 size={22} className="animate-spin text-zinc-600" />
      </div>
    )
    if (error || data.length === 0) return (
      <div className="flex items-center justify-center gap-2 text-zinc-600 text-xs" style={{ height }}>
        <AlertTriangle size={13} />
        {error ?? 'No data in this time range.'}
      </div>
    )
    return renderChart(height, gId)
  }

  // ── Stats bar ─────────────────────────────────────────────────────────
  const renderStats = () => data.length > 0 && !loading && (
    <div className="mt-2 pt-2 border-t border-zinc-800 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-zinc-600">
      <span>{data.length} pts</span>
      <span>min <span className="text-zinc-400">{Math.min(...scores).toFixed(0)}</span></span>
      <span>max <span className="text-zinc-400">{Math.max(...scores).toFixed(0)}</span></span>
      <span>now <span className="font-bold" style={{ color: activeColor }}>{data[data.length - 1].score.toFixed(1)}</span></span>
      {drawMode
        ? <span className="text-cyan-600 font-mono">{pendingPoint ? 'click 2nd point · right-click: cancel' : 'click 1st point · right-click: exit'}</span>
        : selectedSegIdx !== null
        ? <span className="text-cyan-500 font-mono">line selected · drag to move · right-click: delete · Esc: deselect</span>
        : nearSegment
        ? <span className="text-zinc-500 font-mono">click to select · drag to move · right-click: delete</span>
        : null
      }
      {onCreateAlert && hoveredScore !== null && !drawMode && (
        <span className="ml-auto text-zinc-500">
          VI <span className="text-zinc-300">{hoveredScore.toFixed(1)}</span>
          <span className="text-zinc-700"> · right-click: alert</span>
        </span>
      )}
    </div>
  )

  // ── Smart proposals panel ─────────────────────────────────────────────
  const renderSmartPanel = () => !compact && showSmart && (
    <>
      {proposedLevels.length > 0 ? (
        <div className="mt-3 pt-3 border-t border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb size={12} className="text-amber-400" />
            <p className="text-xs font-semibold text-amber-400">Smart suggestions</p>
            <span className="text-[10px] text-zinc-600">levels with repeated VI bounces</span>
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
      ) : data.length >= 15 ? (
        <p className="mt-3 text-[11px] text-zinc-600 italic">
          No significant level detected — try a wider range (7d, 30d).
        </p>
      ) : null}
    </>
  )

  return (
    <>
      {/* ── Normal card ── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
        {renderHeader(false)}
        {renderBody(chartHeight, gradientId)}
        {renderStats()}
        {renderSmartPanel()}
      </div>

      {/* ── Expanded modal overlay ── */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8 bg-black/80 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false) }}
        >
          <div
            className="rounded-xl border border-zinc-700 bg-zinc-950 p-5 w-full max-w-5xl shadow-2xl overflow-y-auto"
            style={{ maxHeight: '92vh' }}
          >
            {renderHeader(true)}
            {renderBody(500, `${gradientId}-modal`)}
            {renderStats()}
            {renderSmartPanel()}
          </div>
        </div>
      )}
    </>
  )
}
