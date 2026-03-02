/**
 * Smoke tests — App renders without crashing (Step 8 scaffold)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../App'

// Mock fetch so the health API call doesn't fail in jsdom
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ status: 'ok', environment: 'test' }),
    }),
  )
})

// Helper: render App inside MemoryRouter with a given initial path
function renderAt(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  )
}

describe('App routing', () => {
  it('redirects / to /dashboard and renders dashboard page', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('renders the sidebar brand name', () => {
    renderAt('/dashboard')
    expect(screen.getByText('TradingDesk')).toBeInTheDocument()
  })

  it('renders Trade Journal nav link', () => {
    renderAt('/dashboard')
    expect(screen.getByRole('link', { name: /trade journal/i })).toBeInTheDocument()
  })

  it('renders /trades page', () => {
    renderAt('/trades')
    expect(screen.getByRole('heading', { name: 'Trade Journal' })).toBeInTheDocument()
  })

  it('renders /risk page', () => {
    renderAt('/risk')
    expect(screen.getByRole('heading', { name: 'Risk Manager' })).toBeInTheDocument()
  })

  it('renders /market-analysis page', () => {
    renderAt('/market-analysis')
    expect(screen.getByRole('heading', { name: 'Market Analysis' })).toBeInTheDocument()
  })

  it('renders /goals page', () => {
    renderAt('/goals')
    expect(screen.getByRole('heading', { name: 'Goals' })).toBeInTheDocument()
  })

  it('renders /settings page', () => {
    renderAt('/settings')
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  })
})

