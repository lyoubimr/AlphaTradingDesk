// ── API client ────────────────────────────────────────────────────────────
// All backend calls go through here.
// Base URL: Vite proxy rewrites /api/* → backend:8000/*
// Never use fetch() directly in components — always use this module.

import type {
  Profile, ProfileCreate, ProfileUpdate,
  Broker, Instrument, InstrumentCreate,
  TradeOpen, TradeClose, TradePartialClose, TradeUpdate, TradeListItem, TradeOut,
  Strategy, StrategyCreate, StrategyUpdate,
  WinRateStats,
  TradingStyle,
  GoalOut, GoalCreate, GoalUpdate, GoalProgressItem, GoalOverrideCreate, GoalOverrideOut,
  MAModule, MAIndicator, MAIndicatorConfig, MAIndicatorConfigOut, MAIndicatorUpdate, MAIndicatorCreate,
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

  create: (brokerId: number, data: InstrumentCreate): Promise<Instrument> =>
    request(`/brokers/${brokerId}/instruments`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// ── Strategies (global + profile-specific) ───────────────────────────────

export const strategiesApi = {
  /**
   * List strategies visible to a profile.
   * Returns global (profile_id=null) + profile-specific strategies.
   * Without profileId → global only.
   */
  list: (profileId?: number): Promise<Strategy[]> => {
    const qs = profileId !== undefined ? `?profile_id=${profileId}` : ''
    return request(`/strategies${qs}`)
  },

  /** Create a global strategy (profile_id = null — shared across all profiles). */
  createGlobal: (data: StrategyCreate): Promise<Strategy> =>
    request('/strategies', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** Update a global strategy. */
  updateGlobal: (strategyId: number, data: StrategyUpdate): Promise<Strategy> =>
    request(`/strategies/${strategyId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  /** Archive (soft-delete) a global strategy. */
  archiveGlobal: (strategyId: number): Promise<void> =>
    request(`/strategies/${strategyId}`, { method: 'DELETE' }),

  /**
   * Upload an image for a global strategy (multipart/form-data).
   * Returns the updated Strategy.
   */
  uploadGlobalImage: async (strategyId: number, file: File): Promise<Strategy> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/strategies/${strategyId}/image`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
    }
    return res.json() as Promise<Strategy>
  },

  /** Remove the image from a global strategy. */
  deleteGlobalImage: (strategyId: number): Promise<Strategy> =>
    request(`/strategies/${strategyId}/image`, { method: 'DELETE' }),

  /** Append a screenshot to a global strategy's gallery. */
  addGlobalScreenshot: async (strategyId: number, file: File): Promise<Strategy> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/strategies/${strategyId}/screenshots`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
    }
    return res.json() as Promise<Strategy>
  },

  /** Remove a screenshot from a global strategy. */
  removeGlobalScreenshot: (strategyId: number, url: string): Promise<Strategy> => {
    const b64 = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    return request(`/strategies/${strategyId}/screenshots/${b64}`, { method: 'DELETE' })
  },

  /** Create a profile-specific strategy. */
  create: (profileId: number, data: StrategyCreate): Promise<Strategy> =>
    request(`/profiles/${profileId}/strategies`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** Alias kept for StrategiesSettingsPage compatibility. */
  createForProfile: (profileId: number, data: StrategyCreate): Promise<Strategy> =>
    request(`/profiles/${profileId}/strategies`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  update: (profileId: number, strategyId: number, data: StrategyUpdate): Promise<Strategy> =>
    request(`/profiles/${profileId}/strategies/${strategyId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (profileId: number, strategyId: number): Promise<void> =>
    request(`/profiles/${profileId}/strategies/${strategyId}`, { method: 'DELETE' }),

  // Image upload is done directly with fetch + FormData (multipart) in the component.
  deleteImage: (profileId: number, strategyId: number): Promise<Strategy> =>
    request(`/profiles/${profileId}/strategies/${strategyId}/image`, { method: 'DELETE' }),

  /** Append a screenshot to a profile strategy's gallery. */
  addScreenshot: async (profileId: number, strategyId: number, file: File): Promise<Strategy> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/profiles/${profileId}/strategies/${strategyId}/screenshots`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
    }
    return res.json() as Promise<Strategy>
  },

  /** Remove a screenshot from a profile strategy. */
  removeScreenshot: (profileId: number, strategyId: number, url: string): Promise<Strategy> => {
    const b64 = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    return request(`/profiles/${profileId}/strategies/${strategyId}/screenshots/${b64}`, { method: 'DELETE' })
  },
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

  /**
   * Upload an entry snapshot image (multipart/form-data).
   * Appends the URL to trade.entry_screenshot_urls.
   * Returns the updated TradeOut.
   */
  uploadEntrySnapshot: async (tradeId: number, file: File): Promise<TradeOut> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/trades/${tradeId}/snapshots/entry`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
    }
    return res.json() as Promise<TradeOut>
  },

  /**
   * Upload a close snapshot image (multipart/form-data).
   * Appends the URL to trade.close_screenshot_urls.
   * Returns the updated TradeOut.
   */
  uploadCloseSnapshot: async (tradeId: number, file: File): Promise<TradeOut> => {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE}/trades/${tradeId}/snapshots/close`, {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail))
    }
    return res.json() as Promise<TradeOut>
  },

  /** Remove one entry snapshot URL (by its path). */
  deleteEntrySnapshot: (tradeId: number, url: string): Promise<TradeOut> => {
    const b64 = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    return request(`/trades/${tradeId}/snapshots/entry/${b64}`, { method: 'DELETE' })
  },

  /** Remove one close snapshot URL (by its path). */
  deleteCloseSnapshot: (tradeId: number, url: string): Promise<TradeOut> => {
    const b64 = btoa(url).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    return request(`/trades/${tradeId}/snapshots/close/${b64}`, { method: 'DELETE' })
  },
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

  update: (profileId: number, goalId: number, data: GoalUpdate): Promise<GoalOut> =>
    request(`/profiles/${profileId}/goals/${goalId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: (profileId: number, goalId: number): Promise<void> =>
    request(`/profiles/${profileId}/goals/${goalId}`, { method: 'DELETE' }),

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

  /** POST /api/market-analysis/modules/{id}/indicators */
  createIndicator: (moduleId: number, data: MAIndicatorCreate): Promise<MAIndicator> =>
    request(`/market-analysis/modules/${moduleId}/indicators`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  /** DELETE /api/market-analysis/indicators/{id} */
  deleteIndicator: (indicatorId: number): Promise<void> =>
    request(`/market-analysis/indicators/${indicatorId}`, { method: 'DELETE' }),

  /** GET /api/profiles/{id}/market-analysis/staleness (profile-scoped, for dashboard widget) */
  getStaleness: (profileId: number): Promise<MAStalenessItem[]> =>
    request(`/profiles/${profileId}/market-analysis/staleness`),

  /** GET /api/market-analysis/staleness (global — last session per module across all profiles) */
  getStalenessGlobal: (): Promise<MAStalenessItem[]> =>
    request('/market-analysis/staleness'),
}
