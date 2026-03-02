"""
Seed: sessions table.

5 predefined trading sessions (UTC times, immutable reference data).
These are CFD market sessions used for the live session widget on the dashboard.

All times stored in UTC. Frontend converts to user's local timezone via
user_preferences.timezone.

Idempotent: ON CONFLICT DO NOTHING on unique name.
"""
from __future__ import annotations

import logging
from datetime import time

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from src.core.models.sessions import TradingSession

logger = logging.getLogger(__name__)

SESSIONS: list[dict] = [
    {
        "name": "Asia",
        "start_utc": time(0, 0),
        "end_utc": time(9, 0),
        "note": "Tokyo/Sydney — JPY, AUD, NZD most active",
        "sort_order": 1,
    },
    {
        "name": "London",
        "start_utc": time(8, 0),
        "end_utc": time(17, 0),
        "note": "EUR, GBP most active. Sets daily direction.",
        "sort_order": 2,
    },
    {
        "name": "New York",
        "start_utc": time(13, 0),
        "end_utc": time(22, 0),
        "note": "Forex opens. USD pairs most active.",
        "sort_order": 3,
    },
    {
        "name": "NYSE Open",
        "start_utc": time(14, 30),
        "end_utc": time(14, 30),
        "note": "Point event — equities and indices volatility spike.",
        "sort_order": 4,
    },
    {
        "name": "Overlap",
        "start_utc": time(13, 0),
        "end_utc": time(17, 0),
        "note": "London + New York simultaneous — peak liquidity.",
        "sort_order": 5,
    },
]


def seed_sessions(session: Session) -> dict[str, int]:
    """
    Insert predefined trading sessions. Skip existing rows (idempotent).

    Returns a dict mapping session name → id.
    """
    stmt = (
        insert(TradingSession)
        .values(SESSIONS)
        .on_conflict_do_nothing(index_elements=["name"])
    )
    session.execute(stmt)
    session.flush()

    rows = session.query(TradingSession).filter(
        TradingSession.name.in_([s["name"] for s in SESSIONS])
    ).all()
    session_ids = {s.name: s.id for s in rows}
    logger.info("Trading sessions seeded: %s", list(session_ids.keys()))
    return session_ids
