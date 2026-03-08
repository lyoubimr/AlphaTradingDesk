# 🎯 Operational Architecture - AlphaTradingDesk

**Date:** March 1, 2026  
**Phase:** 1-4 (Complete workflow)

---

## 📊 System Overview

> **Phase 1 only:** React + FastAPI + PostgreSQL.  
> Redis, Celery, and external APIs are **Phase 2+** additions.

```
User (Browser)
    ↓
React Frontend (Vite)
    ↓
FastAPI Backend
    ├─ REST API
    ├─ WebSocket (real-time)
    └─ Database Layer
         ├─ PostgreSQL + TimescaleDB   ← Phase 1: plain PostgreSQL only
         ├─ Redis (cache)              ← Phase 2+
         └─ Celery (background tasks) ← Phase 2+
    ↓
External APIs (Phase 2+)
    ├─ Kraken (crypto trading)
    ├─ Binance (data)
    └─ Telegram (notifications)
```

---

## 🔄 PHASE 1: Risk Management & Journal (+ Goals + Broker Config + Market Analysis)

> Phase 1 now includes 3 additional features validated on March 1, 2026.  
> See `docs/phases/PHASE_1_SCOPE.md` for complete breakdown.

### User Flow: Weekly Market Analysis (NEW)

```
1. User opens /market-analysis → [New Analysis]

2. Selects market: Crypto / Gold / Forex / Indices

3. For each configured indicator (e.g. BTC.D, TOTAL3, USDT.D...):
   - App shows: indicator name + [Open in TradingView] link
   - User checks the chart on TradingView (separate tab)
   - User answers: [🟢 Bullish] [🟡 Neutral] [🔴 Bearish]

4. App computes score:
   - Bullish = +2pts, Neutral = +1pt, Bearish = +0pts
   - Score% = total_pts / max_pts × 100

5. Bias result:
   - > 65% → 🟢 BULLISH  → risk multiplier shown (+20% longs)
   - 40-65% → 🟡 NEUTRAL  → no change
   - < 40% → 🔴 BEARISH  → risk multiplier shown (-30% longs)

6. User adds optional notes → [Save]

7. Dashboard updates:
   - Goals widget shows bias indicator
   - Trade form shows adjusted risk% based on bias
```

### User Flow: Goals & Risk Limits (NEW)

```
1. Setup (in /settings/goals):
   - Per style (e.g. Swing): Weekly goal +2% | Weekly limit -1.5%
   
2. Live tracking (on /dashboard Goals widget):
   - Style: Swing | Period: Week
   - Goal bar:  +$300 / +$500 [████████░░ 60%] ✅ ON TRACK
   - Risk bar:  -$80 / -$200  [████░░░░░░ 40%] ✅ OK
   
3. Automatic enforcement:
   - If risk limit hit → New Trade button disabled + warning banner
   - If goal reached → ✅ GOAL REACHED badge
```

### User Flow: Adding a Trade

```
1. User opens UI → "New Trade"
   
2. Form submission:
   - Profile*        ← dropdown → loads broker + currency
   - Instrument*     ← searchable list filtered by broker
                        (e.g. BTCUSD, XAUUSD, EURUSD...)
                        + "Add custom pair" option
   - Asset class     ← auto-filled from instrument (Crypto/Forex/Commodities...)
   - Direction*      ← Long / Short
   - Analyzed TF*    ← 15m | 1h | 4h | 1d | 1w
   - Entry price*
   - Stop loss*
   - TPs*: 1–3 levels with percentage split
   - Strategy*       ← dropdown
   - Confidence      ← range slider 0–100%
   - Spread          ← pre-filled from instrument config, editable
   - Fees            ← auto-estimated, editable
   - Tags            ← multi-select
   
3. Backend calculates (and shows live):
   - Risk amount   = capital_current × risk_pct
                     × market_analysis_multiplier (if session exists)
   - Lot size      = risk_amount / ((entry - stop_loss) × pip_value)
   - For leverage:
     Margin needed = position_value / leverage
     Safety check  = margin_available ≥ 2.5 × liquidation_margin
   
4. Creates:
   - 1× Trade record (status: open)
   - N× Position records (one per TP)
   
5. User closes position manually (Phase 1):
   - Enters exit price for each position
   - Fills post-trade note template (structured)
   - Backend calculates realized_pnl
   - Updates profile.capital_current
   - Updates goal_progress_log
   - Sets trade.status = closed
```

