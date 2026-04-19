// ── HourlyWRChart ────────────────────────────────────────────────────────
// Heatmap-style bar chart: WR % by entry hour (UTC)
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { WRByHour } from '../../../types/api'

interface Props { data: WRByHour[] }

export function HourlyWRChart({ data }: Props) {
  const active = data.filter(d => d.trades > 0)
  if (active.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No data</div>

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 9, fill: '#64748b' }}
          tickLine={false}
          tickFormatter={h => `${h}h`}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          tickFormatter={v => `${v}%`}
          width={38}
        />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
          formatter={(v: number, _n: string, props) => [
            v != null ? `${v.toFixed(1)}% (${props.payload?.trades} trades)` : 'No trades',
            'WR',
          ]}
          labelFormatter={h => `${h}:00 UTC`}
        />
        <Bar dataKey="wr_pct" radius={[2, 2, 0, 0]}>
          {data.map((entry, i) => {
            if (entry.trades === 0) return <Cell key={i} fill="#1e293b" />
            const wr = entry.wr_pct ?? 0
            const color = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'
            return <Cell key={i} fill={color} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
