"""
Phase 6A — Analytics service layer.

compute_performance_report(profile_id, period, db) → PerformanceReport

Computes all 15 analytics metrics from the trades table using
SQLAlchemy 2.0 ORM + raw SQL for aggregations.

Period filter:
  "30d"  → last 30 days (closed_at)
  "90d"  → last 90 days
  "180d" → last 180 days
  "all"  → no date filter

Disciplined filter (mirrors the frontend strategy WR logic):
  Excludes trades where post_trade_review.tags contains a tag starting
  with "strategy_broken_" AND trades that are break-even (abs(pnl_pct) < min_pnl_pct_for_stats).
"""

from __future__ import annotations

import copy
import logging
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.analytics.models import AnalyticsAICache, AnalyticsAIKeys, AnalyticsSettings
from src.analytics.schemas import (
    DEFAULT_ANALYTICS_CONFIG,
    AIKeysStatusOut,
    DirectionRow,
    DrawdownPoint,
    EquityPoint,
    KPISummary,
    PerformanceReport,
    RepeatError,
    ReviewRateOut,
    RRScatterPoint,
    TagFrequency,
    TPHitRate,
    TradeTypeRow,
    VIBucket,
    WRByHour,
    WRByStat,
)
from src.core.models.broker import Profile
from src.risk_management.engine import _deep_merge

logger = logging.getLogger(__name__)

VALID_PERIODS = {"30d", "90d", "180d", "all"}


def _period_cutoff(period: str) -> datetime | None:
    """Return the earliest closed_at datetime for the given period, or None for 'all'."""
    days_map = {"30d": 30, "90d": 90, "180d": 180}
    if period in days_map:
        return datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days_map[period])
    return None


# ── Settings CRUD ─────────────────────────────────────────────────────────────

def get_analytics_settings(profile_id: int, db: Session) -> AnalyticsSettings:
    row = db.query(AnalyticsSettings).filter_by(profile_id=profile_id).first()
    if row is None:
        row = AnalyticsSettings(profile_id=profile_id, config=copy.deepcopy(DEFAULT_ANALYTICS_CONFIG))
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def update_analytics_settings(profile_id: int, patch: dict, db: Session) -> AnalyticsSettings:
    row = get_analytics_settings(profile_id, db)
    row.config = _deep_merge(row.config, patch)
    row.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()
    db.refresh(row)
    return row


# ── AI keys CRUD ──────────────────────────────────────────────────────────────

