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

from fastapi import HTTPException, UploadFile, status
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
from src.core.models.trade import Trade
from src.core.uploads import save_image_upload
from src.market_analysis.schemas import (
    AnswerIn,
    EvaluationBucket,
    EvaluationStatsOut,
    IndicatorConfigItem,
    IndicatorCreate,
    IndicatorUpdate,
    LinkedTradeItem,
    LinkedTradesOut,
    ModuleUpdate,
    SessionCreate,
    SessionUpdate,
    StalenessItem,
    TimeframeLinkOut,
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
      1.  Risk-Off         — bearish bias + participation < 40
      1b. Bearish          — bearish bias (any participation)
      2.  Late Stage       — strong trend but momentum fading
      3.  Full Trend       — all 3 factors aligned bullish
      4.  Wait             — trend present but momentum/participation lagging
      5.  Day Trade Only   — momentum spike without trend backing
      6.  Neutral (default)
    """
    # 1. Risk-Off — bearish + participation collapsed
    if bias == "bearish" and participation < Decimal("40"):
        return TradeConclusion(
            emoji="🔴",
            label="Risk-Off — Shorts Only",
            detail="USDT.D rising + weak participation. No longs. Short only on confirmed breakdowns.",
            trade_types=["short"],
            size_advice="shorts only or cash",
            color="red",
        )

    # 1b. Bearish — no longs, go short on A+ setups
    if bias == "bearish":
        return TradeConclusion(
            emoji="🔴",
            label="Bearish — Go Short",
            detail="Bearish composite. No longs. Look for short setups on A+ confirmations.",
            trade_types=["short"],
            size_advice="shorts only (50–100%)",
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


_PULSE_VERDICTS: dict[str, TradeConclusion] = {
    "alts_long_friendly": TradeConclusion(
        emoji="🟢",
        label="Alts Long-Friendly",
        detail="BTC structure holding and BTC.D rejected — rotation into alts. Long S/R setups on alts.",
        trade_types=["long_alts"],
        size_advice="normal (100%)",
        color="green",
    ),
    "btc_only": TradeConclusion(
        emoji="🟡",
        label="BTC Only — Alts Risky",
        detail="BTC strong but BTC.D accepted above resistance — alts bleed. Prefer BTC or A+ alt setups.",
        trade_types=["long_btc"],
        size_advice="reduced (50–75%)",
        color="amber",
    ),
    "risk_off": TradeConclusion(
        emoji="🔴",
        label="Risk-Off — Shorts or Stand Aside",
        detail="BTC weak and BTC.D rising — alts bleed hardest. No longs; short only on confirmed breakdowns.",
        trade_types=["short"],
        size_advice="shorts only (50–100%) or cash",
        color="red",
    ),
    "alts_fragile": TradeConclusion(
        emoji="🟡",
        label="Alts Fragile — Low Conviction",
        detail="BTC weak but BTC.D rejected — alts may hold, but conviction is low. A+ setups only.",
        trade_types=["day_trading"],
        size_advice="reduced (50%)",
        color="amber",
    ),
}

# verdict → {(is_btc_pair, direction): aligned | neutral | opposed}
_PULSE_DIRECTION: dict[str, dict[tuple[bool, str], str]] = {
    "alts_long_friendly": {
        (False, "long"): "aligned", (False, "short"): "opposed",
        (True, "long"): "aligned", (True, "short"): "opposed",
    },
    "btc_only": {
        (False, "long"): "neutral", (False, "short"): "neutral",
        (True, "long"): "aligned", (True, "short"): "opposed",
    },
    "risk_off": {
        (False, "long"): "opposed", (False, "short"): "aligned",
        (True, "long"): "opposed", (True, "short"): "aligned",
    },
    "alts_fragile": {
        (False, "long"): "neutral", (False, "short"): "neutral",
        (True, "long"): "opposed", (True, "short"): "aligned",
    },
}


def pulse_verdict_code(scores: dict[str, int]) -> str | None:
    """BTC structure × BTC.D reaction → verdict code (None if either answer is neutral/absent)."""
    btc = scores.get("pulse_btc_structure")
    btcd = scores.get("pulse_btcd_levels")
    return {
        (2, 2): "alts_long_friendly",
        (2, 0): "btc_only",
        (0, 0): "risk_off",
        (0, 2): "alts_fragile",
    }.get((btc, btcd))  # type: ignore[arg-type]


def pulse_direction_match(code: str, *, is_btc_pair: bool, direction: str) -> str | None:
    """aligned | neutral | opposed for a trade, given a Pulse verdict code."""
    return _PULSE_DIRECTION.get(code, {}).get((is_btc_pair, direction))


def pulse_scores_for_session(session: MarketAnalysisSession) -> dict[str, int]:
    return {a.indicator.key: a.score for a in session.answers}


def get_pulse_conclusion(scores: dict[str, int]) -> TradeConclusion | None:
    """Verdict for the Crypto Pulse module (answer scores keyed by indicator key).

    Returns None when BTC or BTC.D is neutral → caller falls back to the generic
    composite conclusion.
    """
    code = pulse_verdict_code(scores)
    return _PULSE_VERDICTS[code] if code else None


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


def create_indicator(
    db: Session, module_id: int, data: IndicatorCreate
) -> MarketAnalysisIndicator:
    _get_module_or_404(db, module_id)
    existing = (
        db.query(MarketAnalysisIndicator)
        .filter(
            MarketAnalysisIndicator.module_id == module_id,
            MarketAnalysisIndicator.key == data.key,
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Indicator key '{data.key}' already exists in this module.",
        )
    ind = MarketAnalysisIndicator(module_id=module_id, **data.model_dump())
    db.add(ind)
    db.commit()
    db.refresh(ind)
    return ind


def delete_indicator(db: Session, indicator_id: int) -> None:
    ind = (
        db.query(MarketAnalysisIndicator)
        .filter(MarketAnalysisIndicator.id == indicator_id)
        .first()
    )
    if not ind:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Indicator {indicator_id} not found.",
        )
    db.delete(ind)
    db.commit()


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

    pulse = get_pulse_conclusion(pulse_scores_for_session(session))
    if pulse is not None:
        return pulse

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
    window_h = mod.stale_hours or STALE_DAYS * 24
    if last_session is None:
        return StalenessItem(
            module_id=mod.id,
            module_name=mod.name,
            last_analyzed_at=None,
            days_old=None,
            is_stale=True,
            stale_after_hours=window_h,
            warn_after_hours=mod.warn_hours,
            freshness="none",
        )
    last_dt = last_session.analyzed_at
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=UTC)
    age = now - last_dt
    hours_old = round(age.total_seconds() / 3600, 1)
    if hours_old > window_h:
        freshness = "stale"
    elif mod.warn_hours is not None and hours_old > mod.warn_hours:
        freshness = "aging"
    else:
        freshness = "fresh"
    return StalenessItem(
        module_id=mod.id,
        module_name=mod.name,
        last_analyzed_at=last_session.analyzed_at,
        days_old=age.days,
        is_stale=freshness == "stale",
        hours_old=hours_old,
        stale_after_hours=window_h,
        warn_after_hours=mod.warn_hours,
        freshness=freshness,
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


# ── Module freshness windows ──────────────────────────────────────────────────


def patch_module(db: Session, module_id: int, data: ModuleUpdate) -> MarketAnalysisModule:
    module = _get_module_or_404(db, module_id)
    changes = data.model_dump(exclude_unset=True)
    stale = changes.get("stale_hours", module.stale_hours)
    warn = changes.get("warn_hours", module.warn_hours)
    if warn is not None and warn > (stale or STALE_DAYS * 24):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="warn_hours must be ≤ stale_hours.",
        )
    for field, value in changes.items():
        setattr(module, field, value)
    db.commit()
    db.refresh(module)
    return module


# ── Trade timeframe ↔ MA session link ─────────────────────────────────────────

_LTF_TIMEFRAMES = {"1m", "5m", "15m", "30m", "1h"}
_HTF_TIMEFRAMES = {"4h", "1d", "1w"}
_PULSE_PREFIX = "Crypto Pulse"
_HTF_PREFIX = "Crypto HTF"


def resolve_session_for_timeframe(
    db: Session, profile_id: int, timeframe: str | None
) -> TimeframeLinkOut:
    """Pick the MA session a trade on `timeframe` should use.

    Crypto profiles: LTF (15m/1H) → Pulse module, HTF (4H/1D/1W) → HTF module.
    Other profiles keep "latest session of the profile". A session older than the
    module's stale window is never linked (the DRS criterion stays neutral).
    """
    profile = _get_profile_or_404(db, profile_id)
    tf = (timeframe or "").strip().lower()
    out = TimeframeLinkOut(timeframe=timeframe or "")
    now = datetime.now(UTC)

    module: MarketAnalysisModule | None
    if profile.market_type == "Crypto":
        if tf in _LTF_TIMEFRAMES:
            prefix = _PULSE_PREFIX
        elif tf in _HTF_TIMEFRAMES:
            prefix = _HTF_PREFIX
        else:
            out.reason = "No timeframe selected" if not tf else f"No MA module for {timeframe}"
            return out
        module = (
            db.query(MarketAnalysisModule)
            .filter(
                MarketAnalysisModule.is_active.is_(True),
                MarketAnalysisModule.name.startswith(prefix),
            )
            .order_by(MarketAnalysisModule.sort_order)
            .first()
        )
        if module is None:
            out.reason = f"Module '{prefix}' not available"
            return out
        last = (
            db.query(MarketAnalysisSession)
            .filter(
                MarketAnalysisSession.profile_id == profile_id,
                MarketAnalysisSession.module_id == module.id,
            )
            .order_by(MarketAnalysisSession.analyzed_at.desc())
            .first()
        )
    else:
        last = (
            db.query(MarketAnalysisSession)
            .filter(MarketAnalysisSession.profile_id == profile_id)
            .order_by(MarketAnalysisSession.analyzed_at.desc())
            .first()
        )
        module = last.module if last else None
        if module is None:
            out.reason = "No analysis yet"
            return out

    item = _staleness_item(module, last, now)
    out.module_id = module.id
    out.module_name = module.name
    out.freshness = item.freshness
    out.hours_old = item.hours_old
    out.stale_after_hours = item.stale_after_hours
    out.warn_after_hours = item.warn_after_hours
    if last is None:
        out.reason = f"{module.name} not run yet"
        return out
    if item.freshness == "stale":
        out.reason = f"{module.name} is stale"
        return out
    out.session_id = last.id
    out.verdict = get_session_conclusion(db, last.id)
    return out


# ── Session review: notes, screenshots, verdict, linked trades, hit-rate ──────

_SCREENSHOT_KINDS = {"before": "screenshots_before", "after": "screenshots_after"}


def patch_session(db: Session, session_id: int, data: SessionUpdate) -> MarketAnalysisSession:
    """Edit review fields only — answers and scores stay immutable."""
    session = _get_session_or_404(db, session_id)
    changes = data.model_dump(exclude_unset=True)
    for field in ("notes", "after_notes"):
        if field in changes:
            setattr(session, field, (changes[field] or "").strip() or None)
    if "evaluation" in changes:
        session.evaluation = changes["evaluation"]
        session.reviewed_at = datetime.now(UTC) if changes["evaluation"] else None
    db.commit()
    db.refresh(session)
    return session


def _screenshot_attr(kind: str) -> str:
    attr = _SCREENSHOT_KINDS.get(kind)
    if attr is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="kind must be 'before' or 'after'.",
        )
    return attr


def add_session_screenshot(
    db: Session, session_id: int, kind: str, file: UploadFile
) -> MarketAnalysisSession:
    attr = _screenshot_attr(kind)
    session = _get_session_or_404(db, session_id)
    url = save_image_upload(file, "ma_sessions", str(session_id))
    setattr(session, attr, [*(getattr(session, attr) or []), url])
    db.commit()
    db.refresh(session)
    return session


def remove_session_screenshot(
    db: Session, session_id: int, kind: str, url: str
) -> MarketAnalysisSession:
    """Detach a screenshot URL (the file itself stays on disk)."""
    attr = _screenshot_attr(kind)
    session = _get_session_or_404(db, session_id)
    setattr(session, attr, [u for u in (getattr(session, attr) or []) if u != url])
    db.commit()
    db.refresh(session)
    return session


def get_linked_trades(db: Session, session_id: int) -> LinkedTradesOut:
    """Trades opened under this analysis — a measured verdict next to the subjective one."""
    _get_session_or_404(db, session_id)
    rows = (
        db.query(Trade)
        .filter(Trade.market_analysis_session_id == session_id)
        .order_by(Trade.id)
        .all()
    )
    pnls: list[Decimal] = [
        t.realized_pnl for t in rows if t.status == "closed" and t.realized_pnl is not None
    ]
    return LinkedTradesOut(
        count=len(rows),
        closed=len(pnls),
        wins=sum(1 for p in pnls if p > 0),
        total_pnl=sum(pnls, Decimal("0")),
        trades=[
            LinkedTradeItem(
                id=t.id,
                pair=t.pair,
                direction=t.direction,
                status=t.status,
                realized_pnl=t.realized_pnl,
            )
            for t in rows
        ],
    )


def _bucket(key: str, evaluations: list[str | None]) -> EvaluationBucket:
    correct = evaluations.count("correct")
    wrong = evaluations.count("wrong")
    decisive = correct + wrong
    return EvaluationBucket(
        key=key,
        total=len(evaluations),
        correct=correct,
        wrong=wrong,
        neutral=evaluations.count("neutral"),
        not_evaluated=sum(1 for e in evaluations if e is None),
        hit_rate=round(correct / decisive, 3) if decisive else None,
    )


def get_evaluation_stats(db: Session, profile_id: int | None = None) -> EvaluationStatsOut:
    """Hit-rate per module and per Pulse verdict (neutral verdicts are not decisive)."""
    q = db.query(MarketAnalysisSession)
    if profile_id is not None:
        q = q.filter(MarketAnalysisSession.profile_id == profile_id)
    sessions = q.all()

    by_module: dict[str, list[str | None]] = {}
    by_verdict: dict[str, list[str | None]] = {}
    for s in sessions:
        by_module.setdefault(s.module.name, []).append(s.evaluation)
        code = pulse_verdict_code(pulse_scores_for_session(s))
        if code is not None:
            by_verdict.setdefault(_PULSE_VERDICTS[code].label, []).append(s.evaluation)

    return EvaluationStatsOut(
        by_module=[_bucket(k, v) for k, v in sorted(by_module.items())],
        by_verdict=[_bucket(k, v) for k, v in sorted(by_verdict.items())],
    )
