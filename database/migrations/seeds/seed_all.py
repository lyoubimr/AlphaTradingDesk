"""
Seed orchestrator — runs all seed scripts in dependency order.

Usage:
    python -m database.migrations.seeds.seed_all
    # or via Makefile:
    make db-seed

All seeds are idempotent — safe to re-run at any time.
Running on an already-seeded DB will produce no changes.

Dependency order:
  1. brokers             (no deps)
  2. trading_styles      (no deps)
  3. sessions            (no deps)
  4. instruments         (requires broker_ids from step 1)
  5. note_templates      (no deps — profile_id = NULL = global default)
  6. market_analysis     (no deps)

Note: global strategies are NOT seeded — users create their own strategies.
"""
from __future__ import annotations

import logging
import sys

from database.migrations.seeds.seed_brokers import seed_brokers
from database.migrations.seeds.seed_instruments import seed_instruments
from database.migrations.seeds.seed_market_analysis import seed_market_analysis
from database.migrations.seeds.seed_note_templates import seed_note_templates
from database.migrations.seeds.seed_sessions import seed_sessions
from database.migrations.seeds.seed_trading_styles import seed_trading_styles
from src.core.database import get_session_factory

SessionLocal = get_session_factory()

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)-8s %(name)s — %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def run_all_seeds() -> None:
    """Run all seed scripts within a single transaction. Rolls back on error."""
    logger.info("=== Starting seed run ===")
    with SessionLocal() as session:
        try:
            broker_ids = seed_brokers(session)
            seed_trading_styles(session)
            seed_sessions(session)
            seed_instruments(session, broker_ids)
            seed_note_templates(session)
            seed_market_analysis(session)
            session.commit()
            logger.info("=== Seed run complete — all changes committed ===")
        except Exception:
            session.rollback()
            logger.exception("Seed run failed — transaction rolled back")
            raise


if __name__ == "__main__":
    run_all_seeds()
