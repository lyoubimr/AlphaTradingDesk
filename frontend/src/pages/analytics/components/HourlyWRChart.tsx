// ── HourlyWRChart ────────────────────────────────────────────────────────────
// Bar chart: WR % by entry hour, shifted to browser local time
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { WRByHour } from '../../../types/api'

interface Props { data: WRByHour[] }

export function HourlyWRChart({ data }: Props) {
  // Browser UTC offset in hours (e.g. +2 for UTC+2)
  const tzOff = -new Date().getTimezoneOffset() / 60
  const tzLabel = tzOff >= 0 ? `UTC+${tzOff}` : `UTC${tzOff}`

  // Shift data hours to local time, wrap 0-23
  const shifted = data.map(d => ({
    ...d,
    localHour: ((d.hour + tzOff) % 24 + 24) % 24,
  })).sort((a, b) => a.localHour - b.localHour)

  // Trim empty leading + trailing hours
  const firstActive = shifted.findIndex(d => d.trades > 0)
  let lastActive = -1
  for (let i = shifted.length - 1; i >= 0; i--) {
    if (shifted[i].trades > 0) { lastActive = i; break }
  }
  const active = firstActive === -1 ? [] : shifted.slice(
    Math.max(0, firstActive - 1),
    Math.min(shifted.length, lastActive + 2),
  )

  if (active.length === 0) return (
    <div className="text-slate-600 text-sm py-8 text-center">No data</div>
  )

  return (
    <div className="space-y-1">
      <div className="flex justify-end">
        <span className="inline-flex items-center text-[10px] font-medium text-slate-200 bg-surface-800 border border-surface-700 rounded-full px-2 py-0.5">
          {tzLabel}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={active} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e1e35" vertical={false} />
          <XAxis
            dataKey="localHour"
            tick={{ fontSize: 9, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={h => `${String(h).padStart(2, '0')}h`}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#64748b' }}
            tickLine={false}
            tickFormatter={v => `${v}%`}
            width={36}
          />
          <Tooltip
            contentStyle={{ background: '#16162a', border: '1px solid #1e1e35', borderRadius: 8, fontSize: 11 }}
            formatter={(v: unknown, _n: unknown, props) => {
              const n = v as number | undefined
              return [
                n != null ? `${n.toFixed(1)}%  ·  ${props.payload?.trades} trades` : 'No trades',
                'Win Rate',
              ]
            }}
            labelFormatter={h => `${String(h).padStart(2, '0')}:00 ${tzLabel}`}
          />
          <Bar dataKey="wr_pct" radius={[3, 3, 0, 0]} maxBarSize={28}>
            {active.map((entry, i) => {
              if (entry.trades === 0) return <Cell key={i} fill="#1e1e35" />
              const wr = entry.wr_pct ?? 0
              const color = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'
              return <Cell key={i} fill={color} />
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
