# 📐 Phase 1 — Pre-Implementation Scope

**Date:** March 1, 2026  
**Version:** 2.7 (Economic Calendar — Feature 3b: weekly events, trade form warnings)  
**Status:** ✅ Validated — ready for implementation

> This is the final reference document for Phase 1.  
> See `implement-phase1.md` for the implementation plan.  
> See `post-implement-phase1.md` for what comes after.  
> See `SERVER_SETUP.md` for Ubuntu Server install + IP fixe + Docker + CI/CD.

> **📐 Architecture Diagrams:** [`/docs/architecture/diagrams/`](../../../architecture/diagrams/README.md) — system layout, feature data flow, and DB schema in Mermaid.

---

## 🎯 Phase 1 Feature List

```
1. Risk Management & Trade Journal    ← original
2. Goals & Risk Limits System         ← NEW (Feature 1)
3. Broker / Instrument Config         ← NEW (Feature 2)
4. Market Analysis Module             ← NEW (Feature 3)
   └─ 4b. Economic Calendar           ← NEW (Feature 3b — part of analysis)
5. News Intelligence Integration      ← NEW (Feature 4)
```

---

## 🧩 Feature 1 — Goals & Risk Limits

### Concept

Per-profile, per-style goals and hard stop limits.  
**Fully configurable from the UI** — no JSON editing, no code changes.

```
Profile
└─ Style: Swing
   └─ Weekly goal:  +2%   (make $200 on a $10,000 account)
   └─ Weekly limit: -1.5% (stop if -$150 this week)

Style = scalping / day_trading / swing / position
Period = daily / weekly / monthly
```

Each style has its **own relevant periods**. The blocking logic only applies to  
**the periods that are active / configured for that style**:

```
Swing trader:
  → Daily limit NOT enforced  ← a swing trade can easily be -1% intraday, that's normal
  → Weekly limit IS enforced  ← that's the meaningful guardrail for swing
  → Monthly limit IS enforced

Scalper:
  → Daily limit IS enforced   ← lose $X today → stop
  → Weekly + Monthly also enforced

Position trader:
  → Daily limit NOT enforced
  → Weekly limit NOT enforced (optional)
  → Monthly limit IS enforced ← only meaningful period

Rule: a period is only enforced if its goal/limit is configured (> 0) in settings.
If a period is left at 0 or disabled → no bar shown, no block.
```

### Data Model

```
trading_styles        ← config table: scalping, day_trading, swing, position
profile_goals         ← goals per profile + style + period
goal_progress_log     ← computed daily snapshots (for history)
```

### Goal Logic

```
Base goal (configured by user):
  weekly profit target: +2%

Phase 1: fixed
  actual_goal = base_goal

Phase 2+: adjusted by market volatility
  if market_vi == 'high_risk':
    actual_goal = base_goal × 0.7    (reduce target in turbulent market)
  if market_vi == 'optimal':
    actual_goal = base_goal × 1.2    (can push harder)
```

### Goal & Period Persistence

```
Dashboard widget remembers last selected style + period per profile.
Stored in: user_preferences table (profile_id → last_style, last_period)
So next visit: "Swing / Weekly" is pre-selected, no need to re-choose each time.

goal_progress_log is populated:
- On each trade close (auto-computed)
- Daily at midnight via a lightweight background job (Phase 2+) 
  or on page load (Phase 1: computed on-the-fly from closed trades)
```

### Risk Limit Logic

```
Blocking is style-aware — only active periods trigger a block:

SCALPING (all 3 periods active):
  daily_limit -0.7%  → if today's PnL ≤ -0.7%  → 🛑 BLOCKED
  weekly_limit -2%   → if week's PnL  ≤ -2%    → 🛑 BLOCKED
  monthly_limit -5%  → if month's PnL ≤ -5%    → 🛑 BLOCKED

DAY TRADING (all 3 periods active):
  daily_limit -1.5%  → 🛑 BLOCKED
  weekly_limit -4%   → 🛑 BLOCKED
  monthly_limit -8%  → 🛑 BLOCKED

SWING (weekly + monthly only — daily NOT enforced):
  daily_limit        → NOT enforced (normal to be -1% intraday on a swing)
  weekly_limit -1.5% → if week's PnL ≤ -1.5% → 🛑 BLOCKED
  monthly_limit -4%  → if month's PnL ≤ -4%  → 🛑 BLOCKED

POSITION (monthly only):
  daily_limit        → NOT enforced
  weekly_limit       → NOT enforced (or optional light warning only)
  monthly_limit -3%  → if month's PnL ≤ -3%  → 🛑 BLOCKED

→ "Active periods" = those with a limit value > 0 in /settings/goals
→ User can always override blocked state with a manual confirmation click
  (anti-revenge-trade friction, not a hard technical lock)

UI:
├─ Progress bar (goal):  0% → 100% (green → darker green)
├─ Risk bar (limit):     0% → 100% (yellow → red)
│   ├─ 0–50%:   🟢 safe
│   ├─ 50–80%:  🟡 warning
│   ├─ 80–100%: 🟠 danger
│   └─ 100%+:   🛑 BLOCKED — "You've hit your weekly limit"
└─ Override button:  "I understand — let me trade anyway" (logs the override)
```

### UI Components

```
/dashboard
└─ Goals widget (top section, always visible):
   ├─ Style selector: [Scalping | Day | Swing | Position]  ← persisted per profile
   │
   ├─ DAILY row:
   │   ├─ Goal bar:  PnL $40 / Goal $80    [████░░░░░░ 50%] ✅ ON TRACK
   │   └─ Risk bar:  Loss $15 / Limit $60  [██░░░░░░░░ 25%]
   │
   ├─ WEEKLY row:
   │   ├─ Goal bar:  PnL $120 / Goal $200  [████████░░ 60%] ✅ ON TRACK
   │   └─ Risk bar:  Loss $30 / Limit $100 [███░░░░░░░ 30%]
   │
   └─ MONTHLY row:
       ├─ Goal bar:  PnL $300 / Goal $500  [██████░░░░ 60%] ✅ ON TRACK
       └─ Risk bar:  Loss $80 / Limit $250 [███░░░░░░░ 32%]

→ All 3 periods ALWAYS shown simultaneously — no period selector needed.
→ Status badge per row: ✅ ON TRACK / ⚠️ WARNING (>80% risk) / 🛑 BLOCKED (limit hit)
→ Style selector is persisted: last used style pre-selected on next visit.

IMPORTANT — No false positives on Daily:
  - If no trades today → Daily row shows: "— No trades today" (grey, no bar)
  - Daily bar only appears when at least 1 trade was opened today
  - Same for Weekly: shows "— No trades this week" if nothing yet
  - Goal bars show 0% only if trades were taken and result is 0, not by default

/settings/goals
└─ Per profile × per style configuration:
   ├─ Style: Scalping
   │   ├─ Daily goal   +1%  |  Daily limit   -0.7%
   │   ├─ Weekly goal  +4%  |  Weekly limit  -2%
   │   └─ Monthly goal +12% |  Monthly limit -5%
   ├─ Style: Day Trading
   │   ├─ Daily goal   +2%  |  Daily limit   -1.5%
   │   ├─ Weekly goal  +6%  |  Weekly limit  -4%
   │   └─ Monthly goal +15% |  Monthly limit -8%
   ├─ Style: Swing
   │   ├─ Daily goal   +0.5%|  Daily limit   -0.5%
   │   ├─ Weekly goal  +2%  |  Weekly limit  -1.5%   ← primary period for swing
   │   └─ Monthly goal +6%  |  Monthly limit -4%
   └─ Style: Position
       ├─ Daily goal   n/a  |  Daily limit   -1%
       ├─ Weekly goal  +1%  |  Weekly limit  -2%
       └─ Monthly goal +5%  |  Monthly limit -3%     ← primary period for position

→ All values editable per profile in UI (% of account capital).
→ Persisted in DB: profile_goals table (profile_id + style + period → goal + limit).
→ A period can be disabled (set to 0 or toggle OFF) — bar hidden when disabled.
```

---

## 🧩 Feature 2 — Broker / Instrument Configuration

### Concept

Replace hardcoded pair lists with a configurable instrument catalog:
- **Brokers** table: predefined (Kraken, Vantage, Binance...) + "Add custom"
- **Instruments** table: per broker, with tick/pip size, asset class, base currency
- **Profile** linked to a broker → drives available instruments in trade form

### Data Model

```
brokers           ← config table (predefined + custom)
instruments       ← config table per broker (predefined + custom)
```

### Broker Predefined List

```
Crypto:
└─ Kraken    (market_type: Crypto Perps, currency: USD)
             ← USD only for Phase 1. EUR pairs & BTC crosses = out of scope.
             ← Spot = out of scope for now (added later for HTF investing)

CFD:
└─ Vantage   (market_type: CFD, currency: USD / EUR)
             ← IC Markets can be added later as a custom broker by the user

+ "Add custom broker..." option in settings
```

### Account Type (CFD — Vantage)

```
Vantage has 2 account types that affect spread and fees:

Standard Account:
  → Spread built into the price (wider spread, no commission)
  → Easier to start with

Raw Account (ECN):
  → Tight/raw spread + fixed commission per lot ($3.50/lot typical)
  → Lower effective cost for active traders

Decision for Phase 1: store account_type per broker profile (Standard / Raw)
  → Spread field in trade form pre-filled differently based on account type
  → Commission field shown for Raw accounts
  → No need to maintain two instrument tables — just adjust the defaults
```

### Instrument / Asset Class

