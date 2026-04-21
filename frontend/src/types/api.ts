// ── API Types ─────────────────────────────────────────────────────────────
// TypeScript types aligned with backend Pydantic schemas.
// Update here when backend schemas change.

// ── Profiles ──────────────────────────────────────────────────────────────

export interface Profile {
  id: number
  name: string
  market_type: 'CFD' | 'Crypto'
  broker_id: number | null
  currency: string | null
  capital_start: string   // Decimal serialised as string by FastAPI
  capital_current: string
  risk_percentage_default: string
  max_concurrent_risk_pct: string
  // Win-rate stats — updated atomically on every trade close (same tx as capital)
  // ALL closed trades of this profile, regardless of strategy.
  trades_count: number
  win_count: number
  // WR counting threshold — trades with abs(pnl%) < this are excluded from WR stats
  min_pnl_pct_for_stats: string
  description: string | null
  notes: string | null
  status: 'active' | 'archived' | 'deleted'
}

export interface ProfileCreate {
  name: string
  market_type: 'CFD' | 'Crypto'
  broker_id?: number | null
  currency?: string | null
  capital_start: string
  risk_percentage_default?: string
  max_concurrent_risk_pct?: string
  min_pnl_pct_for_stats?: string
  description?: string | null
  notes?: string | null
}

export interface ProfileUpdate {
  name?: string
  market_type?: 'CFD' | 'Crypto'
  broker_id?: number | null
  currency?: string | null
  capital_start?: string
  capital_current?: string
  risk_percentage_default?: string
  max_concurrent_risk_pct?: string
  min_pnl_pct_for_stats?: string
  description?: string | null
  notes?: string | null
  status?: 'active' | 'archived' | 'deleted'
}

// ── Brokers ───────────────────────────────────────────────────────────────

export interface Broker {
  id: number
  name: string
  market_type: 'CFD' | 'Crypto'
  default_currency: string
  is_predefined: boolean
  status: string
}

// ── Generic API error ─────────────────────────────────────────────────────

export interface ApiError {
  detail: string
}

// ── Instruments ───────────────────────────────────────────────────────────

export interface Instrument {
  id: number
  symbol: string
  display_name: string
  asset_class: 'Crypto' | 'Forex' | 'Commodities' | 'Indices'
  base_currency: string
  quote_currency: string
  pip_size: string | null
  tick_value: string | null
  min_lot: string
  max_leverage: number | null
  is_active: boolean
}

export interface InstrumentCreate {
  symbol: string
  display_name: string
  asset_class: string
  base_currency?: string
  quote_currency?: string
  pip_size?: string
  tick_value?: string
  min_lot?: string
  max_leverage?: number
}

// ── Trades ────────────────────────────────────────────────────────────────

/** One TP target sent to POST /api/trades */
export interface TradePosition {
  position_number: number         // 1-based index
  take_profit_price?: string | null  // Decimal as string — null/omit for runner (trailing stop)
  lot_percentage: number          // e.g. 50 means 50% of position
  /** When true, this position uses a trailing stop instead of a fixed TP price */
  is_runner?: boolean
}

export interface TradeOpen {
  profile_id: number
  instrument_id: number
  pair: string
  direction: 'long' | 'short'
  order_type: 'MARKET' | 'LIMIT'       // MARKET → 'open', LIMIT → 'pending'
  asset_class: string
  analyzed_timeframe?: string | null
  entry_price: string
  entry_date?: string | null      // null → backend defaults to utcnow()
  stop_loss: string
  positions: TradePosition[]      // 1–4 TPs required
  risk_pct_override?: string | null
  strategy_id?: number | null
  /** Multi-strategy: all strategy IDs for this trade */
  strategy_ids?: number[]
  session_tag?: string | null
  notes?: string | null
  confidence_score?: number | null
  /** Risk Guard bypass — requires force_allowed=true in risk_settings */
  force?: boolean
  /** Actual leverage used (Crypto only — user-entered) */
  leverage?: number | null
  /** Actual margin deposited (Crypto only — user-entered, takes priority over leverage-derived) */
  margin_used?: number | null
  /** Snapshot of risk advisor output at time of trade open (persisted for audit) */
  dynamic_risk_snapshot?: Record<string, unknown> | null
  /** Auto move SL to break-even when TP1 is filled (requires automation_enabled) */
  be_on_tp1?: boolean
  /** Trailing stop % for the runner position (last TP). If null, profile default is used. */
  runner_trailing_pct?: number | null
}

