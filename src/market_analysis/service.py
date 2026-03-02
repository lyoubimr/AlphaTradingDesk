"""
Market Analysis service — all business logic.

Score computation:
  For each (asset_target, timeframe_level) bucket:
    score_pct = sum(answer.score) / (active_indicators_in_bucket × 2) × 100
    bias = 'bullish' if > 60 | 'neutral' if 40–60 | 'bearish' if < 40

  asset_target 'a' or 'single'  → score_htf_a / score_mtf_a / …
  asset_target 'b'               → score_htf_b / score_mtf_b / …

Indicator config (toggles):
  Lazily defaulted — if no rows exist in profile_indicator_config for this
  profile, all indicators are treated as enabled (default_enabled=True rules).
  PUT saves a full upsert: INSERT … ON CONFLICT (profile_id, indicator_id)
  DO UPDATE SET enabled = excluded.enabled.

Staleness:
  Computed on request — last session per module, compared to now().
  is_stale = days_old > 7 OR no session exists.
"""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.models.broker import Profile
from src.core.models.market_analysis import (
    MarketAnalysisAnswer,
    MarketAnalysisIndicator,
    MarketAnalysisModule,
    MarketAnalysisSession,
    ProfileIndicatorConfig,
)
from src.market_analysis.schemas import (
    AnswerIn,
    IndicatorConfigItem,
    SessionCreate,
    StalenessItem,
)

# ── Constants ─────────────────────────────────────────────────────────────────

STALE_DAYS = 7


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_profile_or_404(db: Session, profile_id: int) -> Profile:
    p = db.query(Profile).filter(Profile.id == profile_id).first()
    if not p:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Profile {profile_id} not found.",
        )
    return p


def _get_module_or_404(db: Session, module_id: int) -> MarketAnalysisModule:
    m = db.query(MarketAnalysisModule).filter(MarketAnalysisModule.id == module_id).first()
    if not m:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Module {module_id} not found.",
        )
    return m


def _get_session_or_404(db: Session, session_id: int) -> MarketAnalysisSession:
    s = db.query(MarketAnalysisSession).filter(MarketAnalysisSession.id == session_id).first()
    if not s:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Session {session_id} not found.",
        )
    return s


def _bias(score_pct: Decimal) -> str:
    if score_pct > Decimal("60"):
        return "bullish"
    if score_pct < Decimal("40"):
        return "bearish"
    return "neutral"


def _score_pct(total: int, count: int) -> Decimal:
    """score% = sum / (count × 2) × 100.  Returns 0 if no active indicators."""
    if count == 0:
        return Decimal("0.00")
    return (Decimal(total) / Decimal(count * 2) * 100).quantize(Decimal("0.01"))


def _get_enabled_indicator_ids(
    db: Session,
    profile_id: int,
    module_id: int,
) -> set[int]:
    """
    Return the set of indicator IDs that are enabled for this profile+module.

    If no profile_indicator_config rows exist → all indicators with
    default_enabled=True are considered active.
    """
    # All indicators for this module
    all_indicators = (
        db.query(MarketAnalysisIndicator)
        .filter(MarketAnalysisIndicator.module_id == module_id)
        .all()
    )

    # Explicit overrides saved by this profile
    overrides = {
        cfg.indicator_id: cfg.enabled
        for cfg in db.query(ProfileIndicatorConfig)
        .filter(
            ProfileIndicatorConfig.profile_id == profile_id,
            ProfileIndicatorConfig.indicator_id.in_([i.id for i in all_indicators]),
        )
        .all()
    }

    enabled: set[int] = set()
    for ind in all_indicators:
        active = overrides.get(ind.id, ind.default_enabled)
        if active:
            enabled.add(ind.id)

    return enabled


