import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EmaSetupsPanel } from '../components/volatility/EmaSetupsPanel'
import { ritualApi, volatilityApi } from '../lib/api'
import type {
  EmaSetupHistoryOut, EmaSetupOut, EmaSetupsOut, EmaSetupsTimeframeOut, EmaSetupTF,
} from '../types/api'

vi.mock('../lib/api', () => ({
  volatilityApi: { getEmaSetups: vi.fn() },
  ritualApi: { addPinned: vi.fn(), removePinned: vi.fn() },
}))

const LATEST = '2026-11-15T12:00:00Z'

function setup(over: Partial<EmaSetupOut> & Pick<EmaSetupOut, 'pair' | 'timeframe'>): EmaSetupOut {
  return {
    signal: 'retest_after_breakout_up', tier: 'prime', direction: 'long', vi_score: 0.62, regime: 'trending',
    change_24h: 2.3, ema_ref_period: over.timeframe === '4H' ? 200 : 99, pin_id: null,
    since: '2026-11-15T04:00:00Z', path: ['breakout_up', 'retest_after_breakout_up'], ...over,
  }
}

function earlier(over: Partial<EmaSetupHistoryOut> & Pick<EmaSetupHistoryOut, 'pair'>): EmaSetupHistoryOut {
  return {
    timeframe: '4H', direction: 'long', best_tier: 'fresh', latest_signal: 'breakout_up', path: ['breakout_up'],
    first_seen: '2026-11-15T00:00:00Z', last_seen: '2026-11-15T04:00:00Z', times_seen: 2, outcome: 'holding',
    current_signal: 'above_all', pin_id: null, ...over,
  }
}

function tf(timeframe: EmaSetupTF, setups: EmaSetupOut[], earlierItems: EmaSetupHistoryOut[] = []): EmaSetupsTimeframeOut {
  return {
    timeframe, generated_at: LATEST, age_minutes: 12, is_stale: false, total: setups.length,
    prime_total: setups.filter(s => s.tier === 'prime').length, setups,
    history_hours: timeframe === '1D' ? 120 : timeframe === '4H' ? 48 : 24,
    earlier_total: earlierItems.length, earlier: earlierItems,
  }
}

const EARLIER_4H = [
  earlier({ pair: 'PF_ETHUSD', outcome: 'holding', best_tier: 'prime', path: ['breakout_up', 'retest_after_breakout_up'] }),
  earlier({ pair: 'PF_ADAUSD', outcome: 'failed', current_signal: 'below_all' }),
  earlier({ pair: 'PF_DOGEUSD', outcome: 'neutral', current_signal: 'mixed', best_tier: 'retest', path: ['retest_up'] }),
  earlier({ pair: 'PF_LINKUSD', outcome: 'holding' }),
]

function payload(isSpot = false): EmaSetupsOut {
  return {
    profile_id: 1, is_spot: isSpot, prime_total: 1,
    timeframes: [
      tf('1D', [setup({ pair: 'PF_AVAXUSD', timeframe: '1D', tier: 'fresh', signal: 'breakout_up', path: ['breakout_up'] })]),
      tf('4H', [
        setup({ pair: 'PF_XBTUSD', timeframe: '4H' }),
        setup({ pair: 'PF_SOLUSD', timeframe: '4H', tier: 'retest', signal: 'retest_down', direction: 'short', change_24h: -1.2, path: ['retest_down'], since: LATEST }),
      ], EARLIER_4H),
      ...(isSpot ? [] : [tf('1H', [])]),
    ],
  }
}

function renderPanel(props: Partial<Parameters<typeof EmaSetupsPanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <EmaSetupsPanel profileId={1} isSpot={false} top={5} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(volatilityApi.getEmaSetups).mockResolvedValue(payload())
})

describe('EmaSetupsPanel — active setups', () => {
  it('shows the prime counter, lifecycle and age of the default 4H tab', async () => {
    renderPanel()

    expect(await screen.findByText('1 prime')).toBeTruthy()
    expect(await screen.findByText(/Prime · Retest after breakout/)).toBeTruthy()
    expect(screen.getByText(/Retest · Retest as resistance/)).toBeTruthy()
    expect(screen.getByText('BTC')).toBeTruthy()
    expect(screen.getByText(/Active for 8 h/)).toBeTruthy()
    expect(screen.getByText('Breakout → Retest after breakout')).toBeTruthy()
    expect(screen.getByText(/Just appeared/)).toBeTruthy()
    expect(vi.mocked(volatilityApi.getEmaSetups)).toHaveBeenCalledWith(1, 5, ['1d', '4h', '1h'], 15)
  })

  it('switches timeframe and remembers the choice', async () => {
    renderPanel()
    await screen.findByText('BTC')

    fireEvent.click(screen.getByRole('tab', { name: /1D/ }))

    expect(await screen.findByText(/Fresh · Breakout/)).toBeTruthy()
    expect(screen.queryByText('BTC')).toBeNull()
    expect(localStorage.getItem('atd.emaSetups.tf')).toBe('"1D"')
  })

  it('pins a setup in one click and unpins it again', async () => {
    vi.mocked(ritualApi.addPinned).mockResolvedValue({ id: 77 } as never)
    vi.mocked(ritualApi.removePinned).mockResolvedValue(undefined)
    const onPinsChanged = vi.fn()
    renderPanel({ onPinsChanged })
    await screen.findByText('BTC')

    fireEvent.click(screen.getAllByTitle(/Pin to watch/)[0])

    await waitFor(() => expect(screen.getAllByTitle('Pinned — click to unpin')).toHaveLength(1))
    expect(vi.mocked(ritualApi.addPinned)).toHaveBeenCalledWith(1, {
      pair: 'PF_XBTUSD', timeframe: '4H', note: null, source: 'watchlist',
    })
    expect(onPinsChanged).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTitle('Pinned — click to unpin'))

    await waitFor(() => expect(screen.queryByTitle('Pinned — click to unpin')).toBeNull())
    expect(vi.mocked(ritualApi.removePinned)).toHaveBeenCalledWith(1, 77)
  })

  it('shows an empty state when a timeframe has no setup', async () => {
    renderPanel()
    await screen.findByText('BTC')

    fireEvent.click(screen.getByRole('tab', { name: /1H/ }))

    expect(await screen.findByText(/No breakout or retest on the EMA99/)).toBeTruthy()
  })

  it('offers no 1H tab for spot profiles', async () => {
    vi.mocked(volatilityApi.getEmaSetups).mockResolvedValue(payload(true))
    renderPanel({ isSpot: true })
    await screen.findByText('BTC')

    expect(screen.queryByRole('tab', { name: /1H/ })).toBeNull()
    expect(vi.mocked(volatilityApi.getEmaSetups)).toHaveBeenCalledWith(1, 5, ['1d', '4h'], 15)
  })

  it('shows an error with a retry when loading fails', async () => {
    vi.mocked(volatilityApi.getEmaSetups).mockRejectedValueOnce(new Error('boom'))
    renderPanel()

    expect(await screen.findByText('boom')).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByText('BTC')).toBeTruthy()
  })
})

