# ⚙️ Scheduling System - AlphaTradingDesk

**Date:** March 1, 2026  
**Version:** 1.0  
**Engine:** Celery 5+ with Redis broker

> **Phase 1 note:** No scheduled tasks in Phase 1 (manual only).  
> Celery infrastructure is set up but idle until Phase 2.

---

## 🏗️ Architecture

```
Celery Beat (scheduler)
    ↓ triggers tasks on schedule
Celery Worker(s)
    ↓ executes tasks
    ├─ Fetch OHLCV (Kraken/Binance)
    ├─ Compute Volatility Index
    ├─ Generate Watchlists
    ├─ Sync Capital (Phase 4)
    └─ Manage Auto-Positions (Phase 4)
    ↓
PostgreSQL + Redis
    └─ Store results + publish WebSocket events
```

---

## 📋 Task Registry

### Phase 2 Tasks

| Task | Schedule | Timeout | Description |
|------|----------|---------|-------------|
| `volatility.calculate_all_pairs` | Every 15 min | 5 min | Compute VI for all tracked pairs |
| `market_data.fetch_ohlcv` | Every 15 min | 3 min | Fetch latest OHLCV from Kraken/Binance |

### Phase 3 Tasks

| Task | Schedule | Timeout | Description |
|------|----------|---------|-------------|
| `watchlist.generate_weekly` | Mon 01:02 UTC | 10 min | Generate weekly watchlists (1d/1w focus) |
| `watchlist.generate_daily` | Daily 00:05 UTC | 5 min | Generate daily watchlists (4h/1d focus) |
| `watchlist.generate_4h` | Every 4h | 3 min | Generate 4h watchlists (1h/4h focus) |
| `watchlist.generate_hourly` | Every 1h at :05 | 2 min | Generate hourly watchlists (15m/1h focus) |

### Phase 4 Tasks

| Task | Schedule | Timeout | Description |
|------|----------|---------|-------------|
| `automation.sync_kraken_balance` | Every 5 min | 30 sec | Sync capital from Kraken API |
| `automation.check_trading_signals` | Every 15 min | 2 min | Check VI+EMA conditions for signals |
| `automation.manage_open_positions` | Every 5 min | 2 min | Monitor/adjust open auto-positions |

---

## 🐍 Celery Configuration

### `src/core/celery_app.py`

```python
from celery import Celery
from celery.schedules import crontab
from src.core.config import settings

app = Celery(
    "alphatrading",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "src.tasks.market_data",   # Phase 2
        "src.tasks.volatility",    # Phase 2
        "src.tasks.watchlist",     # Phase 3
        "src.tasks.automation",    # Phase 4
    ]
)

app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,

    # Task behavior
    task_acks_late=True,          # Acknowledge after execution (prevents loss on crash)
    task_reject_on_worker_lost=True,
    task_track_started=True,

    # Result expiry
    result_expires=3600,          # 1 hour

    # Rate limiting
    task_default_rate_limit="100/m",

    # Retry defaults
    task_max_retries=3,
    task_default_retry_delay=60,  # 1 minute

    # Beat schedule (Phase 2+)
    beat_schedule={
        # ── PHASE 2 ──────────────────────────────────────────────
        "fetch-ohlcv": {
            "task": "src.tasks.market_data.fetch_ohlcv_all_pairs",
            "schedule": crontab(minute="*/15"),
            "kwargs": {"timeframes": ["15m", "1h", "4h", "1d", "1w"]},
            "options": {"expires": 14 * 60},  # Expire if not picked up in 14min
        },
        "calculate-volatility": {
            "task": "src.tasks.volatility.calculate_all_pairs",
            "schedule": crontab(minute="*/15"),
            "kwargs": {"timeframes": ["15m", "1h", "4h", "1d", "1w"]},
            "options": {"expires": 14 * 60},
        },

        # ── PHASE 3 ──────────────────────────────────────────────
        "generate-watchlists-weekly": {
            "task": "src.tasks.watchlist.generate_all_styles",
            "schedule": crontab(day_of_week=0, hour=1, minute=2),
            "kwargs": {"timeframe_focus": "1w"},
        },
        "generate-watchlists-daily": {
            "task": "src.tasks.watchlist.generate_all_styles",
            "schedule": crontab(hour=0, minute=5),
            "kwargs": {"timeframe_focus": "1d"},
        },
        "generate-watchlists-4h": {
            "task": "src.tasks.watchlist.generate_all_styles",
            "schedule": crontab(hour="*/4"),
            "kwargs": {"timeframe_focus": "4h"},
        },
        "generate-watchlists-hourly": {
            "task": "src.tasks.watchlist.generate_all_styles",
            "schedule": crontab(minute=5),
            "kwargs": {"timeframe_focus": "1h"},
        },

        # ── PHASE 4 ──────────────────────────────────────────────
        "sync-kraken-balance": {
            "task": "src.tasks.automation.sync_kraken_balance",
            "schedule": crontab(minute="*/5"),
            "options": {"expires": 4 * 60},
        },
        "check-trading-signals": {
            "task": "src.tasks.automation.check_trading_signals",
            "schedule": crontab(minute="*/15"),
            "options": {"expires": 14 * 60},
        },
        "manage-open-positions": {
            "task": "src.tasks.automation.manage_open_positions",
            "schedule": crontab(minute="*/5"),
            "options": {"expires": 4 * 60},
        },
    },
)
```

