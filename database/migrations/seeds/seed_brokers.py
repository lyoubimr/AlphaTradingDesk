"""
Seed: brokers table.

Pre-seeded brokers for Phase 1:
  - Kraken  (Crypto Perps, USD)
  - Vantage (CFD, USD)

Idempotent: uses INSERT ON CONFLICT DO NOTHING via SQLAlchemy merge-style logic.
Safe to re-run at any time.
"""
from __future__ import annotations

import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from src.core.models.broker import Broker

logger = logging.getLogger(__name__)

BROKERS: list[dict] = [
    {
        "name": "Kraken",
        "market_type": "Crypto",
        "default_currency": "USD",
        "is_predefined": True,
        "status": "active",
    },
    {
        "name": "Vantage",
        "market_type": "CFD",
        "default_currency": "EUR",
        "is_predefined": True,
        "status": "active",
    },
]


def seed_brokers(session: Session) -> dict[str, int]:
    """
    Insert predefined brokers. Skip existing rows (idempotent).

    Returns a dict mapping broker name → id for use by downstream seeds.
    """
    stmt = (
        insert(Broker)
        .values(BROKERS)
        .on_conflict_do_nothing(index_elements=["name"])
    )
    session.execute(stmt)
    session.flush()

    rows = session.query(Broker).filter(
        Broker.name.in_([b["name"] for b in BROKERS])
    ).all()
    broker_ids = {b.name: b.id for b in rows}
    logger.info("Brokers seeded: %s", list(broker_ids.keys()))
    return broker_ids
