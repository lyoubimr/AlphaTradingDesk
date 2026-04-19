// ── TradeTypeDist ─────────────────────────────────────────────────────────
// Pie chart: scalp / intraday / swing trade type distribution
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import type { TradeTypeRow } from '../../../types/api'

interface Props { data: TradeTypeRow[] }

const LABEL_MAP: Record<string, string> = {
  scalp: 'Scalp (<1h)',
  intraday: 'Intraday',
  swing: 'Swing (>24h)',
}
const COLOR_MAP: Record<string, string> = {
  scalp: '#6366f1',
  intraday: '#10b981',
  swing: '#f59e0b',
}

export function TradeTypeDist({ data }: Props) {
  const filtered = data.filter(d => d.count > 0)
  if (filtered.length === 0) return <div className="text-slate-500 text-sm py-8 text-center">No data</div>

  const chartData = filtered.map(d => ({
    name: LABEL_MAP[d.trade_type] ?? d.trade_type,
    value: d.count,
    wr: d.wr_pct,
    avg_pnl: d.avg_pnl,
    raw: d.trade_type,
  }))

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
            dataKey="value"
          >
            {chartData.map((entry, i) => (
              <Cell key={i} fill={COLOR_MAP[entry.raw] ?? '#475569'} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, fontSize: 11 }}
            formatter={(v: number, _n: string, props) => [
              `${v} trades — WR ${props.payload?.wr?.toFixed(1)}%`,
              props.payload?.name,
            ]}
          />
          <Legend
            iconSize={10}
            wrapperStyle={{ fontSize: 11, color: '#94a3b8' }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-3 gap-2">
        {chartData.map(d => (
          <div key={d.raw} className="text-center">
            <div className="text-xs text-slate-500">{d.name}</div>
            <div className="text-sm font-semibold text-slate-200">{d.value} trades</div>
            <div className="text-xs" style={{ color: COLOR_MAP[d.raw] }}>
              WR {d.wr?.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