### Data Model (Phase 1)

```
Profile
├─ name, market_type, broker_id (FK → brokers)
├─ currency, capital_start, capital_current
├─ risk_percentage_default
└─ created_at

Broker (config)
├─ name (Kraken, Vantage, ...), market_type, default_currency
└─ is_predefined (false = user-added)

Instrument (config per broker)
├─ symbol, display_name, asset_class
├─ pip_size, tick_value, min_lot
└─ is_predefined (false = user-added)

Trade
├─ profile_id (FK), instrument_id (FK)
├─ asset_class, analyzed_timeframe
├─ direction, entry_price, stop_loss
├─ status (open/partial/closed), nb_take_profits
├─ risk_amount, potential_profit, realized_pnl
├─ confidence_score (0–100), spread, estimated_fees
├─ structured_notes (JSONB), market_analysis_session_id
└─ notes, screenshots, tags

Position
├─ trade_id (FK), position_number (1, 2, 3)
├─ take_profit_price, lot_percentage
├─ status (open/closed), exit_price, realized_pnl
└─ exit_date

TradingStyle (config)
└─ scalping | day_trading | swing | position

ProfileGoal
├─ profile_id, style_id, period (daily/weekly/monthly)
├─ goal_pct (+%), limit_pct (-%)
└─ is_active

MarketAnalysisConfig
├─ market (Crypto/Gold/Forex/Indices)
├─ indicators (JSONB: list of indicators with questions + scores)
└─ score_thresholds, risk_multipliers

MarketAnalysisSession
├─ profile_id, market, total_score, score_pct
├─ bias (bullish/neutral/bearish)
└─ analyzed_at
```

### UI Pages (Phase 1)

```
/dashboard
  ├─ Goals widget (top)
  │   ├─ Style + Period selector
  │   ├─ Goal progress bar (profit % vs target)
  │   ├─ Risk limit bar (loss % vs limit)
  │   ├─ Market bias badge (from latest analysis)
  │   └─ Status: ✅ ON TRACK / ⚠️ WARNING / 🛑 BLOCKED
  ├─ Open positions (table)
  ├─ Account metrics
  │   ├─ Capital, Win rate, Profit factor
  │   └─ Equity curve (7d/30d)
  └─ Quick actions: New trade, Close trade

/trades
  ├─ Trade list (filters: open, closed, date, asset class)
  ├─ Trade detail view
  │   ├─ Entry/exit info, instrument, TF, confidence
  │   ├─ Screenshots, structured notes, tags
  │   └─ P&L breakdown per position
  └─ Analytics: Performance by strategy/tag/asset class

/market-analysis
  ├─ Analysis history (table with bias trend)
  ├─ [New Analysis] → step-by-step questionnaire
  └─ Latest bias impact on risk (shown clearly)

/settings
  ├─ Profiles      ← name, broker, capital, risk%
  ├─ Goals         ← per style + period: goal% + limit%
  ├─ Instruments   ← browse/add instruments per broker
  ├─ Market Analysis ← toggle indicators, thresholds, risk multipliers
  ├─ Strategies    ← add/edit
  └─ Tags          ← add/edit
```

---

## 📈 PHASE 2: Volatility Analysis

### New Components

