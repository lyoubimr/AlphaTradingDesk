"""
Ritual Module — Celery tasks (Phase 6B).

Beat schedule:
  notify-trading-windows: */15 min — fires at each 15m mark, notifies profiles
  whose trading window is starting within the current 15-minute slot.

Dedup: Redis key  atd:tw_notif:{profile_id}:{label}:{YYYYMMDD_HHMM}  (TTL 20min)
  prevents duplicate messages if Celery fires slightly late or retries.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from src.core.celery_app import celery_app
from src.core.database import get_session_factory

logger = logging.getLogger(__name__)

_WINDOW_TOLERANCE_MIN = 15  # notify if window starts within next N minutes


@celery_app.task(
    name="src.ritual.tasks.notify_trading_windows",
    bind=True,
    max_retries=0,  # fire-and-forget — never retry (time-sensitive)
    ignore_result=True,
)
def notify_trading_windows(self) -> dict:  # type: ignore[override]
    """Send Telegram notifications to profiles whose trading window is starting now.

    Returns:
        {"status": "ok", "notified": N, "skipped": M}
    """
    from src.ritual.models import RitualPinnedPair, RitualSettings
    from src.ritual.service import _expire_stale_pins
    from src.volatility.cache import _get_redis
    from src.volatility.models import NotificationSettings
    from src.volatility.telegram import send_trading_window_alert

    session_factory = get_session_factory()
    notified = 0
    skipped = 0

    now_utc: datetime = datetime.now(tz=UTC)
    today_dow: int = now_utc.weekday()  # 0=Mon, 6=Sun

    with session_factory() as db:
        # Fetch all ritual settings rows that have notif_best_hours enabled
        rows = db.query(RitualSettings).all()

        for row in rows:
            cfg: dict = row.config or {}
            if not cfg.get("notif_best_hours", False):
                skipped += 1
                continue

            windows: list[dict] = cfg.get("trading_windows", [])
            if not windows:
                skipped += 1
                continue

            # Check notification settings — need at least one configured bot
            notif = db.query(NotificationSettings).filter_by(profile_id=row.profile_id).first()
            if not notif or not notif.bots:
                skipped += 1
                continue

            for window in windows:
                days: list[int] = window.get("days", list(range(7)))
                if today_dow not in days:
                    continue

                start_str: str = window.get("start", "")
                end_str: str = window.get("end", "")
                label: str = window.get("label", "Trading")

                try:
                    h, m = map(int, start_str.split(":"))
                except ValueError:
                    continue

                # Build window start datetime for today (UTC)
                window_start = now_utc.replace(hour=h, minute=m, second=0, microsecond=0)
                delta = (window_start - now_utc).total_seconds() / 60.0

                # Fire only if window_start is between now and now+15min (current beat slot)
                if not (0 <= delta < _WINDOW_TOLERANCE_MIN):
                    continue

                # Dedup via Redis — key unique per profile + label + 15-minute slot
                slot = now_utc.strftime("%Y%m%d_%H%M")
                redis_key = f"atd:tw_notif:{row.profile_id}:{label}:{slot}"
                try:
                    r = _get_redis()
                    if r.get(redis_key):
                        continue  # already sent this slot
                    r.setex(redis_key, 1200, "1")  # TTL 20min
                except Exception:
                    pass  # Redis down — send anyway (fail-open)

                # Count active pins for context
                try:
                    _expire_stale_pins(row.profile_id, db)
                    active_pins = db.query(RitualPinnedPair).filter_by(
                        profile_id=row.profile_id, status="active"
                    ).count()
                except Exception:
                    active_pins = 0

                # Resolve bot
                bots = notif.bots or []
                if not bots:
                    continue
                bot = bots[0]
                bot_token: str | None = bot.get("bot_token")
                chat_id: str | None = bot.get("chat_id")
                if not bot_token or not chat_id:
                    continue

                try:
                    ok = send_trading_window_alert(
                        bot_token=bot_token,
                        chat_id=chat_id,
                        label=label,
                        start=start_str,
                        end=end_str,
                        active_pins=active_pins,
                    )
                    if ok:
                        notified += 1
                        logger.info(
                            "ritual.notify_trading_windows: sent to profile=%d window=%r",
                            row.profile_id,
                            label,
                        )
                except Exception as exc:
                    logger.warning(
                        "ritual.notify_trading_windows: failed profile=%d window=%r err=%s",
                        row.profile_id,
                        label,
                        exc,
                    )

    return {"status": "ok", "notified": notified, "skipped": skipped}
