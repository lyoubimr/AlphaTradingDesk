"""
Celery application — Phase 2 Volatility Engine.

Beat schedule:
  Each task fires at maximum frequency (code-defined).
  At runtime, tasks read `volatility_settings` from DB and call
  `is_within_schedule()` to skip if outside the configured hours/days.
  The UI controls execution windows; code controls max trigger frequency.
"""

from celery import Celery
from celery.schedules import crontab

from src.core.config import settings

celery_app = Celery(
    "alphatradingdesk",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=[
        "src.volatility.tasks",  # populated in P2-3
    ],
)

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Timezone
    timezone="UTC",
    enable_utc=True,
    # Result TTL — keep results 24h (volatile data, no need for longer)
    result_expires=86400,
    # Beat schedule — maximum trigger frequency
    # Tasks decide at runtime whether to actually run (via is_within_schedule).
    beat_schedule={
        # ── Market VI (Binance Futures — public API) ──────────────────────
        "market-vi-15m": {
            "task": "src.volatility.tasks.compute_market_vi",
            "schedule": crontab(minute="*/15"),
            "kwargs": {"timeframe": "15m"},
        },
        "market-vi-1h": {
            "task": "src.volatility.tasks.compute_market_vi",
            "schedule": crontab(minute=0),
            "kwargs": {"timeframe": "1h"},
        },
        "market-vi-4h": {
            "task": "src.volatility.tasks.compute_market_vi",
            "schedule": crontab(minute=0, hour="*/4"),
            "kwargs": {"timeframe": "4h"},
        },
        "market-vi-1d": {
            "task": "src.volatility.tasks.compute_market_vi",
            "schedule": crontab(minute=0, hour=0),
            "kwargs": {"timeframe": "1d"},
        },
        "market-vi-1w": {
            "task": "src.volatility.tasks.compute_market_vi",
            "schedule": crontab(minute=0, hour=1, day_of_week="mon"),
            "kwargs": {"timeframe": "1w"},
        },
        # ── Per-Pair VI (Kraken Futures) ──────────────────────────────────
        "pair-vi-15m": {
            "task": "src.volatility.tasks.compute_pair_vi",
            "schedule": crontab(minute="*/15"),
            "kwargs": {"timeframe": "15m"},
        },
        "pair-vi-1h": {
            "task": "src.volatility.tasks.compute_pair_vi",
            "schedule": crontab(minute=0),
            "kwargs": {"timeframe": "1h"},
        },
        "pair-vi-4h": {
            "task": "src.volatility.tasks.compute_pair_vi",
            "schedule": crontab(minute=0, hour="*/4"),
            "kwargs": {"timeframe": "4h"},
        },
        "pair-vi-1d": {
            "task": "src.volatility.tasks.compute_pair_vi",
            "schedule": crontab(minute=0, hour=0),
            "kwargs": {"timeframe": "1d"},
        },
        "pair-vi-1w": {
            "task": "src.volatility.tasks.compute_pair_vi",
            "schedule": crontab(minute=0, hour=1, day_of_week="mon"),
            "kwargs": {"timeframe": "1w"},
        },
        # ── Instruments sync ─────────────────────────────────────────────
        # Kraken pairs upsert + Binance top-100 sync (P2-10)
        "sync-instruments": {
            "task": "src.volatility.tasks.sync_instruments",
            "schedule": crontab(minute=0, hour=2),  # daily at 02:00 UTC
        },
        # ── Stale snapshot cleanup ────────────────────────────────────────
        "cleanup-snapshots": {
            "task": "src.volatility.tasks.cleanup_old_snapshots",
            "schedule": crontab(minute=0, hour=3),  # daily at 03:00 UTC
        },
    },
)
