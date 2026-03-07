"""
Market Analysis service — all business logic.

Score computation v1 (legacy):
  For each (asset_target, timeframe_level) bucket:
    score_pct = sum(answer.score) / (active_indicators_in_bucket × 2) × 100
    bias = 'bullish' if > 60 | 'neutral' if 40–60 | 'bearish' if < 40

Score computation v2 (decomposed — Step 13):
  Indicators are tagged with score_block: 'trend' | 'momentum' | 'participation'.
  Per asset side (a/b), 3 block scores are computed from all TF levels combined,
  then weighted into a composite score:
    Trend=0.45 / Momentum=0.30 / Participation=0.25
  Thresholds: ≥65 = bullish | ≤34 = bearish | rest = neutral

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
    MarketAnalysisConfig,
    MarketAnalysisIndicator,
    MarketAnalysisModule,
    MarketAnalysisSession,
    ProfileIndicatorConfig,
)
from src.market_analysis.schemas import (
    AnswerIn,
    IndicatorConfigItem,
    IndicatorUpdate,
    SessionCreate,
    StalenessItem,
    TradeConclusion,
)

# ── Constants ─────────────────────────────────────────────────────────────────

STALE_DAYS = 7

# v2 composite weights
_BLOCK_WEIGHTS = {
    "trend": Decimal("0.45"),
    "momentum": Decimal("0.30"),
    "participation": Decimal("0.25"),
}

# v2 thresholds — fallback defaults (overridable per module in market_analysis_configs)
_DEFAULT_BULLISH_THRESHOLD = Decimal("65")
_DEFAULT_BEARISH_THRESHOLD = Decimal("34")


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


def _bias_v1(score_pct: Decimal) -> str:
    if score_pct > Decimal("60"):
        return "bullish"
    if score_pct < Decimal("40"):
        return "bearish"
    return "neutral"


def _get_thresholds(db: Session, module_id: int) -> tuple[Decimal, Decimal]:
    """
    Read bullish/bearish thresholds for a module from market_analysis_configs.
    Falls back to global config (module_id IS NULL), then to hardcoded defaults.
    """
    cfg = (
        db.query(MarketAnalysisConfig)
        .filter(
            MarketAnalysisConfig.module_id == module_id,
            MarketAnalysisConfig.profile_id.is_(None),
        )
        .first()
    )
    if cfg is None:
        cfg = (
            db.query(MarketAnalysisConfig)
            .filter(
                MarketAnalysisConfig.module_id.is_(None),
                MarketAnalysisConfig.profile_id.is_(None),
            )
            .first()
        )
    if cfg and cfg.score_thresholds:
        t = cfg.score_thresholds
        return Decimal(str(t.get("bullish", _DEFAULT_BULLISH_THRESHOLD))), Decimal(
            str(t.get("bearish", _DEFAULT_BEARISH_THRESHOLD))
        )
    return _DEFAULT_BULLISH_THRESHOLD, _DEFAULT_BEARISH_THRESHOLD


def _bias_v2(
    score_pct: Decimal,
    bullish: Decimal = _DEFAULT_BULLISH_THRESHOLD,
    bearish: Decimal = _DEFAULT_BEARISH_THRESHOLD,
) -> str:
    if score_pct >= bullish:
        return "bullish"
    if score_pct <= bearish:
        return "bearish"
    return "neutral"


def _score_pct(total: int, count: int) -> Decimal:
    """score% = sum / (count × 2) × 100.  Returns 0 if no active indicators."""
    if count == 0:
        return Decimal("0.00")
    return (Decimal(total) / Decimal(count * 2) * 100).quantize(Decimal("0.01"))


def get_thresholds_public(db: Session, module_id: int) -> tuple[Decimal, Decimal]:
    """Public wrapper — returns (bullish, bearish) thresholds for a module."""
    return _get_thresholds(db, module_id)


def _get_enabled_indicator_ids(
    db: Session,
    profile_id: int,
    module_id: int,
) -> set[int]:
    all_indicators = (
        db.query(MarketAnalysisIndicator)
        .filter(MarketAnalysisIndicator.module_id == module_id)
        .all()
    )
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
        if overrides.get(ind.id, ind.default_enabled):
            enabled.add(ind.id)
    return enabled


def _compute_scores(
    module: MarketAnalysisModule,
    indicators_by_id: dict[int, MarketAnalysisIndicator],
    answers: list[AnswerIn],
    enabled_ids: set[int],
    bullish_threshold: Decimal = _DEFAULT_BULLISH_THRESHOLD,
    bearish_threshold: Decimal = _DEFAULT_BEARISH_THRESHOLD,
) -> dict:
    """
    Compute legacy (HTF/MTF/LTF) AND v2 (Trend/Momentum/Participation/Composite)
    scores for a session.

    Returns a flat dict ready to unpack into MarketAnalysisSession fields.
    """
    # ── v1: (asset_side, tf_level) buckets ───────────────────────────────
    v1_buckets: dict[tuple[str, str], list[int]] = {}
    v1_counts: dict[tuple[str, str], int] = {}

    # ── v2: (asset_side, score_block) buckets ────────────────────────────
    v2_buckets: dict[tuple[str, str], list[int]] = {}
    v2_counts: dict[tuple[str, str], int] = {}

    for ind_id, ind in indicators_by_id.items():
        if ind_id not in enabled_ids:
            continue
        side = "a" if ind.asset_target in ("a", "single") else "b"

        # v1
        v1_key = (side, ind.timeframe_level)
        v1_counts[v1_key] = v1_counts.get(v1_key, 0) + 1
        v1_buckets.setdefault(v1_key, [])

        # v2
        block = getattr(ind, "score_block", "trend")
        v2_key = (side, block)
        v2_counts[v2_key] = v2_counts.get(v2_key, 0) + 1
        v2_buckets.setdefault(v2_key, [])

    for ans in answers:
        ans_ind = indicators_by_id.get(ans.indicator_id)
        if ans_ind is None or ans.indicator_id not in enabled_ids:
            continue
        side = "a" if ans_ind.asset_target in ("a", "single") else "b"

        v1_key = (side, ans_ind.timeframe_level)
        v1_buckets.setdefault(v1_key, []).append(ans.score)

        block = getattr(ans_ind, "score_block", "trend")
        v2_key = (side, block)
        v2_buckets.setdefault(v2_key, []).append(ans.score)

    def _calc_v1(side: str, tf: str) -> tuple[Decimal | None, str | None]:
        key = (side, tf)
        count = v1_counts.get(key, 0)
        if count == 0:
            return None, None
        pct = _score_pct(sum(v1_buckets.get(key, [])), count)
        return pct, _bias_v1(pct)

    def _calc_v2_block(side: str, block: str) -> Decimal | None:
        key = (side, block)
        count = v2_counts.get(key, 0)
        if count == 0:
            return None
        return _score_pct(sum(v2_buckets.get(key, [])), count)

    def _calc_composite(side: str) -> tuple[Decimal | None, str | None]:
        scores: dict[str, Decimal] = {}
        for b in ("trend", "momentum", "participation"):
            s = _calc_v2_block(side, b)
            if s is not None:
                scores[b] = s
        if not scores:
            return None, None
        total_weight = sum(_BLOCK_WEIGHTS[b] for b in scores)
        composite = (
            sum((scores[b] * _BLOCK_WEIGHTS[b] for b in scores), Decimal("0")) / total_weight
        )
        composite = composite.quantize(Decimal("0.01"))
        return composite, _bias_v2(composite, bullish_threshold, bearish_threshold)

    result: dict = {}

    # v1 TF scores
    for tf in ("htf", "mtf", "ltf"):
        pct_a, bias_a = _calc_v1("a", tf)
        result[f"score_{tf}_a"] = pct_a
        result[f"bias_{tf}_a"] = bias_a
        if module.is_dual:
            pct_b, bias_b = _calc_v1("b", tf)
            result[f"score_{tf}_b"] = pct_b
            result[f"bias_{tf}_b"] = bias_b
        else:
            result[f"score_{tf}_b"] = None
            result[f"bias_{tf}_b"] = None

    # v2 block scores — asset A
    for block in ("trend", "momentum", "participation"):
        result[f"score_{block}_a"] = _calc_v2_block("a", block)
    composite_a, bias_composite_a = _calc_composite("a")
    result["score_composite_a"] = composite_a
    result["bias_composite_a"] = bias_composite_a

    # v2 block scores — asset B
    if module.is_dual:
        for block in ("trend", "momentum", "participation"):
            result[f"score_{block}_b"] = _calc_v2_block("b", block)
        composite_b, bias_composite_b = _calc_composite("b")
        result["score_composite_b"] = composite_b
        result["bias_composite_b"] = bias_composite_b
    else:
        for block in ("trend", "momentum", "participation"):
            result[f"score_{block}_b"] = None
        result["score_composite_b"] = None
        result["bias_composite_b"] = None

    return result


# ── Trade Conclusion logic ────────────────────────────────────────────────────


def get_trade_conclusion(
    trend: Decimal,
    momentum: Decimal,
    participation: Decimal,
    bias: str,
) -> TradeConclusion:
    """
    Translate 3 decomposed block scores + composite bias into an actionable
    trade recommendation.

    Rules evaluated in priority order:
      1. Risk-Off         — bearish bias + very weak participation
      2. Late Stage       — strong trend but momentum fading
      3. Full Trend       — all 3 factors aligned bullish
      4. Wait             — trend present but momentum/participation lagging
      5. Day Trade Only   — momentum spike without trend backing
      6. Neutral (default)
    """
    # 1. Risk-Off
    if bias == "bearish" and participation < Decimal("40"):
        return TradeConclusion(
            emoji="🔴",
            label="Risk-Off — No Longs",
            detail="USDT.D rising + weak participation. Longs not recommended.",
            trade_types=[],
            size_advice="cash or short only",
            color="red",
        )

    # 2. Late Stage / Exhaustion
    if trend >= Decimal("65") and momentum < Decimal("40"):
        return TradeConclusion(
            emoji="⚠️",
            label="Late Stage / Exhaustion",
            detail="Trend strong but momentum fading. Reduce size, take early TPs.",
            trade_types=["swing_short_term"],
            size_advice="reduced (50%)",
            color="amber",
        )

    # 3. Full Trend — everything aligned
    if (
        trend >= Decimal("65")
        and momentum >= Decimal("60")
        and participation >= Decimal("55")
        and bias == "bullish"
    ):
        return TradeConclusion(
            emoji="🟢",
            label="Trend Following — Full Size",
            detail="All factors aligned. Swing longs, high R:R setups, normal size.",
            trade_types=["swing", "position"],
            size_advice="normal (100%)",
            color="green",
        )

    # 4. Wait for Confirmation
    if trend >= Decimal("55") and (momentum < Decimal("50") or participation < Decimal("50")):
        return TradeConclusion(
            emoji="🟡",
            label="Wait for Confirmation",
            detail="Trend present but momentum or participation not confirming. Reduce size or wait.",
            trade_types=["swing_careful"],
            size_advice="reduced (50–75%)",
            color="amber",
        )

    # 5. Day Trade Only — momentum without trend
    if momentum >= Decimal("60") and trend < Decimal("50"):
        return TradeConclusion(
            emoji="⚡",
            label="Day Trade Only",
            detail="Short-term momentum only. No swing positions. Quick exits.",
            trade_types=["day_trading"],
            size_advice="reduced (50%)",
            color="amber",
        )

    # 6. Neutral fallback
    return TradeConclusion(
        emoji="🟡",
        label="Neutral — Selective",
        detail="Mixed signals. Only A+ setups, reduced size.",
        trade_types=["day_trading", "swing_careful"],
        size_advice="reduced (50%)",
        color="neutral",
    )


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


def patch_indicator(
    db: Session, indicator_id: int, data: IndicatorUpdate
) -> MarketAnalysisIndicator:
    ind = (
        db.query(MarketAnalysisIndicator).filter(MarketAnalysisIndicator.id == indicator_id).first()
    )
    if not ind:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Indicator {indicator_id} not found.",
        )
    update_data = data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(ind, field, value)
    db.commit()
    db.refresh(ind)
    return ind


def get_indicator_config(db: Session, profile_id: int) -> tuple[int, list[IndicatorConfigItem]]:
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
    Computes both v1 (HTF/MTF/LTF) and v2 (Trend/Momentum/Participation/Composite) scores.
    """
    _get_profile_or_404(db, data.profile_id)
    module = _get_module_or_404(db, data.module_id)

    indicators = (
        db.query(MarketAnalysisIndicator)
        .filter(MarketAnalysisIndicator.module_id == data.module_id)
        .all()
    )
    indicators_by_id: dict[int, MarketAnalysisIndicator] = {i.id: i for i in indicators}

    unknown = {a.indicator_id for a in data.answers} - set(indicators_by_id)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Indicator IDs {sorted(unknown)} do not belong to module {data.module_id}.",
        )

    enabled_ids = _get_enabled_indicator_ids(db, data.profile_id, data.module_id)
    bullish_t, bearish_t = _get_thresholds(db, data.module_id)
    scores = _compute_scores(
        module, indicators_by_id, data.answers, enabled_ids, bullish_t, bearish_t
    )

    session = MarketAnalysisSession(
        profile_id=data.profile_id,
        module_id=data.module_id,
        notes=data.notes,
        analyzed_at=data.analyzed_at or datetime.now(UTC),
        **scores,
    )
    db.add(session)
    db.flush()

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
    return q.order_by(MarketAnalysisSession.analyzed_at.desc()).offset(offset).limit(limit).all()