```
Backend adds:
├─ Volatility Calculator
│   ├─ VI computation (5 components)
│   ├─ Multi-timeframe (15m, 1h, 4h, 1d, 1w)
│   └─ Dynamic BTC/Alts weighting
│
├─ Market Data Module
│   ├─ Kraken/Binance API clients
│   ├─ OHLCV data fetching
│   └─ TimescaleDB storage
│
└─ WebSocket Handler
    └─ Real-time VI updates → frontend

Frontend adds:
├─ VI Dashboard
│   ├─ Live VI scores
│   ├─ Market regime (BTC Dominance/Alt Season)
│   ├─ Volatility charts
│   └─ Volume analysis
│
└─ Pair Analysis
    ├─ Single pair VI breakdown
    ├─ Price vs EMA breakouts
    └─ Risk calculator updated with market VI
```

### Scheduled Task: Volatility Calculation

```
Trigger: Every 15 minutes (configurable via UI)

Task flow:
1. Celery Beat scheduler triggers job
2. Worker fetches latest OHLCV (all timeframes)
3. Computes VI for all pairs
4. Updates market_volatility_snapshots table
5. Publishes WebSocket event → connected clients
6. Updates Redis cache

Configuration (UI):
/settings/volatility
├─ Calculation frequency: [every 15 min]
├─ Timeframes: [15m, 1h, 4h, 1d, 1w]
├─ Component weights: [Volume 38%, OBV 18%, ATR 26%, Price 10%, EMA 8%]
├─ BTC weight: [Dynamic based on volume share]
└─ [Enable/Disable]
```

### Risk Calculator Enhancement (Phase 2)

```
When opening new trade in Phase 2:

Old (Phase 1):
risk_amount = capital × risk_pct

New (Phase 2):
1. Get market VI (from real-time calculations)
2. Adjust risk based on market volatility:
   - Market VI high → reduce risk (more uncertainty)
   - Market VI low → can increase risk (calmer market)
   
3. Also consider pair VI:
   pair_volatility_adjustment = pair_VI / average_pair_VI
   
4. Final risk:
   base_risk = capital × risk_pct
   adjusted_risk = base_risk × market_vi_multiplier × pair_vi_adjustment
```

---

## 📋 PHASE 3: Watchlist Generation

### Scheduled Task: Watchlist Generation

```
Trigger: Multiple schedules (configurable)
├─ Weekly (1w focus): Monday 01:02 UTC
├─ Daily (1d focus): Daily 00:05 UTC
├─ 4-Hour (4h focus): Every 4 hours
└─ Hourly (1h focus): Every hour at :05

Task flow:
1. Fetch all pairs with VI scores
2. Apply filters:
   - Min volume: $1M
   - Min VI threshold: 0.4
   - Exclude stablecoins
3. Score pairs:
   Score = 0.80 × VI_norm + 0.15 × liq_score + 0.05 × ema_signal
4. Tier assignment:
   - Tier S: Top 10%
   - Tier A: 11-30%
   - Tier B: 31-60%
   - Tier C: 61-100%
5. Generate outputs:
   - JSON (API)
   - TXT (TradingView import)
   - CSV (analysis)
6. Store snapshot in DB
```

### UI: Watchlist Management

```
/watchlists
├─ View all styles:
│   ├─ Scalping (15m/1h focus)
│   ├─ Intraday (1h/4h focus)
│   ├─ Swing (4h/1d focus)
│   └─ Position (1d/1w focus)
│
├─ Per-style watchlist:
│   ├─ Tier S pairs (sortable: VI, volume, EMA signals)
│   ├─ Tier A pairs
│   ├─ Tier B/C pairs (collapsible)
│   └─ Buttons: [Export TXT] [Copy to TradingView] [Download CSV]
│
└─ Settings:
    ├─ Recalculation schedule
    ├─ Component weights (inherit Phase 2 settings)
    ├─ Filter thresholds
    └─ Output preferences
```

---

## 🤖 PHASE 4: Auto-Trading & Automation

### New Components