def _compute_scores(
    module: MarketAnalysisModule,
    indicators_by_id: dict[int, MarketAnalysisIndicator],
    answers: list[AnswerIn],
    enabled_ids: set[int],
) -> dict:
    """
    Compute (score_pct, bias) for each (asset_side, timeframe_level) bucket.

    Returns a flat dict ready to unpack into MarketAnalysisSession fields:
      score_htf_a, bias_htf_a, score_mtf_a, bias_mtf_a, …
      score_htf_b, bias_htf_b, …  (None for single-asset modules)
    """
    # Buckets: (asset_side, tf_level) → [answer_scores]
    # asset_side is 'a' for 'a' and 'single' targets; 'b' for 'b' targets
    buckets: dict[tuple[str, str], list[int]] = {}
    active_counts: dict[tuple[str, str], int] = {}

    # Count active indicators per bucket first
    for ind_id, ind in indicators_by_id.items():
        if ind_id not in enabled_ids:
            continue
        side = "a" if ind.asset_target in ("a", "single") else "b"
        key = (side, ind.timeframe_level)
        active_counts[key] = active_counts.get(key, 0) + 1
        buckets.setdefault(key, [])

    # Accumulate answer scores
    for ans in answers:
        ind = indicators_by_id.get(ans.indicator_id)
        if ind is None or ans.indicator_id not in enabled_ids:
            continue
        side = "a" if ind.asset_target in ("a", "single") else "b"
        key = (side, ind.timeframe_level)
        buckets.setdefault(key, []).append(ans.score)

    def _calc(side: str, tf: str) -> tuple[Decimal | None, str | None]:
        key = (side, tf)
        count = active_counts.get(key, 0)
        if count == 0:
            return None, None
        total = sum(buckets.get(key, []))
        pct = _score_pct(total, count)
        return pct, _bias(pct)

    result: dict = {}
    for tf in ("htf", "mtf", "ltf"):
        pct_a, bias_a = _calc("a", tf)
        result[f"score_{tf}_a"] = pct_a
        result[f"bias_{tf}_a"] = bias_a

        if module.is_dual:
            pct_b, bias_b = _calc("b", tf)
            result[f"score_{tf}_b"] = pct_b
            result[f"bias_{tf}_b"] = bias_b
        else:
            result[f"score_{tf}_b"] = None
            result[f"bias_{tf}_b"] = None

    return result


# ── Public service functions ──────────────────────────────────────────────────

def list_modules(db: Session) -> list[MarketAnalysisModule]:
    return (
        db.query(MarketAnalysisModule)
        .filter(MarketAnalysisModule.is_active.is_(True))
        .order_by(MarketAnalysisModule.sort_order)
        .all()
    )


def list_indicators(db: Session, module_id: int) -> list[MarketAnalysisIndicator]:
    _get_module_or_404(db, module_id)
    return (
        db.query(MarketAnalysisIndicator)
        .filter(MarketAnalysisIndicator.module_id == module_id)
        .order_by(MarketAnalysisIndicator.sort_order)
        .all()
    )


def get_indicator_config(
    db: Session, profile_id: int
) -> tuple[int, list[IndicatorConfigItem]]:
    """
    Return per-profile indicator toggles.

    If no explicit config exists for an indicator, default_enabled is used.
    Always returns a row for every indicator across all active modules.
    """
    _get_profile_or_404(db, profile_id)

    all_indicators = (
        db.query(MarketAnalysisIndicator)
        .join(MarketAnalysisModule)
        .filter(MarketAnalysisModule.is_active.is_(True))
        .order_by(MarketAnalysisIndicator.module_id, MarketAnalysisIndicator.sort_order)
        .all()
    )

    overrides = {
        cfg.indicator_id: cfg.enabled
        for cfg in db.query(ProfileIndicatorConfig)
        .filter(ProfileIndicatorConfig.profile_id == profile_id)
        .all()
    }

    configs = [
        IndicatorConfigItem(
            indicator_id=ind.id,
            enabled=overrides.get(ind.id, ind.default_enabled),
        )
        for ind in all_indicators
    ]

    return profile_id, configs


def save_indicator_config(
    db: Session,
    profile_id: int,
    items: list[IndicatorConfigItem],
) -> tuple[int, list[IndicatorConfigItem]]:
    """
    Upsert indicator toggles for this profile.
    INSERT … ON CONFLICT (profile_id, indicator_id) DO UPDATE SET enabled = …
    """
    _get_profile_or_404(db, profile_id)

    if not items:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one indicator config item is required.",
        )

    for item in items:
        db.execute(
            text(
                """
                INSERT INTO profile_indicator_config (profile_id, indicator_id, enabled, updated_at)
                VALUES (:profile_id, :indicator_id, :enabled, now())
                ON CONFLICT (profile_id, indicator_id)
                DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
                """
            ),
            {
                "profile_id": profile_id,
                "indicator_id": item.indicator_id,
                "enabled": item.enabled,
            },
        )

    db.commit()
    return get_indicator_config(db, profile_id)


