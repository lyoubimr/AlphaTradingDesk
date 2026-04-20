"""
Phase 6A — AI service for analytics narrative generation.

Supports three providers via direct HTTP (httpx — already installed):
  - OpenAI       POST https://api.openai.com/v1/chat/completions
  - Anthropic    POST https://api.anthropic.com/v1/messages
  - Perplexity   POST https://api.perplexity.ai/chat/completions  (OpenAI-compatible)

API keys are stored Fernet-encrypted in analytics_ai_keys.{provider}_key_enc.
Encryption key: settings.encryption_key (must be a valid Fernet key — base64url 32 bytes).

Usage:
  summary = await generate_ai_summary(profile_id, period, report, db)
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.analytics.models import AnalyticsAICache, AnalyticsAIKeys
from src.analytics.schemas import AIGenerateOut, PerformanceReport
from src.analytics.service import get_ai_keys_row, get_analytics_settings
from src.core.config import settings

logger = logging.getLogger(__name__)

# ── Encryption helpers ────────────────────────────────────────────────────────

def _get_fernet() -> Fernet:
    """Return a Fernet instance using the app's ENCRYPTION_KEY."""
    try:
        return Fernet(settings.encryption_key.encode())
    except Exception as exc:
        raise RuntimeError("Invalid ENCRYPTION_KEY — must be a valid Fernet key.") from exc


def encrypt_key(plain: str) -> bytes:
    """Encrypt a plain-text API key to Fernet token bytes."""
    return _get_fernet().encrypt(plain.encode())


def decrypt_key(token: bytes) -> str:
    """Decrypt a Fernet token to plain text. Raises HTTPException on failure."""
    try:
        return _get_fernet().decrypt(token).decode()
    except InvalidToken as exc:
        raise HTTPException(status_code=500, detail="Failed to decrypt API key.") from exc


# ── AI keys CRUD ──────────────────────────────────────────────────────────────

def save_ai_keys(
    profile_id: int,
    openai_key: str | None,
    anthropic_key: str | None,
    perplexity_key: str | None,
    db: Session,
    groq_key: str | None = None,
    gemini_key: str | None = None,
) -> None:
    """Encrypt and persist AI API keys. None = keep existing, '' = clear."""
    row = get_ai_keys_row(profile_id, db)

    if openai_key is not None:
        row.openai_key_enc = encrypt_key(openai_key) if openai_key else None
    if anthropic_key is not None:
        row.anthropic_key_enc = encrypt_key(anthropic_key) if anthropic_key else None
    if perplexity_key is not None:
        row.perplexity_key_enc = encrypt_key(perplexity_key) if perplexity_key else None
    if groq_key is not None:
        row.groq_key_enc = encrypt_key(groq_key) if groq_key else None
    if gemini_key is not None:
        row.gemini_key_enc = encrypt_key(gemini_key) if gemini_key else None

    row.updated_at = datetime.now(UTC).replace(tzinfo=None)
    db.commit()


def _get_decrypted_key(row: AnalyticsAIKeys, provider: str) -> str:
    """Return the decrypted API key for a provider, or raise 400 if not set."""
    enc_col_map = {
        "openai": row.openai_key_enc,
        "anthropic": row.anthropic_key_enc,
        "perplexity": row.perplexity_key_enc,
        "groq": row.groq_key_enc,
        "gemini": row.gemini_key_enc,
    }
    enc = enc_col_map.get(provider)
    if not enc:
        raise HTTPException(
            status_code=400,
            detail=f"No API key configured for provider '{provider}'. Please add it in Analytics settings.",
        )
    return decrypt_key(enc)


# ── Prompt builder ────────────────────────────────────────────────────────────

