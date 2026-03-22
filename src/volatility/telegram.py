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

# Default message templates — can be overridden via MarketVIAlertsCfg.message_template
# Variables: {timeframe} {score} {regime} {summary} {components}
_DEFAULT_REGIME_TEMPLATE = (
    "\U0001f514 ATD Market VI \u2014 {timeframe}\n\n"
    "Score: {score}   Regime: {regime}\n"
    "{summary}\n\n"
    "Components: {components}"
)


def format_market_vi_message(
    vi_score: float,
    regime: str,
    timeframe: str,
    components: dict | None = None,
    template: str | None = None,
) -> str:
    """Format a Market VI alert message.

    Example output:
        ATD Market VI — 1H | 14/03 15:00 UTC
        Score: 0.714   Regime: ACTIVE (0.67–0.83)
        High momentum — opportunity window open

        Components: RVOL 0.82 | MFI 0.61 | ATR 0.74 | BB 0.67
    """
    # Build component string
    comp_parts: list[str] = []
    if components:
        for key in ("rvol", "mfi", "atr", "bb_width"):
            if key in components:
                label = key.upper().replace("_WIDTH", "")
                comp_parts.append(f"{label} {float(components[key]):.2f}")
    comp_str = " | ".join(comp_parts) if comp_parts else "\u2014"

    if template:
        try:
            return template.format(
                timeframe=timeframe.upper(),
                score=f"{vi_score:.3f}",
                regime=_REGIME_LABEL.get(regime, regime),
                summary=_REGIME_SUMMARY.get(regime, ""),
                components=comp_str,
            )
        except (KeyError, ValueError):
            logger.warning("format_market_vi_message: invalid template, falling back to default")

    # Default format
    now = datetime.now(UTC).strftime("%d/%m %H:%M UTC")
    lines = [
        f"ATD Market VI \u2014 {timeframe.upper()} | {now}",
        f"Score: {vi_score:.3f}   Regime: {_REGIME_LABEL.get(regime, regime)}",
        _REGIME_SUMMARY.get(regime, ""),
    ]
    if comp_parts:
        lines.append("")
        lines.append("Components: " + comp_str)
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

    template: str | None = notification_cfg.get("message_template") or None
    text = format_market_vi_message(vi_score, regime, timeframe, components, template=template)
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

def _dispatch(notification_cfg: dict, text: str) -> bool:
    """Resolve bot credentials from notification_cfg and send. Returns True on success."""
    # notification_cfg may contain inline credentials OR a bot_name to look up
    bot_token: str | None = notification_cfg.get("bot_token")
    chat_id: str | None = notification_cfg.get("chat_id")

    if not bot_token or not chat_id:
        logger.warning("Telegram dispatch: missing bot_token or chat_id in notification config")
        return False

    return _send(bot_token, chat_id, text)


# ── VI Level / Range alerts ───────────────────────────────────────────────────

def send_vi_level_alerts(
    cfg: dict,
    market_vi_100: float,
    timeframe: str,
    vi_levels: list,
    prev_score_100: float | None,
    profile_id: int | None = None,
) -> None:
    """Check each configured VI level/range alert and send if triggered.

    vi_levels item schema:
      type: 'crossing' | 'range'
      -- crossing: value (0-100), direction: 'up'|'down'|'both'
      -- range:    min (0-100), max (0-100)
      id, label?, enabled, cooldown_min
    """
    bot_token = cfg.get("bot_token")
    chat_id   = cfg.get("chat_id")
    if not bot_token or not chat_id:
        return

    tf_label = timeframe.upper()
    curr = market_vi_100

    try:
        from src.volatility.cache import _get_redis
        r = _get_redis()
    except Exception:
        r = None  # fail-open: alerts sent without cooldown if Redis is down

    for lv in vi_levels:
        if not lv.get("enabled", False):
            continue

        ltype    = lv.get("type", "crossing")
        cooldown = max(1, int(lv.get("cooldown_min", 30)))
        level_id = str(lv.get("id", lv.get("value", "custom")))
        label    = lv.get("label") or ""

        # ── TF filter — skip if level targets a different timeframe ────────
        lv_timeframe = lv.get("timeframe")
        if lv_timeframe and lv_timeframe != timeframe:
            continue

        # ── Day type filter — workday vs weekend ──────────────────────────
        lv_day_type = lv.get("day_type")
        if lv_day_type and lv_day_type != "any":
            from datetime import datetime, timezone  # noqa: PLC0415
            is_weekend = datetime.now(timezone.utc).weekday() >= 5
            if lv_day_type == "workday" and is_weekend:
                continue
            if lv_day_type == "weekend" and not is_weekend:
                continue

        # ── Cooldown check ────────────────────────────────────────────────
        pid_part = f":{profile_id}" if profile_id is not None else ""
        ck = f"atd:alert_sent:vi_level{pid_part}:{timeframe}:{level_id}"
        try:
            if r and r.exists(ck):
                continue
        except Exception:
            pass

        # ── Trigger check ─────────────────────────────────────────────────
        triggered = False
        direction_arrow = "→"

        if ltype == "crossing":
            tval = float(lv.get("value", 0))
            tol  = max(0.0, float(lv.get("tolerance", 0.5)))
            ldir = lv.get("direction", "both")
            in_zone = abs(curr - tval) <= tol
            if prev_score_100 is None:
                # First cycle — fire immediately if VI is already inside the zone
                triggered = in_zone
            else:
                # Transition-based: fire when VI enters the ±tolerance zone
                up   = (prev_score_100 <= tval - tol) and (curr >= tval - tol)
                down = (prev_score_100 >= tval + tol) and (curr <= tval + tol)
                if ldir == "both":
                    triggered = up or down
                elif ldir == "up":
                    triggered = up
                else:
                    triggered = down
                direction_arrow = "↑" if (prev_score_100 is not None and curr > prev_score_100) else "↓"
        elif ltype == "range":
            rmin = float(lv.get("min", 0))
            rmax = float(lv.get("max", 100))
            triggered = rmin <= curr <= rmax

        if not triggered:
            continue

        # ── Set cooldown ──────────────────────────────────────────────────
        try:
            if r:
                r.setex(ck, cooldown * 60, "1")
        except Exception:
            pass

        # ── Build & send message ──────────────────────────────────────────
        score_str = f"{curr:.1f}"
        if ltype == "crossing":
            tval   = float(lv.get("value", 0))
            header = label or f"Level {tval:.0f} crossed"
            msg = (
                f"🔔 VI Level Alert — {tf_label}\n\n"
                f"{header} {direction_arrow}\n"
                f"Current VI: {score_str}\n"
                f"Threshold: {tval:.0f}"
            )
        else:
            rmin = float(lv.get("min", 0))
            rmax = float(lv.get("max", 100))
            header = label or f"Range {rmin:.0f}–{rmax:.0f}"
            msg = (
                f"🔔 VI Range Alert — {tf_label}\n\n"
                f"{header}\n"
                f"Current VI: {score_str} — in range [{rmin:.0f}, {rmax:.0f}]"
            )

        _send(bot_token, chat_id, msg)
