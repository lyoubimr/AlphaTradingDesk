import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { EmaSetupsPanel } from '../components/volatility/EmaSetupsPanel'
import { ritualApi, volatilityApi } from '../lib/api'
import type { EmaSetupOut, EmaSetupsOut, EmaSetupTF } from '../types/api'

vi.mock('../lib/api', () => ({
  volatilityApi: { getEmaSetups: vi.fn() },
  ritualApi: { addPinned: vi.fn(), removePinned: vi.fn() },
}))

function setup(over: Partial<EmaSetupOut> & Pick<EmaSetupOut, 'pair' | 'timeframe'>): EmaSetupOut {
  return {
    signal: 'retest_after_breakout_up', tier: 'prime', direction: 'long', vi_score: 0.62,
    regime: 'trending', change_24h: 2.3, ema_ref_period: over.timeframe === '4H' ? 200 : 99, pin_id: null, ...over,
  }
}

function payload(isSpot = false): EmaSetupsOut {
  const tf = (timeframe: EmaSetupTF, setups: EmaSetupOut[]) => ({
    timeframe, generated_at: '2026-11-15T10:00:00Z', age_minutes: 12, is_stale: false,
    total: setups.length, prime_total: setups.filter(s => s.tier === 'prime').length, setups,
  })
  return {
    profile_id: 1, is_spot: isSpot, prime_total: 1,
    timeframes: [
      tf('1D', [setup({ pair: 'PF_ETHUSD', timeframe: '1D', tier: 'fresh', signal: 'breakout_up' })]),
      tf('4H', [
        setup({ pair: 'PF_XBTUSD', timeframe: '4H' }),
        setup({ pair: 'PF_SOLUSD', timeframe: '4H', tier: 'retest', signal: 'retest_down', direction: 'short', change_24h: -1.2 }),
      ]),
      ...(isSpot ? [] : [tf('1H', [])]),
    ],
  }
}

function renderPanel(isSpot = false) {
  return render(
    <MemoryRouter>
      <EmaSetupsPanel profileId={1} isSpot={isSpot} top={5} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(volatilityApi.getEmaSetups).mockResolvedValue(payload())
})

describe('EmaSetupsPanel', () => {
  it('shows the prime counter and the setups of the default 4H tab', async () => {
    renderPanel()

    expect(await screen.findByText('1 prime')).toBeTruthy()
    expect(await screen.findByText(/Prime · Retest after breakout/)).toBeTruthy()
    expect(screen.getByText(/Retest · Retest as resistance/)).toBeTruthy()
    expect(screen.getByText('BTC')).toBeTruthy()
    expect(vi.mocked(volatilityApi.getEmaSetups)).toHaveBeenCalledWith(1, 5, ['1d', '4h', '1h'])
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
    render(
      <MemoryRouter>
        <EmaSetupsPanel profileId={1} isSpot={false} onPinsChanged={onPinsChanged} />
      </MemoryRouter>,
    )
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
    renderPanel(true)
    await screen.findByText('BTC')

    expect(screen.queryByRole('tab', { name: /1H/ })).toBeNull()
    expect(vi.mocked(volatilityApi.getEmaSetups)).toHaveBeenCalledWith(1, 5, ['1d', '4h'])
  })

  it('shows an error with a retry when loading fails', async () => {
    vi.mocked(volatilityApi.getEmaSetups).mockRejectedValueOnce(new Error('boom'))
    renderPanel()

    expect(await screen.findByText('boom')).toBeTruthy()
    fireEvent.click(screen.getByText('Retry'))
    expect(await screen.findByText('BTC')).toBeTruthy()
  })
})
