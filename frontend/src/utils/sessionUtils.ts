/**
 * SESSION UTILITIES — timezone-aware session helpers.
 *
 * All trading sessions are defined in UTC.
 * `formatSessionRange` converts those UTC boundaries to the browser's
 * local timezone so the display is always correct regardless of where
 * the trader is physically located.
 */

/** UTC boundaries [openH, closeH) for each session. */
export const SESSION_UTC: Record<string, { open: number; close: number } | null> = {
  Asian:     { open: 0,  close: 8  },
  London:    { open: 7,  close: 16 },
  Overlap:   { open: 13, close: 17 },
  'New York': { open: 13, close: 22 },
  Weekend:   null, // Sat–Sun, no fixed hours
}

/** Convert a UTC hour to a local HH:MM string using the browser's timezone. */
function utcHourToLocal(utcH: number): string {
  const d = new Date()
  d.setUTCHours(utcH, 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Current local timezone abbreviation (e.g. "CET", "EST", "JST"). */
export function tzLabel(): string {
  try {
    return (
      Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
        .formatToParts(new Date())
        .find(p => p.type === 'timeZoneName')?.value ?? 'local'
    )
  } catch {
    return 'local'
  }
}

/**
 * Returns the local time range string for a session, e.g.
 *   "09:00–18:00 CET"  (for London, when in Paris)
 *   "Sat–Sun"          (for Weekend)
 */
export function formatSessionRange(session: string): string {
  const bounds = SESSION_UTC[session]
  if (!bounds) return 'Sat–Sun'
  return `${utcHourToLocal(bounds.open)}–${utcHourToLocal(bounds.close)} ${tzLabel()}`
}

const SESSION_EMOJIS: Record<string, string> = {
  Asian:     '🌏',
  London:    '🇬🇧',
  Overlap:   '⚡',
  'New York': '🗽',
  Weekend:   '🌙',
}

const SESSION_CONTEXT: Record<string, string> = {
  Asian:     'Tokyo/Sydney',
  London:    'EUR/GBP',
  Overlap:   'London × NY — volatility peak',
  'New York': 'USD/CAD',
  Weekend:   'crypto only, low liquidity',
}

/**
 * Full tooltip string for a session.
 * Example: "🇬🇧 London (EUR/GBP): 09:00–18:00 CET"
 */
export function sessionTooltip(session: string): string {
  const emoji = SESSION_EMOJIS[session] ?? ''
  const ctx   = SESSION_CONTEXT[session] ?? ''
  const range = formatSessionRange(session)
  return `${emoji} ${session}${ctx ? ` (${ctx})` : ''}: ${range}`
}
