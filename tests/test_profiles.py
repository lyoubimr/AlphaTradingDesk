"""
Integration tests for CRUD /api/profiles.

Covers: list, create, get by id, partial update, soft-delete,
        validation (broker/market_type mismatch, inactive broker),
        and error cases (404).
"""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Broker

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_broker(
    db: Session,
    *,
    name: str,
    market_type: str,
    status: str = "active",
) -> Broker:
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


def _profile_payload(**overrides) -> dict:
    """Return a minimal valid ProfileCreate payload, with optional overrides."""
    base = {
        "name": "Test Profile",
        "market_type": "Crypto",
        "capital_start": "10000.00",
    }
    base.update(overrides)
    return base


# ── Tests: GET /api/profiles ──────────────────────────────────────────────────


class TestListProfiles:
    def test_returns_empty_list_initially(self, client: TestClient):
        resp = client.get("/api/profiles")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_does_not_return_deleted_profiles(self, client: TestClient, db_session: Session):
        # Create then soft-delete
        resp = client.post("/api/profiles", json=_profile_payload())
        profile_id = resp.json()["id"]
        client.delete(f"/api/profiles/{profile_id}")

        resp = client.get("/api/profiles")
        ids = [p["id"] for p in resp.json()]
        assert profile_id not in ids


# ── Tests: POST /api/profiles ─────────────────────────────────────────────────


class TestCreateProfile:
    def test_creates_profile_with_minimal_fields(self, client: TestClient):
        resp = client.post("/api/profiles", json=_profile_payload())

        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "Test Profile"
        assert data["market_type"] == "Crypto"
        assert data["status"] == "active"

    def test_capital_current_equals_capital_start_on_creation(self, client: TestClient):
        resp = client.post("/api/profiles", json=_profile_payload(capital_start="7500.00"))

        assert resp.status_code == 201
        data = resp.json()
        assert data["capital_start"] == "7500.00"
        assert data["capital_current"] == "7500.00"

    def test_default_risk_percentage_is_2(self, client: TestClient):
        resp = client.post("/api/profiles", json=_profile_payload())

        assert resp.status_code == 201
        assert resp.json()["risk_percentage_default"] == "2.00"

    def test_creates_profile_linked_to_matching_broker(
        self, client: TestClient, db_session: Session
    ):
        broker = _make_broker(db_session, name="KrakenTest", market_type="Crypto")

        resp = client.post(
            "/api/profiles",
            json=_profile_payload(broker_id=broker.id),
        )

        assert resp.status_code == 201
        assert resp.json()["broker_id"] == broker.id

    def test_rejects_mismatched_broker_and_market_type(
        self, client: TestClient, db_session: Session
    ):
        cfd_broker = _make_broker(db_session, name="VantageTest", market_type="CFD")

        resp = client.post(
            "/api/profiles",
            json=_profile_payload(market_type="Crypto", broker_id=cfd_broker.id),
        )

        assert resp.status_code == 422
        assert "must match" in resp.json()["detail"]

    def test_rejects_inactive_broker(self, client: TestClient, db_session: Session):
        inactive_broker = _make_broker(
            db_session, name="InactiveBroker", market_type="Crypto", status="inactive"
        )

        resp = client.post(
            "/api/profiles",
            json=_profile_payload(broker_id=inactive_broker.id),
        )

        assert resp.status_code == 422
        assert "not active" in resp.json()["detail"]

    def test_rejects_invalid_market_type(self, client: TestClient):
        resp = client.post("/api/profiles", json=_profile_payload(market_type="Stocks"))
        assert resp.status_code == 422

    def test_rejects_zero_capital(self, client: TestClient):
        resp = client.post("/api/profiles", json=_profile_payload(capital_start="0"))
        assert resp.status_code == 422

    def test_rejects_risk_pct_above_10(self, client: TestClient):
        resp = client.post(
            "/api/profiles",
            json=_profile_payload(risk_percentage_default="11"),
        )
        assert resp.status_code == 422


# ── Tests: GET /api/profiles/{id} ─────────────────────────────────────────────


class TestGetProfile:
    def test_returns_profile_by_id(self, client: TestClient):
        create_resp = client.post("/api/profiles", json=_profile_payload(name="GetMe"))
        profile_id = create_resp.json()["id"]

        resp = client.get(f"/api/profiles/{profile_id}")

        assert resp.status_code == 200
        assert resp.json()["id"] == profile_id
        assert resp.json()["name"] == "GetMe"

    def test_returns_404_for_unknown_id(self, client: TestClient):
        resp = client.get("/api/profiles/99999")
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()


# ── Tests: PUT /api/profiles/{id} ─────────────────────────────────────────────


class TestUpdateProfile:
    def test_partial_update_name(self, client: TestClient):
        create_resp = client.post("/api/profiles", json=_profile_payload(name="OldName"))
        profile_id = create_resp.json()["id"]

        resp = client.put(
            f"/api/profiles/{profile_id}",
            json={"name": "NewName"},
        )

        assert resp.status_code == 200
        assert resp.json()["name"] == "NewName"
        # other fields untouched
        assert resp.json()["market_type"] == "Crypto"

    def test_partial_update_risk_percentage(self, client: TestClient):
        create_resp = client.post("/api/profiles", json=_profile_payload())
        profile_id = create_resp.json()["id"]

        resp = client.put(
            f"/api/profiles/{profile_id}",
            json={"risk_percentage_default": "3.5"},
        )

        assert resp.status_code == 200
        assert resp.json()["risk_percentage_default"] == "3.50"

    def test_update_revalidates_broker_on_market_type_change(
        self, client: TestClient, db_session: Session
    ):
        crypto_broker = _make_broker(db_session, name="KrakenForUpdate", market_type="Crypto")
        create_resp = client.post(
            "/api/profiles",
            json=_profile_payload(broker_id=crypto_broker.id),
        )
        profile_id = create_resp.json()["id"]

        # Try to switch market_type to CFD while keeping a Crypto broker → should fail
        resp = client.put(
            f"/api/profiles/{profile_id}",
            json={"market_type": "CFD"},
        )

        assert resp.status_code == 422

    def test_returns_404_for_unknown_id(self, client: TestClient):
        resp = client.put("/api/profiles/99999", json={"name": "Ghost"})
        assert resp.status_code == 404


# ── Tests: DELETE /api/profiles/{id} ─────────────────────────────────────────


class TestDeleteProfile:
    def test_soft_delete_returns_204(self, client: TestClient):
        create_resp = client.post("/api/profiles", json=_profile_payload())
        profile_id = create_resp.json()["id"]

        resp = client.delete(f"/api/profiles/{profile_id}")
        assert resp.status_code == 204

    def test_soft_delete_sets_status_to_deleted(self, client: TestClient):
        create_resp = client.post("/api/profiles", json=_profile_payload())
        profile_id = create_resp.json()["id"]

        client.delete(f"/api/profiles/{profile_id}")

        # Profile still reachable by direct ID (not physically removed)
        get_resp = client.get(f"/api/profiles/{profile_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["status"] == "deleted"

    def test_returns_404_for_unknown_id(self, client: TestClient):
        resp = client.delete("/api/profiles/99999")
        assert resp.status_code == 404
