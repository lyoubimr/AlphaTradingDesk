# 🗄️ Database Schema - AlphaTradingDesk

**Date:** March 1, 2026  
**Version:** 1.1 (Phase 1 schema updated: HTF/MTF/LTF analysis, news intelligence, sessions, BE logic, leverage)  
**Database:** PostgreSQL 15+ (TimescaleDB for Phase 2+)

---

## 📐 Related Diagrams

| Diagram | File |
|---------|------|
| Database Schema (all Phase 1 tables, relationships, news intelligence) | [`../diagrams/03-database-schema.md`](../diagrams/03-database-schema.md) |
| Feature Data Flow (how data flows through all modules) | [`../diagrams/02-feature-data-flow.md`](../diagrams/02-feature-data-flow.md) |

---

## 🏗️ Schema Principles

1. **Immutable Time-Series** - OHLCV data never updated (only inserted)
2. **Versioned Configuration** - Track schema changes
3. **Soft Deletes** - Trades archived, never deleted
4. **Normalized 3NF** - Reduce redundancy
5. **Audit Trail** - Track all changes (created_at, updated_at)
6. **Foreign Keys** - Enforce data integrity
7. **Indexes** - Optimize common queries
8. **Minimum-Sample Rule** - Strategy win rate is only considered once `trades_count >= min_trades_for_stats` (default **5**). See `strategies` table.

---

## 📊 PHASE 1 Schema (Risk Management & Journal)

### profiles

```sql
CREATE TABLE profiles (
    id BIGSERIAL PRIMARY KEY,
    
    -- Basic info
    name VARCHAR(255) NOT NULL,
    market_type VARCHAR(50) NOT NULL,  -- 'CFD' or 'Crypto'
    
    -- Capital tracking
    capital_start DECIMAL(20, 2) NOT NULL,
    capital_current DECIMAL(20, 2) NOT NULL DEFAULT capital_start,
    
    -- Risk settings
    risk_percentage_default DECIMAL(5, 2) NOT NULL DEFAULT 2.0,  -- 2% per trade
    
    -- Metadata
    description TEXT,
    notes TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'active',  -- 'active', 'archived', 'deleted'
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CHECK (capital_start > 0),
    CHECK (capital_current > 0),
    CHECK (risk_percentage_default > 0 AND risk_percentage_default <= 10),
    CHECK (market_type IN ('CFD', 'Crypto'))
);

CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_created_at ON profiles(created_at DESC);
```

### trades

```sql
CREATE TABLE trades (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Trade info
    pair VARCHAR(20) NOT NULL,        -- 'BTC/USD', 'AAPL', etc
    direction VARCHAR(10) NOT NULL,   -- 'long' or 'short'
    
    -- Entry details
    entry_price DECIMAL(20, 8) NOT NULL,
    entry_date TIMESTAMP NOT NULL,
    
    -- Risk management
    stop_loss DECIMAL(20, 8) NOT NULL,
    nb_take_profits INT NOT NULL DEFAULT 3,
    CHECK (nb_take_profits >= 1 AND nb_take_profits <= 3),
    
    -- Risk calculations
    risk_amount DECIMAL(20, 2) NOT NULL,      -- Absolute amount at risk
    potential_profit DECIMAL(20, 2) NOT NULL,  -- At best TP
    
    -- Trade status
    status VARCHAR(50) NOT NULL DEFAULT 'open',  -- 'open', 'partial', 'closed'
    realized_pnl DECIMAL(20, 2),  -- NULL until closed
    
    -- VI adjustment (Phase 2+)
    market_vi_at_entry DECIMAL(5, 3),  -- Volatility Index at entry
    pair_vi_at_entry DECIMAL(5, 3),    -- Pair-specific VI at entry
    vi_adjusted_risk_amount DECIMAL(20, 2),  -- Risk after VI adjustment
    
    -- Auto-trading (Phase 4+)
    auto_generated BOOLEAN DEFAULT FALSE,
    signal_score DECIMAL(5, 2),  -- Confidence score (0-100)
    slippage DECIMAL(20, 8),     -- Actual vs expected entry
    commission DECIMAL(20, 2),   -- Trading fees
    
    -- Metadata
    notes TEXT,
    strategy_id BIGINT REFERENCES strategies(id) ON DELETE SET NULL,
    
    -- Screenshots (URLs or file paths)
    screenshot_urls TEXT[],
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMP,
    
    -- Constraints
    CHECK (direction IN ('long', 'short')),
    CHECK (status IN ('open', 'partial', 'closed')),
    CHECK (risk_amount > 0),
    CHECK (potential_profit > 0),
    CHECK ((status = 'closed' AND realized_pnl IS NOT NULL) 
        OR (status != 'closed' AND realized_pnl IS NULL))
);

CREATE INDEX idx_trades_profile_created ON trades(profile_id, created_at DESC);
CREATE INDEX idx_trades_pair ON trades(pair);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_strategy ON trades(strategy_id);
```

### positions

```sql
CREATE TABLE positions (
    id BIGSERIAL PRIMARY KEY,
    trade_id BIGINT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    
    -- Position identifier
    position_number INT NOT NULL,  -- 1, 2, or 3
    
    -- TP configuration
    take_profit_price DECIMAL(20, 8) NOT NULL,
    lot_percentage DECIMAL(5, 2) NOT NULL,  -- % of lot (33, 33, 34)
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'open',  -- 'open', 'closed', 'cancelled'
    
    -- Exit details
    exit_price DECIMAL(20, 8),  -- NULL until closed
    exit_date TIMESTAMP,
    realized_pnl DECIMAL(20, 2),  -- NULL until closed
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CHECK (position_number IN (1, 2, 3)),
    CHECK (lot_percentage > 0 AND lot_percentage <= 100),
    CHECK (status IN ('open', 'closed', 'cancelled')),
    CHECK ((status = 'closed' AND exit_price IS NOT NULL) 
        OR (status != 'closed' AND exit_price IS NULL)),
    UNIQUE (trade_id, position_number)
);

CREATE INDEX idx_positions_trade ON positions(trade_id);
CREATE INDEX idx_positions_status ON positions(status);
```