```
Backend adds:
├─ Auto-Trading Module
│   ├─ Signal detection (VI + EMA + risk)
│   ├─ Position opener (Kraken API)
│   ├─ Position manager (adjust size, close)
│   └─ Order monitor (status, fills)
│
├─ Capital Sync Module
│   ├─ Kraken balance fetcher
│   ├─ Profile.capital_current updater
│   └─ Runs every 5 min (configurable)
│
└─ Notification Module
    ├─ Trade alerts
    ├─ Risk warnings
    ├─ Telegram sender
    └─ WebSocket broadcasts

Frontend adds:
├─ Auto-Trading Dashboard
│   ├─ Active signals
│   ├─ Open positions (Kraken synced)
│   ├─ Capital tracking
│   └─ Order history
│
└─ Automation Settings
    ├─ Enable/disable per strategy
    ├─ Risk caps
    ├─ Pair whitelist
    └─ Notification preferences
```

### Scheduled Tasks: Phase 4

```
1. CAPITAL SYNC (every 5 min)
   - Fetch Kraken balance
   - Update profile.capital_current
   - Trigger risk recalculation
   - Alert if threshold exceeded

2. AUTO-TRADE SIGNAL CHECK (every 15 min or real-time)
   - Check VI + EMA conditions
   - Calculate optimal position size (with market VI adjustment)
   - Open position on Kraken API
   - Log trade to DB
   - Send notification

3. POSITION MANAGEMENT (every 5 min)
   - Monitor open positions
   - Adjust stops if market moves
   - Close positions at TP/SL
   - Update realized_pnl
   - Sync capital

4. WATCHLIST REFRESH (as per Phase 3 schedule)

5. NOTIFICATIONS (real-time via WebSocket + Telegram)
```

### Auto-Trading Flow

```
User enables auto-trading:
1. UI: /settings/automation
   ├─ Market conditions: [only when VI > 0.5]
   ├─ Max positions: [3]
   ├─ Risk per trade: [1.5%]
   ├─ Risk cap (portfolio): [10% of capital]
   ├─ Pair whitelist: [BTC, ETH, SOL, ...]
   ├─ Strategies enabled: [VI + EMA cross]
   └─ [ENABLE AUTO-TRADING] ⚠️ WARNING: Real money!

2. Celery tasks continuously:
   a) Check signal conditions
      if VI_pair > threshold AND price crosses EMA:
         → Signal generated
   
   b) Calculate position size:
      risk_amount = capital × risk_pct × market_vi_multiplier
      lot_size = risk_amount / (entry - stop_loss)
      
      if total_risk + new_risk > portfolio_risk_cap:
         → SKIP (risk limit exceeded)
   
   c) Execute on Kraken API:
      - Create limit order at entry
      - Set stop loss
      - Set take profits (if broker supports)
      - Log to DB with order_id
      - Send notification

3. Monitor & Manage:
   - Every 5 min: Check order status
   - Update positions in DB
   - On TP/SL hit: Close & log realized_pnl
   - Sync capital from Kraken
   - Update performance metrics

4. User monitors via UI:
   - Real-time position list
   - Capital balance (synced)
   - Order history
   - Profit/loss dashboard
```

### Risk in Phase 4

```
Multiple safety layers:

1. Position Size Limit:
   - Max capital at risk per trade: 2% (configurable)
   - Max total portfolio risk: 10%
   - Max number of open positions: 3-5

2. Market Conditions:
   - Auto-trading disabled if market VI < 0.3 (dead market)
   - Disabled if BTC dominance < 20% (chaos)
   - Manual override always available

3. Capital Sync:
   - Every 5 min sync with Kraken
   - If balance differs from expected → ALERT
   - Prevents over-leveraging

4. Monitoring:
   - All trades logged with timestamps
   - Slippage tracked
   - Fills monitored
   - Errors logged + alerted

5. User Controls:
   - Instant on/off button
   - Per-pair enable/disable
   - Risk limit adjustment in real-time
   - Manual trade override anytime
```

---

## 📅 Scheduling System (All Phases)

### Celery Beat Configuration

