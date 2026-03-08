"""
Seed: trading_styles table.

4 predefined styles: scalping, day_trading, swing, position.
Sort order drives display order in the UI.

Idempotent: ON CONFLICT DO NOTHING on unique name.
"""
from __future__ import annotations

import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from src.core.models.broker import TradingStyle

logger = logging.getLogger(__name__)

TRADING_STYLES: list[dict] = [
    {
        "name": "scalping",
        "display_name": "Scalping",
        "default_timeframes": "1m,5m,15m",
        "description": (
            "Very short-term trades, seconds to minutes. "
            "High frequency, tight stops, small R targets."
        ),
        "sort_order": 1,
    },
    {
        "name": "day_trading",
        "display_name": "Day Trading",
        "default_timeframes": "15m,1h,4h",
        "description": (
            "Intraday trades, opened and closed within the same session. "
            "No overnight positions."
        ),
        "sort_order": 2,
    },
    {
        "name": "swing",
        "display_name": "Swing",
        "default_timeframes": "4h,1d",
        "description": (
            "Multi-day trades, typically 2–10 days. "
            "Targets larger moves using daily + 4H structure."
        ),
        "sort_order": 3,
    },
    {
        "name": "position",
        "display_name": "Position",
        "default_timeframes": "1d,1w",
        "description": (
            "Long-term directional trades, weeks to months. "
            "Based on macro structure and weekly/daily charts."
        ),
        "sort_order": 4,
    },
]


def seed_trading_styles(session: Session) -> dict[str, int]:
    """
    Insert predefined trading styles. Skip existing rows (idempotent).

    Returns a dict mapping style name → id.
    """
    stmt = (
        insert(TradingStyle)
        .values(TRADING_STYLES)
        .on_conflict_do_nothing(index_elements=["name"])
    )
    session.execute(stmt)
    session.flush()

    rows = session.query(TradingStyle).filter(
        TradingStyle.name.in_([s["name"] for s in TRADING_STYLES])
    ).all()
    style_ids = {s.name: s.id for s in rows}
    logger.info("Trading styles seeded: %s", list(style_ids.keys()))
    return style_ids