export interface TradeSizeResult {
  risk_amount: string
  units_or_lots: string
  market_type: string
  notional: string | null
  leverage: string | null
  /** Actual margin to deposit = notional / leverage */
  margin_required: string | null
  /** Recommended buffer = margin_required × 2.5 */
  safe_margin: string | null
  /** Estimated liquidation price */
  liq_price: string | null
  margin_warning: boolean
}

export interface TradeListItem {
  id: number
  profile_id: number
  pair: string
  instrument_display_name: string | null   // null for free-text pairs
  direction: 'LONG' | 'SHORT'
  order_type: 'MARKET' | 'LIMIT'
  entry_price: string
  entry_date: string | null
  stop_loss: string
  /** Original SL at trade open — NEVER changes after BE move. Use for PnL calc. */
  initial_stop_loss: string
  nb_take_profits: number
  risk_amount: string
  potential_profit: string | null
  current_risk: string | null       // 0.00 after BE move, null for pending LIMIT orders
  status: 'pending' | 'open' | 'partial' | 'runner' | 'closed' | 'cancelled'
  realized_pnl: string | null       // non-null only when fully closed
  booked_pnl: string | null         // sum of closed-position PnLs (partial trades)
  exit_price: string | null         // weighted-avg exit price of closed positions
  strategy_id: number | null        // primary strategy (first of strategy_ids, compat)
  /** All strategy IDs linked to this trade (via trade_strategies junction table) */
  strategy_ids: number[]
  closed_at: string | null
  created_at: string
  /** SL moved to breakeven — current_risk == 0 and trade is open/partial */
  is_be: boolean
  /** At least one KrakenOrder row exists for this trade */
  has_kraken_orders: boolean
  /** Entry was placed through Kraken automation — manual close is blocked */
  automation_enabled: boolean
  /** Auto move SL to break-even when TP1 is filled */
  be_on_tp1: boolean
  /** True when the post-trade review is considered complete:
   *  outcome set + non-empty note + ≥1 close screenshot + ≥1 non-strategy tag */
  is_reviewed: boolean
  /** Trailing stop % if a runner position is configured */
  runner_trailing_pct: string | null
  /** Position numbers (1-based) where tp_hit=True — excludes runners */
  tp_hits: number[]
}

export interface TradePosition_Out {
  id: number
  trade_id: number
  position_number: number
  take_profit_price: string | null  // null for runner positions (trailing stop)
  lot_percentage: string            // Decimal serialised as string
  is_runner: boolean
  status: string
  /** True = closed AT take_profit_price. False = closed early before reaching TP. */
  tp_hit: boolean
  exit_price: string | null
  exit_date: string | null
  realized_pnl: string | null
}

export interface TradeOut extends TradeListItem {
  instrument_id: number | null
  instrument_display_name: string | null   // e.g. "Bitcoin / USD Perpetual"
  strategy_id: number | null
  asset_class: string
  analyzed_timeframe: string | null
  // current_risk is inherited from TradeListItem
  session_tag: string | null
  notes: string | null
  confidence_score: number | null
  updated_at: string
  positions: TradePosition_Out[]
  size_info: TradeSizeResult | null
  /** Actual leverage used (Crypto only) */
  leverage: string | null
  /** Actual margin deposited (Crypto only) */
  margin_used: string | null

  // Snapshots + post-trade review
  entry_screenshot_urls: string[] | null
  close_notes: string | null
  close_screenshot_urls: string[] | null
  post_trade_review: PostTradeReview | null
  /** Full risk advisor output at trade open — persisted for analysis */
  dynamic_risk_snapshot: Record<string, unknown> | null
  /** Trailing stop % for the runner position */
  runner_trailing_pct: string | null
  /** When the trailing stop was activated (runner status entered) */
  runner_activated_at: string | null
}

export interface TradeClose {
  exit_price: string
  closed_at?: string | null
  close_notes?: string | null
  close_screenshot_urls?: string[] | null
}

export interface TradePartialClose {
  position_number: number
  exit_price: string
  exit_date?: string | null
  move_to_be?: boolean
}

