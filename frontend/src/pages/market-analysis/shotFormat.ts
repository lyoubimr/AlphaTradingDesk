/** "01 Nov 14:02" */
export function fmtShotTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

/** "+19h" / "+2d 3h" between two instants. */
export function fmtElapsed(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  if (!fromIso || !toIso) return ''
  const h = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000)
  if (h < 1) return '<1h'
  if (h < 48) return `+${h}h`
  return `+${Math.floor(h / 24)}d ${h % 24}h`
}
