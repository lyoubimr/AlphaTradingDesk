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
  MarketVIOut, AggregatedMarketVIOut, PairsVIOut, WatchlistOut, WatchlistMetaOut, LivePricesResponse,
  VolatilitySettingsOut, NotificationSettingsOut,
  RiskBudgetOut, RiskAdvisorOut, RiskSettingsOut, PairVIOut,
  AutomationSettingsOut, AutomationSettingsUpdateIn, ConnectionTestOut, KrakenOrderOut,
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
    } else if (body?.detail && typeof body.detail === 'object') {
      // Risk Guard and similar return detail as a dict with a nested "detail" string.
      detail = (body.detail as Record<string, unknown>).detail as string
        ?? JSON.stringify(body.detail)
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

  /** GET /api/market-analysis/sessions?profile_id=&module_id=&limit= */
  listSessions: (moduleId?: number, limit = 50, profileId?: number): Promise<MASessionListItem[]> => {
    const qs = new URLSearchParams({ limit: String(limit) })
    if (moduleId != null) qs.set('module_id', String(moduleId))
    if (profileId != null) qs.set('profile_id', String(profileId))
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

// ── Volatility (Phase 2) ──────────────────────────────────────────────────

export const volatilityApi = {
  /** GET /api/volatility/market/{timeframe} → latest Market VI snapshot */
  getMarketVI: (timeframe: string): Promise<MarketVIOut> =>
    request(`/volatility/market/${timeframe}`),

  /** GET /api/volatility/market/aggregated → cross-TF aggregated Market VI */
  getAggregatedMarketVI: (): Promise<AggregatedMarketVIOut> =>
    request('/volatility/market/aggregated'),

  /** GET /api/volatility/market/{tf}/history → last N snapshots, oldest first */
  getMarketVIHistory: (timeframe: string, limit = 96, since?: string): Promise<MarketVIOut[]> => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (since) params.set('since', since)
    return request(`/volatility/market/${timeframe}/history?${params}`)
  },

  /** GET /api/volatility/pairs/{timeframe} → all per-pair VI snapshots */
  getPairsVI: (timeframe: string): Promise<PairsVIOut> =>
    request(`/volatility/pairs/${timeframe}`),

  /** GET /api/volatility/watchlist/{timeframe} → latest watchlist snapshot */
  getWatchlist: (timeframe: string): Promise<WatchlistOut> =>
    request(`/volatility/watchlist/${timeframe}`),

  /** GET /api/volatility/prices/live → BTC + ETH + XAU (cached 30s) */
  getLivePrices: (): Promise<LivePricesResponse> =>
    request('/volatility/prices/live'),

  /**
   * POST /api/volatility/run/{task} — manually queue a background task.
   * task      : 'market-vi' | 'pairs' | 'sync'
   * timeframe : required for 'market-vi' and 'pairs' (e.g. '1h')
   * Returns 202 immediately; data appears after ~15-60 s.
   */
  runTask: (
    task: 'market-vi' | 'pairs' | 'sync',
    timeframe?: string,
  ): Promise<{ status: string; task: string; timeframes: string[] | null; task_ids: string[] }> => {
    const params = timeframe ? `?timeframe=${timeframe}` : ''
    return request(`/volatility/run/${task}${params}`, { method: 'POST' })
  },

  /** GET /api/volatility/watchlists?days=N → lightweight snapshot metadata for tree view */
  listWatchlists: (days = 7): Promise<WatchlistMetaOut[]> =>
    request(`/volatility/watchlists?days=${days}`),

  /** GET /api/volatility/watchlist/snapshot/{id} → full snapshot with pairs */
  getWatchlistById: (snapshotId: number): Promise<WatchlistOut> =>
    request(`/volatility/watchlist/snapshot/${snapshotId}`),

  /** GET /api/volatility/settings/{profileId} */
  getSettings: (profileId: number): Promise<VolatilitySettingsOut> =>
    request(`/volatility/settings/${profileId}`),

  /** PUT /api/volatility/settings/{profileId} */
  updateSettings: (profileId: number, patch: object): Promise<VolatilitySettingsOut> =>
    request(`/volatility/settings/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  /** GET /api/volatility/notifications/{profileId} */
  getNotificationSettings: (profileId: number): Promise<NotificationSettingsOut> =>
    request(`/volatility/notifications/${profileId}`),

  /** PUT /api/volatility/notifications/{profileId} */
  updateNotificationSettings: (profileId: number, patch: object): Promise<NotificationSettingsOut> =>
    request(`/volatility/notifications/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  /** POST /api/volatility/notifications/{profileId}/test
   *  - Omit opts to test saved bots[0] from DB
   *  - Pass botToken + chatId for inline test (before saving)
   *  - Pass botIndex to test a specific saved bot by index
   */
  testNotification: (
    profileId: number,
    opts?: { botIndex?: number; botToken?: string; chatId?: string },
  ): Promise<{ status: string; message: string }> =>
    request(`/volatility/notifications/${profileId}/test`, {
      method: 'POST',
      body: JSON.stringify({
        bot_index: opts?.botIndex ?? 0,
        bot_token: opts?.botToken ?? null,
        chat_id:   opts?.chatId  ?? null,
      }),
    }),
}

// ── Risk Management ───────────────────────────────────────────────────────

export const riskApi = {
  /** GET /api/risk/budget/{profileId} */
  getBudget: (profileId: number): Promise<RiskBudgetOut> =>
    request(`/risk/budget/${profileId}`),

  /** GET /api/risk/advisor */
  getAdvisor: (params: {
    profile_id: number
    pair: string
    timeframe: string
    direction: string
    strategy_id?: number | null
    confidence?: number | null
    ma_session_id?: number | null
  }): Promise<RiskAdvisorOut> => {
    const q = new URLSearchParams({ profile_id: String(params.profile_id), pair: params.pair, timeframe: params.timeframe, direction: params.direction })
    if (params.strategy_id != null)  q.set('strategy_id',  String(params.strategy_id))
    if (params.confidence  != null)  q.set('confidence',   String(params.confidence))
    if (params.ma_session_id != null) q.set('ma_session_id', String(params.ma_session_id))
    return request(`/risk/advisor?${q.toString()}`)
  },

  /** GET /api/risk/settings/{profileId} */
  getSettings: (profileId: number): Promise<RiskSettingsOut> =>
    request(`/risk/settings/${profileId}`),

  /** PUT /api/risk/settings/{profileId} */
  updateSettings: (profileId: number, config: Record<string, unknown>): Promise<RiskSettingsOut> =>
    request(`/risk/settings/${profileId}`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),

  /** GET /api/risk/pair-vi */
  getPairVI: (pair: string, timeframe: string): Promise<PairVIOut> =>
    request(`/risk/pair-vi?pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}`),
}

// ── Kraken Execution (Phase 5) ──────────────────────────────────────────────
export const automationApi = {
  /** GET /api/kraken-execution/settings/{profileId} */
  getSettings: (profileId: number): Promise<AutomationSettingsOut> =>
    request(`/kraken-execution/settings/${profileId}`),

  /** PUT /api/kraken-execution/settings/{profileId} */
  updateSettings: (profileId: number, patch: AutomationSettingsUpdateIn): Promise<AutomationSettingsOut> =>
    request(`/kraken-execution/settings/${profileId}`, { method: 'PUT', body: JSON.stringify(patch) }),

  /** POST /api/kraken-execution/settings/{profileId}/test-connection */
  testConnection: (profileId: number): Promise<ConnectionTestOut> =>
    request(`/kraken-execution/settings/${profileId}/test-connection`, { method: 'POST' }),

  /** GET /api/kraken-execution/orders/{tradeId} */
  getOrders: (tradeId: number): Promise<KrakenOrderOut[]> =>
    request(`/kraken-execution/orders/${tradeId}`),

  /** POST /api/kraken-execution/trades/{tradeId}/open */
  openTrade: (tradeId: number): Promise<KrakenOrderOut> =>
    request(`/kraken-execution/trades/${tradeId}/open`, { method: 'POST' }),

  /** POST /api/kraken-execution/trades/{tradeId}/close */
  closeTrade: (tradeId: number): Promise<KrakenOrderOut> =>
    request(`/kraken-execution/trades/${tradeId}/close`, { method: 'POST' }),

  /** POST /api/kraken-execution/trades/{tradeId}/breakeven */
  moveToBreakeven: (tradeId: number): Promise<KrakenOrderOut> =>
    request(`/kraken-execution/trades/${tradeId}/breakeven`, { method: 'POST' }),

  /** POST /api/kraken-execution/trades/{tradeId}/cancel-entry */
  cancelEntry: (tradeId: number): Promise<KrakenOrderOut> =>
    request(`/kraken-execution/trades/${tradeId}/cancel-entry`, { method: 'POST' }),

  /** POST /api/kraken-execution/trades/{tradeId}/sync-fill
   *  Check if a pending LIMIT entry was filled. On fill: activates trade + places SL/TP.
   */
  syncFill: (tradeId: number): Promise<{ filled: boolean; fill_price: number | null; skipped?: boolean }> =>
    request(`/kraken-execution/trades/${tradeId}/sync-fill`, { method: 'POST' }),

  /** POST /api/kraken-execution/trades/{tradeId}/sync-sl-tp
   *  Check Kraken fills for SL/TP orders of an open/partial trade.
   *  On fill: reconciles trade status, PnL and profile capital via canonical service.
   */
  syncSlTp: (tradeId: number): Promise<{ processed: number; events: { role: string; fill_price: number }[]; skipped?: boolean }> =>
    request(`/kraken-execution/trades/${tradeId}/sync-sl-tp`, { method: 'POST' }),

  /** GET /api/kraken-execution/mark-price/{symbol} — public, no auth required */
  getMarkPrice: (symbol: string): Promise<{ symbol: string; mark_price: number }> =>
    request(`/kraken-execution/mark-price/${encodeURIComponent(symbol)}`),
}
