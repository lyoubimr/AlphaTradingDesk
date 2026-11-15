// Display helpers for the EMA setups panel (labels, freshness, "new since last visit").

import type { EmaSetupOut, EmaSetupTier } from '../types/api'

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