### strategies

```sql
CREATE TABLE strategies (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rules TEXT,  -- JSON or markdown description of rules
    
    -- Metadata
    color VARCHAR(7),  -- Hex color for UI
    emoji VARCHAR(10),
    
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    
    -- Statistics tracking
    -- trades_count: total closed trades recorded for this strategy
    -- win_count: number of closed trades that are winners (realized_pnl > 0)
    -- min_trades_for_stats: minimum closed trades required before win_rate
    --   is shown in analytics AND considered in risk logic.
    --   Default = 5. Below this threshold win_rate is displayed as NULL/N/A
    --   and the strategy is treated as neutral (no win-rate boost/penalty).
    trades_count          INT NOT NULL DEFAULT 0,
    win_count             INT NOT NULL DEFAULT 0,
    min_trades_for_stats  INT NOT NULL DEFAULT 5,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (profile_id, name),
    CHECK (trades_count >= 0),
    CHECK (win_count >= 0),
    CHECK (win_count <= trades_count),
    CHECK (min_trades_for_stats >= 1)
);

CREATE INDEX idx_strategies_profile ON strategies(profile_id);
```

> **Win Rate Rule:** A strategy's win rate (`win_count / trades_count × 100`) is only
> meaningful — and only considered in risk calculations — once
> `trades_count >= min_trades_for_stats` (default **5**).
> Below that threshold the win rate is displayed as `N/A` in the UI and the
> strategy is treated as **neutral** (no risk adjustment applied).
>
> **Keeping counts in the table** avoids a full `GROUP BY` scan on every trade
> open. `trades_count` and `win_count` are incremented atomically when a trade
> is closed (inside the same transaction that updates `profile.capital_current`).

### tags

```sql
CREATE TABLE tags (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    name VARCHAR(100) NOT NULL,
    description TEXT,
    
    -- UI
    color VARCHAR(7),
    emoji VARCHAR(10),
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (profile_id, name)
);

CREATE INDEX idx_tags_profile ON tags(profile_id);
```

### trade_tags

```sql
CREATE TABLE trade_tags (
    id BIGSERIAL PRIMARY KEY,
    trade_id BIGINT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (trade_id, tag_id)
);

CREATE INDEX idx_trade_tags_trade ON trade_tags(trade_id);
CREATE INDEX idx_trade_tags_tag ON trade_tags(tag_id);
```

### performance_snapshots

```sql
CREATE TABLE performance_snapshots (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Date of snapshot
    snapshot_date DATE NOT NULL,
    
    -- Capital
    capital_start DECIMAL(20, 2) NOT NULL,
    capital_current DECIMAL(20, 2) NOT NULL,
    
    -- P&L
    pnl_absolute DECIMAL(20, 2) NOT NULL,
    pnl_percent DECIMAL(10, 4) NOT NULL,
    
    -- Statistics
    trade_count INT NOT NULL DEFAULT 0,
    win_count INT NOT NULL DEFAULT 0,
    loss_count INT NOT NULL DEFAULT 0,
    win_rate DECIMAL(5, 2),  -- 0-100%
    profit_factor DECIMAL(10, 4),  -- Gross profit / Gross loss
    
    -- Data for equity curve
    equity_curve DECIMAL(20, 2)[],  -- Array of daily values
    max_drawdown DECIMAL(10, 4),     -- Percentage
    sharpe_ratio DECIMAL(10, 4),     -- Risk-adjusted return
    
    -- Metadata
    notes TEXT,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (profile_id, snapshot_date)
);

CREATE INDEX idx_performance_snapshots_profile_date 
    ON performance_snapshots(profile_id, snapshot_date DESC);
```

---

## 📊 PHASE 1 Schema Additions (New Features)

### brokers

```sql
CREATE TABLE brokers (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    market_type VARCHAR(50) NOT NULL,       -- 'CFD', 'Crypto', 'Forex'
    default_currency VARCHAR(10) NOT NULL,  -- 'USD', 'USDT', 'EUR'
    is_predefined BOOLEAN NOT NULL DEFAULT TRUE,  -- false = user-added
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (name)
);

-- Seed data (Phase 1 bootstrap)
INSERT INTO brokers (name, market_type, default_currency) VALUES
  ('Kraken', 'Crypto', 'USD'),
  ('Binance', 'Crypto', 'USDT'),
  ('Bybit', 'Crypto', 'USDT'),
  ('Vantage', 'CFD', 'USD'),
  ('IC Markets', 'CFD', 'USD'),
  ('Pepperstone', 'CFD', 'USD');
```

### instruments

