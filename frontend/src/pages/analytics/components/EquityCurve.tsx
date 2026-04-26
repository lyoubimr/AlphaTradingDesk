// ── EquityCurve ─────────────────────────────────────────────────────────
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { EquityPoint } from '../../../types/api'

interface Props { data: EquityPoint[] }

const LastDot = (lastIdx: number, color: string) =>
  (props: { index?: number; cx?: number; cy?: number }) => {
    if (props.index !== lastIdx) return null
    return <circle cx={props.cx} cy={props.cy} r={4} fill={color} stroke="#0f172a" strokeWidth={1.5} />
  }

export function EquityCurve({ data }: Props) {
  if (data.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No data</div>

  const isPositive = data[data.length - 1].cumulative_pnl >= 0
  const lineColor = isPositive ? '#10b981' : '#ef4444'

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={lineColor} stopOpacity={0.3} />
            <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e1e35" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          tickFormatter={d => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
        />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={50} />
        <Tooltip
          contentStyle={{ background: '#16162a', border: '1px solid #1e1e35', borderRadius: 8, fontSize: 11 }}
          formatter={(v) => { const n = Number(v); return [n > 0 ? `+${n.toFixed(2)}` : n.toFixed(2), 'PnL'] }}
        />
        <Area
          type="monotone"
          dataKey="cumulative_pnl"
          stroke={lineColor}
          fill="url(#eq-grad)"
          strokeWidth={2}
          dot={LastDot(data.length - 1, lineColor) as never}
          activeDot={{ r: 4, fill: lineColor, stroke: '#0f172a', strokeWidth: 1.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
