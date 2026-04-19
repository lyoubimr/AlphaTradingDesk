// ── WRBarChart ───────────────────────────────────────────────────────────
// Generic horizontal bar chart for WR breakdowns (strategy / session / pair)
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { WRByStat } from '../../../types/api'

interface Props {
  data: WRByStat[]
  height?: number
  showPnl?: boolean
}

export function WRBarChart({ data, height = 220, showPnl = false }: Props) {
  if (data.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No data</div>

  const sorted = [...data].sort((a, b) => (b.wr_pct ?? 0) - (a.wr_pct ?? 0))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: '#64748b' }}
          tickLine={false}
          tickFormatter={v => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          tickLine={false}
          width={90}
        />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
          formatter={(v: unknown, name: unknown) => {
            const n = v as number | undefined
            const nm = name as string
            return [
              nm === 'wr_pct' ? `${n?.toFixed(1)}%` : n?.toFixed(2),
              nm === 'wr_pct' ? 'WR' : 'Avg PnL',
            ]
          }}
        />
        <Bar dataKey={showPnl ? 'avg_pnl' : 'wr_pct'} radius={[0, 3, 3, 0]}>
          {sorted.map((entry, i) => {
            const val = showPnl ? (entry.avg_pnl ?? 0) : (entry.wr_pct ?? 0)
            const color = showPnl
              ? val >= 0 ? '#10b981' : '#ef4444'
              : val >= 55 ? '#10b981' : val >= 45 ? '#f59e0b' : '#ef4444'
            return <Cell key={i} fill={color} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
