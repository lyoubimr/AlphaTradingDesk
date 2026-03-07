"""
Integration tests for Market Analysis API — Step 7.

  GET  /api/market-analysis/modules
  GET  /api/market-analysis/modules/{id}/indicators
  POST /api/market-analysis/sessions
  GET  /api/market-analysis/sessions
  GET  /api/market-analysis/sessions/{id}
  GET  /api/profiles/{id}/indicator-config
  PUT  /api/profiles/{id}/indicator-config
  GET  /api/profiles/{id}/market-analysis/staleness
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Profile
from src.core.models.market_analysis import (
    MarketAnalysisIndicator,
    MarketAnalysisModule,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_module(
    db: Session,
    *,
    name: str = "TestModule",
    is_dual: bool = False,
    asset_a: str = "BTC",
    asset_b: str | None = None,
) -> MarketAnalysisModule:
    m = MarketAnalysisModule(
        name=name,
        is_dual=is_dual,
        asset_a=asset_a,
        asset_b=asset_b,
        is_active=True,
        sort_order=99,
    )
    db.add(m)
    db.flush()
    return m


def _make_indicator(
    db: Session,
    module: MarketAnalysisModule,
    *,
    key: str = "ind_htf",
    asset_target: str = "single",
    timeframe_level: str = "htf",
    default_enabled: bool = True,
    sort_order: int = 1,
) -> MarketAnalysisIndicator:
    ind = MarketAnalysisIndicator(
        module_id=module.id,
        key=key,
        label=f"Label {key}",
        asset_target=asset_target,
        tv_symbol="XAUUSD",
        tv_timeframe="1W",
        timeframe_level=timeframe_level,
        question="Is this bullish?",
        answer_bullish="YES (+2)",
        answer_partial="PARTIAL (+1)",
        answer_bearish="NO (0)",
        default_enabled=default_enabled,
        sort_order=sort_order,
    )
    db.add(ind)
    db.flush()
    return ind


def _make_broker(db: Session, *, name: str = "Broker") -> Broker:
    b = Broker(
        name=name,
        market_type="Crypto",
        default_currency="USD",
        is_predefined=True,
        status="active",
    )
    db.add(b)
    db.flush()
    return b


def _make_profile(db: Session, broker: Broker, *, name: str = "Trader") -> Profile:
    p = Profile(
        name=name,
        market_type="Crypto",
        broker_id=broker.id,
        capital_start="10000",
        capital_current="10000",
        risk_percentage_default="2.0",
        max_concurrent_risk_pct="2.0",
        status="active",
    )
    db.add(p)
    db.flush()
    return p


def _session_payload(
    profile: Profile,
    module: MarketAnalysisModule,
    indicators: list[MarketAnalysisIndicator],
    *,
    score: int = 2,
) -> dict:
    return {
        "profile_id": profile.id,
        "module_id": module.id,
        "answers": [
            {
                "indicator_id": ind.id,
                "score": score,
                "answer_label": "YES (+2)",
            }
            for ind in indicators
        ],
        "notes": "Test session",
    }


# ── Tests: GET /api/market-analysis/modules ───────────────────────────────────


class TestListModules:
    def test_returns_active_modules(self, client: TestClient, db_session: Session):
        _make_module(db_session, name="ActiveMod")
        inactive = _make_module(db_session, name="InactiveMod")
        inactive.is_active = False
        db_session.flush()

        resp = client.get("/api/market-analysis/modules")
        assert resp.status_code == 200
        names = [m["name"] for m in resp.json()]
        assert "ActiveMod" in names
        assert "InactiveMod" not in names

    def test_returns_correct_fields(self, client: TestClient, db_session: Session):
        _make_module(db_session, name="FieldMod", is_dual=True, asset_a="BTC", asset_b="Alts")
        resp = client.get("/api/market-analysis/modules")
        mod = next(m for m in resp.json() if m["name"] == "FieldMod")
        assert mod["is_dual"] is True
        assert mod["asset_a"] == "BTC"
        assert mod["asset_b"] == "Alts"


# ── Tests: GET /api/market-analysis/modules/{id}/indicators ──────────────────


class TestListIndicators:
    def test_returns_indicators_for_module(self, client: TestClient, db_session: Session):
        mod = _make_module(db_session, name="IndMod")
        i1 = _make_indicator(db_session, mod, key="ind1", sort_order=1)
        i2 = _make_indicator(db_session, mod, key="ind2", sort_order=2)

        resp = client.get(f"/api/market-analysis/modules/{mod.id}/indicators")
        assert resp.status_code == 200
        ids = [i["id"] for i in resp.json()]
        assert i1.id in ids
        assert i2.id in ids

    def test_returns_404_for_unknown_module(self, client: TestClient):
        resp = client.get("/api/market-analysis/modules/99999/indicators")
        assert resp.status_code == 404

    def test_does_not_mix_modules(self, client: TestClient, db_session: Session):
        mod_a = _make_module(db_session, name="ModA")
        mod_b = _make_module(db_session, name="ModB")
        ind_a = _make_indicator(db_session, mod_a, key="a_ind")
        _make_indicator(db_session, mod_b, key="b_ind")

        resp = client.get(f"/api/market-analysis/modules/{mod_a.id}/indicators")
        ids = [i["id"] for i in resp.json()]
        assert ind_a.id in ids
        assert all(i["module_id"] == mod_a.id for i in resp.json())

    def test_returns_all_required_fields(self, client: TestClient, db_session: Session):
        mod = _make_module(db_session, name="FieldIndMod")
        _make_indicator(db_session, mod, key="full_ind")
        resp = client.get(f"/api/market-analysis/modules/{mod.id}/indicators")
        ind = resp.json()[0]
        for field in (
            "id",
            "module_id",
            "key",
            "label",
            "asset_target",
            "tv_symbol",
            "tv_timeframe",
            "timeframe_level",
            "question",
            "answer_bullish",
            "answer_partial",
            "answer_bearish",
            "default_enabled",
            "sort_order",
        ):
            assert field in ind, f"Missing field: {field}"


# ── Tests: GET /api/profiles/{id}/indicator-config ───────────────────────────


class TestGetIndicatorConfig:
    def test_returns_all_indicators_with_defaults(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="ConfigBroker1")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="ConfigMod1")
        i1 = _make_indicator(db_session, mod, key="cfg_default_on", default_enabled=True)
        i2 = _make_indicator(db_session, mod, key="cfg_default_off", default_enabled=False)

        resp = client.get(f"/api/profiles/{profile.id}/indicator-config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["profile_id"] == profile.id

        by_id = {c["indicator_id"]: c["enabled"] for c in data["configs"]}
        assert by_id[i1.id] is True
        assert by_id[i2.id] is False

    def test_returns_404_for_unknown_profile(self, client: TestClient):
        resp = client.get("/api/profiles/99999/indicator-config")
        assert resp.status_code == 404


# ── Tests: PUT /api/profiles/{id}/indicator-config ───────────────────────────


class TestSaveIndicatorConfig:
    def test_saves_toggle_overrides(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="SaveConfigBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="SaveConfigMod")
        i1 = _make_indicator(db_session, mod, key="sc_ind1", default_enabled=True)
        i2 = _make_indicator(db_session, mod, key="sc_ind2", default_enabled=True)

        # Disable i2
        resp = client.put(
            f"/api/profiles/{profile.id}/indicator-config",
            json=[
                {"indicator_id": i1.id, "enabled": True},
                {"indicator_id": i2.id, "enabled": False},
            ],
        )
        assert resp.status_code == 200
        by_id = {c["indicator_id"]: c["enabled"] for c in resp.json()["configs"]}
        assert by_id[i1.id] is True
        assert by_id[i2.id] is False

    def test_upsert_updates_existing(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="UpsertBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="UpsertMod")
        ind = _make_indicator(db_session, mod, key="upsert_ind", default_enabled=True)

        # First PUT: disable
        client.put(
            f"/api/profiles/{profile.id}/indicator-config",
            json=[{"indicator_id": ind.id, "enabled": False}],
        )
        # Second PUT: re-enable
        resp = client.put(
            f"/api/profiles/{profile.id}/indicator-config",
            json=[{"indicator_id": ind.id, "enabled": True}],
        )
        by_id = {c["indicator_id"]: c["enabled"] for c in resp.json()["configs"]}
        assert by_id[ind.id] is True

    def test_returns_404_for_unknown_profile(self, client: TestClient, db_session: Session):
        mod = _make_module(db_session, name="404ConfigMod")
        ind = _make_indicator(db_session, mod, key="404_ind")
        resp = client.put(
            "/api/profiles/99999/indicator-config",
            json=[{"indicator_id": ind.id, "enabled": True}],
        )
        assert resp.status_code == 404


# ── Tests: POST /api/market-analysis/sessions ─────────────────────────────────


class TestCreateSession:
    def test_creates_session_single_asset(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="SessionBroker1")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="SingleMod1", is_dual=False, asset_a="Gold")
        i1 = _make_indicator(
            db_session, mod, key="s1_htf", timeframe_level="htf", asset_target="single"
        )
        i2 = _make_indicator(
            db_session,
            mod,
            key="s1_mtf",
            timeframe_level="mtf",
            asset_target="single",
            sort_order=2,
        )

        resp = client.post(
            "/api/market-analysis/sessions",
            json=_session_payload(profile, mod, [i1, i2], score=2),
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["profile_id"] == profile.id
        assert data["module_id"] == mod.id
        assert len(data["answers"]) == 2

    def test_score_htf_computed_correctly(self, client: TestClient, db_session: Session):
        """2 HTF single indicators, both answered 2 → score_htf_a = 100.00"""
        broker = _make_broker(db_session, name="ScoreBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="ScoreMod", is_dual=False)
        i1 = _make_indicator(
            db_session,
            mod,
            key="sc_htf1",
            timeframe_level="htf",
            asset_target="single",
            sort_order=1,
        )
        i2 = _make_indicator(
            db_session,
            mod,
            key="sc_htf2",
            timeframe_level="htf",
            asset_target="single",
            sort_order=2,
        )

        resp = client.post(
            "/api/market-analysis/sessions",
            json=_session_payload(profile, mod, [i1, i2], score=2),
        )
        data = resp.json()
        assert float(data["score_htf_a"]) == pytest.approx(100.0)
        assert data["bias_htf_a"] == "bullish"

    def test_score_bearish_when_all_zero(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="BearishBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="BearishMod", is_dual=False)
        i1 = _make_indicator(
            db_session, mod, key="bear_htf", timeframe_level="htf", asset_target="single"
        )

        resp = client.post(
            "/api/market-analysis/sessions",
            json=_session_payload(profile, mod, [i1], score=0),
        )
        data = resp.json()
        assert float(data["score_htf_a"]) == pytest.approx(0.0)
        assert data["bias_htf_a"] == "bearish"

    def test_score_neutral_at_50_pct(self, client: TestClient, db_session: Session):
        """1 indicator answered 1 (partial) → 1/(1×2)×100 = 50% → neutral"""
        broker = _make_broker(db_session, name="NeutralBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="NeutralMod", is_dual=False)
        i1 = _make_indicator(
            db_session, mod, key="neut_htf", timeframe_level="htf", asset_target="single"
        )

        resp = client.post(
            "/api/market-analysis/sessions",
            json=_session_payload(profile, mod, [i1], score=1),
        )
        data = resp.json()
        assert float(data["score_htf_a"]) == pytest.approx(50.0)
        assert data["bias_htf_a"] == "neutral"

    def test_dual_module_computes_a_and_b_scores(self, client: TestClient, db_session: Session):
        """Dual module: asset_target 'a' → score_htf_a; 'b' → score_htf_b"""
        broker = _make_broker(db_session, name="DualBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(
            db_session,
            name="DualMod",
            is_dual=True,
            asset_a="BTC",
            asset_b="Alts",
        )
        ia = _make_indicator(
            db_session, mod, key="dual_a_htf", asset_target="a", timeframe_level="htf", sort_order=1
        )
        ib = _make_indicator(
            db_session, mod, key="dual_b_htf", asset_target="b", timeframe_level="htf", sort_order=2
        )

        resp = client.post(
            "/api/market-analysis/sessions",
            json={
                "profile_id": profile.id,
                "module_id": mod.id,
                "answers": [
                    {"indicator_id": ia.id, "score": 2, "answer_label": "YES"},
                    {"indicator_id": ib.id, "score": 0, "answer_label": "NO"},
                ],
            },
        )
        data = resp.json()
        assert float(data["score_htf_a"]) == pytest.approx(100.0)
        assert data["bias_htf_a"] == "bullish"
        assert float(data["score_htf_b"]) == pytest.approx(0.0)
        assert data["bias_htf_b"] == "bearish"

    def test_disabled_indicator_excluded_from_score(self, client: TestClient, db_session: Session):
        """
        2 HTF indicators: i1 default_enabled=True, i2 default_enabled=False.
        Only i1 counts toward the score.
        i1 answered 2, i2 answered 0.
        Expected: score = 2/(1×2)×100 = 100% (i2 ignored).
        """
        broker = _make_broker(db_session, name="DisabledBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="DisabledMod", is_dual=False)
        i1 = _make_indicator(
            db_session, mod, key="dis_on", default_enabled=True, timeframe_level="htf", sort_order=1
        )
        i2 = _make_indicator(
            db_session,
            mod,
            key="dis_off",
            default_enabled=False,
            timeframe_level="htf",
            sort_order=2,
        )

        resp = client.post(
            "/api/market-analysis/sessions",
            json={
                "profile_id": profile.id,
                "module_id": mod.id,
                "answers": [
                    {"indicator_id": i1.id, "score": 2, "answer_label": "YES"},
                    {"indicator_id": i2.id, "score": 0, "answer_label": "NO"},
                ],
            },
        )
        data = resp.json()
        assert float(data["score_htf_a"]) == pytest.approx(100.0)

    def test_returns_null_b_scores_for_single_asset_module(
        self, client: TestClient, db_session: Session
    ):
        broker = _make_broker(db_session, name="NullBBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="NullBMod", is_dual=False)
        ind = _make_indicator(db_session, mod, key="nullb_htf", asset_target="single")

        resp = client.post(
            "/api/market-analysis/sessions",
            json=_session_payload(profile, mod, [ind], score=2),
        )
        data = resp.json()
        assert data["score_htf_b"] is None
        assert data["bias_htf_b"] is None

    def test_rejects_unknown_profile(self, client: TestClient, db_session: Session):
        mod = _make_module(db_session, name="UnkProfMod")
        ind = _make_indicator(db_session, mod, key="unk_prof_ind")
        resp = client.post(
            "/api/market-analysis/sessions",
            json=_session_payload(
                type("P", (), {"id": 99999})(),  # fake profile
                mod,
                [ind],
            ),
        )
        assert resp.status_code == 404

    def test_rejects_indicator_from_wrong_module(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="WrongModBroker")
        profile = _make_profile(db_session, broker)
        mod_a = _make_module(db_session, name="WrongModA")
        mod_b = _make_module(db_session, name="WrongModB")
        ind_b = _make_indicator(db_session, mod_b, key="wrong_ind")

        resp = client.post(
            "/api/market-analysis/sessions",
            json={
                "profile_id": profile.id,
                "module_id": mod_a.id,  # session is for mod_a
                "answers": [
                    {
                        "indicator_id": ind_b.id,
                        "score": 2,
                        "answer_label": "YES",
                    },  # but ind belongs to mod_b
                ],
            },
        )
        assert resp.status_code == 422

    def test_mtf_score_computed_separately_from_htf(self, client: TestClient, db_session: Session):
        """HTF bullish (score=2) + MTF bearish (score=0) → separate scores"""
        broker = _make_broker(db_session, name="TFBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="TFMod", is_dual=False)
        htf = _make_indicator(
            db_session,
            mod,
            key="tf_htf",
            timeframe_level="htf",
            asset_target="single",
            sort_order=1,
        )
        mtf = _make_indicator(
            db_session,
            mod,
            key="tf_mtf",
            timeframe_level="mtf",
            asset_target="single",
            sort_order=2,
        )

        resp = client.post(
            "/api/market-analysis/sessions",
            json={
                "profile_id": profile.id,
                "module_id": mod.id,
                "answers": [
                    {"indicator_id": htf.id, "score": 2, "answer_label": "YES"},
                    {"indicator_id": mtf.id, "score": 0, "answer_label": "NO"},
                ],
            },
        )
        data = resp.json()
        assert float(data["score_htf_a"]) == pytest.approx(100.0)
        assert data["bias_htf_a"] == "bullish"
        assert float(data["score_mtf_a"]) == pytest.approx(0.0)
        assert data["bias_mtf_a"] == "bearish"


# ── Tests: GET /api/market-analysis/sessions ──────────────────────────────────


class TestListSessions:
    def test_returns_sessions(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="ListSessionBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="ListSessionMod")
        ind = _make_indicator(db_session, mod, key="list_ind")

        client.post("/api/market-analysis/sessions", json=_session_payload(profile, mod, [ind]))
        resp = client.get("/api/market-analysis/sessions")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_filters_by_profile(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="FilterProfileBroker")
        p1 = _make_profile(db_session, broker, name="P1")
        p2 = _make_profile(db_session, broker, name="P2")
        mod = _make_module(db_session, name="FilterProfileMod")
        ind = _make_indicator(db_session, mod, key="fp_ind")

        client.post("/api/market-analysis/sessions", json=_session_payload(p1, mod, [ind]))
        client.post("/api/market-analysis/sessions", json=_session_payload(p2, mod, [ind]))

        resp = client.get(f"/api/market-analysis/sessions?profile_id={p1.id}")
        assert all(s["profile_id"] == p1.id for s in resp.json())

    def test_filters_by_module(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="FilterModBroker")
        profile = _make_profile(db_session, broker)
        mod_a = _make_module(db_session, name="FilterModA")
        mod_b = _make_module(db_session, name="FilterModB")
        ia = _make_indicator(db_session, mod_a, key="fm_ia")
        ib = _make_indicator(db_session, mod_b, key="fm_ib")

        client.post("/api/market-analysis/sessions", json=_session_payload(profile, mod_a, [ia]))
        client.post("/api/market-analysis/sessions", json=_session_payload(profile, mod_b, [ib]))

        resp = client.get(f"/api/market-analysis/sessions?module_id={mod_a.id}")
        assert all(s["module_id"] == mod_a.id for s in resp.json())

    def test_pagination(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="PaginBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="PaginMod")
        ind = _make_indicator(db_session, mod, key="pagin_ind")

        for _ in range(3):
            client.post("/api/market-analysis/sessions", json=_session_payload(profile, mod, [ind]))

        resp = client.get(f"/api/market-analysis/sessions?profile_id={profile.id}&limit=2&offset=0")
        assert len(resp.json()) == 2


# ── Tests: GET /api/market-analysis/sessions/{id} ────────────────────────────


class TestGetSession:
    def test_returns_session_with_answers(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="DetailBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="DetailMod")
        i1 = _make_indicator(db_session, mod, key="det_i1", sort_order=1)
        i2 = _make_indicator(db_session, mod, key="det_i2", sort_order=2)

        r = client.post(
            "/api/market-analysis/sessions", json=_session_payload(profile, mod, [i1, i2])
        )
        session_id = r.json()["id"]

        resp = client.get(f"/api/market-analysis/sessions/{session_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == session_id
        assert len(resp.json()["answers"]) == 2

    def test_returns_404_for_unknown_session(self, client: TestClient):
        resp = client.get("/api/market-analysis/sessions/99999")
        assert resp.status_code == 404


# ── Tests: GET /api/profiles/{id}/market-analysis/staleness ──────────────────


class TestStaleness:
    def test_is_stale_when_no_sessions(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="StaleBroker1")
        profile = _make_profile(db_session, broker)
        _make_module(db_session, name="StaleModNoSession")

        resp = client.get(f"/api/profiles/{profile.id}/market-analysis/staleness")
        assert resp.status_code == 200
        stale = next((m for m in resp.json() if m["module_name"] == "StaleModNoSession"), None)
        assert stale is not None
        assert stale["is_stale"] is True
        assert stale["days_old"] is None
        assert stale["last_analyzed_at"] is None

    def test_is_fresh_after_recent_session(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="FreshBroker")
        profile = _make_profile(db_session, broker)
        mod = _make_module(db_session, name="FreshMod")
        ind = _make_indicator(db_session, mod, key="fresh_ind")

        client.post("/api/market-analysis/sessions", json=_session_payload(profile, mod, [ind]))

        resp = client.get(f"/api/profiles/{profile.id}/market-analysis/staleness")
        fresh = next(m for m in resp.json() if m["module_name"] == "FreshMod")
        assert fresh["is_stale"] is False
        assert fresh["days_old"] == 0

    def test_returns_404_for_unknown_profile(self, client: TestClient):
        resp = client.get("/api/profiles/99999/market-analysis/staleness")
        assert resp.status_code == 404

    def test_returns_entry_for_each_active_module(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="AllModBroker")
        profile = _make_profile(db_session, broker)
        _make_module(db_session, name="AllModA")
        _make_module(db_session, name="AllModB")

        resp = client.get(f"/api/profiles/{profile.id}/market-analysis/staleness")
        names = [m["module_name"] for m in resp.json()]
        assert "AllModA" in names
        assert "AllModB" in names
