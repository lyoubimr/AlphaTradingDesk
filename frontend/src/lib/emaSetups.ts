// Display helpers for the EMA setups panel (labels, freshness, "new since last visit").

import type { EmaOutcome, EmaSetupHistoryOut, EmaSetupOut, EmaSetupTF, EmaSetupTier } from '../types/api'

export const TIER_META: Record<EmaSetupTier, { label: string; hint: string }> = {
  prime:  { label: 'Prime',  hint: 'Breakout or breakdown, then a wick retest of the EMA that held — the best entry context.' },
  fresh:  { label: 'Fresh',  hint: 'Price just crossed the EMA — early, but not yet retested.' },
  retest: { label: 'Retest', hint: 'Wick touched the EMA with no recent cross — a plain bounce or rejection.' },
}

const SIGNAL_LABELS: Record<string, string> = {
  retest_after_breakout_up: 'Retest after breakout',
  retest_after_breakdown_down: 'Retest after breakdown',
  breakout_up: 'Breakout',
  breakdown_down: 'Breakdown',
  retest_up: 'Retest as support',
  retest_down: 'Retest as resistance',
}

export function signalLabel(signal: string): string {
  return SIGNAL_LABELS[signal] ?? signal
}

export function formatAge(minutes: number | null): string {
  if (minutes == null) return 'never'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.floor(hours / 24)} d ago`
}

/** Pin lifetime per timeframe — mirrors the backend TTL_HOURS. */
export const PIN_TTL_LABEL: Record<string, string> = { '1D': '14 days', '4H': '7 days', '1H': '3 days' }

export function setupKey(s: Pick<EmaSetupOut, 'timeframe' | 'pair' | 'signal'>): string {
  return `${s.timeframe}|${s.pair}|${s.signal}`
}

const SEEN_TTL_MS = 48 * 3600 * 1000

/**
 * Splits current setup keys into "new since last visit" and the pruned seen-map to persist.
 * A setup is new when its exact (timeframe, pair, signal) was not seen in the last 48 h.
 */
export function splitNewSetups(
  currentKeys: string[],
  seen: Record<string, number>,
  now: number,
): { newKeys: Set<string>; nextSeen: Record<string, number> } {
  const nextSeen: Record<string, number> = {}
  for (const [key, at] of Object.entries(seen)) {
    if (now - at < SEEN_TTL_MS) nextSeen[key] = at
  }
  const newKeys = new Set<string>()
  for (const key of currentKeys) {
    if (!(key in nextSeen)) newKeys.add(key)
    nextSeen[key] = key in nextSeen ? nextSeen[key] : now
  }
  return { newKeys, nextSeen }
}

export const TV_INTERVAL: Record<string, string> = { '1D': '1D', '4H': '240', '1H': '60' }

// ── History ("earlier" setups) ───────────────────────────────────────────────

export const OUTCOME_META: Record<EmaOutcome, { label: string; hint: string }> = {
  holding: { label: 'Holding', hint: "Still on the setup's side of the EMAs — it followed through." },
  failed:  { label: 'Failed',  hint: 'Flipped to the other side of the EMAs — the setup did not hold.' },
  neutral: { label: 'Mixed',   hint: 'Price now sits between the EMAs — no clear follow-through yet.' },
  unknown: { label: 'No data', hint: 'The pair is missing from the latest snapshot.' },
}

const STATE_LABELS: Record<string, string> = {
  above_all: 'Above all EMAs',
  below_all: 'Below all EMAs',
  mixed: 'Between the EMAs',
}

/** Human label for the signal a pair shows right now (states and setups alike). */
export function currentStateLabel(signal: string | null): string {
  if (!signal) return 'Not in the latest snapshot'
  return STATE_LABELS[signal] ?? signalLabel(signal)
}

/** "Fresh → Prime" style path: the last 3 distinct signals, oldest first. */
export function pathLabel(path: string[]): string {
  const shown = path.slice(-3).map(signalLabel).join(' → ')
  return path.length > 3 ? `… → ${shown}` : shown
}

function span(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}

/** How long an active setup has been on, measured up to the latest snapshot. */
export function activeLabel(sinceIso: string | null, latestIso: string | null): string | null {
  if (!sinceIso || !latestIso) return null
  return Date.parse(latestIso) - Date.parse(sinceIso) <= 0 ? 'Just appeared' : `Active for ${span(sinceIso, latestIso)}`
}

/** Compact local date/time, e.g. "Sun 15 Nov, 09:00" (date only on the daily timeframe). */
export function formatWhen(iso: string, tf: EmaSetupTF, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions =
    tf === '1D'
      ? { weekday: 'short', day: 'numeric', month: 'short', timeZone }
      : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone }
  return new Intl.DateTimeFormat('en-GB', opts).format(new Date(iso))
}

export interface FollowThrough {
  holding: number
  failed: number
  neutral: number
  unknown: number
  /** Share of decided setups (holding + failed) that held; null when none is decided. */
  rate: number | null
}

export function summarizeFollowThrough(earlier: EmaSetupHistoryOut[]): FollowThrough {
  const counts = { holding: 0, failed: 0, neutral: 0, unknown: 0 }
  for (const e of earlier) counts[e.outcome] += 1
  const decided = counts.holding + counts.failed
  return { ...counts, rate: decided > 0 ? Math.round((counts.holding / decided) * 100) : null }
}

export type TierFilter = EmaSetupTier | 'all'
export type OutcomeFilter = EmaOutcome | 'all'

export function filterEarlier(
  earlier: EmaSetupHistoryOut[], tier: TierFilter, outcome: OutcomeFilter,
): EmaSetupHistoryOut[] {
  return earlier.filter(e => (tier === 'all' || e.best_tier === tier) && (outcome === 'all' || e.outcome === outcome))
}