def _build_prompt(report: PerformanceReport) -> str:
    kpi = report.kpi
    rr = round(abs(kpi.avg_win_pnl / kpi.avg_loss_pnl), 2) if kpi.avg_loss_pnl else "N/A"
    lines = [
        "You are an experienced trading coach reviewing a trader's performance data. "
        "Respond ONLY using the exact numbers provided below — never invent or extrapolate figures. "
        "Use emojis generously throughout your response — not just on section headers but also inline on bullet points to make the feedback vivid and easy to scan. "
        "Structure your response in exactly 3 sections:\n"
        "✅ What's working\n"
        "❌ What needs fixing\n"
        "🎯 Actions to take\n"
        "Each section: 3-5 bullet points, each starting with a relevant emoji, short and direct. "
        "Only draw conclusions from data points with enough trades to be meaningful — judge significance yourself from the trade counts. "
        "On the Actions section: be specific and concrete, reference the actual numbers.",
        "",
        "━━━ 📊 OVERALL KPIs ━━━",
        f"📅 Period: {report.period}",
        f"🔢 Total trades: {kpi.total_trades} | Disciplined: {kpi.disciplined_trades}",
        f"🎯 Disciplined WR: {kpi.disciplined_wr}% | Raw WR: {kpi.raw_wr}%",
        f"⚖️  Profit factor: {kpi.profit_factor} | Expectancy: {kpi.expectancy}",
        f"💰 Avg win: {kpi.avg_win_pnl} | Avg loss: {kpi.avg_loss_pnl} | R:R implied: {rr}",
        f"🔥 Current streak: {kpi.current_streak} | Best win streak: {kpi.best_win_streak} | Worst loss streak: {kpi.worst_loss_streak}",
        "",
        "━━━ 🕐 SESSIONS ━━━",
    ]
    for s in report.wr_by_session:
        lines.append(f"  {s.label}: {s.trades} trades | WR {s.wr_pct}% | avg PnL {s.avg_pnl} | total PnL {s.total_pnl}")

    lines += ["", "━━━ 📈 STRATEGIES ━━━"]
    for s in report.wr_by_strategy[:5]:
        lines.append(f"  {s.label}: {s.trades} trades | WR {s.wr_pct}% | avg PnL {s.avg_pnl} | total PnL {s.total_pnl}")

    lines += ["", "━━━ 💱 PAIRS ━━━"]
    for p in report.pair_leaderboard[:6]:
        lines.append(f"  {p.label}: {p.trades} trades | WR {p.wr_pct}% | avg PnL {p.avg_pnl} | total PnL {p.total_pnl}")

    lines += ["", "━━━ ⏱️  TRADE STYLE ━━━"]
    for t in report.trade_type_dist:
        lines.append(f"  {t.trade_type}: {t.count} trades | WR {t.wr_pct}% | avg PnL {t.avg_pnl}")

    lines += ["", "━━━ ↕️  DIRECTION ━━━"]
    for d in report.direction_bias:
        lines.append(f"  {d.direction}: {d.trades} trades | WR {d.wr_pct}% | total PnL {d.total_pnl}")

    lines += ["", "━━━ 🏷️  TAGS ━━━"]
    if report.top_tags_winners:
        lines.append("Winners: " + ", ".join(f"{t.tag} ({t.count}x)" for t in report.top_tags_winners[:6]))
    if report.top_tags_losers:
        lines.append("Losers:  " + ", ".join(f"{t.tag} ({t.count}x)" for t in report.top_tags_losers[:6]))
    if report.repeat_errors:
        lines.append("🔁 Repeat mistakes: " + ", ".join(f"{e.tag} ({e.error_count}x)" for e in report.repeat_errors[:5]))

    if report.tp_hit_rates:
        lines += ["", "━━━ 🎯 TP HIT RATES ━━━"]
        for tp in report.tp_hit_rates:
            lines.append(f"  TP{tp.tp_number}: {tp.hits}/{tp.total} hit ({tp.hit_rate_pct}%)")

    if report.vi_correlation:
        lines += ["", "━━━ 🌊 VOLATILITY (pair VI buckets) ━━━"]
        for v in report.vi_correlation:
            lines.append(f"  {v.bucket}: {v.trades} trades | WR {v.wr_pct}% | avg PnL {v.avg_pnl}")

    lines += [
        "",
        "━━━ 📝 REVIEW RATE ━━━",
        f"  {report.review_rate.review_rate_pct}% of trades reviewed ({report.review_rate.reviewed_count}/{report.review_rate.total_closed})",
    ]
    return "\n".join(lines)


# ── Provider API calls ────────────────────────────────────────────────────────

async def _call_openai(api_key: str, model: str, prompt: str) -> tuple[str, int]:
    """Call OpenAI Chat Completions API. Returns (summary, tokens_used)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
                "temperature": 0.7,
            },
        )
    if resp.status_code != 200:
        _raise_provider_error("OpenAI", resp)
    data = resp.json()
    summary = data["choices"][0]["message"]["content"].strip()
    tokens = data.get("usage", {}).get("total_tokens", 0)
    return summary, tokens


async def _call_anthropic(api_key: str, model: str, prompt: str) -> tuple[str, int]:
    """Call Anthropic Messages API. Returns (summary, tokens_used)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": model,
                "max_tokens": 800,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
    if resp.status_code != 200:
        _raise_provider_error("Anthropic", resp)
    data = resp.json()
    summary = data["content"][0]["text"].strip()
    tokens = data.get("usage", {}).get("input_tokens", 0) + data.get("usage", {}).get("output_tokens", 0)
    return summary, tokens


