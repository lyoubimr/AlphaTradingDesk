/** Human-readable age of a Market Analysis session (hours-aware for intraday modules). */
export function maAgeLabel(item: { hours_old?: number | null; days_old: number | null }): string {
  const h = item.hours_old
  if (h == null) {
    if (item.days_old == null) return '—'
    return item.days_old === 0 ? 'Today' : `${item.days_old}d ago`
  }
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`
  if (h < 48) return `${Math.round(h)}h ago`
  return `${Math.round(h / 24)}d ago`
}
