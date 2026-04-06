"""
Phase 2 — Telegram alerting service (P2-11).

Pure functions — no Celery, no DB writes.
Called from tasks.py after each compute cycle.

Two alert types:
  - Market VI alert  : global volatility regime change
  - Watchlist alert  : per-timeframe ranked pairs

Cooldown is enforced via Redis (key: atd:alert_sent:{type}:{timeframe}).
If Redis is down, alerts are sent without cooldown (fail-open — better than silent).

Message format: Telegram HTML (parse_mode=HTML). Use <b>, <i>, <code> tags in custom templates.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

logger = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org"
_TIMEOUT = 8.0  # seconds
_APP_ENV = os.getenv("APP_ENV", "dev")


def _now_local() -> datetime:
    """Return current time in the configured timezone (APP_TIMEZONE env var, default UTC)."""
    tz_name = os.getenv("APP_TIMEZONE", "UTC")
    try:
        tz = ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, KeyError):
        logger.warning("Telegram: unknown APP_TIMEZONE=%r, falling back to UTC", tz_name)
        tz = ZoneInfo("UTC")
    return datetime.now(tz)

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

# Regime → emoji
_REGIME_EMOJI: dict[str, str] = {
    "EXTREME":  "🔥",
    "ACTIVE":   "⚡",
    "TRENDING": "📈",
    "NORMAL":   "⚖️",
    "CALM":     "😴",
    "DEAD":     "💀",
}


def _he(s: str) -> str:
    """Minimal HTML escape for Telegram HTML parse mode."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _fmt_price(v) -> str:
    """Format a price value removing trailing decimal zeros (e.g. '315.25000000' → '315.25')."""
    try:
        return f"{float(v):.8g}"
    except (TypeError, ValueError):
        return str(v)


def _score_100_to_regime(score_100: float) -> str:
    """Map VI score (0–100) to regime using default thresholds."""
    s = score_100 / 100.0
    if s <= 0.17:
        return "DEAD"
    if s <= 0.33:
        return "CALM"
    if s <= 0.50:
        return "NORMAL"
    if s <= 0.67:
        return "TRENDING"
    if s <= 0.83:
        return "ACTIVE"
    return "EXTREME"


# ── Internal HTTP helper ──────────────────────────────────────────────────────

