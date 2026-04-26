// ── EquityCurve ─────────────────────────────────────────────────────────
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { EquityPoint } from '../../../types/api'

interface Props { data: EquityPoint[] }

/** Dot rendered only on the last data point; color depends on that point's value */
const LastDot = (lastIdx: number) =>
  (props: { index?: number; cx?: number; cy?: number; payload?: EquityPoint }) => {
    if (props.index !== lastIdx) return null
    const color = (props.payload?.cumulative_pnl ?? 0) >= 0 ? '#10b981' : '#ef4444'
    return <circle cx={props.cx} cy={props.cy} r={4} fill={color} stroke="#0f172a" strokeWidth={1.5} />
  }

/** Custom tooltip: PnL value colored green/red per-point */
const EquityTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}) => {
  if (!active || !payload?.length) return null
  const val = payload[0].value
  const color = val >= 0 ? '#10b981' : '#ef4444'
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const d = label ? new Date(label) : null
  const dateStr = d ? `${DOW[d.getDay()]} ${d.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''
  return (
    <div style={{ background: '#16162a', border: '1px solid #1e1e35', borderRadius: 8, fontSize: 11, padding: '6px 10px' }}>
      <div style={{ color: '#64748b', marginBottom: 2 }}>{dateStr}</div>
      <div style={{ color }}>PnL  {val >= 0 ? '+' : ''}{val.toFixed(2)}</div>
    </div>
  )
}

export function EquityCurve({ data }: Props) {
  if (data.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No data</div>

  const lastVal = data[data.length - 1].cumulative_pnl
  const lineColor = lastVal >= 0 ? '#10b981' : '#ef4444'

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
          tickFormatter={d => { const dt = new Date(d); const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return `${DOW[dt.getDay()]} ${dt.toLocaleDateString('en', { month: 'short', day: 'numeric' })}` }}
        />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={50} />
        <Tooltip content={<EquityTooltip />} />
        <Area
          type="monotone"
          dataKey="cumulative_pnl"
          stroke={lineColor}
          fill="url(#eq-grad)"
          strokeWidth={2}
          dot={LastDot(data.length - 1) as never}
          activeDot={(props: { cx?: number; cy?: number; payload?: EquityPoint }) => {
            const color = (props.payload?.cumulative_pnl ?? 0) >= 0 ? '#10b981' : '#ef4444'
            return <circle cx={props.cx} cy={props.cy} r={4} fill={color} stroke="#0f172a" strokeWidth={1.5} />
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
