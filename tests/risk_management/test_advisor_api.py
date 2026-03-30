"""
Integration tests for GET /api/risk/advisor
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Profile
from src.core.models.trade import Strategy

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_broker(db: Session, *, name: str = "AdvisorBroker") -> Broker:
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
    name: str = "AdvisorTrader",
    capital: Decimal = Decimal("10000"),
    risk_pct: Decimal = Decimal("2.0"),
) -> Profile:
    p = Profile(
        name=name,
        market_type="Crypto",
        broker_id=broker.id,
        capital_start=capital,
        capital_current=capital,
        risk_percentage_default=risk_pct,
        max_concurrent_risk_pct=Decimal("10.0"),
        status="active",
    )
    db.add(p)
    db.flush()
    return p


def _make_strategy(db: Session, profile: Profile, *, name: str = "TestStrategy") -> Strategy:
    s = Strategy(profile_id=profile.id, name=name, status="active")
    db.add(s)
    db.flush()
    return s


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestRiskAdvisor:
    MINIMAL_PARAMS = {
        "pair": "PF_XBTUSD",
        "timeframe": "1h",
        "direction": "long",
    }
    # Use a bogus pair for tests that expect neutral VI (Kraken fetch will fail,
    # orchestrate_risk_advisor catches HTTPException → vi_regime = None → neutral).
    NEUTRAL_PARAMS = {
        "pair": "PF_FAKE_NOT_REAL_XYZ",
        "timeframe": "1h",
        "direction": "long",
    }

    def test_returns_200_with_all_required_fields(
        self, client: TestClient, db_session: Session
    ):
        """Minimal valid request returns 200 with the full advisor fields."""
        broker = _make_broker(db_session)
        profile = _make_profile(db_session, broker)

        resp = client.get(
            "/api/risk/advisor",
            params={"profile_id": profile.id, **self.MINIMAL_PARAMS},
        )
        assert resp.status_code == 200

        data = resp.json()
        assert "multiplier" in data
        assert "base_risk_pct" in data
        assert "adjusted_risk_pct" in data
        assert "adjusted_risk_amount" in data
        assert "criteria" in data
        assert "budget_remaining_pct" in data
        assert "budget_blocking" in data
        assert "suggested_risk_pct" in data
        assert "force_allowed" in data

    def test_unknown_profile_returns_404(self, client: TestClient):
        """Non-existent profile → 404."""
        resp = client.get(
            "/api/risk/advisor",
            params={"profile_id": 99999, **self.MINIMAL_PARAMS},
        )
        assert resp.status_code == 404

    def test_criteria_has_five_entries(self, client: TestClient, db_session: Session):
        """Advisor always returns all 5 criteria, even with neutral inputs."""
        broker = _make_broker(db_session, name="CritBroker")
        profile = _make_profile(db_session, broker, name="CritTrader")

        resp = client.get(
            "/api/risk/advisor",
            params={"profile_id": profile.id, **self.MINIMAL_PARAMS},
        )
        assert resp.status_code == 200

        criteria = resp.json()["criteria"]
        names = {c["name"] for c in criteria}
        assert names == {"market_vi", "pair_vi", "ma_direction", "strategy_wr", "confidence"}

    def test_confidence_criterion_reflects_score(
        self, client: TestClient, db_session: Session
    ):
        """Confidence=7 → label '7/10', factor != 1.0 (with default min=0.5 max=1.5)."""
        broker = _make_broker(db_session, name="ConfBroker")
        profile = _make_profile(db_session, broker, name="ConfTrader")

        resp = client.get(
            "/api/risk/advisor",
            params={"profile_id": profile.id, "confidence": 7, **self.MINIMAL_PARAMS},
        )
        assert resp.status_code == 200

        conf = next(c for c in resp.json()["criteria"] if c["name"] == "confidence")
        assert conf["value_label"] == "7/10"
        # factor = 0.5 + (7/10) * (1.5 - 0.5) = 0.5 + 0.7 = 1.2
        assert abs(conf["factor"] - 1.2) < 1e-4

    def test_vi_shows_no_data_when_cache_cold(self, client: TestClient, db_session: Session):
        """Redis cache cold + Kraken bogus symbol → VI criteria show 'No data' (neutral factor).

        We mock both the Redis cache (to return None) and clear any MarketVISnapshot
        rows from the DB (within the savepoint, rolled back after the test) so
        the service has no market VI data available, regardless of the local dev env.
        """
        # Clear DB snapshots within this savepoint
        db_session.execute(text("DELETE FROM market_vi_snapshots"))
        db_session.flush()

        broker = _make_broker(db_session, name="VIBroker")
        profile = _make_profile(db_session, broker, name="VITrader")

        # Mock Redis so local dev Redis data doesn't bleed into tests
        with patch("src.risk_management.service.get_cached_market_vi", return_value=None):
            resp = client.get(
                "/api/risk/advisor",
                params={"profile_id": profile.id, **self.NEUTRAL_PARAMS},
            )
        assert resp.status_code == 200

        criteria = {c["name"]: c for c in resp.json()["criteria"]}
        mvi = criteria["market_vi"]
        pvi = criteria["pair_vi"]

        # Graceful degradation: no cache → neutral factor, label = 'No data'
        assert mvi["factor"] == 1.0
        assert mvi["value_label"] == "No data"
        assert pvi["factor"] == 1.0
        assert pvi["value_label"] == "No data"

    def test_all_neutral_inputs_gives_multiplier_one(
        self, client: TestClient, db_session: Session
    ):
        """Without strategy, confidence, MA session, and VI neutral → multiplier ≈ 1.0."""
        broker = _make_broker(db_session, name="NeutBroker")
        profile = _make_profile(db_session, broker, name="NeutTrader")

        # Isolate from local dev Redis data (market_vi: CALM → 0.6 would break this)
        db_session.execute(text("DELETE FROM market_vi_snapshots"))
        db_session.flush()

        with patch("src.risk_management.service.get_cached_market_vi", return_value=None):
            resp = client.get(
                "/api/risk/advisor",
                params={"profile_id": profile.id, **self.NEUTRAL_PARAMS},
            )
        assert resp.status_code == 200

        data = resp.json()
        assert abs(data["multiplier"] - 1.0) < 1e-6
        assert abs(data["adjusted_risk_pct"] - data["base_risk_pct"]) < 1e-6

    def test_strategy_id_resolves_wr(self, client: TestClient, db_session: Session):
        """Providing a strategy → strategy_wr criterion not blocked by 'no stats'."""
        broker = _make_broker(db_session, name="StratBroker")
        profile = _make_profile(db_session, broker, name="StratTrader")
        strategy = _make_strategy(db_session, profile)

        resp = client.get(
            "/api/risk/advisor",
            params={
                "profile_id": profile.id,
                "strategy_id": strategy.id,
                **self.MINIMAL_PARAMS,
            },
        )
        assert resp.status_code == 200

        swr = next(c for c in resp.json()["criteria"] if c["name"] == "strategy_wr")
        # No trades → insufficient stats → neutral factor, label contains N/A
        assert swr["factor"] == 1.0
        assert "insufficient" in swr["value_label"].lower()

    def test_suggested_risk_equals_adjusted_when_no_blocking(
        self, client: TestClient, db_session: Session
    ):
        """No budget blocking → suggested_risk_pct == adjusted_risk_pct."""
        broker = _make_broker(db_session, name="SugBroker")
        profile = _make_profile(db_session, broker, name="SugTrader")

        resp = client.get(
            "/api/risk/advisor",
            params={"profile_id": profile.id, **self.MINIMAL_PARAMS},
        )
        assert resp.status_code == 200

        data = resp.json()
        assert data["budget_blocking"] is False
        assert abs(data["suggested_risk_pct"] - data["adjusted_risk_pct"]) < 1e-6