def _send(bot_token: str, chat_id: str, text: str, parse_mode: str = "HTML") -> bool:
    """POST a message to Telegram Bot API.

    Returns True on success, False on any error (fail-silent).
    """
    url = f"{_TELEGRAM_API}/bot{bot_token}/sendMessage"
    try:
        resp = httpx.post(
            url,
            json={"chat_id": chat_id, "text": text, "parse_mode": parse_mode},
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

# Default send-interval (minutes) per timeframe — mirrors the frontend defaults.
# Used as fallback when per_tf_status is absent from a DB record (e.g. records
# created before per_tf_status was added in the notification settings refactor).
_DEFAULT_STATUS_INTERVALS: dict[str, int] = {
    "aggregated": 120,
    "15m": 240,
    "1h": 480,
    "4h": 960,
    "1d": 1440,
}

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

# Legacy plain-text template saved before HTML format was introduced — treated as «no template»
_LEGACY_REGIME_TEMPLATE = (
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
    is_trigger: bool = False,
    prev_score: float | None = None,  # 0.0–1.0 range; arrow shown when provided
) -> str:
    """Format a Market VI alert message.

    Example output (default HTML):
        📡 VI Status · 1H

        📈 TRENDING ↑
        <i>Sweet spot for trend-following setups</i>

        <code>◦ VI 57.2 | RVOL 0.82 | MFI 0.61 | ATR 0.74 | BB 0.67</code>

        <i>06/04 11:15</i>
    """
    # Build component string
    comp_parts: list[str] = []
    if components:
        for key in ("rvol", "mfi", "atr", "bb_width"):
            if key in components:
                label = key.upper().replace("_WIDTH", "")
                comp_parts.append(f"{label} {float(components[key]):.2f}")
    comp_str = " | ".join(comp_parts) if comp_parts else "\u2014"

    # Skip template if it matches the legacy plain-text default (saved before HTML format)
    if template and template.strip() == _LEGACY_REGIME_TEMPLATE:
        template = None

    if template:
        try:
            return template.format(
                timeframe=timeframe.upper(),
                score=f"{vi_score:.3f}",
                score_100=f"{vi_score * 100:.1f}",
                regime=_REGIME_LABEL.get(regime, regime),
                summary=_REGIME_SUMMARY.get(regime, ""),
                components=comp_str,
            )
        except (KeyError, ValueError):
            logger.warning("format_market_vi_message: invalid template, falling back to default")

    # Default format (HTML)
    now_str = _now_local().strftime("%d/%m %H:%M")
    score_100 = vi_score * 100
    if prev_score is not None:
        diff = vi_score - prev_score
        if diff > 0.001:
            arrow = "↑"
        elif diff < -0.001:
            arrow = "↓"
        else:
            arrow = "→"
    else:
        arrow = ""
    dev_prefix = "[DEV] " if _APP_ENV != "prod" else ""
    r_emoji = _REGIME_EMOJI.get(regime, "📊")
    r_summary = _REGIME_SUMMARY.get(regime, "")

    if is_trigger:
        header = f"{dev_prefix}🎯 <b>VI Trigger</b> · {timeframe.upper()}"
    else:
        header = f"{dev_prefix}📡 <b>VI Status</b> · {timeframe.upper()}"

    # Regime is the primary information — bold and prominent
    arrow_str = f" {arrow}" if arrow else ""
    regime_line = f"{r_emoji} <b>{regime}</b>{arrow_str}"

    # Score + components on one code line (VI is secondary context)
    vi_str = f"VI {score_100:.1f}"
    code_parts = [vi_str] + comp_parts
    code_line = f"<code>◦ {' | '.join(code_parts)}</code>"

    lines = [
        header,
        "",
        regime_line,
        f"<i>{r_summary}</i>",
    ]
    if comp_parts:
        lines.append("")
        lines.append(code_line)
    lines.append("")
    lines.append(f"<i>{now_str}</i>")
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
    now = _now_local().strftime("%d/%m %H:%M")
    mr_emoji = _REGIME_EMOJI.get(market_regime, "📊")
    lines = [
        f"📋 <b>ATD Watchlist</b> · {timeframe.upper()} — {now}",
        f"Market: {mr_emoji} <b>{market_regime}</b> ({market_vi:.3f})",
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
        r_emoji = _REGIME_EMOJI.get(regime, "")
        lines.append(f"{r_emoji} <b>{regime}</b>")
        pair_lines: list[str] = []
        for p in grouped[regime]:
            pair = _he(p.get("pair", "?"))
            vi = float(p.get("vi_score", 0))
            signal = _he(p.get("ema_signal", ""))
            chg = p.get("change_24h")
            chg_str = f"{chg:+.1f}%" if chg is not None else ""
            pair_lines.append(f"{pair:<14} {vi:.2f}  {signal:<16} {chg_str}")
        lines.append("<code>" + "\n".join(pair_lines) + "</code>")
        lines.append("")

    # Summary line
    alerts = [p.get("alert") for p in pairs if p.get("alert")]
    unique_alerts = list(dict.fromkeys(a for a in alerts if a))  # stable dedup
    lines.append(f"→ {len(pairs)} pairs" + (f" | {', '.join(unique_alerts)}" if unique_alerts else ""))
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

    # Status sub-toggle (default True for backward compat with old configs)
    if not notification_cfg.get("status_enabled", True):
        return

    # Filter by configured regimes (empty list = all regimes)
    allowed_regimes: list[str] = notification_cfg.get("regimes", [])
    if allowed_regimes and regime not in allowed_regimes:
        return

    # Per-TF config: interval + template
    per_tf: dict = notification_cfg.get("per_tf_status", {})
    tf_cfg: dict = per_tf.get(timeframe, {})
    # If per_tf_status is configured and this TF is explicitly disabled, skip
    if per_tf and not tf_cfg.get("enabled", True):
        logger.debug("send_market_vi_alert: TF %s disabled in per_tf_status", timeframe)
        return

    cooldown_min: int = int(
        tf_cfg.get("interval_min")
        or notification_cfg.get("cooldown_min")
        or _DEFAULT_STATUS_INTERVALS.get(timeframe, 60)
    )
    if _is_on_cooldown("market_vi", timeframe, cooldown_min):
        logger.debug("send_market_vi_alert: on cooldown (%d min) for %s", cooldown_min, timeframe)
        return

    template: str | None = tf_cfg.get("template") or notification_cfg.get("message_template") or None
    # is_trigger = user configured specific regimes to watch (not "all regimes")
    is_trigger = bool(allowed_regimes)

    # ── Fetch prev score from Redis for direction arrow ───────────────────
    prev_score: float | None = None
    try:
        from src.volatility.cache import _get_redis  # noqa: PLC0415
        _r = _get_redis()
        _prev_key = f"atd:vi_prev_status:{timeframe}"
        _prev_raw = _r.get(_prev_key)
        if _prev_raw is not None:
            prev_score = float(str(_prev_raw))
        _r.set(_prev_key, str(vi_score))
    except Exception:
        pass

    text = format_market_vi_message(
        vi_score, regime, timeframe, components,
        template=template, is_trigger=is_trigger, prev_score=prev_score,
    )
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

    # Levels sub-toggle (default True for backward compat)
    if not cfg.get("levels_enabled", True):
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
            from datetime import UTC, datetime  # noqa: PLC0415
            is_weekend = datetime.now(UTC).weekday() >= 5
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
                # Both conditions require curr to be inside the zone — prevents firing
                # when VI overshoots (e.g. target=36±1, curr=28 crossing below 37)
                up   = (prev_score_100 <= tval - tol) and in_zone
                down = (prev_score_100 >= tval + tol) and in_zone
                if ldir == "both":
                    triggered = up or down
                elif ldir == "up":
                    triggered = up
                else:
                    triggered = down
                if prev_score_100 is not None:
                    direction_arrow = "🔺" if curr > prev_score_100 else ("🔻" if curr < prev_score_100 else "➡️")
                else:
                    direction_arrow = ""
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
        now_str = _now_local().strftime("%d/%m %H:%M")
        regime = _score_100_to_regime(curr)
        r_emoji = _REGIME_EMOJI.get(regime, "📊")
        r_summary = _REGIME_SUMMARY.get(regime, "")
        dev_prefix = "[DEV] " if _APP_ENV != "prod" else ""
        # Mini bar for alerts too
        filled = round(curr / 10)
        bar = "█" * filled + "░" * (10 - filled)
        arrow_part = f" {direction_arrow}" if direction_arrow else ""
        score_line = f"📊 Score: <b>{score_str}</b>{arrow_part}"
        if ltype == "crossing":
            tval = float(lv.get("value", 0))
            tol  = max(0.0, float(lv.get("tolerance", 0.5)))
            msg = (
                f"{dev_prefix}🔔 <b>VI Level Alert</b> · {tf_label}\n\n"
                f"<code>{bar}</code> {score_line}\n"
                f"{r_emoji} Regime: <b>{regime}</b> — {r_summary}\n\n"
                f"🎯 Target: <b>{tval:.0f}</b> <i>(±{tol:.1f})</i>"
            )
            if label:
                msg += f"\n🏷 <i>{_he(label)}</i>"
            msg += f"\n\n<i>{now_str}</i>"
        else:
            rmin = float(lv.get("min", 0))
            rmax = float(lv.get("max", 100))
            msg = (
                f"{dev_prefix}📏 <b>VI Range Alert</b> · {tf_label}\n\n"
                f"<code>{bar}</code> {score_line}\n"
                f"{r_emoji} Regime: <b>{regime}</b> — {r_summary}\n\n"
                f"📐 Range: [<b>{rmin:.0f} – {rmax:.0f}</b>]"
            )
            if label:
                msg += f"\n🏷 <i>{_he(label)}</i>"
            msg += f"\n\n<i>{now_str}</i>"

        _send(bot_token, chat_id, msg)


# ── Phase 5 — Kraken execution events ────────────────────────────────────────

# Default config used when a new NotificationSettings row is created.
# Stored in `notification_settings.execution_alerts` JSONB column.
DEFAULT_EXECUTION_ALERTS_CONFIG: dict = {
    "enabled": True,
    "bot_name": None,  # None → use first bot in `bots` list
    "events": {
        "LIMIT_PLACED": {"enabled": True},
        "LIMIT_FILLED": {"enabled": True},
        "TRADE_OPENED": {"enabled": True},
        "TP1_TAKEN":    {"enabled": True},
        "TP2_TAKEN":    {"enabled": True},
        "TP3_TAKEN":    {"enabled": True},
        "SL_HIT":       {"enabled": True},
        "BE_MOVED":     {"enabled": True},
        "PNL_STATUS":   {"enabled": True},
        "ORDER_ERROR":  {"enabled": True},
    },
}

# Event-to-emoji mapping
_EXEC_EMOJI: dict[str, str] = {
    "LIMIT_PLACED": "📋",
    "LIMIT_FILLED": "✅",
    "TRADE_OPENED": "🚀",
    "TP1_TAKEN":    "🎯",
    "TP2_TAKEN":    "🎯",
    "TP3_TAKEN":    "🎯",
    "SL_HIT":       "🛑",
    "BE_MOVED":     "🔒",
    "PNL_STATUS":   "📊",
    "ORDER_ERROR":  "⚠️",
    "ORDER_FAILED": "❌",
}

# Event-to-label mapping
_EXEC_LABEL: dict[str, str] = {
    "LIMIT_PLACED": "Limit Order Placed",
    "LIMIT_FILLED": "Limit Entry Filled",
    "TRADE_OPENED": "Trade Opened",
    "TP1_TAKEN":    "Take Profit 1 Hit",
    "TP2_TAKEN":    "Take Profit 2 Hit",
    "TP3_TAKEN":    "Take Profit 3 Hit",
    "SL_HIT":       "Stop Loss Hit",
    "BE_MOVED":     "Moved to Breakeven",
    "PNL_STATUS":   "PnL Status",
    "ORDER_ERROR":  "Order Error",
    "ORDER_FAILED": "Order Failed / Cancelled",
}


def _resolve_bot_from_list(bots: list, bot_name: str | None) -> tuple[str | None, str | None]:
    """Return (bot_token, chat_id) for named bot, or first bot as fallback."""
    if bot_name:
        for b in bots:
            if b.get("bot_name") == bot_name:
                return b.get("bot_token"), b.get("chat_id")
    if bots:
        return bots[0].get("bot_token"), bots[0].get("chat_id")
    return None, None


def format_execution_event_message(event: str, **ctx) -> str:
    """Build a Telegram HTML message for a Kraken execution event.

    Common context keys (all optional, rendered if present):
      pair, direction, size, entry_price, limit_price, filled_price,
      stop_price, unrealized_pnl, error_message, trade_id, symbol
    """
    emoji = _EXEC_EMOJI.get(event, "🔔")
    label = _EXEC_LABEL.get(event, event)
    now_str = _now_local().strftime("%d/%m %H:%M")
    dev_prefix = "[DEV] " if _APP_ENV != "prod" else ""

    pair       = ctx.get("pair") or ctx.get("symbol") or "—"
    direction  = (ctx.get("direction") or "").upper()
    dir_emoji  = "📈" if direction == "LONG" else "📉" if direction == "SHORT" else ""
    dir_label  = f" <b>{direction}</b>" if direction else ""

    lines = [f"{dev_prefix}{emoji} <b>{label}</b>"]
    if pair != "—":
        lines.append(f"🪙 Pair: <b>{_he(str(pair))}</b>{dir_label} {dir_emoji}")

    # Event-specific fields
    if event == "LIMIT_PLACED":
        if ctx.get("limit_price") is not None:
            lines.append(f"🎯 Limit: <code>{ctx['limit_price']}</code>")
        if ctx.get("size") is not None:
            lines.append(f"📦 Size: <code>{ctx['size']}</code>")
    elif event in ("LIMIT_FILLED", "TRADE_OPENED"):
        if ctx.get("filled_price") is not None:
            lines.append(f"💰 Fill: <code>{ctx['filled_price']}</code>")
        elif ctx.get("entry_price") is not None:
            lines.append(f"💰 Entry: <code>{ctx['entry_price']}</code>")
        if ctx.get("size") is not None:
            lines.append(f"📦 Size: <code>{ctx['size']}</code>")
        if ctx.get("sl_price") is not None:
            lines.append(f"🛑 SL: <code>{ctx['sl_price']}</code>")
    elif event in ("TP1_TAKEN", "TP2_TAKEN", "TP3_TAKEN"):
        if ctx.get("filled_price") is not None:
            pnl_pct = ctx.get("pnl_pct")
            tp_str = f"{ctx['filled_price']} ({pnl_pct}%)" if pnl_pct is not None else ctx["filled_price"]
            lines.append(f"✅ TP Fill: <code>{tp_str}</code>")
        if ctx.get("trade_pnl") is not None:
            try:
                tp = float(ctx["trade_pnl"])
                tp_str = f"+{tp:.2f}" if tp >= 0 else f"{tp:.2f}"
                lines.append(f"💵 Trade PnL: <code>{tp_str}</code>")
            except (ValueError, TypeError):
                pass
    elif event == "SL_HIT":
        if ctx.get("filled_price") is not None:
            pnl_pct = ctx.get("pnl_pct")
            sl_str = f"{ctx['filled_price']} ({pnl_pct}%)" if pnl_pct is not None else ctx["filled_price"]
            lines.append(f"🛑 SL Fill: <code>{sl_str}</code>")
        if ctx.get("trade_pnl") is not None:
            try:
                tp = float(ctx["trade_pnl"])
                tp_str = f"+{tp:.2f}" if tp >= 0 else f"{tp:.2f}"
                lines.append(f"💵 Trade PnL: <code>{tp_str}</code>")
            except (ValueError, TypeError):
                pass
    elif event == "BE_MOVED" and ctx.get("stop_price") is not None:
        lines.append(f"🔒 New SL (BE): <code>{ctx['stop_price']}</code>")
    elif event in ("ORDER_FAILED", "ORDER_ERROR") and ctx.get("error_message"):
        lines.append(f"⚠️ Reason: <code>{_he(str(ctx['error_message']))}</code>")
    elif event == "PNL_STATUS":
        entry   = ctx.get("entry_price")
        current = ctx.get("current_price")
        pnl_pct = ctx.get("pnl_pct")
        # Current price + % change from entry on one line
        if current is not None:
            price_line = f"📍 Current: <code>{_fmt_price(current)}</code>"
            if pnl_pct is not None:
                price_line += f"  ·  <code>{pnl_pct}%</code> <i>vs entry</i>"
            lines.append(price_line)
        if entry is not None:
            lines.append(f"🏷 Entry: <code>{_fmt_price(entry)}</code>")
        # Unrealized PnL with direction emoji
        if ctx.get("unrealized_pnl") is not None:
            pnl = float(ctx["unrealized_pnl"])
            pnl_str = f"+{pnl:.2f}" if pnl >= 0 else f"{pnl:.2f}"
            pnl_emoji = "📈" if pnl > 0 else "📉" if pnl < 0 else "➡️"
            lines.append(f"💰 Unrealized: <code>{pnl_str}</code> {pnl_emoji}")
        # TPs compact (TP1 · TP2 · TP3) — only non-None, open TPs
        tp_parts = []
        for n in (1, 2, 3):
            v = ctx.get(f"tp{n}_price")
            if v is not None:
                tp_parts.append(f"TP{n} <code>{_fmt_price(v)}</code>")
        if tp_parts:
            lines.append(f"🎯 {' · '.join(tp_parts)}")
        # SL + direction-aware distance:
        #   negative = SL is below current (LONG normal)
        #   positive = SL is above current (SHORT normal)
        if ctx.get("sl_price") is not None:
            sl_line = f"🛑 SL: <code>{_fmt_price(ctx['sl_price'])}</code>"
            if current is not None:
                try:
                    cp = float(current)
                    sl = float(ctx["sl_price"])
                    dist_pct = (sl - cp) / cp * 100
                    sign_char = "+" if dist_pct >= 0 else "−"
                    sl_line += f"  ·  <code>{sign_char}{abs(dist_pct):.1f}%</code> away"
                except (TypeError, ValueError, ZeroDivisionError):
                    pass
            lines.append(sl_line)
    elif event == "ORDER_ERROR" and ctx.get("error_message") is not None:
        lines.append(f"❌ Error: {_he(str(ctx['error_message']))[:200]}")

    if ctx.get("trade_id") is not None:
        lines.append(f"🆔 Trade: <code>{ctx['trade_id']}</code>")

    lines.append(f"\n<i>{now_str}</i>")
    return "\n".join(lines)


def send_execution_event(
    execution_alerts_cfg: dict,
    bots: list,
    event: str,
    **ctx,
) -> bool:
    """Send a Kraken execution event notification if enabled.

    Args:
        execution_alerts_cfg: the `execution_alerts` JSONB from NotificationSettings.
        bots: the `bots` list from NotificationSettings.
        event: one of LIMIT_PLACED, LIMIT_FILLED, TRADE_OPENED, TP1_TAKEN, TP2_TAKEN,
               TP3_TAKEN, SL_HIT, BE_MOVED, PNL_STATUS, ORDER_ERROR.
        **ctx: message context (pair, direction, size, filled_price, etc.)

    Returns:
        True if the message was sent, False otherwise.
    """
    if not execution_alerts_cfg.get("enabled", True):
        return False

    events_cfg: dict = execution_alerts_cfg.get("events", {})
    event_cfg: dict = events_cfg.get(event, {})
    if not event_cfg.get("enabled", True):
        return False

    bot_name: str | None = execution_alerts_cfg.get("bot_name")
    bot_token, chat_id = _resolve_bot_from_list(bots, bot_name)
    if not bot_token or not chat_id:
        logger.debug("send_execution_event: no bot configured for event %s", event)
        return False

    text = format_execution_event_message(event, **ctx)
    ok = _send(bot_token, chat_id, text)
    if ok:
        logger.debug("send_execution_event: sent %s to profile (pair=%s)", event, ctx.get("pair"))
    return ok
