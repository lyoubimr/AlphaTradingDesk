"""
Seed: global strategies (profile_id = NULL).

Global strategies are shared across ALL profiles and appear in every trade form.
They complement profile-specific strategies (created manually per profile).

Idempotent: uses INSERT ... ON CONFLICT DO NOTHING on (name) WHERE profile_id IS NULL.
Safe to re-run at any time — existing global strategies are never modified.

The partial unique index `uq_strategies_global` (created in migration 412487625940)
enforces uniqueness of (name) among global strategies.
"""
from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global strategy definitions
# Each entry maps directly to the strategies table columns.
# profile_id is intentionally absent — it will be NULL in the DB.
# ---------------------------------------------------------------------------

GLOBAL_STRATEGIES: list[dict] = [
    {
        "name": "BOS Retest",
        "description": "Break of Structure followed by retest of the broken level.",
        "rules": "Wait for clean BOS → let price retrace to broken S/R → enter on confirmation candle.",
        "emoji": "🔁",
        "color": "#6366f1",
    },
    {
        "name": "Order Block Sweep",
        "description": "Sweep of liquidity into an OB then reversal.",
        "rules": "Identify OB on higher TF → wait for sweep of opposing liquidity → enter on OB reaction.",
        "emoji": "🧲",
        "color": "#0ea5e9",
    },
    {
        "name": "FVG Fill",
        "description": "Fair Value Gap fill trade — price revisits an imbalance zone.",
        "rules": "Mark FVG on H1/H4 → enter when price enters FVG with momentum shift. SL below/above FVG.",
        "emoji": "🕳️",
        "color": "#10b981",
    },
    {
        "name": "Liquidity Grab",
        "description": "Equal highs/lows swept, then quick reversal.",
        "rules": "Identify EQH/EQL → wait for sweep → enter on next candle close back inside range.",
        "emoji": "💧",
        "color": "#f59e0b",
    },
    {
        "name": "Trend Continuation",
        "description": "Trade in the direction of the prevailing trend after a pullback.",
        "rules": "HTF bias confirmed → wait for pullback to structure/MA → enter on lower TF confirmation.",
        "emoji": "📈",
        "color": "#84cc16",
    },
    {
        "name": "Range Fade",
        "description": "Fade the extremes of a defined range.",
        "rules": "Mark range H/L → enter counter-trend at extremes → SL outside range. TP at opposite side.",
        "emoji": "↔️",
        "color": "#a78bfa",
    },
    {
        "name": "News / Catalyst",
        "description": "Trade based on a fundamental event or macro catalyst.",
        "rules": "Wait for news release → confirm direction after 1-2 candles → ride initial impulse.",
        "emoji": "📰",
        "color": "#f97316",
    },
    {
        "name": "Scalp",
        "description": "Quick intraday scalp on M1–M15 with tight SL.",
        "rules": "Use M15 for structure, M1 for entry. Risk max 0.5%. Target R:R ≥ 1.5.",
        "emoji": "⚡",
        "color": "#ec4899",
    },
]


def seed_global_strategies(session: Session) -> list[int]:
    """
    Insert global strategies (profile_id = NULL). Skip on conflict (idempotent).

    Uses raw SQL INSERT ... ON CONFLICT DO NOTHING to target the partial unique index
    uq_strategies_global — SQLAlchemy ORM insert() does not support partial index targets.

    Returns a list of IDs of the inserted (or already-existing) global strategies.
    """
    for s in GLOBAL_STRATEGIES:
        session.execute(
            text("""
                INSERT INTO strategies (profile_id, name, description, rules, emoji, color, status,
                                        trades_count, win_count, min_trades_for_stats)
                VALUES (NULL, :name, :description, :rules, :emoji, :color, 'active', 0, 0, 5)
                ON CONFLICT DO NOTHING
            """),
            {
                "name": s["name"],
                "description": s.get("description"),
                "rules": s.get("rules"),
                "emoji": s.get("emoji"),
                "color": s.get("color"),
            },
        )

    session.flush()

    rows = session.execute(
        text("SELECT id FROM strategies WHERE profile_id IS NULL AND status = 'active'")
    ).fetchall()
    ids = [r[0] for r in rows]
    logger.info("Global strategies seeded: %d rows (total global active)", len(ids))
    return ids
