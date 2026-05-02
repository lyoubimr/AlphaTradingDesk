"""
Phase 7A — Integration tests for the Investment & Spot module.

Coverage:
  - account_type on profiles (default 'contracts', spot creation)
  - SpotTrade CRUD (create, update, close, cancel)
  - Deposit CRUD (create, update, delete)
  - capital_current recompute formula
  - InvestmentSettings auto-init + deep-merge
  - Portfolio summary
  - 403 guard: risk module blocked for spot profiles
  - 403 guard: spot-trade endpoints blocked for contracts profiles (deposits allowed for all)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Profile

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_broker(db: Session, *, name: str = "Kraken Spot", market_type: str = "Crypto") -> Broker:
    broker = Broker(
        name=name,
        market_type=market_type,
        default_currency="USDT",
        is_predefined=True,
        status="active",
    )
    db.add(broker)
    db.flush()
    return broker


def _make_spot_profile(db: Session, broker_id: int, *, capital: float = 10_000.0) -> Profile:
    profile = Profile(
        name="Spot Test Profile",
        market_type="Crypto",
        account_type="spot",
        broker_id=broker_id,
        currency="USDT",
        capital_start=capital,
        capital_current=capital,
        risk_percentage_default=1.0,
        max_concurrent_risk_pct=5.0,
        min_pnl_pct_for_stats=0.5,
        status="active",
    )
    db.add(profile)
    db.flush()
    return profile


def _make_contracts_profile(db: Session, broker_id: int) -> Profile:
    profile = Profile(
        name="Contracts Profile",
        market_type="Crypto",
        account_type="contracts",
        broker_id=broker_id,
        currency="USDT",
        capital_start=10_000.0,
        capital_current=10_000.0,
        risk_percentage_default=1.0,
        max_concurrent_risk_pct=5.0,
        min_pnl_pct_for_stats=0.5,
        status="active",
    )
    db.add(profile)
    db.flush()
    return profile


def _spot_trade_payload(**overrides) -> dict:
    base = {
        "pair": "BTCUSDT",
        "entry_price": "60000.00",
        "quantity": "0.10",
        "order_type": "MARKET",
    }
    base.update(overrides)
    return base


def _deposit_payload(**overrides) -> dict:
    base = {
        "amount": "500.00",
        "deposit_date": "2026-05-01",
        "label": "Monthly DCA",
        "is_recurrent": False,
    }
    base.update(overrides)
    return base


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture()
def crypto_broker(db_session: Session) -> Broker:
    return _make_broker(db_session)


@pytest.fixture()
def spot_profile(db_session: Session, crypto_broker: Broker) -> Profile:
    return _make_spot_profile(db_session, crypto_broker.id)


@pytest.fixture()
def contracts_profile(db_session: Session, crypto_broker: Broker) -> Profile:
    return _make_contracts_profile(db_session, crypto_broker.id)


# ── Tests: account_type on profiles ──────────────────────────────────────────


class TestProfileAccountType:
    def test_spot_profile_has_account_type_spot(self, spot_profile: Profile):
        assert spot_profile.account_type == "spot"

    def test_contracts_profile_has_account_type_contracts(self, contracts_profile: Profile):
        assert contracts_profile.account_type == "contracts"

    def test_create_spot_profile_via_api(self, client: TestClient, crypto_broker: Broker):
        resp = client.post(
            "/api/profiles",
            json={
                "name": "API Spot Profile",
                "market_type": "Crypto",
                "account_type": "spot",
                "broker_id": crypto_broker.id,
                "capital_start": "5000.00",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["account_type"] == "spot"

    def test_create_profile_defaults_to_contracts(self, client: TestClient):
        resp = client.post(
            "/api/profiles",
            json={
                "name": "Default Profile",
                "market_type": "Crypto",
                "capital_start": "5000.00",
            },
        )
        assert resp.status_code == 201
        assert resp.json()["account_type"] == "contracts"

    def test_profile_out_includes_account_type(self, client: TestClient, spot_profile: Profile):
        resp = client.get(f"/api/profiles/{spot_profile.id}")
        assert resp.status_code == 200
        assert "account_type" in resp.json()


# ── Tests: Spot Trade CRUD ────────────────────────────────────────────────────


class TestSpotTradeCRUD:
    def test_create_spot_trade_and_total_cost_computed(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(entry_price="60000.00", quantity="0.10"),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["pair"] == "BTCUSDT"
        assert data["status"] == "open"
        # total_cost = 60000 * 0.10 = 6000
        assert float(data["total_cost"]) == pytest.approx(6000.0, rel=1e-4)

    def test_create_spot_trade_without_stop_loss(
        self, client: TestClient, spot_profile: Profile
    ):
        """SL is optional for spot trades."""
        resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(),  # no stop_loss
        )
        assert resp.status_code == 201
        assert resp.json()["stop_loss"] is None

    def test_list_spot_trades(self, client: TestClient, spot_profile: Profile):
        client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(pair="ETHUSDT"),
        )
        resp = client.get(f"/api/investment/spot-trades/{spot_profile.id}")
        assert resp.status_code == 200
        pairs = [t["pair"] for t in resp.json()]
        assert "ETHUSDT" in pairs

    def test_list_spot_trades_filter_by_status(self, client: TestClient, spot_profile: Profile):
        client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(),
        )
        resp = client.get(
            f"/api/investment/spot-trades/{spot_profile.id}",
            params={"status": "open"},
        )
        assert resp.status_code == 200
        for trade in resp.json():
            assert trade["status"] == "open"

    def test_update_spot_trade(self, client: TestClient, spot_profile: Profile):
        create_resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(),
        )
        trade_id = create_resp.json()["id"]
        resp = client.put(
            f"/api/investment/spot-trades/{spot_profile.id}/{trade_id}",
            json={"stop_loss": "55000.00", "notes": "Updated SL"},
        )
        assert resp.status_code == 200
        assert float(resp.json()["stop_loss"]) == pytest.approx(55000.0, rel=1e-4)
        assert resp.json()["notes"] == "Updated SL"

    def test_close_spot_trade_computes_realized_pnl(
        self, client: TestClient, spot_profile: Profile
    ):
        create_resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(entry_price="60000.00", quantity="0.10"),
        )
        trade_id = create_resp.json()["id"]
        resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}/{trade_id}/close",
            json={"exit_price": "62000.00"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "closed"
        # realized_pnl = (62000 - 60000) * 0.10 = 200
        assert float(data["realized_pnl"]) == pytest.approx(200.0, rel=1e-4)

    def test_cancel_spot_trade(self, client: TestClient, spot_profile: Profile):
        create_resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(),
        )
        trade_id = create_resp.json()["id"]
        resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}/{trade_id}/cancel"
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"

    def test_close_already_closed_trade_returns_422(
        self, client: TestClient, spot_profile: Profile
    ):
        create_resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(),
        )
        trade_id = create_resp.json()["id"]
        client.post(
            f"/api/investment/spot-trades/{spot_profile.id}/{trade_id}/close",
            json={"exit_price": "62000.00"},
        )
        resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}/{trade_id}/close",
            json={"exit_price": "63000.00"},
        )
        assert resp.status_code == 422

    def test_spot_trade_requires_spot_profile(
        self, client: TestClient, contracts_profile: Profile
    ):
        resp = client.post(
            f"/api/investment/spot-trades/{contracts_profile.id}",
            json=_spot_trade_payload(),
        )
        assert resp.status_code == 403


# ── Tests: Deposit CRUD ───────────────────────────────────────────────────────


class TestDepositCRUD:
    def test_create_deposit(self, client: TestClient, spot_profile: Profile):
        resp = client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="1000.00"),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert float(data["amount"]) == pytest.approx(1000.0, rel=1e-4)
        assert data["label"] == "Monthly DCA"

    def test_create_negative_deposit_is_withdrawal(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="-200.00", label="Withdrawal"),
        )
        assert resp.status_code == 201
        assert float(resp.json()["amount"]) == pytest.approx(-200.0, rel=1e-4)

    def test_list_deposits(self, client: TestClient, spot_profile: Profile):
        client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="300.00"),
        )
        resp = client.get(f"/api/investment/deposits/{spot_profile.id}")
        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_update_deposit(self, client: TestClient, spot_profile: Profile):
        create_resp = client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="400.00"),
        )
        deposit_id = create_resp.json()["id"]
        resp = client.put(
            f"/api/investment/deposits/{spot_profile.id}/{deposit_id}",
            json={"amount": "450.00"},
        )
        assert resp.status_code == 200
        assert float(resp.json()["amount"]) == pytest.approx(450.0, rel=1e-4)

    def test_delete_deposit(self, client: TestClient, spot_profile: Profile):
        create_resp = client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="500.00"),
        )
        deposit_id = create_resp.json()["id"]
        resp = client.delete(f"/api/investment/deposits/{spot_profile.id}/{deposit_id}")
        assert resp.status_code == 204
        # Confirm gone
        list_resp = client.get(f"/api/investment/deposits/{spot_profile.id}")
        ids = [d["id"] for d in list_resp.json()]
        assert deposit_id not in ids

    def test_deposit_allowed_for_contracts_profile(
        self, client: TestClient, contracts_profile: Profile, db_session: Session
    ):
        """Deposits are now available for all profile types.
        For contracts profiles, capital_current is NOT recomputed (managed by trade-close flow).
        """
        initial_capital = float(contracts_profile.capital_current)
        resp = client.post(
            f"/api/investment/deposits/{contracts_profile.id}",
            json=_deposit_payload(),
        )
        assert resp.status_code == 201
        # capital_current must NOT change for contracts profiles (no recompute)
        db_session.refresh(contracts_profile)
        assert float(contracts_profile.capital_current) == pytest.approx(initial_capital, rel=1e-4)


# ── Tests: capital_current recompute ─────────────────────────────────────────


class TestCapitalRecompute:
    def test_deposit_increases_capital_current(
        self, client: TestClient, spot_profile: Profile, db_session: Session
    ):
        initial_capital = float(spot_profile.capital_current)
        client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="2000.00"),
        )
        db_session.refresh(spot_profile)
        assert float(spot_profile.capital_current) == pytest.approx(
            initial_capital + 2000.0, rel=1e-4
        )

    def test_withdrawal_decreases_capital_current(
        self, client: TestClient, spot_profile: Profile, db_session: Session
    ):
        initial_capital = float(spot_profile.capital_current)
        client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="-500.00"),
        )
        db_session.refresh(spot_profile)
        assert float(spot_profile.capital_current) == pytest.approx(
            initial_capital - 500.0, rel=1e-4
        )

    def test_close_trade_updates_capital_current(
        self, client: TestClient, spot_profile: Profile, db_session: Session
    ):
        initial_capital = float(spot_profile.capital_current)
        create_resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(entry_price="60000.00", quantity="0.10"),
        )
        trade_id = create_resp.json()["id"]
        client.post(
            f"/api/investment/spot-trades/{spot_profile.id}/{trade_id}/close",
            json={"exit_price": "62000.00"},  # PnL = +200
        )
        db_session.refresh(spot_profile)
        # capital_current = capital_start + 0 deposits + 200 pnl
        assert float(spot_profile.capital_current) == pytest.approx(
            initial_capital + 200.0, rel=1e-4
        )

    def test_combined_deposits_and_pnl(
        self, client: TestClient, spot_profile: Profile, db_session: Session
    ):
        initial_capital = float(spot_profile.capital_current)
        # deposit 1000
        client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="1000.00"),
        )
        # open and close trade for +150 pnl
        create_resp = client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(entry_price="50000.00", quantity="0.10"),
        )
        trade_id = create_resp.json()["id"]
        client.post(
            f"/api/investment/spot-trades/{spot_profile.id}/{trade_id}/close",
            json={"exit_price": "51500.00"},  # PnL = +150
        )
        db_session.refresh(spot_profile)
        # capital_start + 1000 deposit + 150 pnl
        assert float(spot_profile.capital_current) == pytest.approx(
            initial_capital + 1000.0 + 150.0, rel=1e-4
        )

    def test_delete_deposit_reverts_capital(
        self, client: TestClient, spot_profile: Profile, db_session: Session
    ):
        initial_capital = float(spot_profile.capital_current)
        create_resp = client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="800.00"),
        )
        deposit_id = create_resp.json()["id"]
        client.delete(f"/api/investment/deposits/{spot_profile.id}/{deposit_id}")
        db_session.refresh(spot_profile)
        # Should revert to initial
        assert float(spot_profile.capital_current) == pytest.approx(
            initial_capital, rel=1e-4
        )


# ── Tests: InvestmentSettings ─────────────────────────────────────────────────


class TestInvestmentSettings:
    def test_get_settings_auto_creates_with_defaults(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.get(f"/api/investment/settings/{spot_profile.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert "config" in data
        assert "recurrent_deposit" in data["config"]
        assert "price_tracking" in data["config"]
        assert "watchlist_htf" in data["config"]

    def test_get_settings_idempotent(self, client: TestClient, spot_profile: Profile):
        """Calling GET twice should not raise errors and return the same config."""
        resp1 = client.get(f"/api/investment/settings/{spot_profile.id}")
        resp2 = client.get(f"/api/investment/settings/{spot_profile.id}")
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.json()["config"] == resp2.json()["config"]

    def test_put_settings_deep_merges(self, client: TestClient, spot_profile: Profile):
        """PUT only updates the provided keys, preserving others."""
        # Set top_n
        client.put(
            f"/api/investment/settings/{spot_profile.id}",
            json={"config": {"watchlist_htf": {"top_n": 5}}},
        )
        # Verify top_n updated, timeframes preserved
        resp = client.get(f"/api/investment/settings/{spot_profile.id}")
        data = resp.json()["config"]
        assert data["watchlist_htf"]["top_n"] == 5
        assert "timeframes" in data["watchlist_htf"]
        # Other sections untouched
        assert "recurrent_deposit" in data

    def test_put_settings_enable_recurrent_deposit(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.put(
            f"/api/investment/settings/{spot_profile.id}",
            json={"config": {"recurrent_deposit": {"enabled": True, "amount": 200}}},
        )
        assert resp.status_code == 200
        config = resp.json()["config"]
        assert config["recurrent_deposit"]["enabled"] is True
        assert config["recurrent_deposit"]["amount"] == 200


# ── Tests: Portfolio summary ──────────────────────────────────────────────────


class TestPortfolio:
    def test_portfolio_empty(self, client: TestClient, spot_profile: Profile):
        resp = client.get(f"/api/investment/portfolio/{spot_profile.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["open_positions_count"] == 0
        assert float(data["total_deposited"]) == pytest.approx(0.0, rel=1e-4)

    def test_portfolio_shows_open_trades(self, client: TestClient, spot_profile: Profile):
        client.post(
            f"/api/investment/spot-trades/{spot_profile.id}",
            json=_spot_trade_payload(pair="BTCUSDT"),
        )
        resp = client.get(f"/api/investment/portfolio/{spot_profile.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["open_positions_count"] == 1
        assert "open_positions" not in data

    def test_portfolio_reflects_capital_after_deposit(
        self, client: TestClient, spot_profile: Profile
    ):
        client.post(
            f"/api/investment/deposits/{spot_profile.id}",
            json=_deposit_payload(amount="1500.00"),
        )
        resp = client.get(f"/api/investment/portfolio/{spot_profile.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert float(data["total_deposited"]) == pytest.approx(1500.0, rel=1e-4)
        assert float(data["capital_current"]) == pytest.approx(
            float(spot_profile.capital_start) + 1500.0, rel=1e-4
        )

    def test_portfolio_requires_spot_profile(
        self, client: TestClient, contracts_profile: Profile
    ):
        resp = client.get(f"/api/investment/portfolio/{contracts_profile.id}")
        assert resp.status_code == 403


# ── Tests: Risk module 403 guard for spot profiles ────────────────────────────


class TestRiskGuardForSpotProfiles:
    def test_risk_settings_get_forbidden_for_spot(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.get(f"/api/risk/settings/{spot_profile.id}")
        assert resp.status_code == 403

    def test_risk_settings_put_forbidden_for_spot(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.put(
            f"/api/risk/settings/{spot_profile.id}",
            json={"config": {}},
        )
        assert resp.status_code == 403

    def test_risk_budget_forbidden_for_spot(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.get(f"/api/risk/budget/{spot_profile.id}")
        assert resp.status_code == 403

    def test_risk_advisor_forbidden_for_spot(
        self, client: TestClient, spot_profile: Profile
    ):
        resp = client.get(
            "/api/risk/advisor",
            params={
                "profile_id": spot_profile.id,
                "pair": "PF_XBTUSD",
                "timeframe": "4h",
                "direction": "long",
            },
        )
        assert resp.status_code == 403

    def test_risk_settings_allowed_for_contracts(
        self, client: TestClient, contracts_profile: Profile
    ):
        resp = client.get(f"/api/risk/settings/{contracts_profile.id}")
        assert resp.status_code == 200
