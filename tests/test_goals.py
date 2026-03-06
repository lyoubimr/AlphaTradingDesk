"""
Integration tests for Goals & Risk Limits API.

  GET    /api/profiles/{id}/goals
  POST   /api/profiles/{id}/goals
  PUT    /api/profiles/{id}/goals/{style_id}/{period}
  GET    /api/profiles/{id}/goals/progress
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Profile, TradingStyle
from src.core.models.trade import Trade


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_profile(db: Session, *, name: str = "Test Profile") -> Profile:
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


def _make_style(db: Session, *, name: str = "scalping") -> TradingStyle:
    style = TradingStyle(name=name, display_name=name.replace("_", " ").title(), sort_order=1)
    db.add(style)
    db.flush()
    return style


def _make_closed_trade(
    db: Session,
    profile: Profile,
    *,
    realized_pnl: float,
    closed_at: datetime | None = None,
) -> Trade:
    """Insert a minimal closed trade with the given PnL."""
    trade = Trade(
        profile_id=profile.id,
        pair="BTC/USD",
        direction="long",
        entry_price=Decimal("50000"),
        entry_date=datetime.utcnow(),
        stop_loss=Decimal("49000"),
        nb_take_profits=1,
        risk_amount=Decimal("200"),
        potential_profit=Decimal("400"),
        status="closed",
        realized_pnl=Decimal(str(realized_pnl)),
        closed_at=closed_at or datetime.utcnow(),
    )
    db.add(trade)
    db.flush()
    return trade


def _goal_payload(**overrides) -> dict:
    base = {"style_id": None, "period": "daily", "goal_pct": "2.0", "limit_pct": "-1.5"}
    base.update(overrides)
    return base


# ── Tests: GET /api/profiles/{id}/goals ──────────────────────────────────────

class TestListGoals:
    def test_returns_empty_list_initially(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"/api/profiles/{profile.id}/goals")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_goals_for_profile(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session)

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id),
        )

        resp = client.get(f"/api/profiles/{profile.id}/goals")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_returns_404_for_unknown_profile(self, client: TestClient):
        resp = client.get("/api/profiles/99999/goals")
        assert resp.status_code == 404


# ── Tests: POST /api/profiles/{id}/goals ─────────────────────────────────────

class TestCreateGoal:
    def test_creates_goal_successfully(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session)

        resp = client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="daily"),
        )

        assert resp.status_code == 201
        data = resp.json()
        assert data["profile_id"] == profile.id
        assert data["style_id"] == style.id
        assert data["period"] == "daily"
        assert Decimal(data["goal_pct"]) == Decimal("2.0")
        assert Decimal(data["limit_pct"]) == Decimal("-1.5")

    def test_rejects_duplicate_goal(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="swing_dup")

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="weekly"),
        )
        resp = client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="weekly"),
        )
        assert resp.status_code == 409

    def test_rejects_positive_limit_pct(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="swing_pos")

        resp = client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, limit_pct="1.0"),  # must be negative
        )
        assert resp.status_code == 422

    def test_rejects_zero_goal_pct(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="swing_zero")

        resp = client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, goal_pct="0"),
        )
        assert resp.status_code == 422

    def test_rejects_unknown_style(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)

        resp = client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=99999),
        )
        assert resp.status_code == 422

    def test_returns_404_for_unknown_profile(self, client: TestClient, db_session: Session):
        style = _make_style(db_session, name="swing_noprof")
        resp = client.post(
            "/api/profiles/99999/goals",
            json=_goal_payload(style_id=style.id),
        )
        assert resp.status_code == 404


# ── Tests: PUT /api/profiles/{id}/goals/{style_id}/{period} ──────────────────

class TestUpdateGoal:
    def test_updates_goal_pct(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="day_upd")

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="monthly"),
        )
        resp = client.put(
            f"/api/profiles/{profile.id}/goals/{style.id}/monthly",
            json={"goal_pct": "3.5"},
        )

        assert resp.status_code == 200
        assert Decimal(resp.json()["goal_pct"]) == Decimal("3.5")
        # limit_pct unchanged
        assert Decimal(resp.json()["limit_pct"]) == Decimal("-1.5")

    def test_deactivates_goal(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="day_deact")

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="daily"),
        )
        resp = client.put(
            f"/api/profiles/{profile.id}/goals/{style.id}/daily",
            json={"is_active": False},
        )

        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_returns_404_for_nonexistent_goal(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.put(
            f"/api/profiles/{profile.id}/goals/9999/daily",
            json={"goal_pct": "2.0"},
        )
        assert resp.status_code == 404


# ── Tests: GET /api/profiles/{id}/goals/progress ─────────────────────────────

class TestGoalProgress:
    def test_returns_empty_when_no_active_goals(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        resp = client.get(f"/api/profiles/{profile.id}/goals/progress")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_zero_pnl_when_no_trades(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="prog_notrades")

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="daily"),
        )

        resp = client.get(f"/api/profiles/{profile.id}/goals/progress")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert Decimal(items[0]["pnl_pct"]) == Decimal("0")
        assert items[0]["goal_hit"] is False
        assert items[0]["limit_hit"] is False

    def test_goal_hit_when_pnl_exceeds_target(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="prog_hit")

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="daily", goal_pct="2.0"),
        )
        # PnL = 300 on capital 10000 = 3.0% > 2.0% goal
        _make_closed_trade(db_session, profile, realized_pnl=300.0)
        db_session.flush()

        resp = client.get(f"/api/profiles/{profile.id}/goals/progress")
        items = resp.json()
        assert len(items) == 1
        assert items[0]["goal_hit"] is True
        assert items[0]["limit_hit"] is False

    def test_limit_hit_when_pnl_below_limit(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="prog_limit")

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="daily", limit_pct="-1.0"),
        )
        # PnL = -200 on capital 10000 = -2.0% < -1.0% limit
        _make_closed_trade(db_session, profile, realized_pnl=-200.0)
        db_session.flush()

        resp = client.get(f"/api/profiles/{profile.id}/goals/progress")
        items = resp.json()
        assert items[0]["limit_hit"] is True
        assert items[0]["goal_hit"] is False

    def test_inactive_goals_excluded_from_progress(
        self, client: TestClient, db_session: Session
    ):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="prog_inactive")

        create_resp = client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="daily"),
        )
        # Deactivate the goal
        client.put(
            f"/api/profiles/{profile.id}/goals/{style.id}/daily",
            json={"is_active": False},
        )

        resp = client.get(f"/api/profiles/{profile.id}/goals/progress")
        assert resp.json() == []

    def test_progress_response_shape(self, client: TestClient, db_session: Session):
        profile = _make_profile(db_session)
        style = _make_style(db_session, name="prog_shape")

        client.post(
            f"/api/profiles/{profile.id}/goals",
            json=_goal_payload(style_id=style.id, period="weekly"),
        )

        resp = client.get(f"/api/profiles/{profile.id}/goals/progress")
        assert resp.status_code == 200
        item = resp.json()[0]
        expected_keys = {
            "style_id", "style_name", "period",
            "period_start", "period_end",
            "pnl_pct", "goal_pct", "limit_pct",
            "goal_progress_pct", "risk_progress_pct",
            "goal_hit", "limit_hit",
            # v2 fields
            "trade_count", "avg_r", "avg_r_hit",
            "max_trades_hit", "period_type", "show_on_dashboard",
        }
        assert set(item.keys()) == expected_keys
