# 🔌 API Specification - AlphaTradingDesk

**Date:** February 22, 2026  
**Version:** 1.0  
**Base URL:** `http://localhost:8000/api` (dev) or `https://yourdomain.com/api` (prod)

---

## 📋 API Overview

```
Authentication:  JWT Bearer Token
Content-Type:    application/json
Response Format: JSON
WebSocket:       /ws (real-time updates)
Documentation:   /docs (Swagger UI) or /redoc (ReDoc)
```

---

## 🔐 Authentication

### Login

```
POST /auth/login

Request:
{
  "username": "user@example.com",
  "password": "password"
}

Response (200 OK):
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 3600
}

Errors:
- 401: Invalid credentials
- 422: Validation error
```

### Refresh Token

```
POST /auth/refresh

Headers:
Authorization: Bearer <refresh_token>

Response (200 OK):
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 3600
}
```

### Logout

```
POST /auth/logout

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{ "message": "Logged out successfully" }
```

---

## 👤 User Endpoints

### Get Current User

```
GET /users/me

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "id": 1,
  "username": "trader1",
  "email": "trader@example.com",
  "created_at": "2026-02-22T10:00:00Z"
}
```

### Update User Profile

```
PATCH /users/me

Headers:
Authorization: Bearer <access_token>

Request:
{
  "username": "new_username",
  "email": "new_email@example.com"
}

Response (200 OK):
{
  "id": 1,
  "username": "new_username",
  "email": "new_email@example.com",
  "updated_at": "2026-02-22T11:00:00Z"
}
```

---

## 📊 Profile Endpoints (Trading Profiles)

### Create Profile

```
POST /profiles

Headers:
Authorization: Bearer <access_token>

Request:
{
  "name": "My Trading Account",
  "market_type": "Crypto",
  "capital_start": 10000.00,
  "risk_percentage_default": 2.0,
  "description": "Trading BTC and ETH"
}

Response (201 Created):
{
  "id": 1,
  "name": "My Trading Account",
  "market_type": "Crypto",
  "capital_start": 10000.00,
  "capital_current": 10000.00,
  "risk_percentage_default": 2.0,
  "created_at": "2026-02-22T10:00:00Z"
}
```

### List Profiles

```
GET /profiles

Headers:
Authorization: Bearer <access_token>

Query Parameters:
- status: "active" | "archived" | "deleted"
- limit: int (default 20)
- offset: int (default 0)

Response (200 OK):
{
  "items": [
    {
      "id": 1,
      "name": "My Trading Account",
      "market_type": "Crypto",
      "capital_current": 10000.00,
      ...
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### Get Profile

```
GET /profiles/{profile_id}

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "id": 1,
  "name": "My Trading Account",
  "market_type": "Crypto",
  "capital_start": 10000.00,
  "capital_current": 10050.00,
  "risk_percentage_default": 2.0,
  "created_at": "2026-02-22T10:00:00Z",
  "updated_at": "2026-02-22T11:00:00Z"
}
```

### Update Profile

```
PATCH /profiles/{profile_id}

Headers:
Authorization: Bearer <access_token>

Request:
{
  "name": "Updated Name",
  "risk_percentage_default": 2.5,
  "capital_current": 10050.00
}

Response (200 OK):
{ ... profile updated ... }
```

### Archive Profile

```
DELETE /profiles/{profile_id}

Headers:
Authorization: Bearer <access_token>

Response (204 No Content):
```

---

## 🔄 Trade Endpoints

### Create Trade

```
POST /profiles/{profile_id}/trades

Headers:
Authorization: Bearer <access_token>

Request:
{
  "pair": "BTC/USD",
  "direction": "long",
  "entry_price": 50000.00,
  "stop_loss": 49000.00,
  "nb_take_profits": 3,
  "take_profits": [
    { "price": 51000.00, "percentage": 30 },
    { "price": 52000.00, "percentage": 40 },
    { "price": 53000.00, "percentage": 30 }
  ],
  "notes": "Technical breakout from support",
  "strategy_id": 1,
  "screenshot_urls": ["https://..."]
}