def create_session(db: Session, data: SessionCreate) -> MarketAnalysisSession:
    """
    Save a completed analysis session.

    1. Validate profile + module
    2. Resolve enabled indicators for this profile
    3. Compute scores per (asset_side, timeframe_level) bucket
    4. Persist Session + Answer rows atomically
    """
    _get_profile_or_404(db, data.profile_id)
    module = _get_module_or_404(db, data.module_id)

    # Load all indicators for this module keyed by id
    indicators = (
        db.query(MarketAnalysisIndicator)
        .filter(MarketAnalysisIndicator.module_id == data.module_id)
        .all()
    )
    indicators_by_id: dict[int, MarketAnalysisIndicator] = {i.id: i for i in indicators}

    # Validate all submitted indicator_ids belong to this module
    unknown = {a.indicator_id for a in data.answers} - set(indicators_by_id)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Indicator IDs {sorted(unknown)} do not belong to module {data.module_id}.",
        )

    enabled_ids = _get_enabled_indicator_ids(db, data.profile_id, data.module_id)

    scores = _compute_scores(module, indicators_by_id, data.answers, enabled_ids)

    session = MarketAnalysisSession(
        profile_id=data.profile_id,
        module_id=data.module_id,
        notes=data.notes,
        analyzed_at=data.analyzed_at or datetime.now(UTC),
        **scores,
    )
    db.add(session)
    db.flush()  # get session.id

    for ans in data.answers:
        db.add(
            MarketAnalysisAnswer(
                session_id=session.id,
                indicator_id=ans.indicator_id,
                score=ans.score,
                answer_label=ans.answer_label,
            )
        )

    db.commit()
    db.refresh(session)
    return session


def list_sessions(
    db: Session,
    profile_id: int | None = None,
    module_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> list[MarketAnalysisSession]:
    q = db.query(MarketAnalysisSession)
    if profile_id is not None:
        q = q.filter(MarketAnalysisSession.profile_id == profile_id)
    if module_id is not None:
        q = q.filter(MarketAnalysisSession.module_id == module_id)
    return (
        q.order_by(MarketAnalysisSession.analyzed_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


def get_session(db: Session, session_id: int) -> MarketAnalysisSession:
    return _get_session_or_404(db, session_id)


def get_staleness(db: Session, profile_id: int) -> list[StalenessItem]:
    """
    For each active module, return the last session date and staleness flag.
    is_stale = True if no session exists OR days_old > STALE_DAYS.
    """
    _get_profile_or_404(db, profile_id)

    modules = (
        db.query(MarketAnalysisModule)
        .filter(MarketAnalysisModule.is_active.is_(True))
        .order_by(MarketAnalysisModule.sort_order)
        .all()
    )

    now = datetime.now(UTC)
    result: list[StalenessItem] = []

    for mod in modules:
        last_session = (
            db.query(MarketAnalysisSession)
            .filter(
                MarketAnalysisSession.profile_id == profile_id,
                MarketAnalysisSession.module_id == mod.id,
            )
            .order_by(MarketAnalysisSession.analyzed_at.desc())
            .first()
        )

        if last_session is None:
            result.append(
                StalenessItem(
                    module_id=mod.id,
                    module_name=mod.name,
                    last_analyzed_at=None,
                    days_old=None,
                    is_stale=True,
                )
            )
        else:
            last_dt = last_session.analyzed_at
            # Make timezone-aware if stored as naive
            if last_dt.tzinfo is None:
                last_dt = last_dt.replace(tzinfo=UTC)
            days_old = (now - last_dt).days
            result.append(
                StalenessItem(
                    module_id=mod.id,
                    module_name=mod.name,
                    last_analyzed_at=last_session.analyzed_at,
                    days_old=days_old,
                    is_stale=days_old > STALE_DAYS,
                )
            )

    return result