/** PUT /api/trades/{id} — partial update (only sent fields change) */
export interface TradeUpdate {
  // Always editable (non-closed trades)
  stop_loss?: string | null
  strategy_id?: number | null
  /** Replace full set of strategy links (empty = remove all) */
  strategy_ids?: number[]
  notes?: string | null
  confidence_score?: number | null
  session_tag?: string | null
  analyzed_timeframe?: string | null
  entry_screenshot_urls?: string[] | null
  // CFD/Crypto — editable on open/partial (corrects stored values)
  leverage?: number | null
  margin_used?: number | null
  // Always editable (including closed — post-trade review)
  close_notes?: string | null
  close_screenshot_urls?: string[] | null
  // Runner: editable while trailing stop not yet activated
  runner_trailing_pct?: number | null
  // Pending-only: amend the LIMIT order before it triggers
  entry_price?: string | null
  amend_positions?: TradePosition[] | null
}

export type ReviewOutcome = 'poor' | 'could_do_better' | 'well_executed' | 'excellent'

export interface PostTradeReview {
  reviewed: boolean
  reviewed_at: string | null
  outcome: ReviewOutcome | null
  tags: string[]
  note: string | null
}

export interface PostTradeReviewIn {
  outcome?: ReviewOutcome | null
  tags: string[]
  note?: string | null
}

// ── Strategies ───────────────────────────────────────────

export interface Strategy {
  id: number
  /** null = global strategy (shared across all profiles) */
  profile_id: number | null
  name: string
  description: string | null
  rules: string | null
  emoji: string | null
  color: string | null
  image_url: string | null
  screenshot_urls: string[] | null
  status: string
  trades_count: number
  win_count: number
  min_trades_for_stats: number
  /** Disciplined WR: excludes reviewed trades where strategy_respected was unchecked */
  disciplined_trades_count: number
  disciplined_win_count: number
}

export interface StrategyCreate {
  name: string
  description?: string | null
  rules?: string | null
  emoji?: string | null
  color?: string | null
}

export interface StrategyUpdate {
  name?: string
  description?: string | null
  rules?: string | null
  emoji?: string | null
  color?: string | null
  min_trades_for_stats?: number
  status?: 'active' | 'archived'
}

// ── Trading Styles ────────────────────────────────────────────────────────

export interface TradingStyle {
  id: number
  name: string
  display_name: string
  default_timeframes: string | null
  description: string | null
  sort_order: number
}

// ── Goals ─────────────────────────────────────────────────────────────────

export type GoalPeriod = 'daily' | 'weekly' | 'monthly'

export interface GoalOut {
  id: number
  profile_id: number
  style_id: number | null   // null = global (all styles)
  style_name: string | null // resolved by backend
  period: GoalPeriod
  goal_pct: string    // Decimal as string
  limit_pct: string   // Decimal as string (negative)
  is_active: boolean
  // v2 fields
  avg_r_min: string | null
  max_trades: number | null
  period_type: 'outcome' | 'process'
  show_on_dashboard: boolean
}

export interface GoalCreate {
  style_id?: number | null   // null = global
  period: GoalPeriod
  goal_pct: string    // positive, e.g. "1.5"
  limit_pct: string   // negative, e.g. "-1.5"
  is_active?: boolean
  // v2 fields
  avg_r_min?: string | null
  max_trades?: number | null
  period_type?: 'outcome' | 'process'
  show_on_dashboard?: boolean
}

export interface GoalUpdate {
  goal_pct?: string | null
  limit_pct?: string | null
  is_active?: boolean | null
  // v2 fields
  avg_r_min?: string | null
  max_trades?: number | null
  period_type?: 'outcome' | 'process' | null
  show_on_dashboard?: boolean | null
}

export interface GoalProgressItem {
  goal_id: number
  style_id: number | null
  style_name: string | null
  period: string
  period_start: string   // ISO date
  period_end: string     // ISO date
  pnl_pct: string        // Decimal as string
  goal_pct: string
  limit_pct: string
  goal_progress_pct: string   // 0–100+
  risk_progress_pct: string   // 0–100+
  goal_hit: boolean
  limit_hit: boolean
  trade_count: number         // 0 = no activity this period → show "No trades" row
  // v2 fields
  avg_r: string | null
  avg_r_min: string | null        // goal minimum Avg R (copied from ProfileGoal)
  avg_r_hit: boolean | null
  max_trades_hit: boolean | null
  period_type: 'outcome' | 'process'
  show_on_dashboard: boolean
  trades?: Array<{
    id: number
    pair: string
    direction: string
    realized_pnl: number
    closed_at: string | null
  }>
}