async def _call_perplexity(api_key: str, model: str, prompt: str) -> tuple[str, int]:
    """Call Perplexity API (OpenAI-compatible). Returns (summary, tokens_used)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
            },
        )
    if resp.status_code != 200:
        _raise_provider_error("Perplexity", resp)
    data = resp.json()
    summary = data["choices"][0]["message"]["content"].strip()
    tokens = data.get("usage", {}).get("total_tokens", 0)
    return summary, tokens


async def _call_groq(api_key: str, model: str, prompt: str) -> tuple[str, int]:
    """Call Groq API (OpenAI-compatible, free tier). Returns (summary, tokens_used)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
                "temperature": 0.7,
            },
        )
    if resp.status_code != 200:
        _raise_provider_error("Groq", resp)
    data = resp.json()
    summary = data["choices"][0]["message"]["content"].strip()
    tokens = data.get("usage", {}).get("total_tokens", 0)
    return summary, tokens


async def _call_gemini(api_key: str, model: str, prompt: str) -> tuple[str, int]:
    """Call Google Gemini via OpenAI-compatible endpoint. Returns (summary, tokens_used)."""
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
                "temperature": 0.7,
            },
        )
    if resp.status_code != 200:
        _raise_provider_error("Google Gemini", resp)
    data = resp.json()
    summary = data["choices"][0]["message"]["content"].strip()
    tokens = data.get("usage", {}).get("total_tokens", 0)
    return summary, tokens


def _raise_provider_error(provider: str, resp: httpx.Response) -> None:
    try:
        detail = resp.json()
    except Exception:
        detail = resp.text[:200]
    raise HTTPException(
        status_code=502,
        detail=f"{provider} API error {resp.status_code}: {json.dumps(detail)[:300]}",
    )


# ── Main entry point ──────────────────────────────────────────────────────────

async def generate_ai_summary(
    profile_id: int,
    period: str,
    report: PerformanceReport,
    db: Session,
) -> AIGenerateOut:
    """Generate and cache an AI narrative for the given performance report."""
    settings_row = get_analytics_settings(profile_id, db)
    config = settings_row.config or {}

    if not config.get("ai_enabled", False):
        raise HTTPException(status_code=400, detail="AI insights are disabled. Enable them in Analytics settings.")

    provider = config.get("ai_provider", "openai")
    model = config.get("ai_model", "gpt-4o-mini")

    keys_row = get_ai_keys_row(profile_id, db)
    api_key = _get_decrypted_key(keys_row, provider)

    prompt = _build_prompt(report)

    # ── Call selected provider ─────────────────────────────────────────────
    if provider == "openai":
        summary, tokens = await _call_openai(api_key, model, prompt)
    elif provider == "anthropic":
        summary, tokens = await _call_anthropic(api_key, model, prompt)
    elif provider == "perplexity":
        summary, tokens = await _call_perplexity(api_key, model, prompt)
    elif provider == "groq":
        summary, tokens = await _call_groq(api_key, model, prompt)
    elif provider == "gemini":
        summary, tokens = await _call_gemini(api_key, model, prompt)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider '{provider}'.")

    # ── Upsert cache ───────────────────────────────────────────────────────
    now = datetime.now(UTC).replace(tzinfo=None)
    cache = (
        db.query(AnalyticsAICache)
        .filter_by(profile_id=profile_id, period=period)
        .first()
    )
    if cache is None:
        cache = AnalyticsAICache(
            profile_id=profile_id,
            period=period,
            summary=summary,
            generated_at=now,
            tokens_used=tokens or None,
        )
        db.add(cache)
    else:
        cache.summary = summary
        cache.generated_at = now
        cache.tokens_used = tokens or None
    db.commit()

    logger.info("ai_summary_generated provider=%s model=%s profile=%s period=%s tokens=%s", provider, model, profile_id, period, tokens)

    return AIGenerateOut(
        summary=summary,
        provider=provider,
        model=model,
        tokens_used=tokens or None,
        generated_at=now.isoformat(),
    )
