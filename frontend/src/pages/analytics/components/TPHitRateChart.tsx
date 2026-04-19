// ── TPHitRateChart ────────────────────────────────────────────────────────
// Grouped bar chart: TP1 / TP2 / TP3 hit rates
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { TPHitRate } from '../../../types/api'

interface Props { data: TPHitRate[] }

const COLORS: Record<string, string> = {
  TP1: '#6366f1',
  TP2: '#8b5cf6',
  TP3: '#a78bfa',
}

export function TPHitRateChart({ data }: Props) {
  if (data.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No TP data</div>

  const chartData = data.map(d => ({
    name: d.tp_label,
    rate: d.hit_rate_pct,
    hits: d.hits,
    total: d.total,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} />
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
            `${v.toFixed(1)}% (${props.payload?.hits}/${props.payload?.total})`,
            'Hit Rate',
          ]}
        />
        <Bar dataKey="rate" radius={[3, 3, 0, 0]}>
          <LabelList
            dataKey="rate"
            position="top"
            formatter={(v: number) => `${v.toFixed(0)}%`}
            style={{ fontSize: 11, fill: '#94a3b8' }}
          />
          {chartData.map((entry, i) => (
            <Cell key={i} fill={COLORS[entry.name] ?? '#6366f1'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