// ── Goal Overrides ────────────────────────────────────────────────────────
export interface GoalHistoryItem {
  period: string
  period_start: string   // ISO date
  period_end: string     // ISO date
  pnl_pct: string        // Decimal as string
  pnl_amount: string     // Decimal as string (absolute realized P&L)
  goal_pct: string | null
  limit_pct: string | null
  goal_hit: boolean
  limit_hit: boolean
  trade_count: number
  avg_r: string | null
}
export interface GoalOverrideCreate {
  style_id?: number | null
  period: GoalPeriod
  period_start: string         // ISO date "2026-03-01"
  reason_text: string          // min 20 chars
  pnl_pct_at_override?: string | null
  open_risk_pct?: string | null
  acknowledged?: boolean
}

export interface GoalOverrideOut {
  id: number
  profile_id: number
  period: string
  period_start: string         // ISO date
  pnl_pct_at_override: string | null
  open_risk_pct: string | null
  reason_text: string
  acknowledged: boolean
  overridden_at: string        // ISO datetime
}

// ── Stats / Win-rate ──────────────────────────────────────────────────────
//
// Three win-rate levels:
//   1. Strategy WR  — strategy.win_count / trades_count   (per strategy, from /profiles/{id}/strategies)
//   2. Profile WR   — profile.win_count  / trades_count   (per profile, from /stats/winrate)
//   3. Global WR    — computed in frontend: mean(p.win_rate_pct for p if p.has_data)

export interface ProfileWinRate {
  profile_id: number
  profile_name: string
  trades_total: number
  wins_total: number
  win_rate_pct: number | null   // null → trades_total < 5 (not reliable yet)
  has_data: boolean
}

export interface WinRateStats {
  profiles: ProfileWinRate[]
}

// ── Market Analysis ───────────────────────────────────────────────────────

export interface MAModule {
  id: number
  name: string
  description: string | null
  is_dual: boolean          // true = has asset A + B (e.g. BTC + Alts)
  asset_a: string | null    // e.g. "BTC"
  asset_b: string | null    // e.g. "Alts"
  is_active: boolean
  sort_order: number
}

export type TFLevel = 'htf' | 'mtf' | 'ltf'
export type MABias = 'bullish' | 'neutral' | 'bearish'

export interface MAIndicator {
  id: number
  module_id: number
  key: string
  label: string
  asset_target: 'a' | 'b' | 'single'
  tv_symbol: string
  tv_timeframe: string
  timeframe_level: TFLevel
  score_block: 'trend' | 'momentum' | 'participation'  // v2
  question: string
  tooltip: string | null
  answer_bullish: string
  answer_partial: string
  answer_bearish: string
  default_enabled: boolean
  sort_order: number
}

export interface MAIndicatorConfig {
  indicator_id: number
  enabled: boolean
}

export interface MAIndicatorConfigOut {
  profile_id: number
  configs: MAIndicatorConfig[]
}

/** PATCH /api/market-analysis/indicators/{id} — only UI-text fields */
export interface MAIndicatorUpdate {
  label?: string
  question?: string
  tooltip?: string | null
  answer_bullish?: string
  answer_partial?: string
  answer_bearish?: string
  default_enabled?: boolean
}

export interface MAIndicatorCreate {
  key: string
  label: string
  asset_target: 'a' | 'b' | 'single'
  tv_symbol?: string
  tv_timeframe?: string
  timeframe_level: 'htf' | 'mtf' | 'ltf'
  score_block: 'trend' | 'momentum' | 'participation'
  question: string
  tooltip?: string | null
  answer_bullish?: string
  answer_partial?: string
  answer_bearish?: string
  default_enabled?: boolean
  sort_order?: number
}

export interface MAAnswerIn {
  indicator_id: number
  score: 0 | 1 | 2   // 0=bearish, 1=neutral, 2=bullish
  answer_label: string
}

export interface MASessionCreate {
  profile_id: number
  module_id: number
  answers: MAAnswerIn[]
  notes?: string | null
  analyzed_at?: string | null
}

