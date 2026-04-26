// ── DayHourHeatmap ───────────────────────────────────────────────────────────
// 7×N heatmap: rows = Mon–Sun, columns = active trading hours (local time)
// Each cell is colored by WR% and saturated by trade count
import type { WRByDayHour } from '../../../types/api'

interface Props { data: WRByDayHour[] }

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function wrColor(wr: number, alpha: number): string {
  if (wr >= 60) return `rgba(16, 185, 129, ${alpha})`   // emerald
  if (wr >= 50) return `rgba(245, 158, 11, ${alpha})`   // amber
  if (wr >= 40) return `rgba(239, 68, 68, ${alpha})`    // red
  return `rgba(127, 29, 29, ${alpha})`                  // dark red
}

function wrTextColor(wr: number): string {
  if (wr >= 60) return '#6ee7b7'
  if (wr >= 50) return '#fcd34d'
  return '#fca5a5'
}

export function DayHourHeatmap({ data }: Props) {
  const tzOff = -new Date().getTimezoneOffset() / 60
  const tzLabel = tzOff >= 0 ? `UTC+${tzOff}` : `UTC${tzOff}`

  // Convert each UTC (day, hour) → local (day, hour)
  type Cell = { localDay: number; localHour: number; trades: number; wins: number; wr_pct: number | null }
  const cells: Cell[] = data.map(d => {
    const totalLocal = d.day * 24 + d.hour + tzOff
    const localDay = ((Math.floor(totalLocal / 24)) % 7 + 7) % 7
    const localHour = ((totalLocal % 24) + 24) % 24
    return { localDay, localHour, trades: d.trades, wins: d.wins, wr_pct: d.wr_pct }
  })

  // Active hours range — start at 12:00 minimum (most trades in afternoon/evening)
  const activeHours = [...new Set(cells.filter(c => c.trades > 0).map(c => c.localHour))].sort((a, b) => a - b)
  if (activeHours.length === 0) return (
    <div className="text-slate-600 text-sm py-4 text-center">No data</div>
  )
  const minH = Math.max(12, activeHours[0] - 1)
  const maxH = Math.min(23, activeHours[activeHours.length - 1] + 1)
  const hourRange = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i)

  // Build cell lookup
  const map = new Map<string, Cell>()
  cells.forEach(c => map.set(`${c.localDay}-${c.localHour}`, c))
  const maxTrades = Math.max(...cells.filter(c => c.trades > 0).map(c => c.trades), 1)

  // Filter to days that have at least one active cell
  const activeDays = DAYS.map((label, idx) => ({ label, idx })).filter(({ idx }) =>
    hourRange.some(h => (map.get(`${idx}-${h}`)?.trades ?? 0) > 0)
  )

  if (activeDays.length === 0) return (
    <div className="text-slate-600 text-sm py-4 text-center">No data</div>
  )

  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <span style={{ color: '#e2e8f0' }} className="inline-flex items-center text-[10px] font-medium bg-surface-800 border border-surface-700 rounded-full px-2 py-px">
          {tzLabel}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[9px] border-collapse w-full">
          <thead>
            <tr>
              <th className="w-8 pb-1" />
              {hourRange.map(h => (
                <th key={h} className="text-center text-slate-500 font-normal pb-1 px-0.5 min-w-[2rem]">
                  {String(h).padStart(2, '0')}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeDays.map(({ label, idx }) => (
              <tr key={idx}>
                <td className="text-slate-400 text-right pr-2 font-medium py-0.5 whitespace-nowrap">{label}</td>
                {hourRange.map(h => {
                  const cell = map.get(`${idx}-${h}`)
                  if (!cell || cell.trades === 0) {
                    return <td key={h} className="py-0.5 px-0.5"><div className="h-6 rounded-sm bg-surface-800/30" /></td>
                  }
                  const wr = cell.wr_pct ?? 0
                  const alpha = 0.3 + (cell.trades / maxTrades) * 0.65
                  const bg = wrColor(wr, alpha)
                  const textColor = wrTextColor(wr)
                  return (
                    <td key={h} className="py-0.5 px-0.5">
                      <div
                        title={`${label} ${String(h).padStart(2, '0')}:00 ${tzLabel} — WR ${wr.toFixed(0)}% (${cell.trades} trade${cell.trades > 1 ? 's' : ''})`}
                        style={{ background: bg }}
                        className="h-6 rounded-sm flex items-center justify-center cursor-default select-none"
                      >
                        <span style={{ color: textColor }} className="font-bold leading-none">
                          {wr.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-3 pt-0.5">
        <span className="text-[9px] text-slate-600">WR:</span>
        {[['≥60%', '#6ee7b7', 'rgba(16,185,129,0.6)'], ['≥50%', '#fcd34d', 'rgba(245,158,11,0.6)'], ['<50%', '#fca5a5', 'rgba(239,68,68,0.6)']].map(([label, text, bg]) => (
          <span key={label} className="flex items-center gap-1 text-[9px]">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: bg }} />
            <span style={{ color: text as string }}>{label}</span>
          </span>
        ))}
        <span className="text-[9px] text-slate-600 ml-1">Darker = more trades</span>
      </div>
    </div>
  )
}