---

## 🧱 Task Structure

### Example: Volatility Task

```python
# src/tasks/volatility.py
from src.core.celery_app import app
from src.volatility.calculator import VolatilityCalculator
from src.core.database import get_db_session
import logging

logger = logging.getLogger(__name__)

@app.task(
    name="src.tasks.volatility.calculate_all_pairs",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    soft_time_limit=240,   # 4 min soft kill
    time_limit=300,        # 5 min hard kill
)
def calculate_all_pairs(self, timeframes: list[str]):
    """
    Compute Volatility Index for all tracked pairs.
    Publishes results to Redis (WebSocket pickup).
    """
    try:
        with get_db_session() as session:
            calculator = VolatilityCalculator(session)
            results = calculator.run(timeframes=timeframes)

            # Publish to WebSocket via Redis pub/sub
            from src.core.redis_client import redis_client
            redis_client.publish("volatility_updates", results.to_json())

            logger.info(f"VI calculated for {len(results)} pairs")
            return {"status": "success", "pairs_count": len(results)}

    except Exception as exc:
        logger.error(f"VI calculation failed: {exc}")
        raise self.retry(exc=exc)
```

---

## 📊 Task Monitoring

### Celery Flower (Phase 4 optional)

```
URL:      http://localhost:5555
Purpose:  Visual task monitoring (queue depth, success/failure, timing)
```

### Task Status in DB

All task executions logged to `scheduled_task_runs` table:

```sql
CREATE TABLE scheduled_task_runs (
    id BIGSERIAL PRIMARY KEY,
    task_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,    -- 'running', 'success', 'failed'
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    duration_ms INT,
    error_message TEXT,
    result_summary JSONB
);
```

### UI: /settings/scheduler

```
Task list:
├─ Calculate Volatility      [● Running]  Last: 14:30 (0.8s)  Next: 14:45
├─ Generate Watchlists       [● Enabled]  Last: 00:05 (3.2s)  Next: 00:05+1d
├─ Sync Capital (P4)         [○ Disabled] ──
└─ Auto-Trade Signals (P4)   [○ Disabled] ── ⚠️ REAL MONEY

Job History (last 24h):
Task                  | Status  | Duration | Timestamp
Calculate Volatility  | ✅ OK   | 0.8s     | 14:30 UTC
Calculate Volatility  | ✅ OK   | 0.9s     | 14:15 UTC
Calculate Volatility  | ❌ FAIL | -        | 14:00 UTC  [Error: API timeout]
```

---

## ⚠️ Error Handling

```
Retry Policy:
├─ Max 3 retries
├─ Exponential backoff: 60s, 120s, 240s
└─ Dead-letter queue after 3 failures (logged in DB)

Alerting:
├─ Phase 2: Log errors to DB only
├─ Phase 3: Log + UI warning badge
└─ Phase 4: Log + Telegram notification (critical tasks)

Overlap Prevention:
└─ task_acks_late=True + unique task IDs prevent duplicate execution
```

---

**Next Document:** → `CI_CD.md`
