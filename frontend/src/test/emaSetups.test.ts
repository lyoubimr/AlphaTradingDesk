import { describe, it, expect } from 'vitest'
import {
  activeLabel, currentStateLabel, filterEarlier, formatAge, formatWhen, pathLabel, setupKey, signalLabel,
  splitNewSetups, summarizeFollowThrough,
} from '../lib/emaSetups'
import type { EmaSetupHistoryOut } from '../types/api'

describe('formatAge', () => {
  it('formats minutes, hours and days', () => {
    expect(formatAge(0)).toBe('just now')
    expect(formatAge(12)).toBe('12 min ago')
    expect(formatAge(60)).toBe('1 h ago')
    expect(formatAge(47 * 60)).toBe('47 h ago')
    expect(formatAge(72 * 60)).toBe('3 d ago')
  })

  it('handles missing snapshots', () => {
    expect(formatAge(null)).toBe('never')
  })
})

describe('signalLabel', () => {
  it('translates known signals and passes unknown ones through', () => {
    expect(signalLabel('retest_after_breakout_up')).toBe('Retest after breakout')
    expect(signalLabel('breakdown_down')).toBe('Breakdown')
    expect(signalLabel('something_else')).toBe('something_else')
  })
})

describe('splitNewSetups', () => {
  const HOUR = 3600 * 1000
  const key = setupKey({ timeframe: '4H', pair: 'PF_XBTUSD', signal: 'breakout_up' })

  it('flags unseen setups as new and remembers them', () => {
    const { newKeys, nextSeen } = splitNewSetups([key], {}, 1_000_000)

    expect(newKeys.has(key)).toBe(true)
    expect(nextSeen[key]).toBe(1_000_000)
  })

  it('does not flag a setup seen within 48 hours, and keeps its first-seen time', () => {
    const { newKeys, nextSeen } = splitNewSetups([key], { [key]: 0 }, 10 * HOUR)

    expect(newKeys.size).toBe(0)
    expect(nextSeen[key]).toBe(0)
  })

  it('treats a setup as new again after 48 hours and prunes old entries', () => {
    const stale = setupKey({ timeframe: '1D', pair: 'PF_ETHUSD', signal: 'breakout_up' })
    const { newKeys, nextSeen } = splitNewSetups([key], { [key]: 0, [stale]: 0 }, 49 * HOUR)

    expect(newKeys.has(key)).toBe(true)
    expect(stale in nextSeen).toBe(false)
  })

  it('a changed signal on the same pair is a new setup', () => {
    const upgraded = setupKey({ timeframe: '4H', pair: 'PF_XBTUSD', signal: 'retest_after_breakout_up' })
    const { newKeys } = splitNewSetups([upgraded], { [key]: 0 }, HOUR)

    expect(newKeys.has(upgraded)).toBe(true)
  })
})

describe('history helpers', () => {
  const item = (over: Partial<EmaSetupHistoryOut>): EmaSetupHistoryOut => ({
    pair: 'PF_ETHUSD', timeframe: '4H', direction: 'long', best_tier: 'fresh', latest_signal: 'breakout_up',
    path: ['breakout_up'], first_seen: '2026-11-15T08:00:00Z', last_seen: '2026-11-15T08:00:00Z', times_seen: 1,
    outcome: 'holding', current_signal: 'above_all', pin_id: null, ...over,
  })

  it('summarizes follow-through from decided outcomes only', () => {
    const summary = summarizeFollowThrough([
      item({ outcome: 'holding' }), item({ outcome: 'holding' }), item({ outcome: 'failed' }),
      item({ outcome: 'neutral' }), item({ outcome: 'unknown' }),
    ])

    expect(summary).toMatchObject({ holding: 2, failed: 1, neutral: 1, unknown: 1, rate: 67 })
  })

  it('has no rate when nothing is decided yet', () => {
    expect(summarizeFollowThrough([item({ outcome: 'neutral' })]).rate).toBeNull()
    expect(summarizeFollowThrough([]).rate).toBeNull()
  })

  it('filters by best tier and outcome', () => {
    const list = [
      item({ pair: 'A', best_tier: 'prime', outcome: 'holding' }),
      item({ pair: 'B', best_tier: 'prime', outcome: 'failed' }),
      item({ pair: 'C', best_tier: 'retest', outcome: 'failed' }),
    ]

    expect(filterEarlier(list, 'all', 'all')).toHaveLength(3)
    expect(filterEarlier(list, 'prime', 'all').map(e => e.pair)).toEqual(['A', 'B'])
    expect(filterEarlier(list, 'all', 'failed').map(e => e.pair)).toEqual(['B', 'C'])
    expect(filterEarlier(list, 'prime', 'failed').map(e => e.pair)).toEqual(['B'])
  })

  it('labels the lifecycle path and the current state', () => {
    expect(pathLabel(['breakout_up', 'retest_after_breakout_up'])).toBe('Breakout → Retest after breakout')
    expect(pathLabel(['breakout_up', 'retest_up', 'breakdown_down', 'retest_down'])).toBe(
      '… → Retest as support → Breakdown → Retest as resistance',
    )
    expect(currentStateLabel('above_all')).toBe('Above all EMAs')
    expect(currentStateLabel('mixed')).toBe('Between the EMAs')
    expect(currentStateLabel('breakout_up')).toBe('Breakout')
    expect(currentStateLabel(null)).toBe('Not in the latest snapshot')
  })

  it('measures how long a setup has been active up to the latest snapshot', () => {
    expect(activeLabel('2026-11-15T10:00:00Z', '2026-11-15T10:00:00Z')).toBe('Just appeared')
    expect(activeLabel('2026-11-15T07:00:00Z', '2026-11-15T10:00:00Z')).toBe('Active for 3 h')
    expect(activeLabel('2026-11-12T00:00:00Z', '2026-11-15T00:00:00Z')).toBe('Active for 3 d')
    expect(activeLabel(null, '2026-11-15T10:00:00Z')).toBeNull()
  })

  it('formats dates in English, with the time on intraday timeframes only', () => {
    const intraday = formatWhen('2026-11-15T09:30:00Z', '4H', 'UTC')
    const daily = formatWhen('2026-11-15T09:30:00Z', '1D', 'UTC')

    expect(intraday).toContain('15 Nov')
    expect(intraday).toContain('09:30')
    expect(daily).toContain('15 Nov')
    expect(daily).not.toContain('09:30')
  })
})