export interface MAAnswerOut {
  id: number
  session_id: number
  indicator_id: number
  score: number
  answer_label: string
}

export interface MASessionOut {
  id: number
  profile_id: number
  module_id: number
  // Asset A scores (BTC / Gold / single)
  score_htf_a: string | null
  score_mtf_a: string | null
  score_ltf_a: string | null
  bias_htf_a: MABias | null
  bias_mtf_a: MABias | null
  bias_ltf_a: MABias | null
  // Asset B scores (Alts — null for single-asset)
  score_htf_b: string | null
  score_mtf_b: string | null
  score_ltf_b: string | null
  bias_htf_b: MABias | null
  bias_mtf_b: MABias | null
  bias_ltf_b: MABias | null
  // v2 decomposed scores — Asset A
  score_trend_a: string | null
  score_momentum_a: string | null
  score_participation_a: string | null
  score_composite_a: string | null
  bias_composite_a: MABias | null
  // v2 decomposed scores — Asset B
  score_trend_b: string | null
  score_momentum_b: string | null
  score_participation_b: string | null
  score_composite_b: string | null
  bias_composite_b: MABias | null
  notes: string | null
  analyzed_at: string
  created_at: string
  answers: MAAnswerOut[]
}

export interface MASessionListItem {
  id: number
  profile_id: number
  module_id: number
  score_htf_a: string | null
  score_mtf_a: string | null
  score_ltf_a: string | null
  bias_htf_a: MABias | null
  bias_mtf_a: MABias | null
  bias_ltf_a: MABias | null
  score_htf_b: string | null
  score_mtf_b: string | null
  score_ltf_b: string | null
  bias_htf_b: MABias | null
  bias_mtf_b: MABias | null
  bias_ltf_b: MABias | null
  // v2 composite (slim — block scores not in list item)
  score_composite_a: string | null
  bias_composite_a: MABias | null
  score_composite_b: string | null
  bias_composite_b: MABias | null
  notes: string | null
  analyzed_at: string
}

export interface MAStalenessItem {
  module_id: number
  module_name: string
  last_analyzed_at: string | null
  days_old: number | null
  is_stale: boolean
}

// ── Trade Conclusion (v2) ─────────────────────────────────────────────────

export interface MATradeConclusion {
  emoji: string       // "🟢" | "⚠️" | "🔴" | "⚡" | "🟡"
  label: string       // "Trend Following — Full Size"
  detail: string      // 1-sentence explanation
  trade_types: string[]
  size_advice: string // "normal (100%)" | "reduced (50%)"
  color: 'green' | 'amber' | 'red' | 'neutral'
}

// ── Volatility (Phase 2) ──────────────────────────────────────────────────

export type VIRegime =
  // English labels (from backend score_to_regime)
  | 'DEAD' | 'CALM' | 'NORMAL' | 'TRENDING' | 'ACTIVE' | 'EXTREME'
  // French display labels kept for backward-compat
  | 'MORT' | 'CALME' | 'ACTIF' | 'EXTRÊMe'

export interface MarketVIOut {
  timeframe: string
  vi_score: number
  regime: VIRegime
  timestamp: string  // ISO-8601
  components?: Record<string, number | null>  // {symbol: vi_score} for Binance pairs
}

export interface PairVIOut {
  pair: string
  timeframe: string
  vi_score: number
  regime: VIRegime
  components: Record<string, number | string | null>
  timestamp: string
}

export interface PairsVIOut {
  timeframe: string
  pairs: PairVIOut[]
  count: number
}

export interface WatchlistPairOut {
  pair: string
  vi_score: number
  regime: VIRegime
  alert: string | null
  change_24h: number | null
  ema_score: number
  ema_signal: string
  tf_sup_regime: string | null
  tf_sup_vi: number | null
}

export interface WatchlistOut {
  id: number | null
  timeframe: string
  regime: VIRegime
  pairs_count: number
  pairs: WatchlistPairOut[]
  generated_at: string
}

export interface WatchlistMetaOut {
  id: number
  timeframe: string
  name: string
  regime: VIRegime
  pairs_count: number
  generated_at: string
}

export interface LivePricesResponse {
  btc: number | null
  eth: number | null
  xau: number | null
  btc_change_pct: number | null
  eth_change_pct: number | null
  xau_change_pct: number | null
  currency: string
  currency_symbol: string
  timestamp: string
  cached: boolean
}