```
# celery_config.py
app.conf.beat_schedule = {
    # Phase 2+
    'calculate-volatility': {
        'task': 'tasks.volatility.calculate_all_pairs',
        'schedule': crontab(minute='*/15'),  # Every 15 min
    },
    'generate-watchlists': {
        'task': 'tasks.watchlist.generate_all_styles',
        'schedule': {
            'weekly': crontab(day_of_week=0, hour=1, minute=2),
            'daily': crontab(hour=0, minute=5),
            '4h': crontab(hour='*/4'),
            'hourly': crontab(minute=5),
        }
    },
    
    # Phase 4
    'sync-capital': {
        'task': 'tasks.automation.sync_kraken_balance',
        'schedule': crontab(minute='*/5'),  # Every 5 min
    },
    'check-auto-trade-signals': {
        'task': 'tasks.automation.check_trading_signals',
        'schedule': crontab(minute='*/15'),  # Every 15 min
    },
    'manage-positions': {
        'task': 'tasks.automation.manage_open_positions',
        'schedule': crontab(minute='*/5'),
    },
}
```

### UI: Task Scheduler

```
/settings/scheduler
├─ Task list:
│   ├─ Calculate Volatility
│   │   └─ Frequency: [every 15 min] [Status: ● Running]
│   │   └─ Last run: 14:30 UTC (0 errors)
│   │   └─ Next run: 14:45 UTC
│   │
│   ├─ Generate Watchlists
│   │   ├─ Weekly: Monday 01:02 [Status: ● Enabled]
│   │   ├─ Daily: 00:05 [Status: ● Enabled]
│   │   ├─ 4H: Every 4h [Status: ○ Disabled]
│   │   └─ Hourly: :05 [Status: ○ Disabled]
│   │
│   ├─ Sync Capital (Phase 4)
│   │   └─ Frequency: [every 5 min] [Status: ● Running]
│   │
│   ├─ Auto-Trading Signals (Phase 4)
│   │   └─ Frequency: [every 15 min] [Status: ○ Disabled]
│   │   └─ ⚠️ REAL MONEY
│   │
│   └─ Position Management (Phase 4)
│       └─ Frequency: [every 5 min] [Status: ○ Disabled]
│
├─ Job History
│   ├─ Filter: [Last 24h]
│   ├─ Task / Status / Duration / Errors / Timestamp
│   └─ [Download logs]
│
└─ System Status
    ├─ Celery worker: ● Connected
    ├─ Redis: ● Connected
    ├─ DB: ● Connected
    └─ Last DB backup: 2 hours ago
```

---

## 🔌 API Integration Points

### Phase 1
- ✅ Manual data entry only
- ❌ No external APIs

### Phase 2
- **Kraken (Market Data):**
  - GET /markets/ticker (OHLCV)
  
- **Binance (Market Data):**
  - GET /klines (OHLCV)

### Phase 4 (Auto-Trading & Capital Sync)
- **Kraken (Execution & Capital):**
  - GET /markets/ticker (OHLCV)
  - GET /users/balances (capital sync every 5 min)
  - POST /orders/create (open)
  - DELETE /orders/{id} (cancel)
  - PATCH /orders/{id} (adjust)
  - GET /orders (monitor)
  
- **Binance (Data only):**
  - GET /klines (OHLCV)
  
- **Telegram (Notifications):**
  - POST /sendMessage
```

---

## 🔐 Security Considerations

```
API Keys:
├─ Stored encrypted in settings table
├─ Never logged or exposed in errors
├─ Kraken: READ + TRADING permissions only
└─ Telegram: Token in environment

WebSocket:
├─ Authenticated connections only
├─ User can only see own data
└─ Rate limited

Auto-Trading:
├─ Manual approval for first trade
├─ Risk limits enforced server-side
├─ All trades logged with user ID
└─ Audit trail available
```

---

**This operational architecture enables:**

✅ Clean Phase 1 MVP (risk + journal)  
✅ Smooth Phase 2 integration (volatility)  
✅ Simple Phase 3 addition (watchlists)  
✅ Safe Phase 4 implementation (auto-trading)  
✅ Scalable scheduling system  
✅ Real-time updates via WebSocket  
✅ Secure API integrations
