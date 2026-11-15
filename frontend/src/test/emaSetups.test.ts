import { describe, it, expect } from 'vitest'
import { formatAge, setupKey, signalLabel, splitNewSetups } from '../lib/emaSetups'

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