def get_session(db: Session, session_id: int) -> MarketAnalysisSession:
    return _get_session_or_404(db, session_id)


def get_session_conclusion(db: Session, session_id: int) -> TradeConclusion:
    """
    Return the trade conclusion for a session.
    Requires v2 scores (score_trend_a IS NOT NULL).
    Falls back to a neutral conclusion for legacy sessions.
    """
    session = _get_session_or_404(db, session_id)

    if session.score_trend_a is None:
        # Legacy session — no decomposed scores
        return TradeConclusion(
            emoji="🟡",
            label="Analysis Needed",
            detail="This is a legacy session without block scores. Run a new analysis to get a conclusion.",
            trade_types=[],
            size_advice="n/a",
            color="neutral",
        )

    trend = session.score_trend_a
    momentum = session.score_momentum_a
    participation = session.score_participation_a
    bias = session.bias_composite_a or "neutral"

    return get_trade_conclusion(
        trend=trend or Decimal("50"),
        momentum=momentum or Decimal("50"),
        participation=participation or Decimal("50"),
        bias=bias,
    )


def _staleness_item(
    mod: MarketAnalysisModule,
    last_session: MarketAnalysisSession | None,
    now: datetime,
) -> StalenessItem:
    if last_session is None:
        return StalenessItem(
            module_id=mod.id,
            module_name=mod.name,
            last_analyzed_at=None,
            days_old=None,
            is_stale=True,
        )
    last_dt = last_session.analyzed_at
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=UTC)
    days_old = (now - last_dt).days
    return StalenessItem(
        module_id=mod.id,
        module_name=mod.name,
        last_analyzed_at=last_session.analyzed_at,
        days_old=days_old,
        is_stale=days_old > STALE_DAYS,
    )


def get_staleness(db: Session, profile_id: int) -> list[StalenessItem]:
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
        result.append(_staleness_item(mod, last_session, now))
    return result


def get_staleness_global(db: Session) -> list[StalenessItem]:
    """Global staleness — most recent session per module across ALL profiles."""
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
            .filter(MarketAnalysisSession.module_id == mod.id)
            .order_by(MarketAnalysisSession.analyzed_at.desc())
            .first()
        )
        result.append(_staleness_item(mod, last_session, now))
    return result
