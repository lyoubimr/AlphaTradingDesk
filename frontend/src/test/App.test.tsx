/**
 * Smoke test — App renders without crashing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App'

// Mock fetch so the health call doesn't fail in jsdom
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: 'ok', environment: 'test' }),
    }),
  )
})

describe('App', () => {
  it('renders the AlphaTradingDesk heading', () => {
    render(<App />)
    expect(screen.getByText('AlphaTradingDesk')).toBeInTheDocument()
  })

  it('renders the Dashboard heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('renders the nav links', () => {
    render(<App />)
    expect(screen.getByText('Trade Journal')).toBeInTheDocument()
    expect(screen.getByText('Risk Manager')).toBeInTheDocument()
    expect(screen.getByText('Watchlist')).toBeInTheDocument()
  })
})