```
Two distinct calculation models (by broker type):

CFD Brokers (Vantage, IC Markets):
  → pip_size + tick_value → lot size formula
  → Standard forex/commodity calculation

Crypto Exchanges (Kraken, Binance, Bybit):
  → No pips concept
  → Trade in UNITS (e.g., 0.001 BTC)
  → Risk calc: risk_amount / (entry_price - stop_loss) = units to buy
  → price_decimals field for display formatting only

Each instrument record:
├─ symbol             'XAUUSD', 'BTC/USD', 'EUR/USD'
├─ display_name       'Gold', 'Bitcoin', 'Euro/Dollar'
├─ asset_class        'Commodities' | 'Crypto' | 'Forex' | 'Indices'
├─ broker_id          FK → brokers
├─ broker_type        'cfd' | 'crypto_exchange'   ← drives calculation model
├─ pip_size           (CFD only) e.g. 0.0001, 0.1
├─ tick_value         (CFD only) dollar value per pip per standard lot
├─ price_decimals     (Crypto) nb of decimals for price display
├─ min_order_qty      (Crypto) minimum order size in base asset
├─ currency           'USD', 'EUR', 'USDT'
└─ is_custom          false = pre-seeded | true = user-added
```

### Pre-Seeded Instrument Catalog

> ⚠️ **Kraken = Perpetual Futures only** (Phase 1). Spot = future scope.  
> Kraken perp symbol format: `PF_XBTUSD` (BTC uses XBT internally).  
> All perp symbols verified against Kraken Futures API.

#### Kraken — Perpetual Futures (USD, ~50 pairs)

```
Display name format: "Name (TICKER)" — e.g. "Polygon (MATIC)", "Bitcoin (XBT)"
Currency column always present for scalability (other currencies may be added later).

Symbol          Display Name              Type   CCY   Asset Class
──────────────────────────────────────────────────────────────────
PF_XBTUSD       Bitcoin (BTC)             Perp   USD   Crypto
PF_ETHUSD       Ethereum (ETH)            Perp   USD   Crypto
PF_SOLUSD       Solana (SOL)              Perp   USD   Crypto
PF_XRPUSD       Ripple (XRP)              Perp   USD   Crypto
PF_ADAUSD       Cardano (ADA)             Perp   USD   Crypto
PF_DOTUSD       Polkadot (DOT)            Perp   USD   Crypto
PF_LINKUSD      Chainlink (LINK)          Perp   USD   Crypto
PF_AVAXUSD      Avalanche (AVAX)          Perp   USD   Crypto
PF_MATICUSD     Polygon (MATIC)           Perp   USD   Crypto
PF_ATOMUSD      Cosmos (ATOM)             Perp   USD   Crypto
PF_UNIUSD       Uniswap (UNI)             Perp   USD   Crypto
PF_NEARUSD      Near Protocol (NEAR)      Perp   USD   Crypto
PF_APTUSD       Aptos (APT)               Perp   USD   Crypto
PF_ARBUSD       Arbitrum (ARB)            Perp   USD   Crypto
PF_OPUSD        Optimism (OP)             Perp   USD   Crypto
PF_INJUSD       Injective (INJ)           Perp   USD   Crypto
PF_SUIUSD       Sui (SUI)                 Perp   USD   Crypto
PF_TRXUSD       TRON (TRX)                Perp   USD   Crypto
PF_TONUSD       Toncoin (TON)             Perp   USD   Crypto
PF_DOGEUSD      Dogecoin (DOGE)           Perp   USD   Crypto
PF_SHIBUSDT     Shiba Inu (SHIB)          Perp   USD   Crypto
PF_PEPEUSD      Pepe (PEPE)               Perp   USD   Crypto
PF_WIFUSD       dogwifhat (WIF)           Perp   USD   Crypto
PF_BONKUSD      BONK (BONK)               Perp   USD   Crypto
PF_AAVEUSD      Aave (AAVE)               Perp   USD   Crypto
PF_MKRUSD       Maker (MKR)               Perp   USD   Crypto
PF_SNXUSD       Synthetix (SNX)           Perp   USD   Crypto
PF_CROUSD       Cronos (CRO)              Perp   USD   Crypto
PF_FTMUSD       Fantom (FTM)              Perp   USD   Crypto
PF_ALGOUSD      Algorand (ALGO)           Perp   USD   Crypto
PF_ICPUSD       Internet Computer (ICP)   Perp   USD   Crypto
PF_FILUSD       Filecoin (FIL)            Perp   USD   Crypto
PF_LDOUSD       Lido DAO (LDO)            Perp   USD   Crypto
PF_RNDRUSD      Render (RNDR)             Perp   USD   Crypto
PF_FETUSD       Fetch.ai (FET)            Perp   USD   Crypto
PF_TIAUSD       Celestia (TIA)            Perp   USD   Crypto
PF_STXUSD       Stacks (STX)              Perp   USD   Crypto
PF_JUPUSD       Jupiter (JUP)             Perp   USD   Crypto
PF_PENGUUSD     Pudgy Penguins (PENGU)    Perp   USD   Crypto
PF_ENAUSD       Ethena (ENA)              Perp   USD   Crypto
PF_HYPEUSD      Hyperliquid (HYPE)        Perp   USD   Crypto
PF_MOVEUSDT     Movement (MOVE)           Perp   USD   Crypto
PF_AI16ZUSD     ai16z (AI16Z)             Perp   USD   Crypto
PF_VIRTUALUSD   Virtuals Protocol (VIRT)  Perp   USD   Crypto
PF_WLDUSD       Worldcoin (WLD)           Perp   USD   Crypto
PF_JTOUSD       Jito (JTO)                Perp   USD   Crypto
PF_PYTHUSD      Pyth Network (PYTH)       Perp   USD   Crypto
PF_ONDOUSD      Ondo Finance (ONDO)       Perp   USD   Crypto
PF_TAOUSD       Bittensor (TAO)           Perp   USD   Crypto
PF_EIGENUSDT    Eigenlayer (EIGEN)        Perp   USD   Crypto

Note: Kraken uses XBT internally for BTC (PF_XBTUSD not PF_BTCUSD).
List is indicative — some pairs may not be available on all Kraken Futures regions.
User can always add custom instruments.
```

#### Vantage — CFD (USD/EUR account, Standard & Raw)

```
Symbol     Display Name        Pip Size   Tick Value*   Asset Class   Session
───────────────────────────────────────────────────────────────────────────────
XAUUSD     Gold                0.01       $1.00/pip     Commodities   All
XAGUSD     Silver              0.001      $5.00/pip     Commodities   All
XTIUSD     WTI Crude Oil       0.01       $1.00/pip     Commodities   US+EU
XBRUSD     Brent Crude Oil     0.01       $1.00/pip     Commodities   EU+US

BTCUSD     Bitcoin CFD         1.0        $1.00/pip     Crypto        All
ETHUSD     Ethereum CFD        0.1        $1.00/pip     Crypto        All

EURUSD     Euro / Dollar       0.0001     $10.00/pip    Forex         EU+US
GBPUSD     Pound / Dollar      0.0001     $10.00/pip    Forex         EU+US
USDJPY     Dollar / Yen        0.01       $9.10/pip     Forex         Asia+EU+US
USDCHF     Dollar / Franc      0.0001     $10.00/pip    Forex         EU+US
AUDUSD     Aussie / Dollar     0.0001     $10.00/pip    Forex         Asia+EU+US
USDCAD     Dollar / Cad        0.0001     $7.70/pip     Forex         EU+US
NZDUSD     Kiwi / Dollar       0.0001     $10.00/pip    Forex         Asia+EU+US
GBPJPY     Pound / Yen         0.01       $9.10/pip     Forex         EU+US
EURJPY     Euro / Yen          0.01       $9.10/pip     Forex         EU+US
EURGBP     Euro / Pound        0.0001     $13.00/pip    Forex         EU

US500      S&P 500 CFD         0.1        $1.00/pip     Indices       US
US100      Nasdaq 100 CFD      0.1        $1.00/pip     Indices       US
DJ30       Dow Jones CFD       1.0        $1.00/pip     Indices       US
GER40      DAX 40 CFD          0.1        $1.00/pip     Indices       EU
UK100      FTSE 100 CFD        0.1        $0.77/pip     Indices       EU

ZECUSD     Zcash CFD           0.1        $1.00/pip     Crypto        All

* Tick value per standard lot. Raw account adds ~$3.50 commission/lot round trip.
  Vantage symbol names verified against MT4/MT5 and Vantage web platform (early 2026).
  DJ30 may appear as US30 on some platforms — add both as aliases.
```

### Trading Sessions (CFD Dashboard Widget)

