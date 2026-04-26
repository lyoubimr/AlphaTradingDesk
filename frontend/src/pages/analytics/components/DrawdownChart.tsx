// ── DrawdownChart ────────────────────────────────────────────────────────
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { DrawdownPoint } from '../../../types/api'

interface Props { data: DrawdownPoint[] }

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
            tickFormatter={d => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
          />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} width={40} tickFormatter={v => `${v}%`} />
          <Tooltip
            contentStyle={{ background: '#16162a', border: '1px solid #1e1e35', borderRadius: 8, fontSize: 11 }}
            formatter={(v: unknown) => [`${((v as number) ?? 0).toFixed(2)}%`, 'Drawdown']}
          />
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