```sql
CREATE TABLE instruments (
    id BIGSERIAL PRIMARY KEY,
    broker_id BIGINT NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
    symbol VARCHAR(30) NOT NULL,            -- 'BTCUSD', 'XAUUSD', 'EURUSD'
    display_name VARCHAR(100) NOT NULL,     -- 'Bitcoin', 'Gold', 'Euro/Dollar'
    asset_class VARCHAR(50) NOT NULL,       -- 'Crypto','Commodities','Forex','Indices','Stocks'
    base_currency VARCHAR(10),             -- 'BTC', 'XAU', 'EUR'
    quote_currency VARCHAR(10),            -- 'USD', 'USDT'
    pip_size DECIMAL(20, 10),              -- 0.01 for forex, 0.1 for gold, 1 for BTC
    tick_value DECIMAL(20, 10),            -- dollar value per pip
    min_lot DECIMAL(20, 8),
    is_predefined BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (broker_id, symbol)
);

CREATE INDEX idx_instruments_broker ON instruments(broker_id);
CREATE INDEX idx_instruments_asset_class ON instruments(asset_class);

-- Sample seed data
INSERT INTO instruments (broker_id, symbol, display_name, asset_class, pip_size, tick_value) VALUES
  -- Kraken Crypto
  (1, 'XBTUSD',  'Bitcoin',  'Crypto',      1.0,    1.0),
  (1, 'ETHUSD',  'Ethereum', 'Crypto',      0.01,   0.01),
  (1, 'SOLUSD',  'Solana',   'Crypto',      0.001,  0.001),
  -- Vantage CFD
  (4, 'XAUUSD',  'Gold',     'Commodities', 0.1,    0.01),
  (4, 'EURUSD',  'EUR/USD',  'Forex',       0.0001, 1.0),
  (4, 'GBPUSD',  'GBP/USD',  'Forex',       0.0001, 1.0),
  (4, 'US500',   'S&P 500',  'Indices',     0.01,   0.01);
```

### trading_styles

```sql
CREATE TABLE trading_styles (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,   -- 'scalping', 'day_trading', 'swing', 'position'
    display_name VARCHAR(100) NOT NULL,
    default_timeframes VARCHAR(50),     -- '15m,1h'
    description TEXT,
    sort_order INT DEFAULT 0
);

INSERT INTO trading_styles (name, display_name, default_timeframes, sort_order) VALUES
  ('scalping',     'Scalping',      '15m,1h',    1),
  ('day_trading',  'Day Trading',   '1h,4h',     2),
  ('swing',        'Swing Trading', '4h,1d',     3),
  ('position',     'Position',      '1d,1w',     4);
```

### profile_goals

```sql
CREATE TABLE profile_goals (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    style_id   BIGINT NOT NULL REFERENCES trading_styles(id) ON DELETE CASCADE,
    period     VARCHAR(20) NOT NULL,         -- 'daily', 'weekly', 'monthly'
    goal_pct   DECIMAL(6, 2) NOT NULL,       -- profit target %  e.g. 2.0
    limit_pct  DECIMAL(6, 2) NOT NULL,       -- max loss %  e.g. -1.5
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, style_id, period),
    CHECK (goal_pct > 0),
    CHECK (limit_pct < 0)
);

CREATE INDEX idx_profile_goals_profile ON profile_goals(profile_id);
```

### goal_progress_log

```sql
CREATE TABLE goal_progress_log (
    id BIGSERIAL PRIMARY KEY,
    profile_id       BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    style_id         BIGINT NOT NULL REFERENCES trading_styles(id),
    period           VARCHAR(20) NOT NULL,
    period_start     DATE NOT NULL,
    pnl_pct          DECIMAL(10, 4),
    goal_pct         DECIMAL(6, 2),
    limit_pct        DECIMAL(6, 2),
    goal_hit         BOOLEAN DEFAULT FALSE,
    limit_hit        BOOLEAN DEFAULT FALSE,
    -- Phase 2+: vi_multiplier applied
    vi_multiplier    DECIMAL(5, 3) DEFAULT 1.0,
    adjusted_goal    DECIMAL(6, 2),
    adjusted_limit   DECIMAL(6, 2),
    snapshot_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_goal_progress_profile_period
    ON goal_progress_log(profile_id, period_start DESC);
```

### note_templates

