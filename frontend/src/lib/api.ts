// ── API client ────────────────────────────────────────────────────────────
// All backend calls go through here.
// Base URL: Vite proxy rewrites /api/* → backend:8000/*
// Never use fetch() directly in components — always use this module.

import type { Profile, ProfileCreate, ProfileUpdate, Broker, Instrument, TradeOpen, TradeClose, TradePartialClose, TradeListItem, TradeOut, Strategy, StrategyCreate } from '../types/api'

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
    throw new Error(body?.detail ?? `HTTP ${res.status}`)
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

  delete: (tradeId: number): Promise<void> =>
    request(`/trades/${tradeId}`, { method: 'DELETE' }),
}
