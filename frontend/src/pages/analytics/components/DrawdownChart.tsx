// ── DrawdownChart ────────────────────────────────────────────────────────
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { DrawdownPoint } from '../../../types/api'

interface Props { data: DrawdownPoint[] }

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const DDTooltip = ({ active, payload, label }: {
  active?: boolean
  payload?: { value: number }[]
  label?: string
}) => {
  if (!active || !payload?.length) return null
  const val = payload[0].value
  const d = label ? new Date(label) : null
  const dateStr = d ? `${DOW[d.getDay()]} ${d.toLocaleDateString('en', { month: 'short', day: 'numeric' })}` : ''
  return (
    <div style={{ background: '#16162a', border: '1px solid #1e1e35', borderRadius: 8, fontSize: 11, padding: '6px 10px' }}>
      <div style={{ color: '#64748b', marginBottom: 2 }}>{dateStr}</div>
      <div style={{ color: '#ef4444' }}>Drawdown\u00a0 {val.toFixed(2)}%</div>
    </div>
  )
}

const LastDotDD = (lastIdx: number) =>
  (props: { index?: number; cx?: number; cy?: number }) => {
    if (props.index !== lastIdx) return null
    return <circle cx={props.cx} cy={props.cy} r={4} fill="#ef4444" stroke="#0f172a" strokeWidth={1.5} />
  }

export function DrawdownChart({ data }: Props) {
  if (data.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No data</div>
  const maxDD = Math.min(...data.map(d => d.drawdown_pct))

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        Max drawdown: <span className="text-red-400 font-semibold">{maxDD.toFixed(1)}%</span>
      </p>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dd-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e35" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={d => { const dt = new Date(d); const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return `${DOW[dt.getDay()]} ${dt.toLocaleDateString('en', { month: 'short', day: 'numeric' })}` }}
          />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={40} tickFormatter={v => `${v}%`} />
          <Tooltip content={<DDTooltip />} />
          <Area
            type="monotone"
            dataKey="drawdown_pct"
            stroke="#ef4444"
            fill="url(#dd-grad)"
            strokeWidth={2}
            dot={LastDotDD(data.length - 1) as never}
            activeDot={{ r: 4, fill: '#ef4444', stroke: '#0f172a', strokeWidth: 1.5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