def get_ai_keys_row(profile_id: int, db: Session) -> AnalyticsAIKeys:
    row = db.query(AnalyticsAIKeys).filter_by(profile_id=profile_id).first()
    if row is None:
        row = AnalyticsAIKeys(profile_id=profile_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def get_ai_keys_status(profile_id: int, db: Session) -> AIKeysStatusOut:
    row = get_ai_keys_row(profile_id, db)
    return AIKeysStatusOut(
        profile_id=profile_id,
        openai_configured=row.openai_key_enc is not None,
        anthropic_configured=row.anthropic_key_enc is not None,
        perplexity_configured=row.perplexity_key_enc is not None,
    )


# ── Core analytics computation ────────────────────────────────────────────────

def compute_performance_report(profile_id: int, period: str, db: Session) -> PerformanceReport:
    if period not in VALID_PERIODS:
        raise HTTPException(status_code=400, detail=f"Invalid period '{period}'. Use: {VALID_PERIODS}")

    # Verify profile exists
    profile = db.query(Profile).filter(Profile.id == profile_id).first()
    if profile is None:
        raise HTTPException(status_code=404, detail=f"Profile {profile_id} not found.")

    cutoff = _period_cutoff(period)

    # ── Base query params ──────────────────────────────────────────────────
    params: dict = {"profile_id": profile_id, "min_pnl_pct": float(profile.min_pnl_pct_for_stats)}
    date_filter = ""
    if cutoff is not None:
        params["cutoff"] = cutoff
        date_filter = "AND t.closed_at >= :cutoff"

    # ── Fetch all closed trades for this profile+period ────────────────────
    trades_sql = text(f"""
        SELECT
            t.id,
            t.pair,
            t.direction,
            t.entry_date,
            t.closed_at,
            t.realized_pnl,
            t.risk_amount,
            t.potential_profit,
            t.session_tag,
            t.post_trade_review,
            t.close_notes,
            t.close_screenshot_urls,
            COALESCE(
              (t.realized_pnl / NULLIF(t.risk_amount, 0) * 100),
              0
            ) AS pnl_pct,
            -- is_be: |pnl_pct| < threshold
            ABS(COALESCE(t.realized_pnl / NULLIF(t.risk_amount, 0) * 100, 0)) < :min_pnl_pct AS is_be,
            -- strategy_broken: post_trade_review->>'tags' contains a tag starting with 'strategy_broken_'
            EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(
                COALESCE(t.post_trade_review->'tags', '[]'::jsonb)
              ) tag
              WHERE tag LIKE 'strategy_broken_%'
            ) AS is_strategy_broken
        FROM trades t
        WHERE t.profile_id = :profile_id
          AND t.status = 'closed'
          AND t.realized_pnl IS NOT NULL
          {date_filter}
        ORDER BY t.closed_at ASC
    """)
    rows = db.execute(trades_sql, params).mappings().all()

    if not rows:
        return _empty_report(profile_id, period)

    # ── Build Python lists for in-memory aggregations ─────────────────────
    trades = [dict(r) for r in rows]

    kpi = _compute_kpi(trades, profile)
    equity_curve = _compute_equity_curve(trades)
    drawdown = _compute_drawdown(equity_curve)
    wr_by_strategy = _compute_wr_by_strategy(profile_id, period, cutoff, db, params, date_filter)
    wr_by_session = _compute_wr_by_session(trades)
    wr_by_hour = _compute_wr_by_hour(trades)
    pair_leaderboard = _compute_pair_leaderboard(trades)
    tp_hit_rates = _compute_tp_hit_rates(profile_id, period, cutoff, db, params, date_filter)
    trade_type_dist = _compute_trade_type_dist(trades)
    rr_scatter = _compute_rr_scatter(trades)
    direction_bias = _compute_direction_bias(trades)
    top_tags_winners, top_tags_losers, repeat_errors = _compute_tag_stats(trades)
    review_rate = _compute_review_rate(trades)
    vi_correlation = _compute_vi_correlation(profile_id, cutoff, db, params, date_filter)

    # ── AI cache lookup ────────────────────────────────────────────────────
    ai_summary: str | None = None
    ai_generated_at: str | None = None
    cache = (
        db.query(AnalyticsAICache)
        .filter_by(profile_id=profile_id, period=period)
        .first()
    )
    if cache is not None:
        ai_summary = cache.summary
        ai_generated_at = cache.generated_at.isoformat()

    return PerformanceReport(
        profile_id=profile_id,
        period=period,
        generated_at=datetime.now(UTC).replace(tzinfo=None).isoformat(),
        kpi=kpi,
        equity_curve=equity_curve,
        wr_by_strategy=wr_by_strategy,
        wr_by_session=wr_by_session,
        wr_by_hour=wr_by_hour,
        pair_leaderboard=pair_leaderboard,
        tp_hit_rates=tp_hit_rates,
        drawdown=drawdown,
        trade_type_dist=trade_type_dist,
        rr_scatter=rr_scatter,
        direction_bias=direction_bias,
        top_tags_winners=top_tags_winners,
        top_tags_losers=top_tags_losers,
        repeat_errors=repeat_errors,
        review_rate=review_rate,
        vi_correlation=vi_correlation,
        ai_summary=ai_summary,
        ai_generated_at=ai_generated_at,
    )


# ── KPI ───────────────────────────────────────────────────────────────────────

def _compute_kpi(trades: list[dict], profile: Profile) -> KPISummary:
    total = len(trades)
    disciplined = [t for t in trades if not t["is_be"] and not t["is_strategy_broken"]]
    d_count = len(disciplined)

    # Raw WR
    raw_wins = sum(1 for t in trades if float(t["pnl_pct"]) > 0)
    raw_wr = round(raw_wins / total * 100, 1) if total else None

    # Disciplined WR
    d_wins = sum(1 for t in disciplined if float(t["pnl_pct"]) > 0)
    d_wr = round(d_wins / d_count * 100, 1) if d_count else None

    # Expectancy (based on disciplined trades)
    wins_pnl = [float(t["realized_pnl"]) for t in disciplined if float(t["pnl_pct"]) > 0]
    losses_pnl = [float(t["realized_pnl"]) for t in disciplined if float(t["pnl_pct"]) <= 0]
    avg_win = sum(wins_pnl) / len(wins_pnl) if wins_pnl else None
    avg_loss = sum(losses_pnl) / len(losses_pnl) if losses_pnl else None  # negative

    expectancy: float | None = None
    if d_wr is not None and avg_win is not None and avg_loss is not None:
        wr_ratio = d_wr / 100
        expectancy = round(wr_ratio * avg_win + (1 - wr_ratio) * avg_loss, 2)

    # Profit factor
    gross_profit = sum(wins_pnl) if wins_pnl else 0.0
    gross_loss = abs(sum(losses_pnl)) if losses_pnl else 0.0
    profit_factor = round(gross_profit / gross_loss, 3) if gross_loss > 0 else None

    # Streak
    current_streak, best_win_streak, worst_loss_streak = _compute_streaks(trades)

    return KPISummary(
        disciplined_wr=d_wr,
        raw_wr=raw_wr,
        expectancy=expectancy,
        profit_factor=profit_factor,
        current_streak=current_streak,
        best_win_streak=best_win_streak,
        worst_loss_streak=worst_loss_streak,
        total_trades=total,
        disciplined_trades=d_count,
        avg_win_pnl=round(avg_win, 2) if avg_win is not None else None,
        avg_loss_pnl=round(avg_loss, 2) if avg_loss is not None else None,
    )


def _compute_streaks(trades: list[dict]) -> tuple[int, int, int]:
    """Return (current_streak, best_win_streak, worst_loss_streak)."""
    if not trades:
        return 0, 0, 0
    current = 0
    best_win = 0
    worst_loss = 0
    win_streak = 0
    loss_streak = 0
    for t in trades:
        is_win = float(t["pnl_pct"]) > 0
        if is_win:
            win_streak += 1
            loss_streak = 0
            best_win = max(best_win, win_streak)
        else:
            loss_streak += 1
            win_streak = 0
            worst_loss = min(worst_loss, -loss_streak)
    # Current streak: positive = win, negative = loss
    last = trades[-1]
    if float(last["pnl_pct"]) > 0:
        current = win_streak
    else:
        current = -loss_streak
    return current, best_win, worst_loss


# ── Equity curve ──────────────────────────────────────────────────────────────

def _compute_equity_curve(trades: list[dict]) -> list[EquityPoint]:
    cumulative = 0.0
    points: list[EquityPoint] = []
    for t in trades:
        pnl = float(t["realized_pnl"])
        cumulative += pnl
        closed_at = t["closed_at"]
        date_str = closed_at.strftime("%Y-%m-%d") if hasattr(closed_at, "strftime") else str(closed_at)[:10]
        points.append(EquityPoint(
            date=date_str,
            trade_id=t["id"],
            pnl=round(pnl, 2),
            cumulative_pnl=round(cumulative, 2),
        ))
    return points


# ── Drawdown curve ────────────────────────────────────────────────────────────

def _compute_drawdown(equity: list[EquityPoint]) -> list[DrawdownPoint]:
    if not equity:
        return []
    peak = 0.0
    points: list[DrawdownPoint] = []
    for e in equity:
        cum = e.cumulative_pnl
        peak = max(peak, cum)
        if peak > 0:
            dd_pct = round((cum - peak) / peak * 100, 2)
        else:
            dd_pct = 0.0
        points.append(DrawdownPoint(
            date=e.date,
            cumulative_pnl=cum,
            peak_pnl=round(peak, 2),
            drawdown_pct=dd_pct,
        ))
    return points


# ── WR by strategy ────────────────────────────────────────────────────────────

def _compute_wr_by_strategy(
    profile_id: int,
    period: str,
    cutoff: datetime | None,
    db: Session,
    params: dict,
    date_filter: str,
) -> list[WRByStat]:
    sql = text(f"""
        SELECT
            COALESCE(s.name, 'Unassigned') AS label,
            COUNT(*) AS trades,
            SUM(CASE WHEN t.realized_pnl > 0 THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN t.realized_pnl <= 0 THEN 1 ELSE 0 END) AS losses,
            ROUND(AVG(t.realized_pnl)::numeric, 2) AS avg_pnl,
            ROUND(SUM(t.realized_pnl)::numeric, 2) AS total_pnl
        FROM trades t
        LEFT JOIN trade_strategies ts ON ts.trade_id = t.id
        LEFT JOIN strategies s ON s.id = ts.strategy_id
        WHERE t.profile_id = :profile_id
          AND t.status = 'closed'
          AND t.realized_pnl IS NOT NULL
          {date_filter}
        GROUP BY s.name
        ORDER BY trades DESC
    """)
    rows = db.execute(sql, params).mappings().all()
    result = []
    for r in rows:
        trades = r["trades"]
        wins = r["wins"] or 0
        result.append(WRByStat(
            label=r["label"],
            trades=trades,
            wins=wins,
            losses=r["losses"] or 0,
            wr_pct=round(wins / trades * 100, 1) if trades else None,
            avg_pnl=float(r["avg_pnl"]) if r["avg_pnl"] is not None else None,
            total_pnl=float(r["total_pnl"] or 0),
        ))
    return result


# ── WR by session ─────────────────────────────────────────────────────────────

def _compute_wr_by_session(trades: list[dict]) -> list[WRByStat]:
    sessions: dict[str, dict] = {}
    for t in trades:
        label = t["session_tag"] or "Unknown"
        if label not in sessions:
            sessions[label] = {"trades": 0, "wins": 0, "losses": 0, "pnl_sum": 0.0}
        sessions[label]["trades"] += 1
        pnl = float(t["realized_pnl"])
        sessions[label]["pnl_sum"] += pnl
        if pnl > 0:
            sessions[label]["wins"] += 1
        else:
            sessions[label]["losses"] += 1

    order = ["London", "New York", "Asia", "Tokyo", "Unknown"]
    result = []
    for label in order:
        if label in sessions:
            s = sessions.pop(label)
            tr = s["trades"]
            w = s["wins"]
            result.append(WRByStat(
                label=label,
                trades=tr,
                wins=w,
                losses=s["losses"],
                wr_pct=round(w / tr * 100, 1) if tr else None,
                avg_pnl=round(s["pnl_sum"] / tr, 2) if tr else None,
                total_pnl=round(s["pnl_sum"], 2),
            ))
    # Any remaining unexpected sessions
    for label, s in sessions.items():
        tr = s["trades"]
        w = s["wins"]
        result.append(WRByStat(
            label=label,
            trades=tr,
            wins=w,
            losses=s["losses"],
            wr_pct=round(w / tr * 100, 1) if tr else None,
            avg_pnl=round(s["pnl_sum"] / tr, 2) if tr else None,
            total_pnl=round(s["pnl_sum"], 2),
        ))
    return result


# ── WR by hour (UTC) ──────────────────────────────────────────────────────────

def _compute_wr_by_hour(trades: list[dict]) -> list[WRByHour]:
    hours: dict[int, dict] = {}
    for t in trades:
        entry = t["entry_date"]
        hour = entry.hour if hasattr(entry, "hour") else 0
        if hour not in hours:
            hours[hour] = {"trades": 0, "wins": 0}
        hours[hour]["trades"] += 1
        if float(t["pnl_pct"]) > 0:
            hours[hour]["wins"] += 1
    result = []
    for h in range(24):
        if h in hours:
            tr = hours[h]["trades"]
            w = hours[h]["wins"]
            result.append(WRByHour(
                hour=h,
                trades=tr,
                wins=w,
                wr_pct=round(w / tr * 100, 1) if tr else None,
            ))
        else:
            result.append(WRByHour(hour=h, trades=0, wins=0, wr_pct=None))
    return result


# ── Pair leaderboard ──────────────────────────────────────────────────────────

def _compute_pair_leaderboard(trades: list[dict]) -> list[WRByStat]:
    pairs: dict[str, dict] = {}
    for t in trades:
        label = t["pair"]
        if label not in pairs:
            pairs[label] = {"trades": 0, "wins": 0, "losses": 0, "pnl_sum": 0.0}
        pnl = float(t["realized_pnl"])
        pairs[label]["trades"] += 1
        pairs[label]["pnl_sum"] += pnl
        if pnl > 0:
            pairs[label]["wins"] += 1
        else:
            pairs[label]["losses"] += 1
    result = []
    for label, p in sorted(pairs.items(), key=lambda x: x[1]["trades"], reverse=True):
        tr = p["trades"]
        w = p["wins"]
        result.append(WRByStat(
            label=label,
            trades=tr,
            wins=w,
            losses=p["losses"],
            wr_pct=round(w / tr * 100, 1) if tr else None,
            avg_pnl=round(p["pnl_sum"] / tr, 2) if tr else None,
            total_pnl=round(p["pnl_sum"], 2),
        ))
    return result


# ── TP hit rates ──────────────────────────────────────────────────────────────

def _compute_tp_hit_rates(
    profile_id: int,
    period: str,
    cutoff: datetime | None,
    db: Session,
    params: dict,
    date_filter: str,
) -> list[TPHitRate]:
    sql = text(f"""
        SELECT
            p.position_number,
            COUNT(*) AS total,
            SUM(CASE WHEN p.status = 'closed' THEN 1 ELSE 0 END) AS hits
        FROM positions p
        JOIN trades t ON t.id = p.trade_id
        WHERE t.profile_id = :profile_id
          AND t.status = 'closed'
          AND p.is_runner = FALSE
          {date_filter}
        GROUP BY p.position_number
        ORDER BY p.position_number
    """)
    rows = db.execute(sql, params).mappings().all()
    result = []
    for r in rows:
        total = r["total"] or 0
        hits = r["hits"] or 0
        result.append(TPHitRate(
            tp_number=r["position_number"],
            total=total,
            hits=hits,
            hit_rate_pct=round(hits / total * 100, 1) if total else None,
        ))
    return result


# ── Trade type distribution ───────────────────────────────────────────────────

def _compute_trade_type_dist(trades: list[dict]) -> list[TradeTypeRow]:
    buckets: dict[str, dict] = {"scalp": {"c": 0, "w": 0, "pnl": 0.0}, "intraday": {"c": 0, "w": 0, "pnl": 0.0}, "swing": {"c": 0, "w": 0, "pnl": 0.0}}
    for t in trades:
        entry = t["entry_date"]
        closed = t["closed_at"]
        if entry and closed and hasattr(entry, "hour") and hasattr(closed, "hour"):
            duration_h = (closed - entry).total_seconds() / 3600
        else:
            duration_h = 0
        if duration_h < 1:
            key = "scalp"
        elif duration_h <= 24:
            key = "intraday"
        else:
            key = "swing"
        pnl = float(t["realized_pnl"])
        buckets[key]["c"] += 1
        buckets[key]["pnl"] += pnl
        if pnl > 0:
            buckets[key]["w"] += 1
    result = []
    for trade_type in ["scalp", "intraday", "swing"]:
        b = buckets[trade_type]
        c, w = b["c"], b["w"]
        result.append(TradeTypeRow(
            trade_type=trade_type,
            count=c,
            wins=w,
            wr_pct=round(w / c * 100, 1) if c else None,
            avg_pnl=round(b["pnl"] / c, 2) if c else None,
        ))
    return result


# ── R:R scatter ───────────────────────────────────────────────────────────────

def _compute_rr_scatter(trades: list[dict]) -> list[RRScatterPoint]:
    result = []
    for t in trades:
        risk = float(t["risk_amount"]) if t["risk_amount"] else None
        pnl = float(t["realized_pnl"])
        pot = float(t["potential_profit"]) if t["potential_profit"] else None
        actual_rr = round(pnl / risk, 2) if risk and risk > 0 else None
        planned_rr = round(pot / risk, 2) if risk and risk > 0 and pot else None
        result.append(RRScatterPoint(
            trade_id=t["id"],
            planned_rr=planned_rr,
            actual_rr=actual_rr,
            is_win=pnl > 0,
            pair=t["pair"],
        ))
    return result


# ── Direction bias ────────────────────────────────────────────────────────────

def _compute_direction_bias(trades: list[dict]) -> list[DirectionRow]:
    dirs: dict[str, dict] = {}
    for t in trades:
        d = t["direction"].lower()
        if d not in dirs:
            dirs[d] = {"trades": 0, "wins": 0, "pnl": 0.0}
        pnl = float(t["realized_pnl"])
        dirs[d]["trades"] += 1
        dirs[d]["pnl"] += pnl
        if pnl > 0:
            dirs[d]["wins"] += 1
    result = []
    for direction in ["long", "short"]:
        if direction in dirs:
            b = dirs[direction]
            tr, w = b["trades"], b["wins"]
            result.append(DirectionRow(
                direction=direction,
                trades=tr,
                wins=w,
                wr_pct=round(w / tr * 100, 1) if tr else None,
                total_pnl=round(b["pnl"], 2),
            ))
    return result


# ── Tag stats ─────────────────────────────────────────────────────────────────

def _compute_tag_stats(
    trades: list[dict],
) -> tuple[list[TagFrequency], list[TagFrequency], list[RepeatError]]:
    wins = [t for t in trades if float(t["realized_pnl"]) > 0]
    losses = [t for t in trades if float(t["realized_pnl"]) <= 0]

    top_winners = _tag_frequency(wins, top_n=10)
    top_losers = _tag_frequency(losses, top_n=10)

    # Repeat errors: tags on losers that appear in ≥2 losing trades
    repeat_errors = _compute_repeat_errors(losses)

    return top_winners, top_losers, repeat_errors


def _tag_frequency(trades: list[dict], top_n: int = 10) -> list[TagFrequency]:
    tag_count: dict[str, int] = {}
    for t in trades:
        ptr = t.get("post_trade_review") or {}
        tags = ptr.get("tags") if isinstance(ptr, dict) else []
        for tag in (tags or []):
            if tag and not tag.startswith("strategy_broken_"):
                tag_count[tag] = tag_count.get(tag, 0) + 1
    total = len(trades)
    sorted_tags = sorted(tag_count.items(), key=lambda x: x[1], reverse=True)[:top_n]
    return [
        TagFrequency(
            tag=tag,
            count=count,
            pct=round(count / total * 100, 1) if total else 0.0,
        )
        for tag, count in sorted_tags
    ]


def _compute_repeat_errors(losses: list[dict]) -> list[RepeatError]:
    """Tags appearing on ≥2 losing trades, sorted by frequency."""
    tag_data: dict[str, dict] = {}
    for t in losses:
        ptr = t.get("post_trade_review") or {}
        tags = ptr.get("tags") if isinstance(ptr, dict) else []
        closed_at = t["closed_at"]
        date_str = closed_at.strftime("%Y-%m-%d") if hasattr(closed_at, "strftime") else str(closed_at)[:10]
        for tag in (tags or []):
            if tag and not tag.startswith("strategy_broken_"):
                if tag not in tag_data:
                    tag_data[tag] = {"count": 0, "last_seen": date_str}
                tag_data[tag]["count"] += 1
                if date_str > tag_data[tag]["last_seen"]:
                    tag_data[tag]["last_seen"] = date_str
    errors = [
        RepeatError(tag=tag, error_count=d["count"], last_seen=d["last_seen"])
        for tag, d in tag_data.items()
        if d["count"] >= 2
    ]
    return sorted(errors, key=lambda x: x.error_count, reverse=True)


# ── Review rate ───────────────────────────────────────────────────────────────

def _compute_review_rate(trades: list[dict]) -> ReviewRateOut:
    total = len(trades)
    reviewed = 0
    for t in trades:
        ptr = t.get("post_trade_review") or {}
        outcome = ptr.get("outcome") if isinstance(ptr, dict) else None
        has_outcome = bool(outcome)
        has_notes = bool(t.get("close_notes"))
        has_screenshots = bool(t.get("close_screenshot_urls"))
        tags = ptr.get("tags") if isinstance(ptr, dict) else []
        has_non_strategy_tag = any(
            not tag.startswith("strategy_broken_") for tag in (tags or [])
        )
        if has_outcome and has_notes and has_screenshots and has_non_strategy_tag:
            reviewed += 1
    return ReviewRateOut(
        total_closed=total,
        reviewed_count=reviewed,
        review_rate_pct=round(reviewed / total * 100, 1) if total else 0.0,
    )


# ── Volatility correlation ────────────────────────────────────────────────────

def _compute_vi_correlation(
    profile_id: int,
    cutoff: datetime | None,
    db: Session,
    params: dict,
    date_filter: str,
) -> list[VIBucket]:
    """Bucket closed trades by VI score at entry time (1h timeframe, ±3h window)."""
    sql = text(f"""
        WITH trade_vi AS (
            SELECT
                t.id,
                t.realized_pnl > 0 AS is_win,
                COALESCE(t.realized_pnl / NULLIF(t.risk_amount, 0) * 100, 0) AS pnl_pct,
                (
                    SELECT vs.vi_score
                    FROM volatility_snapshots vs
                    WHERE vs.pair = t.pair
                      AND vs.timeframe = '1h'
                      AND vs.timestamp
                          BETWEEN (t.entry_date::timestamp - INTERVAL '3 hours')
                              AND (t.entry_date::timestamp + INTERVAL '3 hours')
                    ORDER BY ABS(EXTRACT(EPOCH FROM (
                        vs.timestamp - t.entry_date::timestamp
                    )))
                    LIMIT 1
                ) AS vi_score
            FROM trades t
            WHERE t.profile_id = :profile_id
              AND t.status = 'closed'
              AND t.realized_pnl IS NOT NULL
              {date_filter}
        )
        SELECT
            CASE
                WHEN vi_score < 0.33 THEN 'Calm'
                WHEN vi_score < 0.50 THEN 'Normal'
                WHEN vi_score < 0.67 THEN 'Active'
                ELSE 'Extreme'
            END AS bucket,
            COUNT(*) AS trades,
            ROUND(COUNT(*) FILTER (WHERE is_win) * 100.0 / NULLIF(COUNT(*), 0), 1) AS wr_pct,
            ROUND(AVG(pnl_pct)::numeric, 2) AS avg_pnl,
            ROUND(AVG(vi_score)::numeric, 3) AS avg_vi
        FROM trade_vi
        WHERE vi_score IS NOT NULL
        GROUP BY bucket
        ORDER BY AVG(vi_score)
    """)
    try:
        rows = db.execute(sql, params).mappings().all()
        return [
            VIBucket(
                bucket=r["bucket"],
                trades=int(r["trades"]),
                wr_pct=float(r["wr_pct"]) if r["wr_pct"] is not None else None,
                avg_pnl=float(r["avg_pnl"]) if r["avg_pnl"] is not None else None,
                avg_vi=float(r["avg_vi"]) if r["avg_vi"] is not None else None,
            )
            for r in rows
        ]
    except Exception as exc:
        logger.warning("VI correlation query failed: %s", exc)
        return []


# ── Empty report ──────────────────────────────────────────────────────────────

def _empty_report(profile_id: int, period: str) -> PerformanceReport:
    return PerformanceReport(
        profile_id=profile_id,
        period=period,
        generated_at=datetime.now(UTC).replace(tzinfo=None).isoformat(),
        kpi=KPISummary(),
        equity_curve=[],
        wr_by_strategy=[],
        wr_by_session=[],
        wr_by_hour=[WRByHour(hour=h, trades=0, wins=0) for h in range(24)],
        pair_leaderboard=[],
        tp_hit_rates=[],
        drawdown=[],
        trade_type_dist=[
            TradeTypeRow(trade_type=t, count=0, wins=0) for t in ["scalp", "intraday", "swing"]
        ],
        rr_scatter=[],
        direction_bias=[
            DirectionRow(direction=d, trades=0, wins=0) for d in ["long", "short"]
        ],
        top_tags_winners=[],
        top_tags_losers=[],
        repeat_errors=[],
        review_rate=ReviewRateOut(total_closed=0, reviewed_count=0, review_rate_pct=0.0),
        vi_correlation=[],
    )
