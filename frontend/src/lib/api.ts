// ── API client ────────────────────────────────────────────────────────────
// All backend calls go through here.
// Base URL: Vite proxy rewrites /api/* → backend:8000/*
// Never use fetch() directly in components — always use this module.

import type { Profile, ProfileCreate, ProfileUpdate, Broker, Instrument, TradeOpen, TradeClose, TradePartialClose, TradeUpdate, TradeListItem, TradeOut, Strategy, StrategyCreate, WinRateStats, TradingStyle, GoalOut, GoalCreate, GoalUpdate, GoalProgressItem } from '../types/api'

const BASE = '/api'

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    // FastAPI 422 returns detail as an array of validation error objects.
    // Flatten them into a human-readable string.
    let detail: string
    if (Array.isArray(body?.detail)) {
      detail = (body.detail as Array<{ loc?: string[]; msg?: string }>)
        .map((e) => {
          const field = e.loc?.slice(1).join('.') ?? ''
          return field ? `${field}: ${e.msg}` : (e.msg ?? JSON.stringify(e))
        })
        .join(' · ')
    } else {
      detail = body?.detail ?? `HTTP ${res.status}`
    }
    throw new Error(detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Profiles ──────────────────────────────────────────────────────────────

export const profilesApi = {
  list: (): Promise<Profile[]> =>
    request('/profiles'),

  get: (id: number): Promise<Profile> =>
    request(`/profiles/${id}`),

  create: (data: ProfileCreate): Promise<Profile> =>
    request('/profiles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (id: number, data: ProfileUpdate): Promise<Profile> =>
    request(`/profiles/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (id: number): Promise<void> =>
    request(`/profiles/${id}`, { method: 'DELETE' }),
}

// ── Brokers ───────────────────────────────────────────────────────────────

export const brokersApi = {
  list: (): Promise<Broker[]> =>
    request('/brokers'),
}

// ── Instruments ───────────────────────────────────────────────────────────

export const instrumentsApi = {
  listByBroker: (brokerId: number): Promise<Instrument[]> =>
    request(`/brokers/${brokerId}/instruments`),
}

// ── Strategies ────────────────────────────────────────────────────────────

export const strategiesApi = {
  list: (profileId: number): Promise<Strategy[]> =>
    request(`/profiles/${profileId}/strategies`),

  create: (profileId: number, data: StrategyCreate): Promise<Strategy> =>
    request(`/profiles/${profileId}/strategies`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  delete: (profileId: number, strategyId: number): Promise<void> =>
    request(`/profiles/${profileId}/strategies/${strategyId}`, { method: 'DELETE' }),
}

// ── Trades ────────────────────────────────────────────────────────────────

export const tradesApi = {
  list: (profileId: number): Promise<TradeListItem[]> =>
    request(`/trades?profile_id=${profileId}`),

  get: (tradeId: number): Promise<TradeOut> =>
    request(`/trades/${tradeId}`),

  open: (data: TradeOpen): Promise<TradeOut> =>
    request('/trades', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  close: (tradeId: number, data: TradeClose): Promise<TradeOut> =>
    request(`/trades/${tradeId}/close`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  partialClose: (tradeId: number, data: TradePartialClose): Promise<TradeOut> =>
    request(`/trades/${tradeId}/partial`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  cancel: (tradeId: number): Promise<TradeOut> =>
    request(`/trades/${tradeId}/cancel`, { method: 'POST' }),

  activate: (tradeId: number): Promise<TradeOut> =>
    request(`/trades/${tradeId}/activate`, { method: 'POST' }),

  update: (tradeId: number, data: TradeUpdate): Promise<TradeOut> =>
    request(`/trades/${tradeId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  breakeven: (tradeId: number): Promise<TradeOut> =>
    request(`/trades/${tradeId}/breakeven`, { method: 'POST' }),

  delete: (tradeId: number): Promise<void> =>
    request(`/trades/${tradeId}`, { method: 'DELETE' }),
}

// ── Stats ─────────────────────────────────────────────────────────────────

export const statsApi = {
  /**
   * GET /api/stats/winrate
   * Returns profile-level WR stats (trades_count + win_count from the profiles table).
   * The global WR is NOT returned here — it is computed in the frontend as:
   *   mean(p.win_rate_pct for p in profiles if p.has_data)
   */
  winrate: (profileId?: number): Promise<WinRateStats> => {
    const qs = profileId != null ? `?profile_id=${profileId}` : ''
    return request(`/stats/winrate${qs}`)
  },
}

// ── Trading Styles ────────────────────────────────────────────────────────

export const stylesApi = {
  list: (): Promise<TradingStyle[]> =>
    request('/trading-styles'),
}

// ── Goals ─────────────────────────────────────────────────────────────────

export const goalsApi = {
  list: (profileId: number): Promise<GoalOut[]> =>
    request(`/profiles/${profileId}/goals`),

  create: (profileId: number, data: GoalCreate): Promise<GoalOut> =>
    request(`/profiles/${profileId}/goals`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (profileId: number, styleId: number, period: string, data: GoalUpdate): Promise<GoalOut> =>
    request(`/profiles/${profileId}/goals/${styleId}/${period}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  progress: (profileId: number): Promise<GoalProgressItem[]> =>
    request(`/profiles/${profileId}/goals/progress`),
}