```
Sessions are displayed as a live widget on the dashboard (CFD profiles only):

┌─ Sessions ───────────────────────────────────────────────────┐
│  🌏 Asia       00:00–09:00 UTC   [CLOSED]                    │
│  🌍 London     08:00–17:00 UTC   [OPEN ●]                    │
│  🌎 New York   13:00–22:00 UTC   [OPEN ●]                    │
│  📈 NYSE open  14:30 UTC         [equities/indices open]     │
│  ⚡ Overlap    13:00–17:00 UTC   [ACTIVE — peak liquidity]   │
└──────────────────────────────────────────────────────────────┘

→ Widget updates live (based on current UTC time)
→ Shows which sessions are open right now
→ Overlap London/NY = highest forex/commodities liquidity = highlighted
→ NYSE open at 14:30 UTC = separate marker for equities/indices volatility spike

Session definition — stored in DB (UTC, never hardcoded):

  sessions table:
  ┌───────────┬──────────────┬───────────┬──────────────────────────────────────────────┐
  │ name      │ start_utc    │ end_utc   │ note                                         │
  ├───────────┼──────────────┼───────────┼──────────────────────────────────────────────┤
  │ Asia      │ 00:00        │ 09:00     │ Tokyo/Sydney — JPY, AUD, NZD most active     │
  │ London    │ 08:00        │ 17:00     │ EUR, GBP most active. Sets daily direction.  │
  │ New York  │ 13:00        │ 22:00     │ Forex opens. USD pairs most active.          │
  │ NYSE Open │ 14:30        │ 14:30     │ Point event — equities/indices spike         │
  │ Overlap   │ 13:00        │ 17:00     │ London + NY simultaneous — peak liquidity    │
  └───────────┴──────────────┴───────────┴──────────────────────────────────────────────┘

  Modifiable in /settings/sessions if market hours change (rare).

⚠️ Clarification — NY session vs NYSE open:
  NY Forex session:  13:00 UTC (8:00 ET) — banks, FX flows, USD data begin
  NYSE stock open:   14:30 UTC (9:30 ET) — equities and indices become volatile
  → In Paris (UTC+1 winter): NY forex = 14h00, NYSE = 15h30 ← this is what you see!
  → In Paris (UTC+2 summer): NY forex = 15h00, NYSE = 16h30
  → The "15h30" you know = NYSE equities open = 14:30 UTC = UTC+1 CET display

Timezone handling (backend):
  - All session times stored in UTC.
  - Frontend sends its local timezone (e.g. "Europe/Paris") at login → stored in
    user_preferences.timezone.
  - Backend converts current UTC time to local time for display ONLY.
  - All trade timestamps stored in UTC in DB — no ambiguity.
  - DST handled automatically by the tz library (pytz / zoneinfo):
      e.g. "Europe/Paris" = UTC+1 winter (CET), UTC+2 summer (CEST) → auto-adjusted.
  - When user changes location or DST kicks in → no action needed, auto-correct.
  - Session auto-tag on trade entry: computed in UTC, displayed in local time.

On trades: session auto-tagged at entry UTC time (Asia / London / New York / Overlap).
Shown in trade journal — useful for performance analysis by session later.
No manual input required from user.
```

### Instrument Selection UX (Trade Form)

```
Instrument dropdown in trade form:
├─ 🔍 Search bar     ← type "BTC" or "Gold" or "EUR" — instant filter
├─ ⭐ Favourites     ← pin up to 5 instruments per broker (configurable per profile)
│     e.g. Kraken favourites: BTC, ETH, SOL, LINK, INJ
│     e.g. Vantage favourites: XAUUSD, EURUSD, US100, GER40, GBPUSD
├─ Recent            ← last 5 traded instruments (auto)
└─ All instruments   ← grouped by asset class (Crypto / Forex / Indices / Commodities)

Favourites managed in /settings/instruments:
  "Mark as favourite" toggle per instrument, max 5 per broker.
  Shown at top of dropdown with ⭐ prefix.
```

### Trade Form Enhancements

```
Trade form — designed for speed, minimal friction:

Core fields (always visible):
├─ Profile*          ← auto-selected from last used, switchable
├─ Instrument*       ← searchable dropdown (filtered by broker) + "Add custom pair"
├─ Direction*        ← [🟢 LONG] [🔴 SHORT]  ← big buttons, can't miss
├─ Order type*       ← [MARKET] [LIMIT]
│                       Market → entry price auto-filled with current price (editable)
│                       Limit  → entry price field mandatory + status = PENDING
├─ Entry price*      ← pre-filled if Market, manual if Limit
├─ Stop loss*        ← manual input
├─ Take profits*     ← TP1 (mandatory) | TP2 | TP3 (optional)
│                       Each TP: price + % of position to close
│
│                       TP Profit Preview (shown live as user fills TPs):
│                       ┌─────────────────────────────────────────────────┐
│                       │  TP1  50% @ $95,000  → +$125  (1.5R)           │
│                       │  TP2  30% @ $98,000  → +$90   (2.5R)  (if set) │
│                       │  TP3  20% @ $102,000 → +$75   (3.5R)  (if set) │
│                       │  ─────────────────────────────────────────────  │
│                       │  Max profit (all TPs hit): +$290               │
│                       │  Min profit (TP1 only):    +$125               │
│                       └─────────────────────────────────────────────────┘
│                       → Updates live as prices and % allocation are typed
│                       → Sum of % must = 100% (warning if not)
│                       → Shown as $ amount + R multiple (vs initial risk)
├─ Strategy          ← dropdown (from profile strategies)
└─ Analyzed TF       ← configurable dropdown list (default: 15m | 1h | 4h | 1d | 1w)
                        User can configure which TFs appear in /settings/preferences
                        (reorder, hide, add custom — e.g. "2h", "3d")

Auto-calculated (shown live, no input needed):
├─ Risk amount       ← capital × risk% (risk% from profile, EDITABLE inline)
├─ Position size     ← for crypto: risk / (entry - SL) in base units
│                       for CFD: risk / ((entry - SL) × tick_value) in lots
├─ Leverage          ← CRYPTO ONLY: calculated = entry_price × units / margin_used
│                       Shown as calculated value, but EDITABLE by user
│                       If user changes leverage → margin recalculates accordingly
│                       Max leverage cap per category (Kraken perps):
│                         BTC, ETH:          max 50× (typical retail: 1–20×)
│                         Large caps (SOL, XRP, ADA, AVAX...): max 25×
│                         Mid/small caps (most others): max 10×
│                         Meme coins (DOGE, SHIB, PEPE, WIF...): max 5×
│                       Cap stored per instrument in DB — enforced with ⚠️ warning
│                       (not a hard block, user can override)
├─ R:R ratio         ← auto from TP1 vs SL
└─ Margin req.       ← Crypto: position_value / leverage (shown, no alert needed)
                        CFD: standard margin formula + ⚠️ if < 2.5× liq margin

Optional fields (collapsed by default, one click to expand):
├─ Confidence        ← slider 0–100%
├─ Spread            ← pre-filled from instrument, editable
├─ Estimated fees    ← auto-calc from broker config
└─ Tags              ← multi-select

Market Analysis badge (injected above form if analysis exists):
  "📊 Crypto: 🔴 BEARISH (38%) — Shorts favored, risk adjusted"
  → risk% already adjusted, shown live
```

### Close / Partial Close / Move to BE

```
Close form (opened from trade detail or trade list):
├─ Close type:   [FULL CLOSE] [PARTIAL — TP1] [PARTIAL — TP2] [CUSTOM %]
├─ Exit price*   ← manual input (required)
├─ Realized PnL  ← pre-filled by backend (entry-exit × size), EDITABLE
│                   (broker may show slightly different value due to fees)
└─ Notes         ← optional quick note

On Partial Close (e.g., TP1 hit):
  → Closed qty reduced from position
  → Remaining position stays OPEN
  → User prompted: "Move SL to breakeven?" [Yes] [No, keep current]
  → If YES → same logic as standalone BE action (see below)
  → Remaining TPs still active

Move to Breakeven (standalone action — no partial close needed):
  Available directly on:
  ├─ Trade detail page:  [⚡ Move SL to BE] button — always visible on open trades
  └─ Trade list (quick action):  right-click / swipe → "Move to BE"

  Action:
    1. SL updated to entry_price in DB
    2. current_risk recalculated → $0 (no loss possible if stopped out)
    3. Risk available on dashboard restored immediately
    4. Goals risk bars updated
    5. Log entry: "SL moved to BE at [timestamp]"

  Display after BE:
    Trade card shows: 🛡️ BE — risk $0
    Risk bar on dashboard shows this trade as "locked / free"

  Rules:
    → Only available when trade is OPEN and SL ≠ entry_price
    → If price is already at or below entry (for longs), BE button is greyed out
      with tooltip: "Price must be above entry to move SL to BE without locking in a loss"
    → No confirmation dialog needed — action is fast and reversible
      (user can manually edit SL back afterward if needed)
```

### Live Risk Tracking (across all open positions)

```
Risk available is tracked LIVE across all open positions.
Visible on dashboard and in the trade form when opening a new trade.

Dashboard risk summary:
  Account capital:     $10,000
  Risk per trade:      1% = $100

  Open positions:
  ├─ BTC/USD LONG    risk: $100  (SL not at BE)
  ├─ ETH/USD LONG    risk: $0    (SL moved to BE)
  └─ SOL/USD SHORT   risk: $60   (partial close done)

  Total risk committed: $160 / $200 max (2%)
  Available risk:       $40  (0.4% remaining)

  ⚠️ If new trade would exceed available risk:
    → Warning shown in trade form: "Opening this trade would commit $100.
       You only have $40 risk available. Existing positions:
       - BTC/USD LONG ($100) — move to BE to free $100
       - SOL/USD SHORT ($60) — partial close TP1 to reduce risk"
    → User can still proceed (nudge, not a block)
    → Or user can act: close a position, move SL to BE, reduce size

Logic:
  available_risk = max_risk_amount - sum(current_risk for all OPEN trades)
  current_risk per trade:
    - If SL = entry (BE):    risk = $0
    - If partial close done: risk = remaining_qty × (entry - current_SL) × tick/unit
    - If untouched:          risk = original_risk_amount

  max_risk_amount = capital × max_concurrent_risk_pct (configurable per profile)
  Example: capital $10,000 × 2% = $200 max concurrent risk

  Configurable in /settings/profiles:
    max_concurrent_risk_pct (default: 2%)
    → "Total risk across all open positions cannot exceed X% of capital"
```

### Margin Safety Rule

```
Margin safety check (CFD/Leverage — visual alert only, no block):
  liquidation_margin = position_value / max_leverage
  safe_margin        = liquidation_margin × 2.5

  if account_margin < safe_margin:
    → ⚠️ "Margin low — less than 2.5× liquidation buffer. Reduce size or add funds."

Rationale: 2.5× buffer means a 60% adverse move against the liquidation price
before actual liquidation — enough headroom for volatility spikes without margin call.
User can always proceed (advisory, not hard block).
```

