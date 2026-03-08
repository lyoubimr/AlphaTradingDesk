"""
Smoke tests for the seed orchestrator (seed_all).

Purpose:
  - Guarantee that every seed script runs without error on a fresh DB.
  - Guarantee idempotency: running seed_all twice must not raise and must not
    create duplicate rows.
  - Catch regressions early in CI — if a seed breaks, the pipeline fails
    before the image is built and deployed to prod.

These tests use the same transactional session fixture as the rest of the
test suite. seed_all is called inside the savepoint — rolled back at the end,
so the test DB stays clean between runs.
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from database.migrations.seeds.seed_brokers import seed_brokers
from database.migrations.seeds.seed_global_strategies import seed_global_strategies
from database.migrations.seeds.seed_instruments import seed_instruments
from database.migrations.seeds.seed_market_analysis import seed_market_analysis
from database.migrations.seeds.seed_note_templates import seed_note_templates
from database.migrations.seeds.seed_sessions import seed_sessions
from database.migrations.seeds.seed_trading_styles import seed_trading_styles
from src.core.models.broker import Broker, Instrument, TradingStyle

# ── Helper: run the full seed pipeline in the given session ──────────────────

def _run_all(session: Session) -> None:
    """Mirrors seed_all.run_all_seeds() but uses the test session."""
    broker_ids = seed_brokers(session)
    seed_trading_styles(session)
    seed_sessions(session)
    seed_instruments(session, broker_ids)
    seed_note_templates(session)
    seed_market_analysis(session)
    seed_global_strategies(session)
    session.flush()


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestSeedAll:
    def test_seed_runs_without_error(self, db_session: Session) -> None:
        """Full seed pipeline must complete without raising."""
        _run_all(db_session)

    def test_seed_is_idempotent(self, db_session: Session) -> None:
        """Running seed_all twice must not raise and must not create duplicates."""
        _run_all(db_session)
        count_after_first = db_session.query(Broker).count()

        _run_all(db_session)
        count_after_second = db_session.query(Broker).count()

        assert count_after_first == count_after_second, (
            "seed_all is NOT idempotent — broker count changed on second run: "
            f"{count_after_first} → {count_after_second}"
        )


class TestSeedBrokers:
    def test_kraken_and_vantage_are_seeded(self, db_session: Session) -> None:
        seed_brokers(db_session)
        db_session.flush()
        names = {b.name for b in db_session.query(Broker).all()}
        assert "Kraken" in names, "Broker 'Kraken' not found after seed"
        assert "Vantage" in names, "Broker 'Vantage' not found after seed"

    def test_brokers_are_active(self, db_session: Session) -> None:
        seed_brokers(db_session)
        db_session.flush()
        inactive = (
            db_session.query(Broker)
            .filter(Broker.name.in_(["Kraken", "Vantage"]), Broker.status != "active")
            .all()
        )
        assert not inactive, f"Seeded brokers are not active: {[b.name for b in inactive]}"

    def test_returns_broker_id_map(self, db_session: Session) -> None:
        broker_ids = seed_brokers(db_session)
        db_session.flush()
        assert "Kraken" in broker_ids
        assert "Vantage" in broker_ids
        assert isinstance(broker_ids["Kraken"], int)


class TestSeedInstruments:
    def test_instruments_linked_to_brokers(self, db_session: Session) -> None:
        broker_ids = seed_brokers(db_session)
        seed_instruments(db_session, broker_ids)
        db_session.flush()
        instruments = db_session.query(Instrument).all()
        assert len(instruments) > 0, "No instruments seeded"
        # Every instrument must reference a known broker
        known_ids = set(broker_ids.values())
        orphans = [i for i in instruments if i.broker_id not in known_ids]
        assert not orphans, f"Orphan instruments (no valid broker): {[i.symbol for i in orphans]}"


class TestSeedTradingStyles:
    def test_trading_styles_seeded(self, db_session: Session) -> None:
        seed_trading_styles(db_session)
        db_session.flush()
        styles = db_session.query(TradingStyle).all()
        assert len(styles) > 0, "No trading styles seeded"
