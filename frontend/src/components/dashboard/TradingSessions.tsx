// Sessions indicator — compact inline pills for the Topbar.
// Computed client-side from UTC time. Zero API calls. Updates every 30s.
//
// Sessions (UTC):
//   Asia (Tokyo)        : 00:00 – 09:00
//   London              : 08:00 – 17:00
//   London / NY Overlap : 13:00 – 17:00
//   New York            : 13:00 – 22:00
//   NYSE Open           : 14:30 – 21:00

import { useEffect, useState } from 'react'

interface Session {
  id: string
  label: string
  emoji: string
  startH: number  // decimal UTC hour (e.g. 14.5 = 14:30)
  endH: number
  color: string
}

const SESSIONS: Session[] = [
  { id: 'asia',   label: 'Asia',      emoji: '🌏', startH: 0,    endH: 9,  color: '#38bdf8' },
  { id: 'london', label: 'London',    emoji: '🇬🇧', startH: 8,    endH: 17, color: '#a78bfa' },
  { id: 'ny',     label: 'New York',  emoji: '🗽', startH: 13,   endH: 22, color: '#34d399' },
  { id: 'nyse',   label: 'NYSE Open', emoji: '🔔', startH: 14.5, endH: 21, color: '#fbbf24' },
]

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6

function utcH(d: Date) {
  return d.getUTCHours() + d.getUTCMinutes() / 60
}

function isActive(s: Session, now: Date, weekend: boolean): boolean {
  if (weekend) return false
  const h = utcH(now)
  return h >= s.startH && h < s.endH
}

function closesIn(s: Session, now: Date): string {
  const remaining = s.endH - utcH(now)
  const h = Math.floor(remaining)
  const m = Math.round((remaining - h) * 60)
  if (h > 0 && m > 0) return `closes in ${h}h ${m}m`
  if (h > 0) return `closes in ${h}h`
  return `closes in ${m}m`
}

function nextOpenLabel(now: Date): string {
  const h = utcH(now)
  const sorted = [...SESSIONS].sort((a, b) => {
    const da = a.startH > h ? a.startH - h : a.startH + 24 - h
    const db = b.startH > h ? b.startH - h : b.startH + 24 - h
    return da - db
  })
  const next = sorted[0]
  const diff = next.startH > h ? next.startH - h : next.startH + 24 - h
  const dh = Math.floor(diff)
  const dm = Math.round((diff - dh) * 60)
  return `${next.emoji} ${next.label} in ${dh > 0 ? `${dh}h ` : ''}${dm}m`
}

export function SessionsIndicator() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const weekend = isWeekend(now)
  const active  = SESSIONS.filter(s => isActive(s, now, weekend))
  const overlap = !weekend && active.some(s => s.id === 'london') && active.some(s => s.id === 'ny')

  if (weekend) {
    return (
      <span className="hidden sm:inline text-xs text-amber-400 bg-amber-900/20 border border-amber-700/30 px-2.5 py-0.5 rounded-full">
        🌙 Weekend — Crypto only
      </span>
    )
  }

  if (active.length === 0) {
    return (
      <span className="hidden lg:inline text-xs text-slate-600">
        Market closed · next: {nextOpenLabel(now)}
      </span>
    )
  }

  return (
    <div className="hidden md:flex items-center gap-2">
      {active.map(s => (
        <span
          key={s.id}
          className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border"
          style={{ borderColor: s.color + '55', backgroundColor: s.color + '18', color: s.color }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse"
            style={{ backgroundColor: s.color }}
          />
          {s.emoji} {s.label}
          <span className="opacity-60 font-normal">{closesIn(s, now)}</span>
        </span>
      ))}
      {overlap && (
        <span className="text-[11px] text-purple-400 bg-purple-900/15 border border-purple-700/30 px-2 py-0.5 rounded-full">
          ⚡ Overlap LDN·NYC
        </span>
      )}
    </div>
  )
}

// Backward-compat alias
export { SessionsIndicator as TradingSessions }
