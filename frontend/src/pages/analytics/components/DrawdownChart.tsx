// ── DrawdownChart ────────────────────────────────────────────────────────
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { DrawdownPoint } from '../../../types/api'

interface Props { data: DrawdownPoint[] }

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
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={40} tickFormatter={v => `${v}%`} />
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
            formatter={(v: number) => [`${v.toFixed(2)}%`, 'Drawdown']}
          />
          <Area
            type="monotone"
            dataKey="drawdown_pct"
            stroke="#ef4444"
            fill="url(#dd-grad)"
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
