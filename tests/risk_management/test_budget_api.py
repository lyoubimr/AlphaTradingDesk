"""
Integration tests for GET /api/risk/budget/{profile_id}
"""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Profile

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_broker(db: Session, *, name: str = "BudgetBroker") -> Broker:
    b = Broker(
        name=name, market_type="Crypto",
        default_currency="USD", is_predefined=True, status="active",
    )
    db.add(b)
    db.flush()
    return b


def _make_profile(
    db: Session,
    broker: Broker,
    *,
    name: str = "BudgetTrader",
    capital: Decimal = Decimal("10000"),
    risk_pct: Decimal = Decimal("2.0"),
    max_concurrent: Decimal = Decimal("10.0"),
) -> Profile:
    p = Profile(
        name=name,
        market_type="Crypto",
        broker_id=broker.id,
        capital_start=capital,
        capital_current=capital,
        risk_percentage_default=risk_pct,
        max_concurrent_risk_pct=max_concurrent,
        status="active",
    )
    db.add(p)
    db.flush()
    return p


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestRiskBudget:
    def test_fresh_profile_has_full_budget(self, client: TestClient, db_session: Session):
        """No open trades → budget used = 0, remaining = max_concurrent_risk_pct."""
        broker = _make_broker(db_session)
        profile = _make_profile(db_session, broker, max_concurrent=Decimal("10.0"))

        resp = client.get(f"/api/risk/budget/{profile.id}")
        assert resp.status_code == 200

        data = resp.json()
        assert data["profile_id"] == profile.id
        assert data["concurrent_risk_used_pct"] == 0.0
        assert abs(data["budget_remaining_pct"] - 10.0) < 1e-6
        assert data["open_trades_count"] == 0
        assert data["pending_trades_count"] == 0
        assert data["alert_risk_saturated"] is False

    def test_returns_capital_and_defaults(self, client: TestClient, db_session: Session):
        """Budget response includes capital and default risk pct."""
        broker = _make_broker(db_session, name="CapBroker")
        profile = _make_profile(
            db_session, broker,
            name="CapTrader", capital=Decimal("50000"), risk_pct=Decimal("1.5"),
        )

        resp = client.get(f"/api/risk/budget/{profile.id}")
        assert resp.status_code == 200

        data = resp.json()
        assert abs(data["capital_current"] - 50000.0) < 0.01
        assert abs(data["risk_pct_default"] - 1.5) < 1e-6

    def test_unknown_profile_returns_404(self, client: TestClient):
        """Non-existent profile → 404."""
        resp = client.get("/api/risk/budget/99999")
        assert resp.status_code == 404

    def test_settings_auto_created_on_budget_call(self, client: TestClient, db_session: Session):
        """GET budget should not fail even with no risk_settings row (auto-upserted)."""
        broker = _make_broker(db_session, name="AutoBroker")
        profile = _make_profile(db_session, broker, name="AutoTrader")

        # First call — no risk_settings row exists yet
        resp = client.get(f"/api/risk/budget/{profile.id}")
        assert resp.status_code == 200
        data = resp.json()
        # force_allowed defaults from DEFAULT_RISK_CONFIG
        assert isinstance(data["force_allowed"], bool)
