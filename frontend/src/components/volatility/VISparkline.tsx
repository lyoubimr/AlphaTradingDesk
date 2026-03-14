// ── VISparkline ──────────────────────────────────────────────────────────────
// Pure SVG sparkline — visualises a series of VI scores [0, 1].
// Accumulates readings from live polling (passed in as `points`).
// When fewer than 2 points: shows a "collecting data…" placeholder.

interface Point {
  score: number
  ts: number  // epoch ms
}

interface Props {
  points: Point[]
  width?: number
  height?: number
  color?: string
}

export function VISparkline({ points, width = 320, height = 48, color = '#fb923c' }: Props) {
  if (points.length < 2) {
    return (
      <div
        className="flex items-center justify-center text-xs text-zinc-500 italic"
        style={{ width, height }}
      >
        Collecting data…
      </div>
    )
  }

  const pad = 4
  const w = width - pad * 2
  const h = height - pad * 2

  const minS = Math.min(...points.map((p) => p.score))
  const maxS = Math.max(...points.map((p) => p.score))
  const range = maxS - minS || 0.01

  const toX = (i: number) => pad + (i / (points.length - 1)) * w
  const toY = (s: number) => pad + h - ((s - minS) / range) * h

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(i).toFixed(1)} ${toY(p.score).toFixed(1)}`)
    .join(' ')

  // Filled area path
  const areaD = `${d} L ${toX(points.length - 1).toFixed(1)} ${pad + h} L ${pad} ${pad + h} Z`

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="vi-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#vi-fill)" />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