### Structured Notes with Templates

```
After trade close, user fills structured post-trade notes:
├─ What went well?
├─ What went wrong?
├─ Followed the plan? (Yes / Partially / No)
├─ Emotional state: (Calm / Anxious / FOMO / Revenge)
├─ Would I take this again? (Yes / No)
└─ Free notes

Template stored in DB table: note_templates
Can be customized per profile.
Results stored in trade.structured_notes (JSONB)
```

---

## 🧩 Feature 3 — Market Analysis Module

### Concept

A weekly (or on-demand) questionnaire-based analysis to score market bias (bullish/bearish).  
Done in under 10 minutes by looking at TradingView charts.  
Result feeds into risk decisions (adjust trade size, enable/block trading).

### Key Principles

- **Visual** → User opens TradingView, reads chart, selects one answer per question
- **Fast** → < 10 min total (5–7 questions per module)
- **Guided** → Each question has a short "how to read this" tooltip/description
- **Configurable** → Each indicator can be toggled ON/OFF per profile in Settings
- **Dynamic scoring** → `score% = points_obtained / max_possible × 100`
  → Toggle a question → max recalculates automatically → thresholds stay valid
- **History** → Every session saved, sparkline trend visible over time

### Scoring System

```
Each question has 3 answer options:
  🟢 YES / Bullish  → +2 pts
  🟡 PARTIAL / Mixed → +1 pt
  🔴 NO / Bearish   →  0 pts

score% = (sum / (active_questions × 2)) × 100

Thresholds (same across ALL modules — configurable in settings):
  > 60%  → 🟢 BULLISH BIAS
  40–60% → 🟡 NEUTRAL
  < 40%  → 🔴 BEARISH BIAS
```

### Impact on Risk

```
BULLISH BIAS:
  → Longs:  risk% × 1.20  (+20%)  ← favored
  → Shorts: risk% × 0.70  (-30%)  ← discouraged

NEUTRAL:
  → No adjustment

BEARISH BIAS:
  → Shorts: risk% × 1.20  (+20%)  ← favored
  → Longs:  risk% × 0.70  (-30%)  ← discouraged

→ Badge shown in trade form: "🔴 Bearish bias — Shorts +20%, Longs -30%"
→ Risk% adjusts live when direction is toggled
→ Visual nudge only — user can always override
→ Multipliers configurable in /settings/market-analysis
```

---

### Module 1 — Crypto (BTC + Alts)

**When to run:** Weekly (Sunday/Monday) or before a significant trade  
**Time needed:** ~15–20 min  
**Timeframes:** HTF (1W + 1D) + MTF (4H) + LTF (1H / 15min)  
**⚠️ Staleness warning:** Banner shown if HTF last analysis > 7 days old

> This module produces **2 × 3 scores** — BTC and Alts, each scored across 3 TF levels.
>
> The 3 TF scores tell you **what type of trade you can consider right now**:
> - All 3 green → any style valid (swing, day trade, scalp all aligned)
> - HTF + MTF green, LTF red → swing/position OK — wait for 1H/15min entry
> - HTF green only → structural bias only, no active 4H setup yet
> - All red → no longs — shorts always valid in any direction

#### Timeframe definitions (for this module)

```
HTF — High Time Frame:   1W + 1D
  → Macro + tactical structure. "Which direction does the market want to go?"
  → 1W = long-term direction (rarely reverses mid-week)
  → 1D = swing confirmation ("is the trend active on the timeframe most traders watch?")
  → Checked once a week. Drives swing + position trades.

MTF — Mid Time Frame:    4H
  → Active setup context. "Is an entry structure forming?"
  → Drives day trades. Changes every few hours — re-check each session.
  → ⚠️ Re-check 4H before each trading session.

LTF — Low Time Frame:    1H / 15min
  → Precise entry timing. "Where exactly do I enter right now?"
  → For scalping and tight day trade entries.
  → No dedicated question yet (Phase 1). Informational only — answered live on the chart.
  → ⚠️ LTF has no score in Phase 1. Used for manual entry confirmation only.

Staleness:
  HTF: valid for 7 days (staleness warning if not refreshed)
  MTF: always shows "⚠️ Re-check 4H before trading" — answered fresh each session
  LTF: not tracked in the app — checked manually on chart before entry
```

#### Indicators used

| # | What to open | Ticker | TF | Default | Affects |
|---|---|---|---|---|---|
| 1 | BTC Price | `BTCUSDT` | 1W | ✅ ON | BTC HTF (1W) |
| 2 | Total Market Cap | `CRYPTOCAP:TOTAL` | 1W | ✅ ON | BTC HTF (1W) |
| 3 | Tether Dominance | `CRYPTOCAP:USDT.D` | 1W | ✅ ON | BTC HTF (1W) |
| 4 | BTC Price | `BTCUSDT` | 1D | ✅ ON | BTC HTF (1D) |
| 5 | BTC Price | `BTCUSDT` | 4H | ✅ ON | BTC MTF |
| 6 | BTC Dominance | `CRYPTOCAP:BTC.D` | 1W | ✅ ON | Alts HTF (1W) |
| 7 | ETH/BTC Ratio | `ETHBTC` | 1W | ✅ ON | Alts HTF (1W) |
| 8 | Total2 (alts ex-BTC) | `CRYPTOCAP:TOTAL2` | 1W | ✅ ON | Alts HTF (1W) |
| 9 | ETH/BTC Ratio | `ETHBTC` | 1D | ✅ ON | Alts HTF (1D) |
| 10 | ETH Price | `ETHUSD` | 4H | ✅ ON | Alts MTF |
| 11 | Others (small alts) | `CRYPTOCAP:OTHERS` | 1W | ☐ OFF | Alts HTF (1W) |

#### Questions

```
═══ SCORE A: BTC ════════════════════════════════════════════════════

── A-HTF (1W) — Macro structure ─────────────────────────────────

Q1 — BTCUSDT (1W)
  "Is BTC in a clear weekly uptrend — higher highs and higher lows?"
  📖 Weekly chart: last 2–3 swing lows higher? Price above 20W/50W MA?
  🟢 YES — uptrend / above MAs (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Q2 — CRYPTOCAP:TOTAL (1W)
  "Is the total crypto market cap in an uptrend or breaking a key resistance?"
  📖 Higher highs + higher lows = growing interest. Breakout = bullish.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Q3 — CRYPTOCAP:USDT.D (1W)
  "Is Tether Dominance falling or holding at a support level?"
  📖 USDT.D falling = money moving into crypto = risk-on.
  🟢 YES — falling / at support (+2) | 🟡 PARTIAL (+1) | 🔴 NO — rising (0)

Score A-HTF (1W) = (Q1+Q2+Q3) / 6 × 100

── A-HTF (1D) — Daily confirmation ──────────────────────────────

Q4 — BTCUSDT (1D)
  "On the daily chart, is BTC in an uptrend and above its key moving averages?"
  📖 Daily 20 EMA / 50 EMA. Price above = bullish. Below = bearish.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Score A-HTF (1D) = Q4 / 2 × 100

Score A-HTF (combined) = average of 1W + 1D scores

── A-MTF (4H) — Active setup ────────────────────────────────────

Q5 — BTCUSDT (4H)
  "On the 4H chart, is BTC showing bullish structure or a setup forming?"
  📖 Higher highs on 4H? Break of structure? Support holding? Entry-level setup?
  🟢 YES — bullish setup forming (+2) | 🟡 PARTIAL — ranging (+1) | 🔴 NO (0)

Score A-MTF = Q5 / 2 × 100
⚠️ Re-check 4H before each trading session — changes within hours.

── A-LTF (1H / 15min) — Entry timing ───────────────────────────

No question in Phase 1. Check manually on chart before entering.
LTF is not scored — only HTF + MTF produce a score and a bias.

═══ SCORE B: ALTS ═══════════════════════════════════════════════════

── B-HTF (1W) — Macro structure ─────────────────────────────────

Q6 — CRYPTOCAP:BTC.D (1W)
  "Is BTC Dominance falling or rejecting a resistance level?"
  📖 BTC.D falling = capital rotating from BTC into alts.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Q7 — ETHBTC (1W)
  "Is the ETH/BTC ratio in an uptrend or bouncing from support?"
  📖 ETH/BTC up = ETH outperforming BTC = alt season proxy.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Q8 — CRYPTOCAP:TOTAL2 (1W)
  "Is TOTAL2 (all alts minus BTC) in an uptrend or making higher highs?"
  📖 TOTAL2 up while BTC flat → altcoins are winning.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Q9 — CRYPTOCAP:OTHERS (1W) [optional, default OFF]
  "Is the 'Others' cap trending up without a vertical blow-off?"
  📖 OTHERS = small alts outside top 10. Moves last in a bull cycle.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Score B-HTF (1W) = (Q6+Q7+Q8 [+Q9 if ON]) / max_pts × 100

── B-HTF (1D) — Daily confirmation ──────────────────────────────

Q10 — ETHBTC (1D)
  "On the daily chart, is ETH/BTC holding above support and trending up?"
  📖 Daily ETHBTC confirms (or denies) the weekly alt season signal.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Score B-HTF (1D) = Q10 / 2 × 100

Score B-HTF (combined) = average of 1W + 1D scores

── B-MTF (4H) — Active setup ────────────────────────────────────

Q11 — ETHUSD (4H)
  "On the 4H chart, is ETH showing bullish structure or a setup forming?"
  📖 ETH is the alt proxy on 4H. ETH setup = most alts likely have one too.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Score B-MTF = Q11 / 2 × 100
⚠️ Re-check 4H before each trading session — changes within hours.

── B-LTF (1H / 15min) — Entry timing ───────────────────────────

No question in Phase 1. Check manually on chart before entering.

Thresholds (all scores):
  > 60%  → 🟢 BULLISH
  40–60% → 🟡 NEUTRAL
  < 40%  → 🔴 BEARISH
```

