// ── MarketVIGauge ────────────────────────────────────────────────────────────
// SVG arc gauge showing a VI score [0, 1].
// Arc goes from -210° to +30° (240° sweep), bottom-left to bottom-right.
// Color tracks the regime: zinc → sky → green → yellow → orange → red.

interface Props {
  score: number   // [0, 1]
  size?: number   // px, default 200
}

const REGIME_COLORS = [
  { max: 0.17, color: '#71717a' },  // zinc-500   MORT
  { max: 0.33, color: '#38bdf8' },  // sky-400     CALME
  { max: 0.50, color: '#34d399' },  // emerald-400 NORMAL
  { max: 0.67, color: '#fbbf24' },  // yellow-400  TRENDING
  { max: 0.83, color: '#fb923c' },  // orange-400  ACTIF
  { max: 1.00, color: '#f87171' },  // red-400     EXTRÊME
]

function scoreColor(score: number): string {
  return REGIME_COLORS.find((r) => score <= r.max)?.color ?? '#f87171'
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  }
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polarToCartesian(cx, cy, r, startDeg)
  const e = polarToCartesian(cx, cy, r, endDeg)
  const largeArc = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`
}

const START_DEG = 150   // bottom-left
const END_DEG   = 390   // bottom-right (150 + 240)
const SWEEP     = 240

export function MarketVIGauge({ score, size = 200 }: Props) {
  const cx = size / 2
  const cy = size / 2
  const r  = size * 0.38
  const strokeW = size * 0.07

  const clampedScore = Math.max(0, Math.min(1, score))
  const fillEnd = START_DEG + SWEEP * clampedScore
  const color = scoreColor(clampedScore)

  return (
    <svg width={size} height={size * 0.75} viewBox={`0 0 ${size} ${size * 0.75}`}>
      {/* Track */}
      <path
        d={arcPath(cx, cy * 0.88, r, START_DEG, END_DEG)}
        fill="none"
        stroke="#27272a"
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      {/* Fill */}
      {clampedScore > 0 && (
        <path
          d={arcPath(cx, cy * 0.88, r, START_DEG, fillEnd)}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
        />
      )}
      {/* Score label */}
      <text
        x={cx}
        y={cy * 0.78}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        fontSize={size * 0.22}
        fontWeight="700"
        fontFamily="monospace"
      >
        {(clampedScore * 100).toFixed(0)}
      </text>
      {/* /100 suffix */}
      <text
        x={cx}
        y={cy * 0.78 + size * 0.12}
        textAnchor="middle"
        fill="#71717a"
        fontSize={size * 0.08}
        fontFamily="monospace"
      >
        / 100
      </text>
    </svg>
  )
}
