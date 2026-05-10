"""
tests/kraken_execution/test_service.py
Integration tests for the AutomationService layer.

Tests use the real Postgres transactional fixture (db_session) — no network calls.
Fernet encryption is tested with a fixed TEST-ONLY key (patched via unittest.mock).

What is covered:
  - get_automation_settings auto-creates row on first access
  - update_automation_settings deep-merges (does not overwrite untouched keys)
  - update_automation_settings encrypts API keys before storage
  - has_api_keys returns False / True correctly
  - _make_client raises MissingAPIKeysError when keys are absent or decryption fails
  - verify_connection returns not-connected payload when no keys
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from src.core.models.broker import Profile
from src.kraken_execution import MissingAPIKeysError
from src.kraken_execution.models import DEFAULT_AUTOMATION_CONFIG
from src.kraken_execution.service import (
    _decrypt,
    _encrypt,
    _make_client,
    get_automation_settings,
    has_api_keys,
    update_automation_settings,
    verify_connection,
)

# ── Constants ─────────────────────────────────────────────────────────────────

# Valid Fernet key (URL-safe base64 of 32 bytes of 0x41) — TEST ONLY, never used in prod.
# Generated via: base64.urlsafe_b64encode(b'A' * 32)
_TEST_FERNET_KEY = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_profile(db: Session, *, name: str = "AutoTest") -> Profile:
    profile = Profile(
        name=name,
        market_type="Crypto",
        capital_start=Decimal("10000"),
        capital_current=Decimal("10000"),
        risk_percentage_default=Decimal("2.0"),
        max_concurrent_risk_pct=Decimal("10.0"),
    )
    db.add(profile)
    db.flush()
    return profile


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def patch_encryption_key():
    """Patch settings.encryption_key for all tests in this module."""
    with patch("src.kraken_execution.service.settings") as mock_settings:
        mock_settings.encryption_key = _TEST_FERNET_KEY
        # Pass through other settings fields used in test_connection
        mock_settings.kraken_demo = True
        mock_settings.environment = "test"
        mock_settings.kraken_futures_base_url = "https://demo-futures.kraken.com"
        yield mock_settings


# ── get_automation_settings ───────────────────────────────────────────────────

class TestGetAutomationSettings:
    def test_auto_creates_row_on_first_access(self, db_session: Session):
        """Row must not exist before; must be created on first call."""
        profile = _make_profile(db_session, name="AutoCreate")
        row = get_automation_settings(profile.id, db_session)

        assert row is not None
        assert row.profile_id == profile.id

    def test_returns_defaults_for_new_profile(self, db_session: Session):
        profile = _make_profile(db_session, name="Defaults")
        row = get_automation_settings(profile.id, db_session)

        assert row.config["enabled"] == DEFAULT_AUTOMATION_CONFIG["enabled"]
        assert "pnl_status_interval_minutes" in row.config

    def test_idempotent_second_call_returns_same_row(self, db_session: Session):
        profile = _make_profile(db_session, name="Idempotent")
        row1 = get_automation_settings(profile.id, db_session)
        row2 = get_automation_settings(profile.id, db_session)

        assert row1.profile_id == row2.profile_id


# ── update_automation_settings ────────────────────────────────────────────────

class TestUpdateAutomationSettings:
    def test_updates_simple_config_field(self, db_session: Session):
        profile = _make_profile(db_session, name="PatchConfig")
        update_automation_settings(profile.id, {"enabled": True}, db_session)
        row = get_automation_settings(profile.id, db_session)

        assert row.config["enabled"] is True

    def test_deep_merge_does_not_overwrite_untouched_fields(self, db_session: Session):
        """Sending only 'enabled' must not delete 'pnl_status_interval_minutes'."""
        profile = _make_profile(db_session, name="DeepMerge")
        get_automation_settings(profile.id, db_session)  # auto-init with defaults

        update_automation_settings(profile.id, {"enabled": True}, db_session)
        row = get_automation_settings(profile.id, db_session)

        assert row.config.get("pnl_status_interval_minutes") is not None

    def test_encrypts_api_key_on_write(self, db_session: Session):
        """Plaintext 'kraken_api_key' must be stored encrypted, never as plaintext."""
        profile = _make_profile(db_session, name="EncryptKey")
        update_automation_settings(
            profile.id,
            {"kraken_api_key": "my_secret_key"},
            db_session,
        )
        row = get_automation_settings(profile.id, db_session)

        assert "kraken_api_key_enc" in row.config
        assert "kraken_api_key" not in row.config
        # Encrypted value is not the plaintext
        assert row.config["kraken_api_key_enc"] != "my_secret_key"

    def test_encrypts_api_secret_on_write(self, db_session: Session):
        profile = _make_profile(db_session, name="EncryptSecret")
        update_automation_settings(
            profile.id,
            {"kraken_api_secret": "my_secret"},
            db_session,
        )
        row = get_automation_settings(profile.id, db_session)

        assert "kraken_api_secret_enc" in row.config
        assert "kraken_api_secret" not in row.config

    def test_encrypted_key_can_be_decrypted(self, db_session: Session):
        """The stored ciphertext must decrypt back to the original plaintext."""
        profile = _make_profile(db_session, name="DecryptCheck")
        update_automation_settings(
            profile.id,
            {"kraken_api_key": "round_trip_key"},
            db_session,
        )
        row = get_automation_settings(profile.id, db_session)

        decrypted = _decrypt(row.config["kraken_api_key_enc"])
        assert decrypted == "round_trip_key"

    def test_update_does_not_clear_existing_keys_when_not_provided(self, db_session: Session):
        """Second PUT without key fields must not remove existing encrypted keys."""
        profile = _make_profile(db_session, name="KeepKeys")
        update_automation_settings(
            profile.id,
            {"kraken_api_key": "keep_me", "kraken_api_secret": "keep_secret"},
            db_session,
        )
        # Second call without key fields
        update_automation_settings(profile.id, {"enabled": True}, db_session)
        row = get_automation_settings(profile.id, db_session)

        assert "kraken_api_key_enc" in row.config
        assert "kraken_api_secret_enc" in row.config


# ── has_api_keys ──────────────────────────────────────────────────────────────

class TestHasApiKeys:
    def test_returns_false_for_new_profile(self, db_session: Session):
        profile = _make_profile(db_session, name="NoKeys")
        row = get_automation_settings(profile.id, db_session)

        assert has_api_keys(row) is False

    def test_returns_false_when_only_one_key_set(self, db_session: Session):
        profile = _make_profile(db_session, name="OneKey")
        update_automation_settings(profile.id, {"kraken_api_key": "only_key"}, db_session)
        row = get_automation_settings(profile.id, db_session)

        assert has_api_keys(row) is False  # both required

    def test_returns_true_when_both_keys_set(self, db_session: Session):
        profile = _make_profile(db_session, name="BothKeys")
        update_automation_settings(
            profile.id,
            {"kraken_api_key": "key", "kraken_api_secret": "secret"},
            db_session,
        )
        row = get_automation_settings(profile.id, db_session)

        assert has_api_keys(row) is True


# ── _make_client ──────────────────────────────────────────────────────────────

class TestMakeClient:
    def test_raises_when_no_keys(self, db_session: Session):
        profile = _make_profile(db_session, name="NoClient")
        row = get_automation_settings(profile.id, db_session)

        with pytest.raises(MissingAPIKeysError):
            _make_client(row)

    def test_raises_with_bad_decryption_token(self, db_session: Session):
        """If ENCRYPTION_KEY changed after keys were stored → MissingAPIKeysError."""
        profile = _make_profile(db_session, name="BadToken")
        # Manually insert garbage ciphertext
        row = get_automation_settings(profile.id, db_session)
        row.config = {
            **row.config,
            "kraken_api_key_enc": "not_valid_ciphertext",
            "kraken_api_secret_enc": "also_invalid",
        }
        db_session.flush()

        with pytest.raises(MissingAPIKeysError):
            _make_client(row)

    def test_returns_client_when_valid_keys(self, db_session: Session):
        """With both valid keys, _make_client returns a KrakenExecutionClient."""
        from src.kraken_execution.client import KrakenExecutionClient  # noqa: PLC0415

        profile = _make_profile(db_session, name="GoodClient")
        update_automation_settings(
            profile.id,
            {"kraken_api_key": "valid_key", "kraken_api_secret": "dmFsaWRfc2VjcmV0"},
            db_session,
        )
        row = get_automation_settings(profile.id, db_session)

        client = _make_client(row)
        try:
            assert isinstance(client, KrakenExecutionClient)
        finally:
            client.close()


# ── verify_connection ───────────────────────────────────────────────────────────

class TestVerifyConnection:
    def test_returns_not_connected_when_no_keys(self, db_session: Session):
        profile = _make_profile(db_session, name="ConnTest")
        result = verify_connection(profile.id, db_session)

        assert result["connected"] is False
        assert "error" in result

    def test_returns_connected_true_when_ping_succeeds(self, db_session: Session):
        profile = _make_profile(db_session, name="ConnPing")
        update_automation_settings(
            profile.id,
            {"kraken_api_key": "k", "kraken_api_secret": "dmFsaWRfc2VjcmV0"},
            db_session,
        )
        # Mock _make_client to return a client whose ping() returns True
        mock_client = patch(
            "src.kraken_execution.service._make_client",
            return_value=_MockClient(ping_result=True),
        )
        with mock_client:
            result = verify_connection(profile.id, db_session)

        assert result["connected"] is True

    def test_returns_connected_false_when_ping_fails(self, db_session: Session):
        profile = _make_profile(db_session, name="ConnFail")
        update_automation_settings(
            profile.id,
            {"kraken_api_key": "k", "kraken_api_secret": "dmFsaWRfc2VjcmV0"},
            db_session,
        )
        mock_client = patch(
            "src.kraken_execution.service._make_client",
            return_value=_MockClient(ping_result=False),
        )
        with mock_client:
            result = verify_connection(profile.id, db_session)

        assert result["connected"] is False


# ── Encryption round-trip (unit) ──────────────────────────────────────────────

class TestEncryptionRoundTrip:
    def test_encrypt_decrypt_round_trip(self):
        plaintext = "super_secret_api_key_12345"
        ciphertext = _encrypt(plaintext)
        assert ciphertext != plaintext
        assert _decrypt(ciphertext) == plaintext

    def test_different_plaintexts_produce_different_ciphertexts(self):
        ct1 = _encrypt("key_one")
        ct2 = _encrypt("key_two")
        assert ct1 != ct2


# ── Internal mock client ──────────────────────────────────────────────────────

class _MockClient:
    """Minimal mock for KrakenExecutionClient used in verify_connection tests."""

    def __init__(self, *, ping_result: bool):
        self._ping = ping_result

    def ping(self) -> tuple[bool, str | None]:
        return self._ping, None if self._ping else "mock ping failure"

    def close(self) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


# ── Spy client for place_sl_tp_orders tests ───────────────────────────────────

class _SpyClient:
    """Records send_order calls — no network, returns a valid 'placed' response."""

    def __init__(self):
        self.orders_sent: list[dict] = []

    def send_order(self, order_type: str, symbol: str, side: str, size: str, **kwargs) -> dict:
        call = {"order_type": order_type, "symbol": symbol, "side": side, "size": size, **kwargs}
        self.orders_sent.append(call)
        return {"sendStatus": {"order_id": f"TEST-{len(self.orders_sent)}", "status": "placed"}}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass


# ── place_sl_tp_orders — stop-limit / stop-market ────────────────────────────

def _setup_trade_for_sl_test(
    db: Session,
    *,
    name_suffix: str,
    direction: str = "long",
    entry_price: str = "40000",
    stop_loss: str = "39000",
    tp_price: str = "42000",
) -> tuple:
    """Create Profile → Broker → Instrument → Trade → Position for SL tests."""
    from datetime import datetime  # noqa: PLC0415

    from src.core.models.broker import Broker, Instrument  # noqa: PLC0415
    from src.core.models.trade import Position, Trade  # noqa: PLC0415

    profile = _make_profile(db, name=f"SL-{name_suffix}")

    broker = Broker(
        name=f"Broker-{name_suffix}",
        market_type="Crypto",
        default_currency="USD",
        is_predefined=True,
        status="active",
    )
    db.add(broker)
    db.flush()

    instr = Instrument(
        broker_id=broker.id,
        symbol="PF_XBTUSD",
        display_name="BTC/USD Perp",
        asset_class="Crypto",
        contract_value_precision=4,
        is_active=True,
    )
    db.add(instr)
    db.flush()

    from decimal import Decimal as D  # noqa: PLC0415
    trade = Trade(
        profile_id=profile.id,
        instrument_id=instr.id,
        pair="XBTUSD",
        direction=direction,
        entry_price=D(entry_price),
        stop_loss=D(stop_loss),
        initial_stop_loss=D(stop_loss),
        risk_amount=D("15.00"),
        potential_profit=D("45.00"),
        entry_date=datetime.utcnow(),
        status="open",
        order_type="MARKET",
        automation_enabled=True,
    )
    db.add(trade)
    db.flush()

    pos = Position(
        trade_id=trade.id,
        position_number=1,
        lot_percentage=D("100"),
        take_profit_price=D(tp_price),
        status="open",
        is_runner=False,
    )
    db.add(pos)
    db.flush()

    # Reload trade with relationships
    db.refresh(trade)
    return profile, instr, trade


class TestPlaceSlTpOrders:
    """Unit tests for place_sl_tp_orders — no network calls, spy client only."""

    def test_default_config_has_new_sl_keys(self):
        """DEFAULT_AUTOMATION_CONFIG must include sl_order_type, sl_limit_offset_pct, max_loss_guard."""
        assert DEFAULT_AUTOMATION_CONFIG["sl_order_type"] == "stop_limit"
        assert DEFAULT_AUTOMATION_CONFIG["sl_limit_offset_pct"] == 1.5
        assert isinstance(DEFAULT_AUTOMATION_CONFIG["max_loss_guard"], dict)
        assert DEFAULT_AUTOMATION_CONFIG["max_loss_guard"]["enabled"] is False
        assert DEFAULT_AUTOMATION_CONFIG["max_loss_guard"]["multiplier"] == 2.0

    def test_stop_limit_sends_limit_price_to_kraken(self, db_session: Session):
        """stop_limit: send_order must receive a limit_price kwarg for the SL call."""
        from src.kraken_execution.service import place_sl_tp_orders  # noqa: PLC0415

        profile, _instr, trade = _setup_trade_for_sl_test(db_session, name_suffix="SL-Limit")
        update_automation_settings(
            profile.id,
            {"sl_order_type": "stop_limit", "sl_limit_offset_pct": 1.5},
            db_session,
        )
        settings = get_automation_settings(profile.id, db_session)

        spy = _SpyClient()
        from decimal import Decimal  # noqa: PLC0415
        place_sl_tp_orders(trade, Decimal("0.001"), spy, db_session, settings_row=settings)

        sl_call = next(c for c in spy.orders_sent if c["order_type"] == "stp")
        assert sl_call.get("limit_price") is not None

    def test_stop_market_does_not_send_limit_price(self, db_session: Session):
        """stop_market: send_order must NOT receive a limit_price for the SL call."""
        from src.kraken_execution.service import place_sl_tp_orders  # noqa: PLC0415

        profile, _instr, trade = _setup_trade_for_sl_test(db_session, name_suffix="SL-Market")
        update_automation_settings(
            profile.id,
            {"sl_order_type": "stop_market"},
            db_session,
        )
        settings = get_automation_settings(profile.id, db_session)

        spy = _SpyClient()
        from decimal import Decimal  # noqa: PLC0415
        place_sl_tp_orders(trade, Decimal("0.001"), spy, db_session, settings_row=settings)

        sl_call = next(c for c in spy.orders_sent if c["order_type"] == "stp")
        assert sl_call.get("limit_price") is None

    def test_stop_limit_long_limit_is_below_trigger(self, db_session: Session):
        """Long stop-limit: limit_price must be BELOW the stop_price (slippage protection)."""
        from decimal import Decimal  # noqa: PLC0415

        from src.kraken_execution.service import place_sl_tp_orders  # noqa: PLC0415

        profile, _instr, trade = _setup_trade_for_sl_test(
            db_session,
            name_suffix="SL-LongDir",
            direction="long",
            stop_loss="39000",
        )
        update_automation_settings(profile.id, {"sl_order_type": "stop_limit", "sl_limit_offset_pct": 1.5}, db_session)
        settings = get_automation_settings(profile.id, db_session)

        spy = _SpyClient()
        place_sl_tp_orders(trade, Decimal("0.001"), spy, db_session, settings_row=settings)

        sl_call = next(c for c in spy.orders_sent if c["order_type"] == "stp")
        limit = Decimal(sl_call["limit_price"])
        stop = Decimal(sl_call["stop_price"])
        assert limit < stop  # limit must be below trigger for long

    def test_stop_limit_short_limit_is_above_trigger(self, db_session: Session):
        """Short stop-limit: limit_price must be ABOVE the stop_price."""
        from decimal import Decimal  # noqa: PLC0415

        from src.kraken_execution.service import place_sl_tp_orders  # noqa: PLC0415

        profile, _instr, trade = _setup_trade_for_sl_test(
            db_session,
            name_suffix="SL-ShortDir",
            direction="short",
            entry_price="40000",
            stop_loss="41000",
            tp_price="38000",
        )
        update_automation_settings(profile.id, {"sl_order_type": "stop_limit", "sl_limit_offset_pct": 1.5}, db_session)
        settings = get_automation_settings(profile.id, db_session)

        spy = _SpyClient()
        place_sl_tp_orders(trade, Decimal("0.001"), spy, db_session, settings_row=settings)

        sl_call = next(c for c in spy.orders_sent if c["order_type"] == "stp")
        limit = Decimal(sl_call["limit_price"])
        stop = Decimal(sl_call["stop_price"])
        assert limit > stop  # limit must be above trigger for short

    def test_stop_limit_stores_limit_price_in_kraken_order(self, db_session: Session):
        """KrakenOrder.limit_price must be non-null when sl_order_type=stop_limit."""
        from decimal import Decimal  # noqa: PLC0415

        from src.kraken_execution.models import KrakenOrder  # noqa: PLC0415
        from src.kraken_execution.service import place_sl_tp_orders  # noqa: PLC0415

        profile, _instr, trade = _setup_trade_for_sl_test(db_session, name_suffix="SL-DBLimit")
        update_automation_settings(profile.id, {"sl_order_type": "stop_limit", "sl_limit_offset_pct": 2.0}, db_session)
        settings = get_automation_settings(profile.id, db_session)

        spy = _SpyClient()
        place_sl_tp_orders(trade, Decimal("0.001"), spy, db_session, settings_row=settings)

        sl_row = (
            db_session.query(KrakenOrder)
            .filter(KrakenOrder.trade_id == trade.id, KrakenOrder.role == "sl")
            .first()
        )
        assert sl_row is not None
        assert sl_row.limit_price is not None

    def test_stop_market_stores_null_limit_price_in_kraken_order(self, db_session: Session):
        """KrakenOrder.limit_price must be NULL when sl_order_type=stop_market."""
        from decimal import Decimal  # noqa: PLC0415

        from src.kraken_execution.models import KrakenOrder  # noqa: PLC0415
        from src.kraken_execution.service import place_sl_tp_orders  # noqa: PLC0415

        profile, _instr, trade = _setup_trade_for_sl_test(db_session, name_suffix="SL-DBMkt")
        update_automation_settings(profile.id, {"sl_order_type": "stop_market"}, db_session)
        settings = get_automation_settings(profile.id, db_session)

        spy = _SpyClient()
        place_sl_tp_orders(trade, Decimal("0.001"), spy, db_session, settings_row=settings)

        sl_row = (
            db_session.query(KrakenOrder)
            .filter(KrakenOrder.trade_id == trade.id, KrakenOrder.role == "sl")
            .first()
        )
        assert sl_row is not None
        assert sl_row.limit_price is None