#### Combined Crypto Summary (shown after completing module)

```
┌─ Crypto Analysis ──────────────────────────────────────────────────────┐
│               HTF (1W+1D)    MTF (4H)                                  │
│  BTC          🟢 88%         🟡 50%                                    │
│  Alts         � 75%         🔴 25%                                    │
│                                                                          │
│  BTC:   HTF aligned ✅ — 4H ranging ⏳ — wait for MTF entry            │
│  Alts:  HTF ok ✅  — 4H bearish ⚠️ — longs selective, shorts valid    │
│                                                                          │
│  Risk (HTF-based):  BTC longs +20% | Alt longs no change (MTF 🔴)     │
│  ⚠️ Re-check 4H before entry — LTF (1H/15min) on chart only           │
└────────────────────────────────────────────────────────────────────────┘
```

Trade type matrix (per asset):

```
HTF 🟢 + MTF 🟢  → Any style valid (swing, day, scalp)
HTF 🟢 + MTF 🟡  → Swing/position OK — wait for 4H entry trigger
HTF 🟢 + MTF 🔴  → Swing bias valid — no day longs, shorts valid on 4H
HTF � + MTF 🔴  → No longs — shorts favored
HTF 🔴 + MTF 🔴  → Strong bearish — shorts priority

Rule: a bearish MTF never means "avoid trading" — it means "favor shorts".
Primary bias for risk multipliers: HTF score (stable, weekly)
MTF score: determines trade style (swing vs day vs scalp)
LTF (1H/15min): manual entry confirmation on chart — not scored in app
```

BTC + Alts interpretation:

```
BTC 🟢 + Alts 🟢 → Full risk-on
BTC 🟢 + Alts 🟡 → BTC favored, alts selective
BTC 🟢 + Alts 🔴 → BTC only — alt longs risky, alt shorts valid
BTC 🔴 + Alts 🔴 → Risk-off — shorts or cash
```

---

### Module 2 — Gold (XAUUSD)

**When to run:** Weekly (Sunday/Monday) or before a significant trade  
**Time needed:** ~10 min  
**Timeframes:** HTF (1W + 1D) + MTF (4H) + LTF (1H / 15min)  
**⚠️ Staleness warning:** Banner shown if HTF last analysis > 7 days old

> Gold module produces **1 × 2 scores** — HTF and MTF across XAUUSD.  
> 3 core drivers: real yields (US10Y), USD strength (DXY), risk sentiment (VIX).

#### Indicators used

| # | What to open | Ticker | TF | Default | Affects |
|---|---|---|---|---|---|
| 1 | Gold Price | `XAUUSD` | 1W | ✅ ON | HTF (1W) |
| 2 | US Dollar Index | `TVC:DXY` | 1W | ✅ ON | HTF (1W) |
| 3 | US 10Y Yield | `TVC:US10Y` | 1W | ✅ ON | HTF (1W) |
| 4 | VIX | `CBOE:VIX` | 1W | ✅ ON | HTF (1W) |
| 5 | Gold Price | `XAUUSD` | 1D | ✅ ON | HTF (1D) |
| 6 | Gold Price | `XAUUSD` | 4H | ✅ ON | MTF |
| 7 | Gold/Silver Ratio | `TVC:GOLD/TVC:SILVER` | 1W | ☐ OFF | HTF (1W) |

#### Questions

```
── HTF (1W) — Macro structure ───────────────────────────────────

Q1 — XAUUSD (1W)
  "Is Gold in a clear weekly uptrend — higher highs and higher lows?"
  📖 Price above 20W/50W MA? Swing lows rising? That's structural bullish.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Q2 — TVC:DXY (1W)
  "Is the US Dollar (DXY) in a downtrend or rejecting a resistance level?"
  📖 DXY and Gold move inversely. DXY falling / rejecting = bullish for Gold.
  🟢 YES — DXY falling / rejecting (+2) | 🟡 PARTIAL (+1) | 🔴 NO — DXY rising (0)

Q3 — TVC:US10Y (1W)
  "Are US 10-year yields falling or capped at a resistance?"
  📖 Rising yields = gold less attractive vs bonds. Falling yields = gold wins.
  🟢 YES — yields falling / capped (+2) | 🟡 PARTIAL (+1) | 🔴 NO — rising (0)

Q4 — CBOE:VIX (1W)
  "Is the VIX elevated (15–30) — mild fear, not panic?"
  📖 VIX 15–30 = mild risk-off = gold safe-haven demand.
     VIX >35 (panic) = everything sells. VIX <15 (complacency) = no tailwind.
  🟢 YES — VIX 15–30, rising gently (+2) | 🟡 PARTIAL — VIX <15 (+1) | 🔴 VIX >35 (0)

Q5 — TVC:GOLD/TVC:SILVER [optional, default OFF]
  "Is the Gold/Silver ratio flat or falling (silver keeping pace)?"
  📖 Falling ratio = silver outperforming = healthy metals momentum.
  🟢 YES — flat or falling (+2) | 🟡 PARTIAL (+1) | 🔴 Rising sharply (0)

Score HTF (1W) = (Q1+Q2+Q3+Q4 [+Q5 if ON]) / max_pts × 100

── HTF (1D) — Daily confirmation ────────────────────────────────

Q6 — XAUUSD (1D)
  "On the daily chart, is Gold in an uptrend and above its key MAs?"
  📖 Daily 20 EMA / 50 EMA. Price above = bullish. Below = bearish.
  🟢 YES (+2) | 🟡 PARTIAL (+1) | 🔴 NO (0)

Score HTF (1D) = Q6 / 2 × 100

Score HTF (combined) = average of 1W + 1D scores

── MTF (4H) — Active setup ──────────────────────────────────────

Q7 — XAUUSD (4H)
  "On the 4H chart, is Gold showing bullish structure or a setup forming?"
  📖 Higher highs on 4H? Support holding? Break of 4H structure upward?
  🟢 YES (+2) | 🟡 PARTIAL — ranging (+1) | 🔴 NO (0)

Score MTF = Q7 / 2 × 100
⚠️ Re-check 4H before each trading session.

── LTF (1H / 15min) — Entry timing ─────────────────────────────

No question in Phase 1. Check manually on chart before entering.

Thresholds (all scores): > 60% 🟢 | 40–60% 🟡 | < 40% 🔴
```

#### Gold Summary

```
┌─ Gold Analysis ──────────────────────────────────────────────────┐
│               HTF (1W+1D)    MTF (4H)                            │
│  XAUUSD       🟢 87%         🟡 50%                              │
│                                                                   │
│  Swing:  ✅ HTF aligned → valid                                 │
│  Day:    ⏳ 4H ranging — wait for MTF entry trigger             │
│                                                                   │
│  Risk (HTF-based): longs +20% | shorts -30%                     │
│  ⚠️ LTF (1H/15min): check manually before entry                 │
└──────────────────────────────────────────────────────────────────┘
```

---

### Modules 3–5 — Forex, Indices, Universal Overlay

> ⏳ **Deferred — pending deep research session**  
> These modules need a dedicated deep analysis to finalize the right questions.  
> They will be added post-Phase 1 with zero structural changes — just new rows in  
> `market_analysis_modules` and `market_analysis_indicators`.

---

### Feature 3b — Economic Calendar Integration

#### Concept

At the **start of each week's market analysis session**, the user enters (or imports) the key
macro events for that week. These events are displayed throughout the week **inline with the
analysis summary and the trade form** as a warning layer — not a blocker.

The goal: never open a trade 30 minutes before a FOMC decision without knowing it.

#### When it runs

```
Trigger: at the beginning of each /market-analysis/new session
  → Step 0a (before even fetching news): "Weekly Events — what's on this week?"
  → User fills in the events once per week (Monday morning routine)
  → Events persist for the whole week → shown on every analysis summary + trade form
  → On next weekly analysis session → prompt to clear/update
```

#### What events to track

```
HIGH IMPACT (🔴 — always show, strong warning on trade form):
  FOMC decision / Fed minutes / Fed speeches (Powell etc.)
  CPI / Core CPI (US)
  NFP — Non-Farm Payrolls
  US GDP release
  US PPI
  ECB rate decision
  BOE / BOJ rate decisions
  OPEC meeting (for oil-correlated assets)
  US Debt ceiling / budget votes (rare but extreme)

MEDIUM IMPACT (🟡 — show on analysis, softer warning):
  Jobless Claims (weekly Thursday)
  ISM Manufacturing / Services PMI
  Retail Sales (US)
  Consumer Confidence
  JOLTS / ADP Payroll
  Treasury auctions (large ones)
  Earnings (for equity-correlated crypto / indices)

LOW / CONTEXT (🟠 — show on analysis only, no trade form warning):
  Fed speakers (non-decision, less important)
  Housing data
  Trade balance
  Regional PMIs (Europe)
```

#### Data Model

```sql
-- New table
CREATE TABLE weekly_events (
  id            SERIAL PRIMARY KEY,
  profile_id    INT NOT NULL REFERENCES profiles(id),
  week_start    DATE NOT NULL,              -- Monday of that week (ISO week)
  event_date    DATE NOT NULL,
  event_time    TIME NOT NULL,              -- stored in UTC
  title         TEXT NOT NULL,
  impact        TEXT CHECK (impact IN ('high','medium','low')),
  asset_scope   TEXT[],                    -- ['crypto','gold','forex','all']
  note          TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX idx_weekly_events_week ON weekly_events(profile_id, week_start);
```

> **Timezone handling:** `event_time` is stored in UTC in DB.  
> The backend converts to the user's local timezone (from `user_preferences.timezone`)  
> before sending to the frontend. The UI always displays in local time.  
> Default timezone: UTC+1 (Paris — configurable per profile in Settings).

