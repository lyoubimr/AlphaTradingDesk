"""AI settings and API keys are shared across profiles; retired Groq models are remapped."""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from src.analytics.ai_service import _get_decrypted_key
from src.core.models.broker import Profile

# Valid Fernet key — TEST ONLY.
_TEST_FERNET_KEY = "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="


@pytest.fixture(autouse=True)
def patch_encryption_key():
    with patch("src.analytics.ai_service.settings") as mock_settings:
        mock_settings.encryption_key = _TEST_FERNET_KEY
        yield


def _profile(db: Session, name: str) -> Profile:
    p = Profile(
        name=name,
        market_type="Crypto",
        capital_start=Decimal("1000"),
        capital_current=Decimal("1000"),
        risk_percentage_default=Decimal("2.0"),
        max_concurrent_risk_pct=Decimal("10.0"),
    )
    db.add(p)
    db.flush()
    return p


def test_ai_config_enabled_on_one_profile_applies_to_all(client, db_session):
    a, b = _profile(db_session, "A"), _profile(db_session, "B")
    client.get(f"/api/analytics/settings/{b.id}")

    res = client.put(
        f"/api/analytics/settings/{a.id}",
        json={"ai_enabled": True, "ai_provider": "groq", "ai_model": "openai/gpt-oss-120b"},
    )
    assert res.status_code == 200

    cfg_b = client.get(f"/api/analytics/settings/{b.id}").json()["config"]
    assert cfg_b["ai_enabled"] is True
    assert cfg_b["ai_provider"] == "groq"
    assert cfg_b["ai_model"] == "openai/gpt-oss-120b"


def test_ai_config_applies_to_profile_created_later(client, db_session):
    a = _profile(db_session, "A")
    client.put(f"/api/analytics/settings/{a.id}", json={"ai_enabled": True, "ai_provider": "groq"})
    late = _profile(db_session, "Late")

    cfg = client.get(f"/api/analytics/settings/{late.id}").json()["config"]
    assert cfg["ai_enabled"] is True
    assert cfg["ai_provider"] == "groq"


def test_disabling_ai_disables_for_all_profiles(client, db_session):
    a, b = _profile(db_session, "A"), _profile(db_session, "B")
    client.put(f"/api/analytics/settings/{a.id}", json={"ai_enabled": True})
    client.put(f"/api/analytics/settings/{b.id}", json={"ai_enabled": False})

    assert client.get(f"/api/analytics/settings/{a.id}").json()["config"]["ai_enabled"] is False
    assert client.get(f"/api/analytics/settings/{b.id}").json()["config"]["ai_enabled"] is False


def test_retired_groq_model_is_mapped_to_successor(client, db_session):
    a = _profile(db_session, "A")
    client.put(
        f"/api/analytics/settings/{a.id}",
        json={"ai_enabled": True, "ai_provider": "groq", "ai_model": "llama-3.3-70b-versatile"},
    )
    cfg = client.get(f"/api/analytics/settings/{a.id}").json()["config"]
    assert cfg["ai_model"] == "openai/gpt-oss-120b"


def test_api_key_saved_on_one_profile_is_usable_by_all(client, db_session):
    a, b = _profile(db_session, "A"), _profile(db_session, "B")
    client.get(f"/api/analytics/ai-keys/{b.id}")

    res = client.put(f"/api/analytics/ai-keys/{a.id}", json={"groq_key": "gsk_test_123"})
    assert res.status_code == 200

    status_b = client.get(f"/api/analytics/ai-keys/{b.id}").json()
    assert status_b["groq_configured"] is True
    assert status_b["openai_configured"] is False
    assert _get_decrypted_key(b.id, "groq", db_session) == "gsk_test_123"


def test_api_key_visible_to_profile_created_later_and_clearable(client, db_session):
    a = _profile(db_session, "A")
    client.put(f"/api/analytics/ai-keys/{a.id}", json={"groq_key": "gsk_test_123"})
    late = _profile(db_session, "Late")

    assert client.get(f"/api/analytics/ai-keys/{late.id}").json()["groq_configured"] is True

    client.put(f"/api/analytics/ai-keys/{late.id}", json={"groq_key": ""})
    assert client.get(f"/api/analytics/ai-keys/{a.id}").json()["groq_configured"] is False
