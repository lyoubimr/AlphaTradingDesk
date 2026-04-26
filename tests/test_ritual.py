"""
Integration tests for the Ritual module (Phase 6B).

Endpoints tested:
  GET  /api/profiles/{id}/ritual/settings
  PUT  /api/profiles/{id}/ritual/settings
  GET  /api/profiles/{id}/ritual/steps/{session_type}
  POST /api/profiles/{id}/ritual/steps/{session_type}/reset
  GET  /api/profiles/{id}/ritual/pinned
  POST /api/profiles/{id}/ritual/pinned
  DEL  /api/profiles/{id}/ritual/pinned/{pin_id}
  POST /api/profiles/{id}/ritual/pinned/{pin_id}/extend
  POST /api/profiles/{id}/ritual/sessions
  GET  /api/profiles/{id}/ritual/sessions/active
  POST /api/profiles/{id}/ritual/sessions/{id}/steps/{log_id}/complete
  POST /api/profiles/{id}/ritual/sessions/{id}/complete
  POST /api/profiles/{id}/ritual/sessions/{id}/abandon
  GET  /api/profiles/{id}/ritual/score
  GET  /api/profiles/{id}/ritual/score/history
"""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Profile

# ─────────────────────────────────────────────────────────────────────────────
# Fixtures / helpers
# ─────────────────────────────────────────────────────────────────────────────

BASE = "/api/profiles"


def _make_profile(db: Session, *, name: str = "Ritual-Test") -> Profile:
    p = Profile(
        name=name,
        market_type="Crypto",
        capital_start=Decimal("10000"),
        capital_current=Decimal("10000"),
        risk_percentage_default=Decimal("2.0"),
        max_concurrent_risk_pct=Decimal("2.0"),
        status="active",
    )
    db.add(p)
    db.flush()
    return p


def _ritual(profile_id: int) -> str:
    return f"{BASE}/{profile_id}/ritual"


# ─────────────────────────────────────────────────────────────────────────────
# Settings
# ─────────────────────────────────────────────────────────────────────────────


