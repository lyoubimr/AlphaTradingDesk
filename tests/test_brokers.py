"""
Integration tests for GET /api/brokers and GET /api/brokers/{id}/instruments.

Brokers are read-only reference data — no create/update/delete endpoints.
"""
from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Instrument


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_broker(db: Session, *, name: str, market_type: str, status: str = "active") -> Broker:
    broker = Broker(
        name=name,
        market_type=market_type,
        default_currency="USD",
        is_predefined=True,
        status=status,
    )
    db.add(broker)
    db.flush()
    return broker


def _make_instrument(db: Session, broker: Broker, *, symbol: str, active: bool = True) -> Instrument:
    instrument = Instrument(
        broker_id=broker.id,
        symbol=symbol,
        display_name=symbol,
        asset_class="Crypto",
        is_active=active,
    )
    db.add(instrument)
    db.flush()
    return instrument


# ── Tests: GET /api/brokers ───────────────────────────────────────────────────

class TestListBrokers:
    def test_returns_only_active_brokers(self, client: TestClient, db_session: Session):
        _make_broker(db_session, name="ActiveBroker", market_type="Crypto")
        _make_broker(db_session, name="InactiveBroker", market_type="CFD", status="inactive")

        resp = client.get("/api/brokers")

        assert resp.status_code == 200
        names = [b["name"] for b in resp.json()]
        assert "ActiveBroker" in names
        assert "InactiveBroker" not in names

    def test_returns_empty_list_when_no_brokers(self, client: TestClient, db_session: Session):
        # db_session provides an isolated, empty transaction — no seeded brokers visible
        resp = client.get("/api/brokers")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_response_shape(self, client: TestClient, db_session: Session):
        _make_broker(db_session, name="ShapeBroker", market_type="Crypto")

        resp = client.get("/api/brokers")

        assert resp.status_code == 200
        broker = next(b for b in resp.json() if b["name"] == "ShapeBroker")
        assert set(broker.keys()) == {"id", "name", "market_type", "default_currency", "is_predefined", "status"}


# ── Tests: GET /api/brokers/{id}/instruments ──────────────────────────────────

class TestListInstruments:
    def test_returns_active_instruments_for_broker(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="KrakenTest", market_type="Crypto")
        _make_instrument(db_session, broker, symbol="PF_BTCUSD")
        _make_instrument(db_session, broker, symbol="PF_ETHUSD", active=False)

        resp = client.get(f"/api/brokers/{broker.id}/instruments")

        assert resp.status_code == 200
        symbols = [i["symbol"] for i in resp.json()]
        assert "PF_BTCUSD" in symbols
        assert "PF_ETHUSD" not in symbols

    def test_instruments_not_mixed_between_brokers(self, client: TestClient, db_session: Session):
        broker_a = _make_broker(db_session, name="BrokerA", market_type="Crypto")
        broker_b = _make_broker(db_session, name="BrokerB", market_type="CFD")
        _make_instrument(db_session, broker_a, symbol="PF_SOLUSD")
        _make_instrument(db_session, broker_b, symbol="XAUUSD")

        resp = client.get(f"/api/brokers/{broker_a.id}/instruments")

        symbols = [i["symbol"] for i in resp.json()]
        assert "PF_SOLUSD" in symbols
        assert "XAUUSD" not in symbols

    def test_returns_404_for_unknown_broker(self, client: TestClient):
        resp = client.get("/api/brokers/99999/instruments")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_returns_empty_list_when_no_instruments(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="EmptyBroker", market_type="Crypto")

        resp = client.get(f"/api/brokers/{broker.id}/instruments")

        assert resp.status_code == 200
        assert resp.json() == []
