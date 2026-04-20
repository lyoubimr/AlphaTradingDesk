"""
Phase 6A — Analytics API router.

Routes:
  GET  /api/analytics/performance/{profile_id}?period=30d
       → PerformanceReport (15 metrics + cached AI summary)

  GET  /api/analytics/settings/{profile_id}
  PUT  /api/analytics/settings/{profile_id}
       → AnalyticsSettingsOut

  GET  /api/analytics/ai-keys/{profile_id}
       → AIKeysStatusOut (which providers are configured — no raw keys exposed)

  PUT  /api/analytics/ai-keys/{profile_id}
       → AIKeysStatusOut (save / clear encrypted keys)

  POST /api/analytics/ai/generate/{profile_id}?period=30d
       → AIGenerateOut (trigger AI generation, update cache)

  DELETE /api/analytics/ai/cache/{profile_id}?period=30d
       → 204 (clear cached summary for a specific period)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.analytics.ai_service import generate_ai_summary, save_ai_keys
from src.analytics.models import AnalyticsAICache
from src.analytics.schemas import (
    AIGenerateOut,
    AIKeysStatusOut,
    AIKeysUpdateIn,
    AnalyticsSettingsOut,
    AnalyticsSettingsUpdateIn,
    PerformanceReport,
)
from src.analytics.service import (
    compute_performance_report,
    get_ai_keys_status,
    get_analytics_settings,
    update_analytics_settings,
)
from src.core.deps import get_db

router = APIRouter(prefix="/analytics", tags=["analytics"])


# ── Performance report ────────────────────────────────────────────────────────

@router.get("/performance/{profile_id}", response_model=PerformanceReport)
def get_performance(
    profile_id: int,
    period: str = Query(default="30d", description="30d | 90d | 180d | all"),
    db: Session = Depends(get_db),
) -> PerformanceReport:
    """Compute and return the full performance report for a profile."""
    return compute_performance_report(profile_id, period, db)


# ── Settings ──────────────────────────────────────────────────────────────────

@router.get("/settings/{profile_id}", response_model=AnalyticsSettingsOut)
def get_settings(
    profile_id: int,
    db: Session = Depends(get_db),
) -> AnalyticsSettingsOut:
    row = get_analytics_settings(profile_id, db)
    return AnalyticsSettingsOut(profile_id=row.profile_id, config=row.config)


@router.put("/settings/{profile_id}", response_model=AnalyticsSettingsOut)
def update_settings(
    profile_id: int,
    body: AnalyticsSettingsUpdateIn,
    db: Session = Depends(get_db),
) -> AnalyticsSettingsOut:
    patch = body.model_dump(exclude_none=True)
    row = update_analytics_settings(profile_id, patch, db)
    return AnalyticsSettingsOut(profile_id=row.profile_id, config=row.config)


# ── AI keys ───────────────────────────────────────────────────────────────────

@router.get("/ai-keys/{profile_id}", response_model=AIKeysStatusOut)
def get_ai_keys(
    profile_id: int,
    db: Session = Depends(get_db),
) -> AIKeysStatusOut:
    return get_ai_keys_status(profile_id, db)


@router.put("/ai-keys/{profile_id}", response_model=AIKeysStatusOut)
def update_ai_keys(
    profile_id: int,
    body: AIKeysUpdateIn,
    db: Session = Depends(get_db),
) -> AIKeysStatusOut:
    save_ai_keys(
        profile_id=profile_id,
        openai_key=body.openai_key,
        anthropic_key=body.anthropic_key,
        perplexity_key=body.perplexity_key,
        groq_key=body.groq_key,
        gemini_key=body.gemini_key,
        db=db,
    )
    return get_ai_keys_status(profile_id, db)


# ── AI generation ─────────────────────────────────────────────────────────────

@router.post("/ai/generate/{profile_id}", response_model=AIGenerateOut)
async def generate_summary(
    profile_id: int,
    period: str = Query(default="30d", description="30d | 90d | 180d | all"),
    db: Session = Depends(get_db),
) -> AIGenerateOut:
    """Trigger AI narrative generation and update the cache."""
    report = compute_performance_report(profile_id, period, db)
    return await generate_ai_summary(profile_id, period, report, db)


# ── AI cache ──────────────────────────────────────────────────────────────────

@router.delete("/ai/cache/{profile_id}", status_code=204, response_model=None)
def clear_ai_cache(
    profile_id: int,
    period: str = Query(default="30d", description="30d | 90d | 180d | all"),
    db: Session = Depends(get_db),
) -> None:
    """Clear the cached AI summary for a given profile+period."""
    db.query(AnalyticsAICache).filter_by(profile_id=profile_id, period=period).delete()
    db.commit()
