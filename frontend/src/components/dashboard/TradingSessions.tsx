// Sessions indicator — compact dots for the Topbar.
// Computed client-side from UTC time. Zero API calls. Updates every 30s.
// Hover OR click on a dot to see session details.
//
// Sessions (UTC):
//   Asia (Tokyo)        : 00:00 – 09:00
//   London / EUR        : 08:00 – 17:00
//   London / NY Overlap : 13:00 – 17:00
//   New York            : 13:00 – 22:00
//   NYSE Open           : 14:30 – 21:00

import { useEffect, useRef, useState } from 'react'

interface Session {
  id: string
  label: string
  emoji: string
  startH: number  // decimal UTC hour (e.g. 14.5 = 14:30)
  endH: number
  color: string
}

const SESSIONS: Session[] = [
  { id: 'asia',   label: 'Asia', emoji: '🌏', startH: 0,    endH: 9,  color: '#38bdf8' },
  { id: 'london', label: 'EUR',  emoji: '🇬🇧', startH: 8,    endH: 17, color: '#a78bfa' },
  { id: 'ny',     label: 'NY',   emoji: '🗽', startH: 13,   endH: 22, color: '#fb923c' },
  { id: 'nyse',   label: 'NYSE', emoji: '🔔', startH: 14.5, endH: 21, color: '#f87171' },
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

// ── SessionDot: hover + click tooltip ────────────────────────────────────────
function SessionDot({ color, label }: { color: string; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <span
      ref={ref}
      className="relative flex items-center justify-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onClick={() => setOpen(v => !v)}
    >
      <span
        className="block w-2.5 h-2.5 rounded-full animate-pulse cursor-pointer"
        style={{ backgroundColor: color }}
      />
      {open && (
        <span className="
          absolute top-full left-1/2 -translate-x-1/2 mt-2
          whitespace-nowrap text-xs
          bg-surface-800 border border-surface-700
          text-slate-200 px-2.5 py-1 rounded-lg shadow-xl z-50
          pointer-events-none
        ">
          {label}
        </span>
      )}
    </span>
  )
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
      <SessionDot color="#f59e0b" label="🌙 Weekend — Crypto only" />
    )
  }

  if (active.length === 0) {
    return (
      <SessionDot color="#334155" label={`Market closed · next: ${nextOpenLabel(now)}`} />
    )
  }

  return (
    <div className="hidden md:flex items-center gap-1.5">
      {active.map(s => (
        <SessionDot
          key={s.id}
          color={s.color}
          label={`${s.emoji} ${s.label} · ${closesIn(s, now)}`}
        />
      ))}
      {overlap && (
        <SessionDot color="#c084fc" label="⚡ Overlap EUR·NY — peak liquidity" />
      )}
    </div>
  )
}

// Backward-compat alias
export { SessionsIndicator as TradingSessions }
