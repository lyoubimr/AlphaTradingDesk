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
