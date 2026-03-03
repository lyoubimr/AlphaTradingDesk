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

// ── Trades ────────────────────────────────────────────────────────────────

export interface TradePosition {
  tp_price: string
  lot_percentage: number  // e.g. 50 means 50% of position
}

export interface TradeOpen {
  profile_id: number
  instrument_id: number
  pair: string
  direction: 'LONG' | 'SHORT'
  asset_class: string
  analyzed_timeframe?: string | null
  entry_price: string
  entry_date?: string | null
  stop_loss: string
  positions: TradePosition[]          // at least 1 TP required
  risk_pct_override?: string | null
  strategy_id?: number | null
  session_tag?: string | null
  notes?: string | null
  confidence_score?: number | null
}

export interface TradeSizeResult {
  risk_amount: string
  units_or_lots: string
  market_type: string
  margin_warning: boolean
  safe_margin: boolean
}

export interface TradeListItem {
  id: number
  profile_id: number
  pair: string
  direction: 'LONG' | 'SHORT'
  entry_price: string
  entry_date: string | null
  stop_loss: string
  nb_take_profits: number
  risk_amount: string
  potential_profit: string | null
  status: 'open' | 'closed' | 'cancelled'
  realized_pnl: string | null
  closed_at: string | null
  created_at: string
}

export interface TradeOut extends TradeListItem {
  instrument_id: number | null
  strategy_id: number | null
  asset_class: string
  analyzed_timeframe: string | null
  current_risk: string | null
  session_tag: string | null
  notes: string | null
  confidence_score: number | null
  updated_at: string
  positions: Array<{
    id: number
    tp_price: string
    lot_percentage: number
    status: string
    exit_price: string | null
    realized_pnl: string | null
  }>
  size_info: TradeSizeResult | null
}

export interface TradeClose {
  exit_price: string
  closed_at?: string | null
}

export interface TradePartialClose {
  position_number: number
  exit_price: string
  exit_date?: string | null
  move_to_be?: boolean
}

// ── Strategies ────────────────────────────────────────────────────────────

export interface Strategy {
  id: number
  profile_id: number
  name: string
  description: string | null
  emoji: string | null
  color: string | null
  status: string
  trades_count: number
  win_count: number
  min_trades_for_stats: number
}

export interface StrategyCreate {
  name: string
  description?: string | null
  emoji?: string | null
  color?: string | null
}
