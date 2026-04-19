// ── EquityCurve ─────────────────────────────────────────────────────────
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { EquityPoint } from '../../../types/api'

interface Props { data: EquityPoint[] }

export function EquityCurve({ data }: Props) {
  if (data.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No data</div>

  const isPositive = data[data.length - 1].cumulative_pnl >= 0

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.3} />
            <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={50} />
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
          formatter={(v: number) => [v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2), 'PnL']}
        />
        <Area
          type="monotone"
          dataKey="cumulative_pnl"
          stroke={isPositive ? '#10b981' : '#ef4444'}
          fill="url(#eq-grad)"
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