#### UI — Weekly Events Entry

```
/market-analysis/new → Step 0 (before technical questions):

┌─ 📅 Weekly Events ─────────────────────────────────────────────┐
│  Week of March 3–7, 2026                    [Clear] [+ Add]    │
│                                                                 │
│  🔴  Wed Mar 5  15:30       ADP Payroll                        │
│  🔴  Thu Mar 6  14:30       ECB Rate Decision                  │
│  🔴  Fri Mar 7  14:30       NFP + Unemployment                 │
│  🟡  Thu Mar 6  16:00       ISM Services PMI                   │
│                             (times in local — Europe/Paris)     │
│                                                                 │
│  [Skip — no major events this week]         [Confirm & Next →] │
└─────────────────────────────────────────────────────────────────┘
```

Add event form (inline, single row):
```
[Date ▼] [Time local ▼] [Impact 🔴🟡🟠 ▼] [Title___________________] [Scope ▼] [+]
```

> User enters time in **local timezone** (UTC+1 by default).  
> Backend converts to UTC before storing. Display always in local.  
> Sources: Forex Factory, Investing.com/economic-calendar, Earnings Whispers.  
> Phase 2+: auto-import via Forex Factory RSS or API.

#### Display — Analysis Summary Banner

```
After completing the analysis, the summary shows:

┌─ ⚠️ This Week's Events ──────────────────────────────────────┐
│  🔴  Thu Mar 6  13:30 UTC  ECB Rate Decision                 │
│       → Gold & EUR pairs: expect high volatility             │
│       → Consider reducing size or avoiding new trades        │
│         in the 2h window before/after                        │
│                                                              │
│  🔴  Fri Mar 7  13:30 UTC  NFP + Unemployment               │
│       → All USD pairs + BTC: liquidity spike expected        │
│                                                              │
│  🟡  Thu Mar 6  15:00 UTC  ISM Services PMI                 │
└──────────────────────────────────────────────────────────────┘
```

#### Display — Trade Form Warning