export interface TFComponentOut {
  tf: string
  vi_score: number
  regime: VIRegime
  weight: number
}

export interface AggregatedMarketVIOut {
  vi_score: number
  regime: VIRegime
  timestamp: string  // ISO-8601
  is_weekend: boolean
  tf_components: TFComponentOut[]
}

export interface VolatilitySettingsOut {
  profile_id: number
  market_vi: Record<string, unknown>
  per_pair: Record<string, unknown>
  regimes: Record<string, number>
  updated_at: string
}

export interface NotificationSettingsOut {
  profile_id: number
  bots: Array<{ bot_name?: string; bot_token: string; chat_id: string }>
  market_vi_alerts: Record<string, unknown>
  watchlist_alerts: Record<string, unknown>
  execution_alerts?: Record<string, unknown>
  updated_at: string
}

// ── Risk Management (Phase 3) ─────────────────────────────────────────────

export interface RiskBudgetOut {
  profile_id: number
  capital_current: number
  risk_pct_default: number
  max_concurrent_risk_pct: number
  concurrent_risk_used_pct: number
  budget_remaining_pct: number
  budget_remaining_amount: number
  open_trades_count: number
  pending_trades_count: number
  alert_risk_saturated: boolean
  alert_threshold_pct: number
  force_allowed: boolean
}

export interface CriterionDetail {
  name: string
  enabled: boolean
  value_label: string
  factor: number
  weight: number
  contribution: number
}

export interface RiskAdvisorOut {
  base_risk_pct: number
  adjusted_risk_pct: number
  adjusted_risk_amount: number
  multiplier: number
  criteria: CriterionDetail[]
  // Live budget (open/partial, current_risk — BE trades = 0)
  budget_remaining_pct: number
  budget_remaining_amount: number
  budget_blocking: boolean
  suggested_risk_pct: number
  // Pending LIMIT orders (potential future exposure)
  pending_risk_pct: number
  pending_risk_amount: number
  budget_remaining_if_pending_fill_pct: number
  budget_remaining_if_pending_fill_amount: number
  pending_budget_warning: boolean
  force_allowed: boolean
  // VI + EMA snapshot — stored at trade open for history analysis
  pair_vi_score: number | null
  pair_vi_ema_score: number | null
  pair_vi_ema_signal: string | null
  market_vi_score: number | null
}

export interface RiskSettingsOut {
  profile_id: number
  config: Record<string, unknown>
  updated_at: string
}

export interface PairVIOut {
  pair: string
  timeframe: string
  vi_score: number
  regime: VIRegime
  ema_score: number | null
  ema_signal: string | null
  source: string
  computed_at: string
}

// ── Kraken Execution (Phase 5) ────────────────────────────────────────────

export interface AutomationConfig {
  enabled: boolean
  pnl_status_interval_minutes: number
  max_leverage_override: number | null
}

export interface AutomationSettingsOut {
  profile_id: number
  has_api_keys: boolean
  config: AutomationConfig
  updated_at: string
}

export interface AutomationSettingsUpdateIn {
  enabled?: boolean
  pnl_status_interval_minutes?: number
  max_leverage_override?: number | null
  /** Write-only: plaintext API key — encrypted server-side, never returned */
  kraken_api_key?: string
  /** Write-only: plaintext API secret — encrypted server-side, never returned */
  kraken_api_secret?: string
}

export interface ConnectionTestOut {
  connected: boolean
  demo: boolean
  base_url: string
  error?: string | null
}

export type KrakenOrderRole   = 'entry' | 'sl' | 'tp1' | 'tp2' | 'tp3' | 'runner'
export type KrakenOrderStatus = 'open' | 'filled' | 'cancelled' | 'error'

export interface KrakenOrderOut {
  id: number
  trade_id: number
  profile_id: number
  kraken_order_id: string
  kraken_fill_id: string | null
  role: KrakenOrderRole
  status: KrakenOrderStatus
  order_type: string
  symbol: string
  side: 'buy' | 'sell'
  size: number
  limit_price: number | null
  filled_price: number | null
  filled_size: number | null
  error_message: string | null
  sent_at: string
  filled_at: string | null
  cancelled_at: string | null
}

