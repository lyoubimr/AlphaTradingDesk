"""
tests/kraken_execution/test_router.py

HTTP-level tests for the Kraken Execution API router.

Strategy:
  - Settings CRUD (GET/PUT) uses the real service + transactional DB fixture.
    Fernet is patched via the module-level fixture.
  - Automation triggers (open/close/breakeven/cancel-entry) mock the service
    functions that call Kraken, keeping tests offline and fast.

Covered endpoints:
  GET  /api/kraken-execution/settings/{profile_id}
  PUT  /api/kraken-execution/settings/{profile_id}
  POST /api/kraken-execution/settings/{profile_id}/test-connection
  GET  /api/kraken-execution/orders/{trade_id}
  POST /api/kraken-execution/trades/{trade_id}/open
  POST /api/kraken-execution/trades/{trade_id}/close
  POST /api/kraken-execution/trades/{trade_id}/breakeven
  POST /api/kraken-execution/trades/{trade_id}/cancel-entry
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Instrument, Profile
from src.core.models.trade import Trade
from src.kraken_execution import AutomationNotEnabledError, KrakenAPIError, MissingAPIKeysError
from src.kraken_execution.models import KrakenOrder

# ── Constants ─────────────────────────────────────────────────────────────────

# Valid Fernet key (URL-safe base64 of 32 bytes of 0x41) — TEST ONLY, never used in prod.
_TEST_FERNET_KEY = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="

_PREFIX = "/api/kraken-execution"


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_encryption_key():
    """Patch settings.encryption_key so Fernet calls work without a real .env."""
    with patch("src.kraken_execution.service.settings") as mock_settings:
        mock_settings.encryption_key = _TEST_FERNET_KEY
        mock_settings.kraken_demo = True
        mock_settings.environment = "test"
        mock_settings.kraken_futures_base_url = "https://demo-futures.kraken.com"
        yield mock_settings


@pytest.fixture()
def profile(db_session: Session) -> Profile:
    p = Profile(
        name="RouterTest",
        market_type="Crypto",
        capital_start=Decimal("10000"),
        capital_current=Decimal("10000"),
        risk_percentage_default=Decimal("2.0"),
        max_concurrent_risk_pct=Decimal("10.0"),
    )
    db_session.add(p)
    db_session.flush()
    return p


@pytest.fixture()
def broker(db_session: Session) -> Broker:
    b = Broker(
        name="KrakenTest",
        market_type="Crypto",
        default_currency="USD",
        is_predefined=True,
        status="active",
    )
    db_session.add(b)
    db_session.flush()
    return b


@pytest.fixture()
def instrument(db_session: Session, broker: Broker) -> Instrument:
    inst = Instrument(
        broker_id=broker.id,
        symbol="PF_XBTUSD",
        display_name="Bitcoin Perpetual",
        asset_class="Crypto",
        is_active=True,
        contract_value_precision=4,
    )
    db_session.add(inst)
    db_session.flush()
    return inst


@pytest.fixture()
def trade(db_session: Session, profile: Profile, instrument: Instrument) -> Trade:
    t = Trade(
        profile_id=profile.id,
        instrument_id=instrument.id,
        pair="BTC/USD",
        direction="long",
        status="pending",
        entry_price=Decimal("50000"),
        stop_loss=Decimal("49000"),
        initial_stop_loss=Decimal("49000"),
        risk_amount=Decimal("200"),
        potential_profit=Decimal("600"),
        order_type="MARKET",
        automation_enabled=True,
        entry_date=datetime.now(UTC),
    )
    db_session.add(t)
    db_session.flush()
    return t


@pytest.fixture()
def trade_automation_disabled(db_session: Session, profile: Profile, instrument: Instrument) -> Trade:
    t = Trade(
        profile_id=profile.id,
        instrument_id=instrument.id,
        pair="BTC/USD",
        direction="long",
        status="pending",
        entry_price=Decimal("50000"),
        stop_loss=Decimal("49000"),
        initial_stop_loss=Decimal("49000"),
        risk_amount=Decimal("200"),
        potential_profit=Decimal("600"),
        order_type="MARKET",
        automation_enabled=False,
        entry_date=datetime.now(UTC),
    )
    db_session.add(t)
    db_session.flush()
    return t


# ── GET /settings/{profile_id} ────────────────────────────────────────────────

class TestGetSettings:
    def test_returns_200_for_new_profile(self, client: TestClient, profile: Profile):
        resp = client.get(f"{_PREFIX}/settings/{profile.id}")
        assert resp.status_code == 200

    def test_response_contains_profile_id(self, client: TestClient, profile: Profile):
        resp = client.get(f"{_PREFIX}/settings/{profile.id}")
        data = resp.json()
        assert data["profile_id"] == profile.id

    def test_response_does_not_contain_key_fields(self, client: TestClient, profile: Profile):
        """API keys must NEVER appear in the response."""
        resp = client.get(f"{_PREFIX}/settings/{profile.id}")
        body = resp.text
        assert "kraken_api_key_enc" not in body
        assert "kraken_api_secret_enc" not in body
        assert "kraken_api_key" not in body
        assert "kraken_api_secret" not in body

    def test_has_api_keys_false_for_new_profile(self, client: TestClient, profile: Profile):
        resp = client.get(f"{_PREFIX}/settings/{profile.id}")
        assert resp.json()["has_api_keys"] is False

    def test_default_enabled_is_false(self, client: TestClient, profile: Profile):
        resp = client.get(f"{_PREFIX}/settings/{profile.id}")
        assert resp.json()["config"]["enabled"] is False


# ── PUT /settings/{profile_id} ────────────────────────────────────────────────

class TestPutSettings:
    def test_update_enabled_flag(self, client: TestClient, profile: Profile):
        resp = client.put(
            f"{_PREFIX}/settings/{profile.id}",
            json={"enabled": True},
        )
        assert resp.status_code == 200
        assert resp.json()["config"]["enabled"] is True

    def test_update_pnl_interval(self, client: TestClient, profile: Profile):
        resp = client.put(
            f"{_PREFIX}/settings/{profile.id}",
            json={"pnl_status_interval_minutes": 30},
        )
        assert resp.status_code == 200
        assert resp.json()["config"]["pnl_status_interval_minutes"] == 30

    def test_has_api_keys_true_after_setting_keys(self, client: TestClient, profile: Profile):
        resp = client.put(
            f"{_PREFIX}/settings/{profile.id}",
            json={"kraken_api_key": "test_key", "kraken_api_secret": "test_secret"},
        )
        assert resp.status_code == 200
        assert resp.json()["has_api_keys"] is True

    def test_response_does_not_expose_plaintext_keys(self, client: TestClient, profile: Profile):
        resp = client.put(
            f"{_PREFIX}/settings/{profile.id}",
            json={"kraken_api_key": "super_secret", "kraken_api_secret": "also_secret"},
        )
        body = resp.text
        assert "super_secret" not in body
        assert "also_secret" not in body

    def test_partial_update_preserves_other_keys(self, client: TestClient, profile: Profile):
        """Updating only 'enabled' must not clear previously stored API keys."""
        client.put(
            f"{_PREFIX}/settings/{profile.id}",
            json={"kraken_api_key": "k", "kraken_api_secret": "s"},
        )
        resp = client.put(
            f"{_PREFIX}/settings/{profile.id}",
            json={"enabled": True},
        )
        assert resp.json()["has_api_keys"] is True


# ── POST /settings/{profile_id}/test-connection ───────────────────────────────

class TestTestConnection:
    def test_not_connected_when_no_keys(self, client: TestClient, profile: Profile):
        resp = client.post(f"{_PREFIX}/settings/{profile.id}/test-connection")
        assert resp.status_code == 200
        data = resp.json()
        assert data["connected"] is False

    def test_reports_demo_mode(self, client: TestClient, profile: Profile):
        resp = client.post(f"{_PREFIX}/settings/{profile.id}/test-connection")
        assert "demo" in resp.json()
        assert "base_url" in resp.json()


# ── GET /orders/{trade_id} ────────────────────────────────────────────────────

class TestGetOrders:
    def test_returns_empty_list_for_new_trade(
        self, client: TestClient, trade: Trade
    ):
        resp = client.get(f"{_PREFIX}/orders/{trade.id}")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_existing_orders(
        self, client: TestClient, trade: Trade, db_session: Session
    ):
        order = KrakenOrder(
            trade_id=trade.id,
            profile_id=trade.profile_id,
            kraken_order_id="TEST-ORDER-1",
            role="entry",
            status="open",
            order_type="market",
            symbol="PF_XBTUSD",
            side="buy",
            size=0.1,
        )
        db_session.add(order)
        db_session.flush()

        resp = client.get(f"{_PREFIX}/orders/{trade.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["kraken_order_id"] == "TEST-ORDER-1"
        assert data[0]["role"] == "entry"


# ── POST /trades/{trade_id}/open ──────────────────────────────────────────────

class TestTriggerOpen:
    def test_returns_400_when_automation_disabled(
        self, client: TestClient, trade_automation_disabled: Trade
    ):
        with patch(
            "src.kraken_execution.router.open_automated_trade",
            side_effect=AutomationNotEnabledError("automation disabled"),
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade_automation_disabled.id}/open")
        assert resp.status_code == 400

    def test_returns_422_when_missing_api_keys(self, client: TestClient, trade: Trade):
        with patch(
            "src.kraken_execution.router.open_automated_trade",
            side_effect=MissingAPIKeysError("no keys"),
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade.id}/open")
        assert resp.status_code == 422

    def test_returns_502_when_kraken_api_error(self, client: TestClient, trade: Trade):
        with patch(
            "src.kraken_execution.router.open_automated_trade",
            side_effect=KrakenAPIError(503, "service unavailable"),
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade.id}/open")
        assert resp.status_code == 502

    def test_returns_200_with_order_details_on_success(
        self, client: TestClient, trade: Trade
    ):
        fake_order = _make_fake_kraken_order(trade_id=trade.id, profile_id=trade.profile_id)
        with patch(
            "src.kraken_execution.router.open_automated_trade",
            return_value=fake_order,
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade.id}/open")
        assert resp.status_code == 200
        assert resp.json()["role"] == "entry"


# ── POST /trades/{trade_id}/close ─────────────────────────────────────────────

class TestTriggerClose:
    def test_returns_400_when_automation_disabled(
        self, client: TestClient, trade_automation_disabled: Trade
    ):
        with patch(
            "src.kraken_execution.router.close_automated_trade",
            side_effect=AutomationNotEnabledError("disabled"),
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade_automation_disabled.id}/close")
        assert resp.status_code == 400

    def test_returns_200_on_success(self, client: TestClient, trade: Trade):
        fake_order = _make_fake_kraken_order(
            trade_id=trade.id, profile_id=trade.profile_id, role="entry", order_type="market"
        )
        with patch(
            "src.kraken_execution.router.close_automated_trade",
            return_value=fake_order,
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade.id}/close")
        assert resp.status_code == 200


# ── POST /trades/{trade_id}/breakeven ─────────────────────────────────────────

class TestTriggerBreakeven:
    def test_returns_404_when_trade_not_found(self, client: TestClient):
        with patch(
            "src.kraken_execution.router.move_to_breakeven",
            side_effect=ValueError("Trade 99999 not found."),
        ):
            resp = client.post(f"{_PREFIX}/trades/99999/breakeven")
        assert resp.status_code == 404

    def test_returns_200_on_success(self, client: TestClient, trade: Trade):
        fake_order = _make_fake_kraken_order(
            trade_id=trade.id, profile_id=trade.profile_id, role="sl"
        )
        with patch(
            "src.kraken_execution.router.move_to_breakeven",
            return_value=fake_order,
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade.id}/breakeven")
        assert resp.status_code == 200
        assert resp.json()["role"] == "sl"


# ── POST /trades/{trade_id}/cancel-entry ──────────────────────────────────────

class TestTriggerCancelEntry:
    def test_returns_422_when_missing_api_keys(self, client: TestClient, trade: Trade):
        with patch(
            "src.kraken_execution.router.cancel_entry",
            side_effect=MissingAPIKeysError("no keys"),
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade.id}/cancel-entry")
        assert resp.status_code == 422

    def test_returns_200_on_success(self, client: TestClient, trade: Trade):
        fake_order = _make_fake_kraken_order(
            trade_id=trade.id,
            profile_id=trade.profile_id,
            status="cancelled",
        )
        with patch(
            "src.kraken_execution.router.cancel_entry",
            return_value=fake_order,
        ):
            resp = client.post(f"{_PREFIX}/trades/{trade.id}/cancel-entry")
        assert resp.status_code == 200
        assert resp.json()["status"] == "cancelled"


# ── Internal factory ──────────────────────────────────────────────────────────

def _make_fake_kraken_order(
    *,
    trade_id: int,
    profile_id: int,
    role: str = "entry",
    status: str = "open",
    order_type: str = "market",
) -> MagicMock:
    """Return a MagicMock that behaves like a KrakenOrder for response serialization."""
    mock = MagicMock()
    mock.id = 1
    mock.trade_id = trade_id
    mock.profile_id = profile_id
    mock.kraken_order_id = "FAKE-ORDER-001"
    mock.kraken_fill_id = None
    mock.role = role
    mock.status = status
    mock.order_type = order_type
    mock.symbol = "PF_XBTUSD"
    mock.side = "buy"
    mock.size = 0.1
    mock.limit_price = None
    mock.filled_price = None
    mock.filled_size = None
    mock.error_message = None
    mock.sent_at = datetime.now(UTC)
    mock.filled_at = None
    mock.cancelled_at = None
    return mock