describe('EmaSetupsPanel — earlier setups', () => {
  it('is collapsed by default but already summarizes the follow-through', async () => {
    renderPanel()
    await screen.findByText('BTC')

    expect(screen.getByText(/Earlier · last 2 days/)).toBeTruthy()
    expect(screen.getByText('67%')).toBeTruthy() // 2 holding ÷ (2 holding + 1 failed)
    expect(screen.queryByText('ETH')).toBeNull()
  })

  it('expands to rows with their outcome, path and current state, and remembers it', async () => {
    renderPanel()
    await screen.findByText('BTC')

    fireEvent.click(screen.getByText(/Earlier · last 2 days/))

    expect(await screen.findByText('ETH')).toBeTruthy()
    const rowOf = (base: string) => screen.getByText(base).closest('li') as HTMLElement
    expect(within(rowOf('ETH')).getByText('Holding')).toBeTruthy()
    expect(within(rowOf('ADA')).getByText('Failed')).toBeTruthy()
    expect(within(rowOf('DOGE')).getByText('Mixed')).toBeTruthy()
    expect(within(rowOf('ADA')).getByText('Below all EMAs')).toBeTruthy()
    expect(within(rowOf('ETH')).getByText('Breakout → Retest after breakout')).toBeTruthy()
    expect(localStorage.getItem('atd.emaSetups.earlier')).toBe('true')
  })

  it('starts expanded when asked to, unless the user chose otherwise', async () => {
    renderPanel({ earlierOpenByDefault: true })
    expect(await screen.findByText('ETH')).toBeTruthy()
  })

  it('filters by tier and by outcome', async () => {
    renderPanel({ earlierOpenByDefault: true })
    await screen.findByText('ETH')

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(screen.getByText('ADA')).toBeTruthy()
    expect(screen.queryByText('ETH')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Any outcome' }))
    fireEvent.click(screen.getByRole('button', { name: 'Prime' }))
    expect(screen.getByText('ETH')).toBeTruthy()
    expect(screen.queryByText('LINK')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(screen.getByText(/No earlier setup matches these filters/)).toBeTruthy()
  })

  it('pins an earlier setup too', async () => {
    vi.mocked(ritualApi.addPinned).mockResolvedValue({ id: 5 } as never)
    renderPanel({ earlierOpenByDefault: true })
    const row = (await screen.findByText('ETH')).closest('li') as HTMLElement

    fireEvent.click(within(row).getByTitle(/Pin to watch/))

    await waitFor(() => expect(within(row).getByTitle('Pinned — click to unpin')).toBeTruthy())
    expect(vi.mocked(ritualApi.addPinned)).toHaveBeenCalledWith(1, {
      pair: 'PF_ETHUSD', timeframe: '4H', note: null, source: 'watchlist',
    })
  })

  it('previews six rows and offers to show the rest', async () => {
    const many = Array.from({ length: 9 }, (_, i) => earlier({ pair: `PF_TK${i}USD` }))
    const data = payload()
    data.timeframes = data.timeframes.map(t => t.timeframe === '4H' ? tf('4H', t.setups, many) : t)
    vi.mocked(volatilityApi.getEmaSetups).mockResolvedValue(data)
    renderPanel({ earlierOpenByDefault: true })
    await screen.findByText('TK0')

    expect(screen.queryByText('TK8')).toBeNull()
    fireEvent.click(screen.getByText('Show all 9'))
    expect(screen.getByText('TK8')).toBeTruthy()
    fireEvent.click(screen.getByText('Show less'))
    expect(screen.queryByText('TK8')).toBeNull()
  })

  it('hides the section when a timeframe has no earlier setup', async () => {
    renderPanel()
    await screen.findByText('BTC')

    fireEvent.click(screen.getByRole('tab', { name: /1D/ }))
    await screen.findByText('AVAX')

    expect(screen.queryByText(/Earlier · last/)).toBeNull()
  })
})