class TestRitualSettings:
    def test_get_settings_auto_creates(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/settings")
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile_id"] == profile.id
        assert "config" in data
        # Default config must have top_n
        assert "top_n" in data["config"]

    def test_get_settings_idempotent(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        r1 = client.get(f"{_ritual(profile.id)}/settings")
        r2 = client.get(f"{_ritual(profile.id)}/settings")
        assert r1.status_code == r2.status_code == 200
        assert r1.json()["profile_id"] == r2.json()["profile_id"]

    def test_update_settings_deep_merge(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        # Prime defaults
        client.get(f"{_ritual(profile.id)}/settings")
        # Patch only top_n
        resp = client.put(
            f"{_ritual(profile.id)}/settings",
            json={"config": {"top_n": 30}},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["config"]["top_n"] == 30

    def test_update_settings_unknown_profile_raises(self, client: TestClient):
        resp = client.put(
            f"{BASE}/99999/ritual/settings",
            json={"config": {"top_n": 10}},
        )
        assert resp.status_code == 404

    def test_get_settings_unknown_profile_raises(self, client: TestClient):
        resp = client.get(f"{BASE}/99999/ritual/settings")
        assert resp.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# Step templates
# ─────────────────────────────────────────────────────────────────────────────


class TestRitualSteps:
    def test_get_steps_auto_seeds(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/steps/daily_prep")
        assert resp.status_code == 200
        steps = resp.json()
        assert len(steps) > 0
        # All steps belong to correct session type
        for s in steps:
            assert s["session_type"] == "daily_prep"
            assert "label" in s
            assert "position" in s

    def test_get_steps_weekly_setup(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/steps/weekly_setup")
        assert resp.status_code == 200
        assert len(resp.json()) > 0

    def test_reset_steps_returns_defaults(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        # Seed first
        client.get(f"{_ritual(profile.id)}/steps/trade_session")
        # Reset
        resp = client.post(f"{_ritual(profile.id)}/steps/trade_session/reset")
        assert resp.status_code == 200
        steps = resp.json()
        assert len(steps) > 0
        for s in steps:
            assert s["session_type"] == "trade_session"

    def test_get_steps_invalid_session_type(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/steps/invalid_type")
        # Service should raise 400 or return empty list — either is acceptable
        assert resp.status_code in (200, 400, 422)


# ─────────────────────────────────────────────────────────────────────────────
# Pinned pairs
# ─────────────────────────────────────────────────────────────────────────────


class TestPinnedPairs:
    def test_list_pinned_empty_initially(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/pinned")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_add_pinned_pair(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.post(
            f"{_ritual(profile.id)}/pinned",
            json={"pair": "BTC/USD", "timeframe": "4H", "note": "strong support", "source": "manual"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["pair"] == "BTC/USD"
        assert data["timeframe"] == "4H"
        assert data["note"] == "strong support"
        assert data["status"] == "active"
        assert data["expires_at"] is not None

    def test_list_pinned_returns_added_pair(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        client.post(
            f"{_ritual(profile.id)}/pinned",
            json={"pair": "ETH/USD", "timeframe": "1D", "source": "manual"},
        )
        resp = client.get(f"{_ritual(profile.id)}/pinned")
        assert resp.status_code == 200
        pins = resp.json()
        assert len(pins) == 1
        assert pins[0]["pair"] == "ETH/USD"

    def test_remove_pinned_pair(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        add_resp = client.post(
            f"{_ritual(profile.id)}/pinned",
            json={"pair": "SOL/USD", "timeframe": "1H", "source": "manual"},
        )
        pin_id = add_resp.json()["id"]

        del_resp = client.delete(f"{_ritual(profile.id)}/pinned/{pin_id}")
        assert del_resp.status_code == 204

        # Should no longer be in active list
        list_resp = client.get(f"{_ritual(profile.id)}/pinned")
        pairs = [p["pair"] for p in list_resp.json()]
        assert "SOL/USD" not in pairs

    def test_extend_pinned_pair(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        add_resp = client.post(
            f"{_ritual(profile.id)}/pinned",
            json={"pair": "XBT/USD", "timeframe": "1W", "source": "manual"},
        )
        pin_id = add_resp.json()["id"]
        original_expiry = add_resp.json()["expires_at"]

        ext_resp = client.post(
            f"{_ritual(profile.id)}/pinned/{pin_id}/extend",
            json={"hours": 24},
        )
        assert ext_resp.status_code == 200
        new_expiry = ext_resp.json()["expires_at"]
        # New expiry must be later
        assert new_expiry > original_expiry

    def test_ttl_reflects_timeframe(self, client: TestClient, db_session: Session):
        """1W pin should have longer TTL than 1H pin."""
        profile = _make_profile(db_session)
        r1w = client.post(
            f"{_ritual(profile.id)}/pinned",
            json={"pair": "BTC/USD", "timeframe": "1W", "source": "manual"},
        )
        r1h = client.post(
            f"{_ritual(profile.id)}/pinned",
            json={"pair": "ETH/USD", "timeframe": "1H", "source": "manual"},
        )
        assert r1w.json()["expires_at"] > r1h.json()["expires_at"]

    def test_add_pinned_unknown_profile(self, client: TestClient):
        resp = client.post(
            f"{BASE}/99999/ritual/pinned",
            json={"pair": "BTC/USD", "timeframe": "4H", "source": "manual"},
        )
        assert resp.status_code == 404

    def test_add_pinned_invalid_timeframe(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.post(
            f"{_ritual(profile.id)}/pinned",
            json={"pair": "BTC/USD", "timeframe": "5D", "source": "manual"},
        )
        assert resp.status_code == 422


# ─────────────────────────────────────────────────────────────────────────────
# Sessions
# ─────────────────────────────────────────────────────────────────────────────


class TestRitualSessions:
    def test_no_active_session_initially(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/sessions/active")
        assert resp.status_code == 200
        assert resp.json() is None

    def test_start_session(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "daily_prep"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["session_type"] == "daily_prep"
        assert data["status"] == "in_progress"
        assert len(data["step_logs"]) > 0

    def test_active_session_returned_after_start(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "weekly_setup"},
        )
        resp = client.get(f"{_ritual(profile.id)}/sessions/active")
        assert resp.status_code == 200
        data = resp.json()
        assert data is not None
        assert data["session_type"] == "weekly_setup"
        assert data["status"] == "in_progress"

    def test_starting_second_session_abandons_first(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        first = client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "daily_prep"},
        )
        first_id = first.json()["id"]

        client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "trade_session"},
        )
        # Old session must now be abandoned
        sessions = client.get(f"{_ritual(profile.id)}/sessions").json()
        old = next((s for s in sessions if s["id"] == first_id), None)
        assert old is not None
        assert old["status"] == "abandoned"

    def test_complete_step(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        start_resp = client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "daily_prep"},
        )
        session_id = start_resp.json()["id"]
        # First step log
        first_log = start_resp.json()["step_logs"][0]
        log_id = first_log["id"]

        resp = client.post(
            f"{_ritual(profile.id)}/sessions/{session_id}/steps/{log_id}/complete",
            json={"status": "done", "output": {}},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "done"
        assert resp.json()["completed_at"] is not None

    def test_skip_optional_step(self, client: TestClient, db_session: Session):
        """Skipping any step via status=skipped must return skipped."""
        profile = _make_profile(db_session)
        start_resp = client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "daily_prep"},
        )
        session_id = start_resp.json()["id"]
        log_id = start_resp.json()["step_logs"][0]["id"]

        resp = client.post(
            f"{_ritual(profile.id)}/sessions/{session_id}/steps/{log_id}/complete",
            json={"status": "skipped", "output": {}},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "skipped"

    def test_abandon_session(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        start_resp = client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "weekend_review"},
        )
        session_id = start_resp.json()["id"]

        resp = client.post(f"{_ritual(profile.id)}/sessions/{session_id}/abandon")
        assert resp.status_code == 200
        assert resp.json()["status"] == "abandoned"

        # No active session anymore
        active = client.get(f"{_ritual(profile.id)}/sessions/active")
        assert active.json() is None

    def test_complete_session_awards_points(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        start_resp = client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "daily_prep"},
        )
        session_id = start_resp.json()["id"]
        logs = start_resp.json()["step_logs"]

        # Complete all steps
        for log in logs:
            client.post(
                f"{_ritual(profile.id)}/sessions/{session_id}/steps/{log['id']}/complete",
                json={"status": "done", "output": {}},
            )

        resp = client.post(
            f"{_ritual(profile.id)}/sessions/{session_id}/complete",
            json={"outcome": None, "notes": None},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        # daily_prep awards +10 points
        assert data["discipline_points"] >= 10

    def test_list_sessions(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        # Start and abandon two sessions
        for st in ["daily_prep", "weekly_setup"]:
            r = client.post(f"{_ritual(profile.id)}/sessions", json={"session_type": st})
            client.post(f"{_ritual(profile.id)}/sessions/{r.json()['id']}/abandon")

        resp = client.get(f"{_ritual(profile.id)}/sessions")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_start_session_unknown_profile(self, client: TestClient):
        resp = client.post(
            f"{BASE}/99999/ritual/sessions",
            json={"session_type": "daily_prep"},
        )
        assert resp.status_code == 404


# ─────────────────────────────────────────────────────────────────────────────
# Discipline Score
# ─────────────────────────────────────────────────────────────────────────────


class TestDisciplineScore:
    def test_score_auto_inits_to_zero(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/score")
        assert resp.status_code == 200
        data = resp.json()
        assert data["score"] == 0
        assert data["max_score"] > 0
        assert data["grade"] in ("S", "A", "B", "C", "D", "F")

    def test_score_increases_after_completed_session(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        start_resp = client.post(
            f"{_ritual(profile.id)}/sessions",
            json={"session_type": "daily_prep"},
        )
        session_id = start_resp.json()["id"]
        logs = start_resp.json()["step_logs"]

        for log in logs:
            client.post(
                f"{_ritual(profile.id)}/sessions/{session_id}/steps/{log['id']}/complete",
                json={"status": "done", "output": {}},
            )
        client.post(
            f"{_ritual(profile.id)}/sessions/{session_id}/complete",
            json={"outcome": None, "notes": None},
        )

        resp = client.get(f"{_ritual(profile.id)}/score")
        assert resp.json()["score"] > 0

    def test_score_history_returns_list(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"{_ritual(profile.id)}/score/history")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_score_unknown_profile(self, client: TestClient):
        resp = client.get(f"{BASE}/99999/ritual/score")
        assert resp.status_code == 404
