"""
Phase 2 — Telegram alerting service (P2-11).

Pure functions — no Celery, no DB writes.
Called from tasks.py after each compute cycle.

Two alert types:
  - Market VI alert  : global volatility regime change
  - Watchlist alert  : per-timeframe ranked pairs

Cooldown is enforced via Redis (key: atd:alert_sent:{type}:{timeframe}).
If Redis is down, alerts are sent without cooldown (fail-open — better than silent).

Message format: plain text, no HTML/Markdown (parse_mode omitted — most compatible).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

import httpx

logger = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org"
_TIMEOUT = 8.0  # seconds

# Regime → display label
_REGIME_LABEL: dict[str, str] = {
    "EXTREME":  "EXTREME  (>0.83)",
    "ACTIVE":   "ACTIVE   (0.67–0.83)",
    "TRENDING": "TRENDING (0.50–0.67)",
    "NORMAL":   "NORMAL   (0.33–0.50)",
    "CALM":     "CALM     (0.17–0.33)",
    "DEAD":     "DEAD     (<0.17)",
}

# Regime → actionable summary (matches tasks.py alerts)
_REGIME_SUMMARY: dict[str, str] = {
    "EXTREME":  "Market too hot — size down, widen SL",
    "ACTIVE":   "High momentum — opportunity window open",
    "TRENDING": "Sweet spot for trend-following setups",
    "NORMAL":   "Neutral conditions — standard sizing",
    "CALM":     "Low activity — reduce frequency",
    "DEAD":     "No liquidity — avoid new entries",
}


# ── Internal HTTP helper ──────────────────────────────────────────────────────

def _send(bot_token: str, chat_id: str, text: str) -> bool:
    """POST a message to Telegram Bot API.

    Returns True on success, False on any error (fail-silent).
    """
    url = f"{_TELEGRAM_API}/bot{bot_token}/sendMessage"
    try:
        resp = httpx.post(
            url,
            json={"chat_id": chat_id, "text": text},
            timeout=_TIMEOUT,
        )
        if not resp.is_success:
            logger.warning(
                "Telegram sendMessage failed: status=%d body=%s",
                resp.status_code,
                resp.text[:200],
            )
            return False
        return True
    except Exception as exc:
        logger.warning("Telegram sendMessage error: %s", exc)
        return False


# ── Cooldown helpers ──────────────────────────────────────────────────────────

def _cooldown_key(alert_type: str, timeframe: str) -> str:
    return f"atd:alert_sent:{alert_type}:{timeframe}"


def _is_on_cooldown(alert_type: str, timeframe: str, cooldown_min: int) -> bool:
    """Return True if the alert was sent within cooldown_min minutes."""
    try:
        from src.volatility.cache import _get_redis
        r = _get_redis()
        return r.exists(_cooldown_key(alert_type, timeframe)) == 1
    except Exception:
        return False  # Redis down → allow send


def _set_cooldown(alert_type: str, timeframe: str, cooldown_min: int) -> None:
    """Mark alert as sent in Redis for cooldown_min minutes."""
    try:
        from src.volatility.cache import _get_redis
        r = _get_redis()
        r.setex(_cooldown_key(alert_type, timeframe), cooldown_min * 60, "1")
    except Exception:
        pass  # Redis down — next call will also allow send


# ── Message formatters ────────────────────────────────────────────────────────

def format_market_vi_message(
    vi_score: float,
    regime: str,
    timeframe: str,
    components: dict | None = None,
) -> str:
    """Format a Market VI alert message.

    Example output:
        ATD Market VI — 1H | 14/03 15:00 UTC
        Score: 0.714   Regime: ACTIVE (0.67–0.83)
        High momentum — opportunity window open

        Components: RVOL 0.82 | MFI 0.61 | ATR 0.74 | BB 0.67
    """
    now = datetime.now(UTC).strftime("%d/%m %H:%M UTC")
    lines = [
        f"ATD Market VI — {timeframe.upper()} | {now}",
        f"Score: {vi_score:.3f}   Regime: {_REGIME_LABEL.get(regime, regime)}",
        _REGIME_SUMMARY.get(regime, ""),
    ]
    if components:
        parts = []
        for key in ("rvol", "mfi", "atr", "bb_width"):
            if key in components:
                label = key.upper().replace("_WIDTH", "")
                parts.append(f"{label} {float(components[key]):.2f}")
        if parts:
            lines.append("")
            lines.append("Components: " + " | ".join(parts))
    return "\n".join(lines)


def format_watchlist_message(
    pairs: list[dict],
    timeframe: str,
    market_regime: str,
    market_vi: float,
) -> str:
    """Format a Watchlist alert message grouped by regime.

    Example:
        ATD Watchlist — 1H | 14/03 15:00 UTC
        Market: ACTIVE (0.714)

        EXTREME
          ETHUSDT   0.89  breakout_up    +4.2%
          SOLUSDT   0.85  above_all      +2.8%

        ACTIVE
          AVAXUSDT  0.74  mixed          +1.1%

        -> 3 pairs | setup_ready + opportunity
    """
    now = datetime.now(UTC).strftime("%d/%m %H:%M UTC")
    lines = [
        f"ATD Watchlist — {timeframe.upper()} | {now}",
        f"Market: {market_regime} ({market_vi:.3f})",
        "",
    ]

    # Group by regime in display order
    regime_order = ["EXTREME", "ACTIVE", "TRENDING", "NORMAL", "CALM", "DEAD"]
    grouped: dict[str, list[dict]] = {}
    for p in pairs:
        r = p.get("regime", "NORMAL")
        grouped.setdefault(r, []).append(p)

    for regime in regime_order:
        if regime not in grouped:
            continue
        lines.append(regime)
        for p in grouped[regime]:
            pair = p.get("pair", "?")
            vi = float(p.get("vi_score", 0))
            signal = p.get("ema_signal", "")
            chg = p.get("change_24h")
            chg_str = f"{chg:+.1f}%" if chg is not None else ""
            lines.append(f"  {pair:<14} {vi:.2f}  {signal:<16} {chg_str}")
        lines.append("")

    # Summary line
    alerts = [p.get("alert") for p in pairs if p.get("alert")]
    unique_alerts = list(dict.fromkeys(a for a in alerts if a))  # stable dedup
    lines.append(f"-> {len(pairs)} pairs" + (f" | {', '.join(unique_alerts)}" if unique_alerts else ""))
    return "\n".join(lines)


# ── Public send functions ─────────────────────────────────────────────────────

def send_market_vi_alert(
    notification_cfg: dict,
    vi_score: float,
    regime: str,
    timeframe: str,
    components: dict | None = None,
) -> None:
    """Send a Market VI alert if notifications are enabled and cooldown has elapsed.

    notification_cfg: the `market_vi_alerts` JSONB from NotificationSettings.
    Expected structure:
      {
        "enabled": true,
        "bot_name": "MyBot",          # matched against bots list
        "cooldown_min": 30,
        "regimes": ["ACTIVE", "EXTREME"]  # only alert for these regimes
      }
    bots_cfg: the `bots` list from NotificationSettings.
    """
    if not notification_cfg.get("enabled", False):
        return

    # Filter by configured regimes (empty list = all regimes)
    allowed_regimes: list[str] = notification_cfg.get("regimes", [])
    if allowed_regimes and regime not in allowed_regimes:
        return

    cooldown_min: int = int(notification_cfg.get("cooldown_min", 30))
    if _is_on_cooldown("market_vi", timeframe, cooldown_min):
        logger.debug("send_market_vi_alert: on cooldown (%d min) for %s", cooldown_min, timeframe)
        return

    text = format_market_vi_message(vi_score, regime, timeframe, components)
    _dispatch(notification_cfg, text)
    _set_cooldown("market_vi", timeframe, cooldown_min)


def send_watchlist_alert(
    notification_cfg: dict,
    pairs: list[dict],
    timeframe: str,
    market_regime: str,
    market_vi: float,
) -> None:
    """Send a Watchlist alert if enabled and cooldown has elapsed.

    notification_cfg: the `watchlist_alerts` JSONB from NotificationSettings.
    Expected structure:
      {
        "enabled": true,
        "bot_name": "MyBot",
        "per_tf": {
          "1h": {"enabled": true, "cooldown_min": 60, "vi_min": 0.50}
        }
      }
    """
    if not notification_cfg.get("enabled", False):
        return
    if not pairs:
        return

    # Per-TF config
    per_tf: dict = notification_cfg.get("per_tf", {})
    tf_cfg: dict = per_tf.get(timeframe, {})
    if not tf_cfg.get("enabled", True):
        return

    vi_min: float = float(tf_cfg.get("vi_min", 0.0))
    pairs_filtered = [p for p in pairs if float(p.get("vi_score", 0)) >= vi_min]
    if not pairs_filtered:
        return

    cooldown_min: int = int(tf_cfg.get("cooldown_min", 60))
    if _is_on_cooldown("watchlist", timeframe, cooldown_min):
        logger.debug("send_watchlist_alert: on cooldown (%d min) for %s", cooldown_min, timeframe)
        return

    text = format_watchlist_message(pairs_filtered, timeframe, market_regime, market_vi)
    _dispatch(notification_cfg, text)
    _set_cooldown("watchlist", timeframe, cooldown_min)


# ── Bot dispatch helper ───────────────────────────────────────────────────────

def _dispatch(notification_cfg: dict, text: str) -> None:
    """Resolve bot credentials from notification_cfg and send."""
    # notification_cfg may contain inline credentials OR a bot_name to look up
    bot_token: str | None = notification_cfg.get("bot_token")
    chat_id: str | None = notification_cfg.get("chat_id")

    if not bot_token or not chat_id:
        logger.warning("Telegram dispatch: missing bot_token or chat_id in notification config")
        return

    _send(bot_token, chat_id, text)