// ── Analytics (Phase 6A) ──────────────────────────────────────────────────

export interface AnalyticsKPISummary {
  disciplined_wr: number | null
  raw_wr: number | null
  expectancy: number | null
  profit_factor: number | null
  current_streak: number
  best_win_streak: number
  worst_loss_streak: number
  total_trades: number
  disciplined_trades: number
  avg_win_pnl: number | null
  avg_loss_pnl: number | null
}

export interface EquityPoint {
  date: string
  trade_id: number
  pnl: number
  cumulative_pnl: number
}

export interface WRByStat {
  label: string
  trades: number
  wins: number
  losses: number
  wr_pct: number | null
  avg_pnl: number | null
  total_pnl: number
  avg_pnl_pct: number | null
}

export interface WRByHour {
  hour: number
  trades: number
  wins: number
  wr_pct: number | null
}

export interface TPHitRate {
  tp_number: number
  total: number
  hits: number
  hit_rate_pct: number | null
  early_exits: number  // TP1 only: trades closed before reaching TP1
}

export interface DrawdownPoint {
  date: string
  cumulative_pnl: number
  peak_pnl: number
  drawdown_pct: number
}

export interface TradeTypeRow {
  trade_type: string
  count: number
  wins: number
  wr_pct: number | null
  avg_pnl: number | null
}

export interface RRScatterPoint {
  trade_id: number
  planned_rr: number | null
  actual_rr: number | null
  is_win: boolean
  pair: string
}

export interface DirectionRow {
  direction: string
  trades: number
  wins: number
  wr_pct: number | null
  total_pnl: number
}

export interface TagFrequency {
  tag: string
  count: number
  pct: number
}

export interface RepeatError {
  tag: string
  error_count: number
  last_seen: string | null
}

export interface ReviewRateOut {
  total_closed: number
  reviewed_count: number
  review_rate_pct: number
}

export interface VIBucket {
  bucket: string        // "Calm" | "Normal" | "Active" | "Extreme"
  trades: number
  wr_pct: number | null
  avg_pnl: number | null
  avg_vi: number | null // 0-1 scale
}

export interface PerformanceReport {
  profile_id: number
  period: string
  generated_at: string
  kpi: AnalyticsKPISummary
  equity_curve: EquityPoint[]
  wr_by_strategy: WRByStat[]
  wr_by_session: WRByStat[]
  wr_by_hour: WRByHour[]
  pair_leaderboard: WRByStat[]
  tp_hit_rates: TPHitRate[]
  drawdown: DrawdownPoint[]
  trade_type_dist: TradeTypeRow[]
  rr_scatter: RRScatterPoint[]
  direction_bias: DirectionRow[]
  top_tags_winners: TagFrequency[]
  top_tags_losers: TagFrequency[]
  repeat_errors: RepeatError[]
  review_rate: ReviewRateOut
  vi_correlation: VIBucket[]         // pair VI — 6 buckets (Dead/Calm/Normal/Trending/Active/Extreme)
  vi_correlation_market: VIBucket[]  // market VI — by regime field
  ai_summary: string | null
  ai_generated_at: string | null
}

export interface AnalyticsSettingsOut {
  profile_id: number
  config: {
    ai_enabled: boolean
    ai_provider: 'openai' | 'anthropic' | 'perplexity' | 'groq' | 'gemini'
    ai_model: string
    ai_refresh: 'per_trade' | 'daily' | 'manual'
    ai_refresh_hours: number
  }
}

export interface AnalyticsSettingsUpdateIn {
  ai_enabled?: boolean
  ai_provider?: 'openai' | 'anthropic' | 'perplexity' | 'groq' | 'gemini'
  ai_model?: string
  ai_refresh?: 'per_trade' | 'daily' | 'manual'
  ai_refresh_hours?: number
}

export interface AIKeysStatusOut {
  profile_id: number
  openai_configured: boolean
  anthropic_configured: boolean
  perplexity_configured: boolean
  groq_configured: boolean
  gemini_configured: boolean
}

export interface AIKeysUpdateIn {
  openai_key?: string | null
  anthropic_key?: string | null
  perplexity_key?: string | null
  groq_key?: string | null
  gemini_key?: string | null
}

export interface AIGenerateOut {
  summary: string
  provider: string
  model: string
  tokens_used: number | null
  generated_at: string
}