When opening a trade within a configurable window (default: **2 hours before or after** a
HIGH impact event that matches the asset's scope):

```
┌─ ⚠️ Upcoming Event ─────────────────────────────────────────────┐
│  🔴 NFP — Non-Farm Payrolls  |  Fri Mar 7 13:30 UTC  (in 1h45) │
│  High volatility expected around this event.                    │
│  Recommendation: wait until after release or reduce size.       │
│  [Acknowledge & Continue]                          [Cancel]     │
└─────────────────────────────────────────────────────────────────┘
```

Rules:
```
- Warning fires if: event.event_date = today AND abs(now - event_time) < 2h
  AND event.impact = 'high'
  AND event.asset_scope overlaps with trade instrument.asset_class
- Warning window configurable in /settings/preferences → "Event warning window (hours)"
- User can acknowledge and proceed — never a hard block
- Warning is also shown passively on the trade form header as a badge:
  "⚠️ 2 high-impact events this week"
```

#### DB: weekly_events relationship to analysis sessions

```
market_analysis_sessions
  └─ week_start (DATE) → used to join weekly_events for display
  
(No FK needed — events are per-week, sessions reference week by date)
```

#### MVP Criteria (additions for Feature 3b)

```
26. ✅ Weekly events: user can add/edit/delete events at start of weekly analysis
27. ✅ Weekly events: 3 impact levels (high/medium/low) with color coding
28. ✅ Weekly events: persist for the full week, shown on analysis summary
29. ✅ Weekly events: trade form warns (non-blocking) when opening trade within 2h of high-impact event
30. ✅ Weekly events: asset scope filter (crypto / gold / forex / all)
```

---

## 🧩 Feature 4 — News Intelligence Integration

### Concept

An **optional, AI-powered news context layer** that can be fetched at the moment of creating
a market analysis session. The user triggers a single API call to an external AI service
(Perplexity or Grok) that returns a structured news brief covering macro, micro, and
geopolitical events relevant to the assets being analyzed. The result is saved alongside the
technical analysis scores and displayed as a dedicated **"News Context"** section — never
replacing the technical scores, always complementing them.

**This feature is opt-in:**
- Disabled by default — zero API calls are made unless the user explicitly enables it
- Enabled via a global toggle in `/settings/preferences`
- Can be triggered on-demand per analysis session (even if globally enabled, user sees a
  confirmation button before the call is made)

---

### Provider Architecture

```
Supported providers (Phase 1):
  1. Perplexity AI  → "sonar" or "sonar-pro" model
     Endpoint: POST https://api.perplexity.ai/chat/completions
     Auth: Bearer token (user-supplied API key, stored encrypted in DB)

  2. xAI Grok       → "grok-3" or "grok-3-mini" model
     Endpoint: POST https://api.x.ai/v1/chat/completions
     Auth: Bearer token (user-supplied API key, stored encrypted in DB)

Provider selection: user picks one in /settings/preferences → "News Intelligence"
API key: entered once, stored encrypted (AES-256), never shown in plain text again
Fallback: if API call fails → toast error, analysis saved without news section
```

---

### What the AI is Asked (Prompt Template)

The prompt is **fully configurable** in `/settings/preferences → News Intelligence`.  
A default template ships with the app. The user can edit it — changes saved per profile.

#### Default Template

```
You are a professional financial analyst assistant.
Provide a concise, structured macro & geopolitical news brief for a trader
analyzing the following markets: {assets}.

Return ONLY a JSON object with this exact structure:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "summary": "<2-3 sentence overall macro context>",
  "key_themes": [
    { "theme": "<theme name>", "impact": "bullish|bearish|neutral", "detail": "<1 sentence>" },
    ...  (max 5 themes)
  ],
  "risks": [
    { "risk": "<risk name>", "severity": "high|medium|low", "detail": "<1 sentence>" }
    ...  (max 3 risks)
  ],
  "sources_used": ["<source 1>", "<source 2>", ...]
}

Focus on: macro data releases in the last 7 days, central bank signals, geopolitical events,
risk-on/risk-off sentiment shifts. Be factual. No investment advice. Today: {date}.
```

#### Template Variables (auto-filled at call time)

| Variable | Filled with |
|---|---|
| `{assets}` | Comma-separated asset names from the module (e.g. "BTC, ETH, XAUUSD") |
| `{date}` | Today's date in ISO format (e.g. "2026-03-01") |
| `{module}` | Module name (e.g. "Crypto", "Gold") — optional, for custom templates |

The user can add/remove/edit any part of the template. The app only requires that the
response is valid JSON matching the structure above. If the JSON is malformed → error toast,
no save.

---

### UI — `/market-analysis/new` (updated flow)

```
Step 0 (new):  [News Intelligence]
  ┌──────────────────────────────────────────────────────────────────┐
  │  📰 Fetch macro/news context for this analysis?                  │
  │                                                                  │
  │  Provider: [Perplexity ▾]   Model: [sonar-pro ▾]               │
  │  Assets in scope: BTC, ETH alts, XAUUSD (from module)           │
  │                                                                  │
  │  [ 🔍 Fetch News Brief ]   [ Skip → go straight to questions ]  │
  │                                                                  │
  │  ⚙️ Configure template / API key → /settings/preferences        │
  └──────────────────────────────────────────────────────────────────┘

  → "Fetch" tapped:
    - Spinner shown, button disabled
    - POST to backend /api/news-brief (never exposes API key to frontend)
    - Response parsed and displayed below (collapsible card)
    - User can re-fetch once (to refresh if data looked stale)

  → Either way → user proceeds to technical questions (Step 1+) unchanged

Step N (final summary, after all technical questions):

  ┌─ News Context ──────────────────────────────────────────────────────┐
  │  [fetched if Step 0 used, else "Not fetched — add manually?"]       │
  │  Sentiment: 🟡 NEUTRAL (confidence: 58%)                            │
  │  Summary: "Fed pause signaled for Q2; DXY reversing from 107 res;   │
  │            BTC spot ETF inflows resuming this week."                │
  │                                                                      │
  │  Key themes:                                                         │
  │   • Fed pivot signal   → 🟢 Bullish   | Rate hike fears fading      │
  │   • DXY reversal       → 🟢 Bullish   | Gold + crypto tailwind      │
  │   • Geopolitical risk  → 🔴 Bearish   | Escalation in MENA region   │
  │                                                                      │
  │  Risks:                                                              │
  │   ⚠️ High:   CPI data Thursday — could shift rates narrative        │
  │   ⚠️ Medium: BTC ETF net outflows if equity selloff                 │
  │                                                                      │
  │  Sources: Reuters, Bloomberg, CoinDesk, FT                          │
  │  Fetched: 2026-03-01 08:14 UTC  [re-fetch]                         │
  └──────────────────────────────────────────────────────────────────────┘

  ┌─ Technical Scores ─ (unchanged from v2.5) ────────────────────────┐
  │   BTC   HTF 🟢 83%   MTF 🟢 100%   LTF 🟡 50%                   │
  │   Alts  HTF 🟢 75%   MTF 🟡 50%    LTF 🔴 25%                   │
  └────────────────────────────────────────────────────────────────────┘

  Combined interpretation banner (shown only if news was fetched):
  ┌──────────────────────────────────────────────────────────────────────┐
  │  🔀 Technical vs News alignment:                                     │
  │    Technical HTF: 🟢 BULLISH                                         │
  │    News sentiment: 🟡 NEUTRAL                                        │
  │    → Mixed signal — proceed with normal sizing, watch CPI Thursday   │
  └──────────────────────────────────────────────────────────────────────┘

  The combined banner is informational only:
    Both 🟢         → "Technicals + macro aligned bullish — full size OK"
    Tech 🟢 + News 🟡 → "Mixed — standard sizing, note the risks above"
    Tech 🟢 + News 🔴 → "Technical bullish but macro headwind — reduce size 1 step"
    Tech 🔴 + News 🟡 → "Technicals bearish, macro neutral — no longs"
    Both 🔴         → "Strong risk-off — avoid longs, shorts or cash"

  ⚠️ The news sentiment does NOT change the risk multipliers.
     Only the technical HTF score feeds the risk engine.
     News is context — the final call is always the trader's.
```

---

### Backend — `/api/news-brief`

```
POST /api/news-brief
Body: {
  profile_id: int,
  module: "crypto" | "gold",    ← determines asset list injected into template
  assets: string[]              ← override asset list (optional, for future modules)
}

Backend responsibilities:
  1. Load profile → fetch encrypted API key + provider config
  2. Decrypt API key in-process (never returned to client)
  3. Inject {assets} and {date} into the stored prompt template
  4. POST to provider endpoint with auth header
  5. Parse JSON response — validate structure
  6. Return to frontend (never log the full raw API key in any log file)

Response on success:
{
  "sentiment": "neutral",
  "confidence": 58,
  "summary": "...",
  "key_themes": [...],
  "risks": [...],
  "sources_used": [...],
  "fetched_at": "2026-03-01T08:14:00Z",
  "provider": "perplexity",
  "model": "sonar-pro"
}

Response on failure (API key invalid, rate limit, network):
{ "error": "news_fetch_failed", "reason": "provider_error | invalid_key | timeout" }

Security rules:
  → API key never logged, never returned to frontend, never stored in plain text
  → Rate limit: max 3 news fetches per analysis session (re-fetch button disabled after 3)
  → Timeout: 15s — if provider doesn't respond, return error gracefully
```

---

### DB Schema — New & Modified Tables

```
news_provider_config (per profile):
  id                    SERIAL PK
  profile_id            FK → profiles
  provider              VARCHAR(20)    ← 'perplexity' | 'xai_grok'
  model                 VARCHAR(40)    ← 'sonar-pro' | 'grok-3' etc.
  api_key_encrypted     BYTEA          ← AES-256 encrypted
  api_key_iv            BYTEA          ← IV for decryption
  prompt_template       TEXT           ← user-editable, defaults to standard template
  enabled               BOOLEAN        ← global ON/OFF per profile
  max_fetches_per_day   INT DEFAULT 10 ← soft cap to avoid runaway API costs
  created_at            TIMESTAMPTZ
  updated_at            TIMESTAMPTZ

market_analysis_sessions (additions to existing table):
  news_sentiment        VARCHAR(10)    ← 'bullish' | 'bearish' | 'neutral' | NULL
  news_confidence       INT            ← 0–100, NULL if not fetched
  news_summary          TEXT           ← NULL if not fetched
  news_key_themes       JSONB          ← array of {theme, impact, detail}
  news_risks            JSONB          ← array of {risk, severity, detail}
  news_sources          JSONB          ← array of source strings
  news_fetched_at       TIMESTAMPTZ    ← NULL if not fetched
  news_provider         VARCHAR(20)    ← 'perplexity' | 'xai_grok' | NULL
  news_model            VARCHAR(40)    ← model name used | NULL
```

---

### Settings Page — `/settings/preferences → News Intelligence`

```
┌─ News Intelligence ─────────────────────────────────────────────┐
│  [ Toggle ON/OFF ]  ← master switch for this profile             │
│                                                                   │
│  Provider:     [Perplexity ▾]                                    │
│  Model:        [sonar-pro ▾]  ← dropdown of supported models    │
│  API Key:      [●●●●●●●● (saved)]  [Replace]  [Test connection] │
│                                                                   │
│  Daily fetch limit: [10]  ← prevent runaway API costs           │
│                                                                   │
│  Prompt Template:                                                 │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ You are a professional financial analyst assistant.         │ │
│  │ Provide a concise, structured macro & geopolitical news     │ │
│  │ brief for a trader analyzing: {assets}.                     │ │
│  │ ...                                                         │ │
│  │ [Restore default template]                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  [Save]                                                           │
└───────────────────────────────────────────────────────────────────┘

Notes:
  → "Test connection" fires a minimal test prompt → confirms key works → green ✅ or red ❌
  → Template changes are profile-scoped — other profiles keep their own template
  → Switching provider clears the cached API key for the old provider
```

---

### Key Design Decisions

```
1. News does NOT feed the risk engine
   → Only technical HTF score drives risk multipliers (stable, weekly signal)
   → News is fast-moving, AI-generated, potentially wrong — only used as context
   → User always has final say — "override" logic not needed, no override UI required

2. AI provider is a backend proxy
   → Frontend never sees the API key — not in headers, not in responses
   → Backend decrypts key in memory, uses it, discards it
   → This also allows future switching of providers without frontend changes

3. News section is collapsible and non-blocking
   → User can close it if distracting
   → Does not prevent saving the analysis
   → If not fetched: field is NULL in DB, section shows "Not fetched" in view

4. Prompt is user-editable for power users
   → Response must always return valid JSON with the required fields
   → App validates JSON shape on receipt — if malformed, error is shown, no data saved
   → Bad prompt → bad JSON → user is shown the raw response for debugging

5. Phase 1 supports Perplexity + Grok only
   → Both use OpenAI-compatible chat completions format → same backend adapter
   → Adding a new provider in Phase 2+ = add a row to a provider config enum, no code change

6. Zero data leakage design
   → API key encrypted at rest (AES-256 with per-row IV)
   → API key never logged (log level checked before any request)
   → News content is stored per analysis session — not shared across profiles
```

---

## 📊 Updated Phase 1 DB Schema (additions)

### New Tables

```
brokers                      ← broker catalog (pre-seeded + custom)
instruments                  ← instrument catalog per broker (~70 rows pre-seeded + custom)
                               + max_leverage per instrument (category-based default, editable)
trading_styles               ← scalping, day_trading, swing, position
profile_goals                ← goal + limit per profile × style × period (all 3 periods)
goal_progress_log            ← daily goal snapshots (computed on page load in Phase 1)
note_templates               ← post-trade note question templates
sessions                     ← trading session catalog (Asia/London/NY/Overlap) — UTC times in DB
market_analysis_modules      ← Crypto / Gold / Forex / Indices (seeded)
market_analysis_indicators   ← pre-seeded indicator catalog per module
                               + tv_timeframe ("1W"/"1D"/"4H"), timeframe_level ("htf"/"mtf"/"ltf")
profile_indicator_config     ← per-profile ON/OFF toggle per indicator
market_analysis_sessions     ← completed analysis sessions
                               + score_htf_a, score_mtf_a, score_ltf_a (pct)
                               + score_htf_b, score_mtf_b, score_ltf_b (pct, dual-score modules)
                               + bias_htf_a, bias_mtf_a, bias_ltf_a
                               + bias_htf_b, bias_mtf_b, bias_ltf_b
                               + news_sentiment, news_confidence, news_summary (NULL if not fetched)
                               + news_key_themes (JSONB), news_risks (JSONB), news_sources (JSONB)
                               + news_fetched_at, news_provider, news_model
                               + week_start (DATE) ← links to weekly_events for display
market_analysis_answers      ← per-indicator answers per session
news_provider_config         ← per-profile: provider, model, encrypted API key, prompt template
                               + enabled (BOOLEAN), max_fetches_per_day (INT)
weekly_events                ← macro events entered at start of weekly analysis
                               + profile_id, week_start (DATE — ISO Monday)
                               + event_date, event_time (UTC), title
                               + impact: 'high' | 'medium' | 'low'
                               + asset_scope: TEXT[] — ['crypto','gold','forex','all']
                               + note (optional context)
```

### Modified Tables

```
profiles:
+ broker_id (FK → brokers)
+ currency (derived from broker, e.g. USD / USDT / EUR)
+ max_concurrent_risk_pct  ← max % of capital in risk across all open trades (default 2%)

trades:
+ instrument_id (FK → instruments)
+ asset_class (Commodities/Crypto/Forex/Indices/Stocks)
+ analyzed_timeframe (15m/1h/4h/1d/1w — configurable list)
+ confidence_score (0–100)
+ spread (DECIMAL)
+ estimated_fees (DECIMAL)
+ structured_notes (JSONB)
+ market_analysis_session_id (FK → market_analysis_sessions, nullable)
+ leverage (DECIMAL, editable — for Crypto)
+ current_risk (DECIMAL, recalculated on each partial close / BE move)
+ session_tag (asia/london/new_york/overlap — auto-tagged at entry UTC time)

user_preferences:
+ timezone (e.g. "Europe/Paris") ← stored per user, used for session display
+ analyzed_tf_list (JSON array of TFs to show in dropdown — configurable)
+ news_intelligence_enabled (BOOLEAN default FALSE) ← mirrors news_provider_config.enabled
```

---

## 🗓️ Updated UI Pages & Layout

```
Phase 1 pages:

/dashboard
├─ Goals widget           ← 3-period bars (Daily/Weekly/Monthly), style selector, all visible at once
├─ Market Analysis badge  ← last analysis per market: "Crypto 🟢 BULLISH (79%) — 2 days ago"
├─ Open positions         ← current trades, risk live
└─ Performance summary    ← equity curve, win rate, PF

/trades
├─ /trades/new            ← full trade form (instrument, direction, TPs, risk, calc fields)
├─ /trades/:id            ← trade detail + close form (partial/full, editable realized_pnl)
└─ /trades                ← journal list

/market-analysis
├─ /market-analysis/new   ← module selector → step-by-step questions → summary → save
├─ /market-analysis/:id   ← view past analysis
└─ /market-analysis       ← history table + sparklines per module

/settings
├─ /settings/profiles     ← profile CRUD + broker/currency + max_concurrent_risk_pct
├─ /settings/goals        ← goals × style × period (all 3 periods per style)
├─ /settings/instruments  ← instrument catalog (view pre-seeded, add/edit/delete custom)
├─ /settings/market-analysis ← indicator toggles per module + thresholds + multipliers
├─ /settings/sessions     ← session start/end times (UTC) — rarely changed
├─ /settings/preferences  ← timezone, analyzed TF dropdown list, UI prefs
│   └─ News Intelligence  ← provider, model, API key (encrypted), prompt template, daily limit
├─ /settings/strategies   ← strategy tags
└─ /settings/tags         ← trade tags
```

---

## ✅ Phase 1 MVP Criteria (Updated)

**Done when:**
1. ✅ Profile with broker + currency + max_concurrent_risk_pct
2. ✅ Trade with instrument from catalog (+ custom pair option)
3. ✅ Trade form: TF (configurable list incl. 15m), confidence slider, spread, fees, margin safety alert
4. ✅ Leverage field (Crypto): calculated, editable, capped per instrument category with ⚠️
5. ✅ TP profit preview: live $ + R multiple per TP, sum-of-% validation
6. ✅ Lot size / leverage / margin calculated and shown live
7. ✅ Risk amount = capital × risk% (risk% pre-filled, editable per trade)
8. ✅ Multi-TP, partial close (TP1 → move SL to BE → risk recalculated live), full close
9. ✅ realized_pnl pre-filled by backend on close, editable by user
10. ✅ Live risk tracking: available risk shown on dashboard + in trade form with nudge
11. ✅ Goals: Daily + Weekly + Monthly progress bars, all 3 visible, per style
12. ✅ Sessions: live widget (UTC stored, displayed in user local timezone with DST auto)
13. ✅ Market analysis: **Crypto** (HTF 1W + MTF 1D + LTF 4H, 3 scores) + **Gold** (same 3-TF structure)
14. ✅ Market analysis: trade type guidance per TF alignment (swing vs day vs scalp)
15. ✅ Market analysis: LTF score always shown with "re-check before session" reminder
16. ✅ Market analysis: Bearish → Shorts favored, Bullish → Longs favored (badge + live risk calc)
17. ✅ Notes: structured post-trade template (in DB)
18. ✅ Performance dashboard: equity curve, win rate, profit factor
    - Strategy win rate is only shown (and only used in risk logic) once
      `strategies.trades_count >= min_trades_for_stats` (default **5**).
      Below threshold → displayed as `N/A`, treated as neutral in risk calculations.
19. ✅ News Intelligence: global toggle per profile (disabled by default)
20. ✅ News Intelligence: API key stored encrypted (AES-256), never exposed to frontend
21. ✅ News Intelligence: "Fetch News Brief" button in `/market-analysis/new` — fires only on user action
22. ✅ News Intelligence: response displayed as collapsible "News Context" section alongside technical scores
23. ✅ News Intelligence: tech vs news alignment banner (informational only — does not change risk multipliers)
24. ✅ News Intelligence: prompt template configurable per profile with variable injection ({assets}, {date})
25. ✅ News Intelligence: daily fetch limit configurable, graceful error handling (analysis saves without news if fetch fails)

---

## 📌 Business Rule: Strategy Win Rate Minimum

> **A strategy's win rate is only shown and used in risk logic when
> `trades_count >= min_trades_for_stats` (default 5).**

| `trades_count` | Win rate UI | Risk logic |
|:-:|:-:|:-:|
| 0 – 4 | `N/A` | ❌ Neutral (no adjustment) |
| ≥ 5 | `win% shown` | ✅ Applied |

- Tracked via `strategies.trades_count` + `strategies.win_count` (denormalized counters).
- Both incremented atomically on trade close (same DB transaction as capital update).
- `min_trades_for_stats` defaults to 5, stored per-strategy (overridable in settings).
- All API endpoints that return `win_rate` must return `null` below threshold.
- See `docs/architecture/tech/DATABASE.md` → §"Business Logic: Strategy Win Rate Minimum".

---

## 🔗 Cross-Feature Integration

```
Market Analysis (5 modules, dynamic % scoring)
    ↓
[Optional] News Intelligence fetch (Step 0 of /market-analysis/new)
  → User taps "Fetch News Brief"
  → Backend proxies call to Perplexity / Grok (API key never leaves server)
  → JSON response parsed → stored in market_analysis_sessions (news_* columns)
  → Displayed as collapsible "News Context" section below technical scores
  → Tech vs News alignment banner shown (informational, no risk engine impact)
    ↓
Bias result per module: 🟢 BULLISH / 🟡 NEUTRAL / 🔴 BEARISH
  (driven by HTF technical score only — news sentiment is context, not input)
    ↓
Trade form opened:
  → instrument's asset class matched to relevant module
  → Badge shown: "🔴 Bearish bias — Shorts +20%, Longs -30%"
  → If news was fetched: second badge shown: "📰 News: 🟡 Neutral — CPI data Thursday ⚠️"
  → risk% field pre-filled from profile × technical HTF bias multiplier
  → Calculated risk amount, lot size, margin updated live
    ↓
Goals module updated on trade close:
  → PnL added to daily/weekly/monthly progress
  → If limit hit → ⚠️ / 🛑 badge shown on dashboard
    ↓
Partial close (e.g. TP1 hit → move SL to BE):
  → realized_pnl pre-filled (backend calc), editable
  → Current risk = 0 (BE = no loss possible)
  → Risk available restored proportionally
  → Goals bars updated in real time
```

---

## 🌐 Deployment Environments

### Philosophy

```
Two environments — same Docker stack, different domain + config:

  DEV  →  http://localhost               (Mac only — Vite dev server + uvicorn)
  PROD →  http://alphatradingdesk.local  (Dell server — LAN, all devices on WiFi)

No cloud for now. PROD runs on the Dell OptiPlex (headless Ubuntu Server).
GCE / cloud migration is a future option — no structural changes needed when that time comes.
See SERVER_SETUP.md for the full Dell setup procedure.
```

### DEV — localhost

```
URL:      http://localhost
Frontend: http://localhost:5173  (Vite dev server, hot reload)
Backend:  http://localhost:8000  (uvicorn --reload)
API docs: http://localhost:8000/docs
DB GUI:   http://localhost:8080  (Adminer)

Stack: docker-compose.dev.yml
  → Vite dev server (hot reload on save)
  → uvicorn --reload (hot reload on save)
  → No Caddy — direct port exposure
  → No Celery (Phase 1 has no scheduled tasks)
  → DEBUG=True, LOG_LEVEL=DEBUG
```

### PROD — alphatradingdesk.local (Dell — LAN)

```
URL:      http://alphatradingdesk.local
Frontend: served by Caddy (reverse proxy → nginx static build)
Backend:  served by Caddy (/api/* → gunicorn on :8000)
API docs: http://alphatradingdesk.local/api/docs

Stack: docker-compose.prod.yml
  → React built as static files (npm run build)
  → gunicorn + UvicornWorker (production WSGI)
  → Caddy as reverse proxy (HTTP only on LAN — no HTTPS needed locally)
  → DEBUG=False, LOG_LEVEL=INFO

Domain propagation on local network:
  Option A — /etc/hosts on each device (manual, simple):
    Mac:     echo "127.0.0.1 alphatradingdesk.local" >> /etc/hosts
    iPhone:  use Surge/AdGuard with custom DNS rule
    Other:   add to /etc/hosts or hosts file (Windows)

  Option B — Local DNS via router (preferred, auto for all devices):
    → Add custom DNS entry in router admin (e.g. FritzBox, Livebox, UniFi):
         alphatradingdesk.local → [Mac's LAN IP, e.g. 192.168.1.42]
    → All devices on the network resolve it automatically
    → Mac's LAN IP should be static (set in macOS Network prefs or router DHCP reservation)

  Option C — mDNS (zero-config, macOS native):
    → macOS already broadcasts hostname.local via Bonjour
    → Rename Mac hostname to "alphatradingdesk" in System Settings → General → Sharing
    → Any device on LAN can reach it as alphatradingdesk.local automatically
    → ⭐ Recommended for simplest setup — no router config needed

Recommended path:
  1. Rename Mac hostname: alphatradingdesk (System Settings → General → Sharing → Local hostname)
  2. Caddy listens on :80 → serves frontend + proxies /api to backend
  3. All LAN devices reach http://alphatradingdesk.local instantly (Bonjour/mDNS)
  4. iPhone, iPad, laptop — all work out of the box on same WiFi

Caddyfile (LAN prod — no TLS needed):
  alphatradingdesk.local {
      # SPA routing
      root * /srv/frontend
      file_server
      try_files {path} /index.html

      # API proxy
      reverse_proxy /api/* backend:8000
      reverse_proxy /ws/*  backend:8000

      # Security headers (even on LAN)
      header X-Frame-Options "SAMEORIGIN"
      header X-Content-Type-Options "nosniff"

      encode gzip
  }
```

### Future: GCE / Cloud (not yet)

```
When ready:
  → Same docker-compose.prod.yml, minimal changes
  → Replace alphatradingdesk.local → real domain (e.g. alphatradingdesk.com)
  → Add TLS block to Caddyfile (Let's Encrypt auto)
  → Move DB to Cloud SQL or keep in container (phase decision)
  → Zero code changes — only infra config

GCE path (when chosen):
  Provider:  Google Cloud Compute Engine (e2-standard-2 or f1-micro to start)
  Region:    europe-west9 (Paris) — closest to you
  Domain:    alphatradingdesk.com (register on Cloudflare, point A record to GCE IP)
```

---

**Next:** → `implement-phase1.md` (implementation plan)
