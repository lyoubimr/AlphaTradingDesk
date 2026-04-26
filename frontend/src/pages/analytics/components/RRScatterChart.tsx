// ── RRScatterChart ────────────────────────────────────────────────────────────
// Scatter: planned R:R vs actual R:R, colored by win/loss
import {
  CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { RRScatterPoint } from '../../../types/api'

interface Props { data: RRScatterPoint[] }

const CustomDot = (props: { cx?: number; cy?: number; payload?: RRScatterPoint }) => {
  const { cx = 0, cy = 0, payload } = props
  const isWin = payload?.is_win
  return (
    <g>
      <circle
        cx={cx} cy={cy} r={5}
        fill={isWin ? '#10b981' : '#ef4444'}
        fillOpacity={0.65}
        stroke={isWin ? '#34d399' : '#f87171'}
        strokeWidth={0.8}
        strokeOpacity={0.5}
      />
    </g>
  )
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: { payload: RRScatterPoint }[] }) => {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="bg-[#16162a] border border-surface-700 rounded-lg px-3 py-2 text-[11px] space-y-0.5 shadow-xl">
      <div className="font-semibold text-slate-200">{p.pair} <span className={p.is_win ? 'text-emerald-400' : 'text-red-400'}>{p.is_win ? 'Win' : 'Loss'}</span></div>
      {p.strategy_name && <div className="text-slate-400">Strategy: <span className="text-slate-200">{p.strategy_name}</span></div>}
      {p.session_tag && <div className="text-slate-400">Session: <span className="text-slate-200">{p.session_tag}</span></div>}
      <div className="text-slate-400">Planned: <span className="text-slate-200">{(p.planned_rr ?? 0).toFixed(2)}R</span></div>
      <div className="text-slate-400">Actual: <span className={p.actual_rr != null && p.actual_rr >= 0 ? 'text-emerald-400' : 'text-red-400'}>{(p.actual_rr ?? 0).toFixed(2)}R</span></div>
    </div>
  )
}

export function RRScatterChart({ data }: Props) {
  if (data.length === 0) return <div className="text-slate-600 text-sm py-8 text-center">No R:R data</div>

  const maxVal = Math.ceil(
    Math.max(...data.map(d => Math.max(d.planned_rr ?? 0, d.actual_rr ?? 0)), 4)
  )
  const wins = data.filter(d => d.is_win).length
  const avgPlanned = data.reduce((s, d) => s + (d.planned_rr ?? 0), 0) / data.length
  const avgActual = data.reduce((s, d) => s + (d.actual_rr ?? 0), 0) / data.length

  return (
    <div className="space-y-3">
      {/* Mini stats — visible badges */}
      <div className="flex gap-1.5 flex-wrap">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-emerald-950/50 border border-emerald-900/40 text-emerald-300 rounded-full px-2 py-px">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
          {wins}W
        </span>
        <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-red-950/50 border border-red-900/40 text-red-300 rounded-full px-2 py-px">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
          {data.length - wins}L
        </span>
        <span style={{ color: '#e2e8f0' }} className="inline-flex items-center gap-1 text-[10px] font-medium bg-surface-800 border border-surface-700 rounded-full px-2 py-px">
          Plan <strong style={{ color: '#ffffff' }}>{avgPlanned.toFixed(2)}R</strong>
        </span>
        <span style={{ color: '#e2e8f0' }} className="inline-flex items-center gap-1 text-[10px] font-medium bg-surface-800 border border-surface-700 rounded-full px-2 py-px">
          Act <strong style={{ color: '#ffffff' }}>{avgActual.toFixed(2)}R</strong>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e35" />
          <XAxis
            type="number"
            dataKey="planned_rr"
            domain={[0, maxVal]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            label={{ value: 'Planned R:R', position: 'insideBottom', offset: -8, fontSize: 10, fill: '#94a3b8' }}
          />
          <YAxis
            type="number"
            dataKey="actual_rr"
            domain={[0, maxVal]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            width={36}
            label={{ value: 'Actual R:R', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* y = x diagonal reference */}
          <ReferenceLine
            segment={[{ x: 0, y: 0 }, { x: maxVal, y: maxVal }]}
            stroke="#334155"
            strokeDasharray="5 4"
            strokeWidth={1}
          />
          <Scatter data={data} shape={<CustomDot />} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