```sql
CREATE TABLE note_templates (
    id BIGSERIAL PRIMARY KEY,
    profile_id  BIGINT REFERENCES profiles(id) ON DELETE CASCADE,  -- NULL = global default
    name        VARCHAR(100) NOT NULL,
    questions   JSONB NOT NULL,
    -- [{"key": "went_well", "label": "What went well?", "type": "text"},
    --  {"key": "followed_plan", "label": "Followed the plan?", "type": "select",
    --   "options": ["Yes", "Partially", "No"]},
    --  {"key": "emotion", "label": "Emotional state?", "type": "select",
    --   "options": ["Calm", "Anxious", "FOMO", "Revenge"]}]
    is_default  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### sessions

```sql
-- Trading session catalog (Asia / London / New York / NYSE Open / Overlap)
-- All times stored in UTC. Frontend converts to user local timezone.
CREATE TABLE sessions (
    id           BIGSERIAL PRIMARY KEY,
    name         VARCHAR(50)  NOT NULL,   -- 'Asia', 'London', 'New York', 'NYSE Open', 'Overlap'
    start_utc    TIME         NOT NULL,   -- e.g. '08:00'
    end_utc      TIME         NOT NULL,   -- e.g. '17:00' — equal to start for point events
    is_point     BOOLEAN      NOT NULL DEFAULT FALSE,  -- TRUE for NYSE Open (no duration)
    note         TEXT,
    sort_order   INT          DEFAULT 0,
    created_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

INSERT INTO sessions (name, start_utc, end_utc, is_point, note, sort_order) VALUES
  ('Asia',     '00:00', '09:00', FALSE, 'Tokyo/Sydney — JPY, AUD, NZD most active', 1),
  ('London',   '08:00', '17:00', FALSE, 'EUR, GBP most active. Sets daily direction.', 2),
  ('New York', '13:00', '22:00', FALSE, 'Forex opens. USD pairs most active.', 3),
  ('NYSE Open','14:30', '14:30', TRUE,  'Point event — equities/indices spike', 4),
  ('Overlap',  '13:00', '17:00', FALSE, 'London + NY simultaneous — peak liquidity', 5);
```

### user_preferences

```sql
CREATE TABLE user_preferences (
    id                       BIGSERIAL PRIMARY KEY,
    profile_id               BIGINT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    timezone                 VARCHAR(50) NOT NULL DEFAULT 'UTC',
                             -- e.g. 'Europe/Paris' — used for session display only
    analyzed_tf_list         JSONB NOT NULL DEFAULT '["15m","1h","4h","1d","1w"]',
                             -- ordered list of TFs shown in trade form dropdown
    news_intelligence_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                             -- mirrors news_provider_config.enabled for quick access
    last_style               VARCHAR(20),  -- persisted style selector in dashboard goals widget
    last_period              VARCHAR(20),  -- persisted period in dashboard goals widget
    updated_at               TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### market_analysis_modules

```sql
CREATE TABLE market_analysis_modules (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(50)  NOT NULL UNIQUE,  -- 'Crypto', 'Gold', 'Forex', 'Indices'
    description TEXT,
    is_dual     BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = 2 assets (e.g. BTC + Alts)
    asset_a     VARCHAR(50),  -- 'BTC'
    asset_b     VARCHAR(50),  -- 'Alts'
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INT DEFAULT 0
);

INSERT INTO market_analysis_modules (name, description, is_dual, asset_a, asset_b, sort_order) VALUES
  ('Crypto', 'BTC + Altcoins — HTF/MTF/LTF 3-score analysis', TRUE, 'BTC', 'Alts', 1),
  ('Gold',   'XAUUSD — DXY/yields/VIX macro + HTF/MTF/LTF',  FALSE, 'XAUUSD', NULL, 2);
  -- Forex and Indices deferred to post-Phase 1
```

### market_analysis_indicators

```sql
CREATE TABLE market_analysis_indicators (
    id              BIGSERIAL PRIMARY KEY,
    module_id       BIGINT NOT NULL REFERENCES market_analysis_modules(id) ON DELETE CASCADE,
    key             VARCHAR(100) NOT NULL,     -- 'btc_1w_trend', 'usdt_dominance_1w'
    label           VARCHAR(200) NOT NULL,     -- 'BTC weekly trend'
    asset_target    VARCHAR(10) NOT NULL,      -- 'a' (BTC) or 'b' (Alts) or 'single'
    tv_symbol       VARCHAR(100) NOT NULL,     -- 'BTCUSDT', 'CRYPTOCAP:USDT.D'
    tv_timeframe    VARCHAR(10)  NOT NULL,     -- '1W', '1D', '4H'
    timeframe_level VARCHAR(10)  NOT NULL,     -- 'htf', 'mtf', 'ltf'
    question        TEXT         NOT NULL,
    tooltip         TEXT,                      -- "how to read this" description
    answer_bullish  VARCHAR(200) NOT NULL,
    answer_partial  VARCHAR(200) NOT NULL,
    answer_bearish  VARCHAR(200) NOT NULL,
    default_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order      INT DEFAULT 0,
    UNIQUE (module_id, key)
);

CREATE INDEX idx_ma_indicators_module ON market_analysis_indicators(module_id);
CREATE INDEX idx_ma_indicators_level  ON market_analysis_indicators(module_id, timeframe_level);
```

### profile_indicator_config

```sql
CREATE TABLE profile_indicator_config (
    id           BIGSERIAL PRIMARY KEY,
    profile_id   BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    indicator_id BIGINT NOT NULL REFERENCES market_analysis_indicators(id) ON DELETE CASCADE,
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (profile_id, indicator_id)
);
```

### market_analysis_sessions

```sql
-- One row per completed analysis session.
-- Stores 3-TF scores for up to 2 assets (A + B) per module.
-- Optional news intelligence context stored in news_* columns (NULL if not fetched).
CREATE TABLE market_analysis_sessions (
    id           BIGSERIAL PRIMARY KEY,
    profile_id   BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    module_id    BIGINT NOT NULL REFERENCES market_analysis_modules(id),

    -- 3-TF scores — Asset A (e.g. BTC, or single asset like Gold)
    score_htf_a  DECIMAL(5,2),   -- 0–100%
    score_mtf_a  DECIMAL(5,2),
    score_ltf_a  DECIMAL(5,2),
    bias_htf_a   VARCHAR(10),    -- 'bullish' | 'neutral' | 'bearish'
    bias_mtf_a   VARCHAR(10),
    bias_ltf_a   VARCHAR(10),

    -- 3-TF scores — Asset B (e.g. Alts, NULL for single-asset modules)
    score_htf_b  DECIMAL(5,2),
    score_mtf_b  DECIMAL(5,2),
    score_ltf_b  DECIMAL(5,2),
    bias_htf_b   VARCHAR(10),
    bias_mtf_b   VARCHAR(10),
    bias_ltf_b   VARCHAR(10),

    -- ── News Intelligence context (NULL if not fetched) ──────────────
    news_sentiment   VARCHAR(10),   -- 'bullish' | 'bearish' | 'neutral'
    news_confidence  INT,           -- 0–100
    news_summary     TEXT,
    news_key_themes  JSONB,         -- [{theme, impact, detail}, ...]  max 5
    news_risks       JSONB,         -- [{risk, severity, detail}, ...]  max 3
    news_sources     JSONB,         -- ["Reuters", "Bloomberg", ...]
    news_fetched_at  TIMESTAMPTZ,
    news_provider    VARCHAR(20),   -- 'perplexity' | 'xai_grok'
    news_model       VARCHAR(40),   -- 'sonar-pro' | 'grok-3'
    -- ─────────────────────────────────────────────────────────────────

    notes        TEXT,
    analyzed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ma_sessions_profile_module
    ON market_analysis_sessions(profile_id, module_id, analyzed_at DESC);
```

### market_analysis_answers

```sql
CREATE TABLE market_analysis_answers (
    id            BIGSERIAL PRIMARY KEY,
    session_id    BIGINT NOT NULL REFERENCES market_analysis_sessions(id) ON DELETE CASCADE,
    indicator_id  BIGINT NOT NULL REFERENCES market_analysis_indicators(id),
    score         INT    NOT NULL,   -- 0, 1, or 2
    answer_label  VARCHAR(200) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, indicator_id)
);

CREATE INDEX idx_ma_answers_session ON market_analysis_answers(session_id);
```

### news_provider_config

```sql
-- Per-profile AI news provider configuration.
-- API key stored AES-256 encrypted — never in plain text.
CREATE TABLE news_provider_config (
    id                  BIGSERIAL PRIMARY KEY,
    profile_id          BIGINT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    provider            VARCHAR(20)  NOT NULL DEFAULT 'perplexity',
                        -- 'perplexity' | 'xai_grok'
    model               VARCHAR(40)  NOT NULL DEFAULT 'sonar-pro',
                        -- 'sonar-pro' | 'sonar' | 'grok-3' | 'grok-3-mini'
    api_key_encrypted   BYTEA,       -- AES-256 ciphertext, NULL until key is set
    api_key_iv          BYTEA,       -- IV for AES-GCM decryption
    prompt_template     TEXT         NOT NULL,
                        -- User-editable; ships with default template
    enabled             BOOLEAN      NOT NULL DEFAULT FALSE,
    max_fetches_per_day INT          NOT NULL DEFAULT 10,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

### weekly_events

```sql
-- Macro economic events entered by the user at the start of each weekly analysis.
-- Displayed as warnings throughout the week on analysis summaries and the trade form.
CREATE TABLE weekly_events (
    id           BIGSERIAL PRIMARY KEY,
    profile_id   BIGINT       NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    week_start   DATE         NOT NULL,   -- ISO Monday of that week (e.g. 2026-03-02)
    event_date   DATE         NOT NULL,   -- exact date of the event
    event_time   TIME,                    -- UTC — NULL if time unknown
    title        TEXT         NOT NULL,   -- e.g. "NFP + Unemployment"
    impact       VARCHAR(10)  NOT NULL DEFAULT 'medium'
                 CHECK (impact IN ('high', 'medium', 'low')),
    asset_scope  TEXT[]       NOT NULL DEFAULT '{"all"}',
                 -- e.g. '{"crypto","gold"}', '{"all"}', '{"forex"}'
    note         TEXT,                    -- optional user note
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fast lookup for the current week
CREATE INDEX idx_weekly_events_profile_week
    ON weekly_events(profile_id, week_start);

-- Fast lookup for trade form warning (today's high-impact events)
CREATE INDEX idx_weekly_events_date_impact
    ON weekly_events(event_date, impact);
```

**Usage:**
```
- Populated at start of /market-analysis/new session (Step 0a)
- Queried on: analysis summary display, trade form warning check
- Warning fires when: event_date = today AND impact = 'high'
  AND abs(now_utc - event_time) < warning_window_hours (default: 2)
  AND event.asset_scope overlaps with instrument.asset_class
- Cleared/refreshed at next week's analysis session
```

### market_analysis_configs

```sql
-- Legacy / global config table (score thresholds, risk multipliers per module).
-- Kept for backward compatibility; per-indicator config now in profile_indicator_config.
CREATE TABLE market_analysis_configs (
    id                BIGSERIAL PRIMARY KEY,
    profile_id        BIGINT REFERENCES profiles(id) ON DELETE CASCADE, -- NULL = global default
    module_id         BIGINT REFERENCES market_analysis_modules(id),
    score_thresholds  JSONB NOT NULL DEFAULT '{"bullish": 60, "bearish": 40}',
    risk_multipliers  JSONB NOT NULL DEFAULT
                      '{"bullish_long": 1.20, "bullish_short": 0.70,
                        "bearish_long":  0.70, "bearish_short":  1.20}',
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Modified: profiles

```sql
ALTER TABLE profiles ADD COLUMN broker_id              BIGINT REFERENCES brokers(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN currency               VARCHAR(10);       -- 'USD', 'USDT', 'EUR'
ALTER TABLE profiles ADD COLUMN max_concurrent_risk_pct DECIMAL(5,2) NOT NULL DEFAULT 2.0;
  -- Max % of capital in risk across all open trades at once
```

### Modified: trades

```sql
ALTER TABLE trades ADD COLUMN instrument_id          BIGINT REFERENCES instruments(id) ON DELETE SET NULL;
ALTER TABLE trades ADD COLUMN asset_class            VARCHAR(50);       -- 'Crypto','Commodities','Forex','Indices'
ALTER TABLE trades ADD COLUMN analyzed_timeframe     VARCHAR(10);       -- '15m','1h','4h','1d','1w'
ALTER TABLE trades ADD COLUMN confidence_score       INT
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));
ALTER TABLE trades ADD COLUMN spread                 DECIMAL(20, 8);
ALTER TABLE trades ADD COLUMN estimated_fees         DECIMAL(20, 2);
ALTER TABLE trades ADD COLUMN structured_notes       JSONB;             -- post-trade template answers
ALTER TABLE trades ADD COLUMN market_analysis_session_id BIGINT
    REFERENCES market_analysis_sessions(id) ON DELETE SET NULL;
ALTER TABLE trades ADD COLUMN leverage               DECIMAL(10, 2);    -- Crypto: editable leverage
ALTER TABLE trades ADD COLUMN current_risk           DECIMAL(20, 2);    -- Live: recalculated on BE/partial close
ALTER TABLE trades ADD COLUMN session_tag            VARCHAR(20);       -- 'asia','london','new_york','overlap'
    -- auto-tagged at entry UTC time — never manually entered
```

---

## 📊 PHASE 2 Schema Additions (Volatility)

### market_volatility_snapshots

```sql
-- TimescaleDB hypertable (Phase 2+)
CREATE TABLE market_volatility_snapshots (
    id BIGSERIAL,
    pair VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,  -- '15m', '1h', '4h', '1d', '1w'
    
    -- VI Score (0-1)
    vi_score DECIMAL(5, 3) NOT NULL,
    
    -- Component breakdown
    volume_component DECIMAL(5, 3),
    obv_component DECIMAL(5, 3),
    atr_component DECIMAL(5, 3),
    price_component DECIMAL(5, 3),
    ema_component DECIMAL(5, 3),
    
    -- Market context
    btc_dominance DECIMAL(5, 2),  -- Percentage
    market_regime VARCHAR(50),  -- 'bull', 'bear', 'sideways'
    
    -- Timestamp
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (pair, timeframe, timestamp)
);

-- Create hypertable (run after creating table)
SELECT create_hypertable(
    'market_volatility_snapshots',
    'timestamp',
    if_not_exists => TRUE
);

-- Compression (keep last 90 days uncompressed, compress older)
ALTER TABLE market_volatility_snapshots SET (
    timescaledb.compress = true,
    timescaledb.compress_segmentby = 'pair,timeframe',
    timescaledb.compress_orderby = 'timestamp DESC'
);

CREATE POLICY compress_old_snapshots
    ON market_volatility_snapshots
    AS POLICY FOR compress
    USING (NOW() - timestamp > '90 days'::interval);

-- Indexes
CREATE INDEX idx_vi_snapshots_pair_timeframe_timestamp 
    ON market_volatility_snapshots(pair, timeframe, timestamp DESC);
```

### ohlcv_data

```sql
-- TimescaleDB hypertable (Phase 2+)
CREATE TABLE ohlcv_data (
    id BIGSERIAL,
    pair VARCHAR(20) NOT NULL,
    timeframe VARCHAR(10) NOT NULL,  -- '15m', '1h', '4h', '1d', '1w'
    
    -- OHLCV
    open DECIMAL(20, 8) NOT NULL,
    high DECIMAL(20, 8) NOT NULL,
    low DECIMAL(20, 8) NOT NULL,
    close DECIMAL(20, 8) NOT NULL,
    volume DECIMAL(20, 2) NOT NULL,
    
    -- Timestamp
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (pair, timeframe, timestamp)
);

-- Create hypertable
SELECT create_hypertable(
    'ohlcv_data',
    'timestamp',
    if_not_exists => TRUE
);

-- Compression
ALTER TABLE ohlcv_data SET (
    timescaledb.compress = true,
    timescaledb.compress_segmentby = 'pair,timeframe',
    timescaledb.compress_orderby = 'timestamp DESC'
);

-- Indexes
CREATE INDEX idx_ohlcv_pair_timeframe_timestamp 
    ON ohlcv_data(pair, timeframe, timestamp DESC);
```

---

## 📊 PHASE 3 Schema Additions (Watchlists)

### watchlist_snapshots

```sql
CREATE TABLE watchlist_snapshots (
    id BIGSERIAL PRIMARY KEY,
    
    style VARCHAR(50) NOT NULL,  -- 'scalping', 'intraday', 'swing', 'position'
    timeframe_focus VARCHAR(10),  -- '15m', '1h', '4h', '1d', '1w'
    
    -- Metadata
    generation_timestamp TIMESTAMP NOT NULL,
    snapshot_date DATE NOT NULL,
    
    -- Data (JSON for flexibility)
    snapshot_data JSONB NOT NULL,  -- [{pair, vi_score, tier, rank}, ...]
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (style, snapshot_date)
);

CREATE INDEX idx_watchlist_snapshots_style_date 
    ON watchlist_snapshots(style, snapshot_date DESC);
```

### watchlist_pairs

```sql
CREATE TABLE watchlist_pairs (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id BIGINT NOT NULL REFERENCES watchlist_snapshots(id) ON DELETE CASCADE,
    
    pair VARCHAR(20) NOT NULL,
    tier VARCHAR(1) NOT NULL,  -- 'S', 'A', 'B', 'C'
    rank INT NOT NULL,
    
    -- Scores
    vi_score DECIMAL(5, 3),
    volume_24h DECIMAL(20, 2),
    liquidity_score DECIMAL(5, 2),
    ema_signal VARCHAR(50),  -- 'bullish', 'bearish', 'neutral'
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    UNIQUE (snapshot_id, pair)
);

CREATE INDEX idx_watchlist_pairs_snapshot ON watchlist_pairs(snapshot_id);
CREATE INDEX idx_watchlist_pairs_pair ON watchlist_pairs(pair);
```

---

## 📊 PHASE 4 Schema Additions (Auto-Trading)

### kraken_orders

```sql
CREATE TABLE kraken_orders (
    id BIGSERIAL PRIMARY KEY,
    trade_id BIGINT REFERENCES trades(id) ON DELETE SET NULL,
    profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Kraken reference
    kraken_order_id VARCHAR(255) NOT NULL UNIQUE,
    
    -- Order details
    pair VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,  -- 'long', 'short'
    amount DECIMAL(20, 8) NOT NULL,
    entry_price DECIMAL(20, 8) NOT NULL,
    
    -- Risk management (from order creation)
    stop_loss DECIMAL(20, 8) NOT NULL,
    take_profits JSONB,  -- [{price: X, percentage: Y}, ...]
    
    -- Status
    status VARCHAR(50) NOT NULL,  -- 'pending', 'open', 'partial', 'closed', 'failed'
    
    -- Fill details
    fill_price DECIMAL(20, 8),
    slippage DECIMAL(20, 8),  -- fill_price - entry_price
    commission DECIMAL(20, 2),
    
    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    executed_at TIMESTAMP,
    closed_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    
    CHECK (direction IN ('long', 'short')),
    CHECK (amount > 0)
);

CREATE INDEX idx_kraken_orders_profile ON kraken_orders(profile_id);
CREATE INDEX idx_kraken_orders_trade ON kraken_orders(trade_id);
CREATE INDEX idx_kraken_orders_status ON kraken_orders(status);
CREATE INDEX idx_kraken_orders_created_at ON kraken_orders(created_at DESC);
```

### automation_settings

```sql
CREATE TABLE automation_settings (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Toggle
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Market conditions
    market_vi_threshold DECIMAL(5, 3),  -- Don't trade if VI < this
    btc_dominance_min DECIMAL(5, 2),    -- Don't trade if BTC dom < this
    
    -- Position limits
    max_positions INT NOT NULL DEFAULT 3,
    risk_per_trade DECIMAL(5, 2) NOT NULL DEFAULT 1.5,  -- % of capital
    portfolio_risk_cap DECIMAL(5, 2) NOT NULL DEFAULT 10.0,  -- % total cap
    
    -- Pair whitelist (JSONB for flexibility)
    pair_whitelist JSONB,  -- ["BTC/USD", "ETH/USD", ...]
    
    -- Strategies (JSONB - which signals to use)
    strategies_enabled JSONB,  -- {vi_ema: true, price_action: false, ...}
    
    -- API Keys (encrypted in application layer)
    kraken_api_key_encrypted TEXT,
    kraken_api_secret_encrypted TEXT,
    
    -- Notification preferences
    notify_on_signal BOOLEAN DEFAULT TRUE,
    notify_on_fill BOOLEAN DEFAULT TRUE,
    notify_on_error BOOLEAN DEFAULT TRUE,
    telegram_chat_id VARCHAR(255),
    
    -- Metadata
    notes TEXT,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_automation_settings_profile ON automation_settings(profile_id);
```

### capital_sync_history

```sql
CREATE TABLE capital_sync_history (
    id BIGSERIAL PRIMARY KEY,
    profile_id BIGINT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    
    -- Sync results
    timestamp TIMESTAMP NOT NULL,
    kraken_balance DECIMAL(20, 2) NOT NULL,
    expected_balance DECIMAL(20, 2) NOT NULL,
    difference DECIMAL(20, 2),  -- kraken_balance - expected_balance
    
    -- Alert?
    alert_raised BOOLEAN,
    alert_message TEXT,
    
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_capital_sync_history_profile_timestamp 
    ON capital_sync_history(profile_id, timestamp DESC);
```

---

## 🔄 Migrations (Alembic)

### Initial Schema (Phase 1)

```bash
alembic revision --autogenerate -m "Create Phase 1 schema"
```

### Phase 2 Additions

```bash
alembic revision --autogenerate -m "Add TimescaleDB and volatility tables"
```

### Phase 3 Additions

```bash
alembic revision --autogenerate -m "Add watchlist tables"
```

### Phase 4 Additions

```bash
alembic revision --autogenerate -m "Add auto-trading and capital sync tables"
```

### Deploy Migrations

```bash
# Dev
docker-compose -f docker-compose.dev.yml exec backend alembic upgrade head

# Prod
docker-compose -f docker-compose.prod.yml exec backend alembic upgrade head
```

---

## 📈 Performance Notes

### Indexes

**Query patterns optimized:**
```
- Get trades for profile: idx_trades_profile_created
- Get positions for trade: idx_positions_trade
- Get daily performance: idx_performance_snapshots_profile_date
- Get VI by pair/timeframe: idx_vi_snapshots_pair_timeframe_timestamp (TimescaleDB automatic)
- Get watchlist rankings: idx_watchlist_pairs_snapshot
```

### TimescaleDB Compression

Automatic compression after 90 days:
- Reduces storage by ~80%
- Query performance unchanged (transparent decompression)
- Old data still searchable

### Connection Pooling

```
SQLAlchemy defaults:
- pool_size=10 (connections)
- max_overflow=20 (additional connections)
- pool_pre_ping=True (prevent stale connections)
```

Adjust for production if needed:
```python
CREATE_ENGINE_CONFIG = {
    'pool_size': 20,
    'max_overflow': 40,
    'pool_timeout': 30,
    'pool_recycle': 3600,  # Recycle connections every hour
}
```

---

## 🔐 Security

### Encrypted Fields

**Phase 4 (application-level encryption):**
```python
# Kraken API keys encrypted before storage
kraken_api_key_encrypted = encrypt(api_key, ENCRYPTION_KEY)

# Decrypted only when needed
api_key = decrypt(kraken_api_key_encrypted, ENCRYPTION_KEY)
```

### Access Control

```sql
-- Row-level security (future: multi-user)
CREATE POLICY user_profile_policy ON profiles
  USING (id = current_user_id());
```

---

---

## 📌 Business Logic: Strategy Win Rate Minimum

### Rule

> A strategy's win rate is **undefined (`N/A`)** until it has at least
> `min_trades_for_stats` **closed** trades recorded.
> **Default threshold: 5 trades.**

| `trades_count` | Displayed win rate | Used in risk logic? |
|:-:|:-:|:-:|
| 0 – 4 | `N/A` | ❌ No (treated as neutral) |
| ≥ 5 | `win_count / trades_count × 100 %` | ✅ Yes |

### Why 5?

A single lucky (or unlucky) trade would give 100 % or 0 % win rate, which is
statistically meaningless. Five trades is the pragmatic minimum for the numbers
to carry any signal.

### Implementation notes

- `strategies.trades_count` and `strategies.win_count` are **incremented inside
  the same transaction** that closes a trade and updates
  `profile.capital_current`. If the transaction rolls back, no partial update
  leaks.
- A trade is counted as a **win** when `realized_pnl > 0` at close.
- The threshold (`min_trades_for_stats`) is stored per strategy so it can be
  overridden per strategy without changing global settings.
- All analytics endpoints that expose `win_rate` must respect the threshold:
  return `null` (JSON) / `None` (Python) when below threshold.

### Migration note (backfill for existing rows)

```sql
-- Alembic migration: backfill strategy trade stats
UPDATE strategies s SET
  trades_count = sub.cnt,
  win_count    = sub.wins
FROM (
  SELECT
    strategy_id,
    COUNT(*)                                 AS cnt,
    COUNT(*) FILTER (WHERE realized_pnl > 0) AS wins
  FROM trades
  WHERE status = 'closed'
    AND strategy_id IS NOT NULL
  GROUP BY strategy_id
) sub
WHERE s.id = sub.strategy_id;
```

---

## 📊 PHASE 5 Schema (Trade Automation — Kraken Execution)

### Modifications tables existantes

#### `instruments` — ajout `contract_value_precision`

```sql
ALTER TABLE instruments
  ADD COLUMN contract_value_precision INTEGER;
-- Rempli automatiquement par sync_instruments (Celery daily) via Kraken API.
-- Positif n  → min_lot = 10^(-n)   ex: prec=4 → 0.0001 (PF_XBTUSD)
-- Négatif n  → min_lot = 10^abs(n) ex: prec=-3 → 1000   (PF_BONKUSD)
-- Utilisé par quantize_size() dans kraken_execution/precision.py
```

#### `trades` — ajout colonnes automation

```sql
ALTER TABLE trades
  ADD COLUMN automation_enabled     BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN kraken_entry_order_id  VARCHAR(255);
-- automation_enabled: opt-in par trade — false = journal pur (comportements Phase 1-4)
-- kraken_entry_order_id: référence rapide vers l'ordre d'entrée Kraken (aussi dans kraken_orders)
```

---

### `automation_settings`

Config Table Pattern (JSONB) — une ligne par profil.

```sql
CREATE TABLE automation_settings (
    profile_id  BIGINT  PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    config      JSONB   NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**Structure du JSONB `config` :**

```json
{
  "enabled": true,
  "api_key_encrypted": "<Fernet ciphertext>",
  "api_secret_encrypted": "<Fernet ciphertext>",
  "pnl_status_interval_minutes": 60,
  "max_open_automated_trades": 5
}
```

- `api_key_encrypted` / `api_secret_encrypted` : chiffrés Fernet (`ENCRYPTION_KEY` env var)
- `pnl_status_interval_minutes` : fréquence des notifs PnL courant (0 = désactivé)
- `max_open_automated_trades` : garde-fou — refuse d'ouvrir si déjà N trades auto ouverts

---

### `kraken_orders`

Tracking granulaire de chaque ordre envoyé à Kraken Futures.
Un trade peut avoir jusqu'à 5 ordres : 1 entrée + 1 SL + jusqu'à 3 TP.

```sql
CREATE TABLE kraken_orders (
    id                BIGSERIAL PRIMARY KEY,

    -- Liens ATD
    trade_id          BIGINT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    position_id       BIGINT REFERENCES positions(id) ON DELETE SET NULL,
    -- position_id renseigné uniquement pour les ordres TP (lié à la position concerned)

    -- Identifiant Kraken
    kraken_order_id   VARCHAR(255) UNIQUE,
    -- NULL tant que l'ordre n'a pas été confirmé par Kraken
    -- Unique constraint empêche le double-insert en cas de retry idempotent

    -- Rôle dans le trade
    role              VARCHAR(20) NOT NULL,
    -- 'entry' | 'sl' | 'tp1' | 'tp2' | 'tp3'

    -- Caractéristiques de l'ordre
    order_type        VARCHAR(20) NOT NULL,
    -- 'market' | 'limit' | 'stop' | 'take_profit'
    side              VARCHAR(10) NOT NULL,
    -- 'buy' | 'sell'
    size              NUMERIC(20, 8) NOT NULL,
    -- quantisé via quantize_size() AVANT envoi — jamais de float
    limit_price       NUMERIC(20, 8),   -- NULL pour market
    stop_price        NUMERIC(20, 8),   -- NULL sauf stop orders

    -- Résultat du fill
    status            VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- 'pending' | 'open' | 'filled' | 'cancelled' | 'error'
    filled_price      NUMERIC(20, 8),   -- prix réel du fill
    filled_size       NUMERIC(20, 8),   -- peut différer de size (partial fills)
    kraken_fill_id    VARCHAR(255) UNIQUE,
    -- stocké pour prévenir le double-traitement (idempotence)
    error_msg         TEXT,             -- message d'erreur Kraken si status='error'

    -- Timestamps
    created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
    filled_at         TIMESTAMP,

    -- Contraintes
    CHECK (role IN ('entry', 'sl', 'tp1', 'tp2', 'tp3')),
    CHECK (order_type IN ('market', 'limit', 'stop', 'take_profit')),
    CHECK (side IN ('buy', 'sell')),
    CHECK (status IN ('pending', 'open', 'filled', 'cancelled', 'error')),
    CHECK (size > 0)
);

CREATE INDEX idx_kraken_orders_trade_id ON kraken_orders(trade_id);
CREATE INDEX idx_kraken_orders_status   ON kraken_orders(status) WHERE status IN ('pending', 'open');
CREATE INDEX idx_kraken_orders_role     ON kraken_orders(trade_id, role);
```

---

### Relations Phase 5

```
trades (1) ──────────────── (N) kraken_orders
   │                               │
   │  automation_enabled = true    │  role = 'tp1' / 'tp2' / 'tp3'
   │                               ↓
   └──────────────── (N) positions (1) ──── (1) kraken_orders (TP lié)

profiles (1) ──── (1) automation_settings
```

---

**Next Document:** → `API_SPEC.md` (REST API endpoints)
