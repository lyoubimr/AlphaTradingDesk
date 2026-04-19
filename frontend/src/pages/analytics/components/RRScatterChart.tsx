// ── RRScatterChart ────────────────────────────────────────────────────────
// Scatter: planned R:R vs actual R:R, colored by win/loss
import {
  CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { RRScatterPoint } from '../../../types/api'

interface Props { data: RRScatterPoint[] }

const CustomDot = (props: { cx?: number; cy?: number; payload?: RRScatterPoint }) => {
  const { cx = 0, cy = 0, payload } = props
  const color = payload?.is_win ? '#10b981' : '#ef4444'
  return <circle cx={cx} cy={cy} r={4} fill={color} fillOpacity={0.7} stroke="none" />
}

export function RRScatterChart({ data }: Props) {
  if (data.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No R:R data</div>

  const maxVal = Math.ceil(
    Math.max(...data.map(d => Math.max(d.planned_rr ?? 0, d.actual_rr ?? 0)), 4)
  )

  return (
    <div className="space-y-2">
      <div className="flex gap-4 text-xs text-slate-500">
        <span><span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />Win</span>
        <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Loss</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis
            type="number"
            dataKey="planned_rr"
            domain={[0, maxVal]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            label={{ value: 'Planned R:R', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#64748b' }}
          />
          <YAxis
            type="number"
            dataKey="actual_rr"
            domain={[0, maxVal]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            width={36}
            label={{ value: 'Actual', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#64748b' }}
          />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
            formatter={(v: number, name: string) => [v.toFixed(2), name === 'planned_rr' ? 'Planned' : 'Actual']}
          />
          {/* Diagonal reference line y=x */}
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: maxVal, y: maxVal }]}
            stroke="#334155"
            strokeDasharray="4 4"
          />
          <Scatter data={data} shape={<CustomDot />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
