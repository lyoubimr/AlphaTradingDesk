// ── API client ────────────────────────────────────────────────────────────
// All backend calls go through here.
// Base URL: Vite proxy rewrites /api/* → backend:8000/*
// Never use fetch() directly in components — always use this module.

import type {
  Profile, ProfileCreate, ProfileUpdate,
  Broker, Instrument,
  TradeOpen, TradeClose, TradePartialClose, TradeUpdate, TradeListItem, TradeOut,
  Strategy, StrategyCreate,
  WinRateStats,
  TradingStyle,
  GoalOut, GoalCreate, GoalUpdate, GoalProgressItem, GoalOverrideCreate, GoalOverrideOut,
  MAModule, MAIndicator, MAIndicatorConfig, MAIndicatorConfigOut, MAIndicatorUpdate,
  MASessionCreate, MASessionOut, MASessionListItem, MAStalenessItem, MATradeConclusion,
} from '../types/api'

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

  /** POST — creates or upserts (reactivates + updates values if already exists) */
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

  delete: (profileId: number, styleId: number, period: string): Promise<void> =>
    request(`/profiles/${profileId}/goals/${styleId}/${period}`, { method: 'DELETE' }),

  progress: (profileId: number): Promise<GoalProgressItem[]> =>
    request(`/profiles/${profileId}/goals/progress`),

  /** POST — log a circuit-breaker override (reason_text ≥ 20 chars) */
  createOverride: (profileId: number, data: GoalOverrideCreate): Promise<GoalOverrideOut> =>
    request(`/profiles/${profileId}/goal-overrides`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** GET — override history for a profile (newest first) */
  listOverrides: (profileId: number): Promise<GoalOverrideOut[]> =>
    request(`/profiles/${profileId}/goal-overrides`),
}

// ── Market Analysis ───────────────────────────────────────────────────────

export const maApi = {
  /** GET /api/market-analysis/modules */
  listModules: (): Promise<MAModule[]> =>
    request('/market-analysis/modules'),

  /** GET /api/market-analysis/modules/{id}/indicators */
  listIndicators: (moduleId: number): Promise<MAIndicator[]> =>
    request(`/market-analysis/modules/${moduleId}/indicators`),

  /** GET /api/market-analysis/sessions?module_id=&limit= (global — no profile filter) */
  listSessions: (moduleId?: number, limit = 50): Promise<MASessionListItem[]> => {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (moduleId != null) qs.set('module_id', String(moduleId))
    return request(`/market-analysis/sessions?${qs}`)
  },

  /** GET /api/market-analysis/sessions/{id} */
  getSession: (sessionId: number): Promise<MASessionOut> =>
    request(`/market-analysis/sessions/${sessionId}`),

  /** GET /api/market-analysis/sessions/{id}/conclusion — v2 trade recommendation */
  getConclusion: (sessionId: number): Promise<MATradeConclusion> =>
    request(`/market-analysis/sessions/${sessionId}/conclusion`),

  /** GET /api/market-analysis/modules/{id}/thresholds — v2 bias thresholds from DB */
  getThresholds: (moduleId: number): Promise<{ bullish: number; bearish: number }> =>
    request(`/market-analysis/modules/${moduleId}/thresholds`),

  /** POST /api/market-analysis/sessions */
  createSession: (data: MASessionCreate): Promise<MASessionOut> =>
    request('/market-analysis/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** GET /api/profiles/{id}/indicator-config */
  getIndicatorConfig: (profileId: number): Promise<MAIndicatorConfigOut> =>
    request(`/profiles/${profileId}/indicator-config`),

  /** PUT /api/profiles/{id}/indicator-config */
  saveIndicatorConfig: (profileId: number, configs: MAIndicatorConfig[]): Promise<MAIndicatorConfigOut> =>
    request(`/profiles/${profileId}/indicator-config`, {
      method: 'PUT',
      body: JSON.stringify(configs),
    }),

  /** PATCH /api/market-analysis/indicators/{id} */
  patchIndicator: (indicatorId: number, data: MAIndicatorUpdate): Promise<MAIndicator> =>
    request(`/market-analysis/indicators/${indicatorId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  /** GET /api/profiles/{id}/market-analysis/staleness (profile-scoped, for dashboard widget) */
  getStaleness: (profileId: number): Promise<MAStalenessItem[]> =>
    request(`/profiles/${profileId}/market-analysis/staleness`),

  /** GET /api/market-analysis/staleness (global — last session per module across all profiles) */
  getStalenessGlobal: (): Promise<MAStalenessItem[]> =>
    request('/market-analysis/staleness'),
}