Response (201 Created):
{
  "id": 123,
  "profile_id": 1,
  "pair": "BTC/USD",
  "direction": "long",
  "entry_price": 50000.00,
  "stop_loss": 49000.00,
  "status": "open",
  "risk_amount": 200.00,
  "potential_profit": 600.00,
  "positions": [
    { "id": 1, "position_number": 1, "take_profit_price": 51000.00, "lot_percentage": 30 },
    { "id": 2, "position_number": 2, "take_profit_price": 52000.00, "lot_percentage": 40 },
    { "id": 3, "position_number": 3, "take_profit_price": 53000.00, "lot_percentage": 30 }
  ],
  "created_at": "2026-02-22T10:00:00Z"
}

Errors:
- 400: Invalid take_profit percentages (must sum to 100)
- 422: Validation error
```

### List Trades

```
GET /profiles/{profile_id}/trades

Headers:
Authorization: Bearer <access_token>

Query Parameters:
- status: "open" | "partial" | "closed"
- pair: "BTC/USD"
- strategy_id: int
- tag_id: int
- date_from: ISO date
- date_to: ISO date
- limit: int (default 20)
- offset: int (default 0)
- sort_by: "created_at" | "entry_date" | "realized_pnl"
- order: "asc" | "desc"

Response (200 OK):
{
  "items": [
    {
      "id": 123,
      "pair": "BTC/USD",
      "direction": "long",
      "entry_price": 50000.00,
      "status": "open",
      "risk_amount": 200.00,
      "positions_count": 3,
      "created_at": "2026-02-22T10:00:00Z"
    }
  ],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

### Get Trade

```
GET /profiles/{profile_id}/trades/{trade_id}

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "id": 123,
  "profile_id": 1,
  "pair": "BTC/USD",
  "direction": "long",
  "entry_price": 50000.00,
  "stop_loss": 49000.00,
  "status": "open",
  "risk_amount": 200.00,
  "potential_profit": 600.00,
  "positions": [
    {
      "id": 1,
      "position_number": 1,
      "take_profit_price": 51000.00,
      "lot_percentage": 30,
      "status": "open",
      "exit_price": null,
      "realized_pnl": null
    },
    ...
  ],
  "tags": [
    { "id": 1, "name": "breakout" },
    { "id": 2, "name": "momentum" }
  ],
  "strategy": {
    "id": 1,
    "name": "Support Breakout"
  },
  "notes": "Technical breakout from support",
  "screenshot_urls": ["https://..."],
  "created_at": "2026-02-22T10:00:00Z",
  "updated_at": "2026-02-22T10:00:00Z"
}
```

### Update Trade

```
PATCH /profiles/{profile_id}/trades/{trade_id}

Headers:
Authorization: Bearer <access_token>

Request:
{
  "notes": "Updated notes",
  "strategy_id": 2,
  "stop_loss": 48500.00
}

Response (200 OK):
{ ... trade updated ... }
```

### Close Position

```
POST /profiles/{profile_id}/trades/{trade_id}/positions/{position_id}/close

Headers:
Authorization: Bearer <access_token>

Request:
{
  "exit_price": 51000.00,
  "exit_date": "2026-02-22T14:30:00Z"
}

Response (200 OK):
{
  "id": 1,
  "position_number": 1,
  "status": "closed",
  "take_profit_price": 51000.00,
  "exit_price": 51000.00,
  "realized_pnl": 300.00,
  "exit_date": "2026-02-22T14:30:00Z"
}

Backend calculation:
- lot_size = risk_amount / (entry - stop_loss) = 200 / 1000 = 0.2 BTC
- position_lot = lot_size * (lot_percentage / 100) = 0.2 * 0.30 = 0.06 BTC
- realized_pnl = position_lot * (exit_price - entry_price) = 0.06 * 1000 = 600 (for position 1)

Total profit = sum of all positions' P&L
```

### Delete Trade

```
DELETE /profiles/{profile_id}/trades/{trade_id}

Headers:
Authorization: Bearer <access_token>

Response (204 No Content):
```

---

## 🏷️ Tag Endpoints

### Create Tag

```
POST /profiles/{profile_id}/tags

Headers:
Authorization: Bearer <access_token>

Request:
{
  "name": "breakout",
  "color": "#FF5733",
  "emoji": "📈"
}

Response (201 Created):
{
  "id": 1,
  "profile_id": 1,
  "name": "breakout",
  "color": "#FF5733",
  "emoji": "📈",
  "created_at": "2026-02-22T10:00:00Z"
}
```

### List Tags

```
GET /profiles/{profile_id}/tags

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "items": [
    { "id": 1, "name": "breakout", "color": "#FF5733", "emoji": "📈" },
    { "id": 2, "name": "momentum", "color": "#33FF57", "emoji": "🚀" }
  ]
}
```

### Add Tag to Trade

```
POST /profiles/{profile_id}/trades/{trade_id}/tags/{tag_id}

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "trade_id": 123,
  "tag_id": 1,
  "created_at": "2026-02-22T10:00:00Z"
}
```

### Remove Tag from Trade

```
DELETE /profiles/{profile_id}/trades/{trade_id}/tags/{tag_id}

Headers:
Authorization: Bearer <access_token>

Response (204 No Content):
```

---

## 📈 Strategy Endpoints

### Create Strategy

```
POST /profiles/{profile_id}/strategies

Headers:
Authorization: Bearer <access_token>

Request:
{
  "name": "Support Breakout",
  "description": "Trade breakouts from identified support levels",
  "rules": "1. Identify support level\n2. Wait for bounce attempt\n3. Enter on breakout",
  "color": "#FF5733",
  "emoji": "📊"
}

Response (201 Created):
{
  "id": 1,
  "profile_id": 1,
  "name": "Support Breakout",
  "description": "Trade breakouts from identified support levels",
  "rules": "1. Identify support level\n2. Wait for bounce attempt\n3. Enter on breakout",
  "color": "#FF5733",
  "emoji": "📊",
  "created_at": "2026-02-22T10:00:00Z"
}
```

### List Strategies

```
GET /profiles/{profile_id}/strategies

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "items": [
    { "id": 1, "name": "Support Breakout", ... },
    { "id": 2, "name": "EMA Cross", ... }
  ]
}
```

---

## 📊 Performance Endpoints

### Get Dashboard Summary

```
GET /profiles/{profile_id}/dashboard

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "profile": {
    "name": "My Trading Account",
    "capital_start": 10000.00,
    "capital_current": 10500.00
  },
  "statistics": {
    "total_trades": 50,
    "open_trades": 3,
    "closed_trades": 47,
    "win_count": 28,
    "loss_count": 19,
    "win_rate": 59.57,
    "profit_factor": 2.31,
    "total_pnl": 500.00,
    "pnl_percent": 5.0
  },
  "recent_trades": [
    {
      "id": 123,
      "pair": "BTC/USD",
      "direction": "long",
      "realized_pnl": 300.00,
      "closed_at": "2026-02-22T14:30:00Z"
    }
  ],
  "equity_curve": {
    "dates": ["2026-02-01", "2026-02-02", ...],
    "values": [10000, 10100, 10050, ...]
  }
}
```

### Get Performance Snapshots

```
GET /profiles/{profile_id}/performance

Headers:
Authorization: Bearer <access_token>

Query Parameters:
- date_from: ISO date
- date_to: ISO date
- limit: int (default 30)

Response (200 OK):
{
  "items": [
    {
      "snapshot_date": "2026-02-22",
      "capital_start": 10000.00,
      "capital_current": 10100.00,
      "pnl_absolute": 100.00,
      "pnl_percent": 1.0,
      "win_count": 2,
      "loss_count": 1,
      "win_rate": 66.67,
      "profit_factor": 3.0,
      "max_drawdown": -2.5
    }
  ]
}
```

---

## 🔌 WebSocket Endpoints (Phase 2+)

### Connect

```
WS /ws

Query Parameters:
- token: JWT access token

JavaScript Example:
const ws = new WebSocket('ws://localhost:8000/ws?token=<access_token>');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

### Message Types

#### Real-Time Volatility Update (Phase 2+)

```
{
  "type": "volatility_update",
  "data": {
    "pair": "BTC/USD",
    "timeframe": "1h",
    "vi_score": 0.65,
    "timestamp": "2026-02-22T14:30:00Z"
  }
}
```

#### Trade Notification (Phase 4+)

```
{
  "type": "trade_notification",
  "data": {
    "event": "position_closed",
    "trade_id": 123,
    "position_id": 1,
    "realized_pnl": 300.00,
    "timestamp": "2026-02-22T14:30:00Z"
  }
}
```

---

## 🟩 Phase 2 Endpoints (Volatility)

### Get Volatility Index

```
GET /volatility/snapshot

Query Parameters:
- timeframe: "15m" | "1h" | "4h" | "1d" | "1w"

Response (200 OK):
{
  "timestamp": "2026-02-22T14:30:00Z",
  "market_regime": "bull",
  "btc_dominance": 52.3,
  "pairs": [
    {
      "pair": "BTC/USD",
      "vi_score": 0.65,
      "volume_component": 0.60,
      "obv_component": 0.70,
      "atr_component": 0.65,
      "price_component": 0.50,
      "ema_component": 0.70
    },
    ...
  ]
}
```

### Get Pair VI History

```
GET /volatility/pairs/{pair}/history

Query Parameters:
- timeframe: "15m" | "1h" | "4h" | "1d" | "1w"
- limit: int (default 100)

Response (200 OK):
{
  "pair": "BTC/USD",
  "timeframe": "1h",
  "data": [
    { "timestamp": "2026-02-22T13:00:00Z", "vi_score": 0.63 },
    { "timestamp": "2026-02-22T14:00:00Z", "vi_score": 0.65 },
    ...
  ]
}
```

---

## 🟨 Phase 3 Endpoints (Watchlists)

### Get Watchlists

```
GET /watchlists

Query Parameters:
- style: "scalping" | "intraday" | "swing" | "position"
- limit: int (default 20)

Response (200 OK):
{
  "style": "scalping",
  "generated_at": "2026-02-22T14:30:00Z",
  "pairs_by_tier": {
    "S": [
      { "pair": "BTC/USD", "vi_score": 0.85, "volume_24h": 100000000, "rank": 1 },
      ...
    ],
    "A": [...],
    "B": [...],
    "C": [...]
  }
}
```

---

## 🟪 Phase 4 Endpoints (Auto-Trading)

### Get Automation Settings

```
GET /profiles/{profile_id}/automation

Headers:
Authorization: Bearer <access_token>

Response (200 OK):
{
  "id": 1,
  "profile_id": 1,
  "enabled": false,
  "market_vi_threshold": 0.5,
  "max_positions": 3,
  "risk_per_trade": 1.5,
  "portfolio_risk_cap": 10.0,
  "pair_whitelist": ["BTC/USD", "ETH/USD"],
  "strategies_enabled": { "vi_ema": true },
  "notify_on_signal": true,
  "notify_on_fill": true,
  "notify_on_error": true
}
```

### Update Automation Settings

```
PATCH /profiles/{profile_id}/automation

Headers:
Authorization: Bearer <access_token>

Request:
{
  "enabled": true,
  "max_positions": 5,
  "risk_per_trade": 2.0
}

Response (200 OK):
{ ... settings updated ... }
```

### Get Capital Sync History

```
GET /profiles/{profile_id}/capital-sync-history

Headers:
Authorization: Bearer <access_token>

Query Parameters:
- limit: int (default 50)

Response (200 OK):
{
  "items": [
    {
      "timestamp": "2026-02-22T14:30:00Z",
      "kraken_balance": 10500.00,
      "expected_balance": 10500.00,
      "difference": 0.00,
      "alert_raised": false
    }
  ]
}
```

---

## ⚠️ Error Responses

All errors follow this format:

```json
{
  "detail": "Error message",
  "error_code": "ERROR_CODE",
  "status_code": 400
}
```

### Common Status Codes

```
200 OK              - Success
201 Created         - Resource created
204 No Content      - Success, no response body
400 Bad Request     - Invalid request data
401 Unauthorized    - Missing/invalid token
403 Forbidden       - User doesn't have permission
404 Not Found       - Resource not found
422 Unprocessable   - Validation error
429 Too Many        - Rate limited
500 Server Error    - Unexpected error
```

### Validation Error Example

```
422 Unprocessable Entity

{
  "detail": [
    {
      "loc": ["body", "capital_start"],
      "msg": "ensure this value is greater than 0",
      "type": "value_error.number.not_gt"
    }
  ]
}
```

---

## 📊 Rate Limiting

```
Limit:       100 requests per minute per user
Window:      60 seconds
Headers:     X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

On rate limit (429 Too Many Requests):
```json
{
  "detail": "Rate limit exceeded",
  "reset_at": "2026-02-22T14:31:00Z"
}
```

---

## 📝 Pagination

All list endpoints support pagination:

```
Query Parameters:
- limit: Number of items (default 20, max 100)
- offset: Number of items to skip (default 0)

Response:
{
  "items": [...],
  "total": 150,
  "limit": 20,
  "offset": 0
}
```

---

**Auto-generated API docs available at:**
- Swagger UI: `/docs`
- ReDoc: `/redoc`
- OpenAPI JSON: `/openapi.json`

---

**Next Document:** → `SCHEDULING.md` (Celery Beat tasks)
