"""EMA setups: ranking of breakout / retest opportunities and the profile-aware endpoint."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from src.core.models.broker import Profile
from src.ritual.models import RitualPinnedPair
from src.spot_volatility.models import SpotWatchlistSnapshot
from src.volatility.ema_setups import rank_setups, snapshot_age_seconds
from src.volatility.models import WatchlistSnapshot


def _pair(symbol: str, signal: str, vi: float, regime: str = "active") -> dict:
    return {
        "pair": symbol, "vi_score": vi, "regime": regime, "alert": None, "change_24h": 1.5,
        "ema_score": 0.5, "ema_signal": signal, "tf_sup_regime": None, "tf_sup_vi": None,
    }


_MIXED = [
    _pair("PF_AAAUSD", "above_all", 0.9),                       # state, not an event
    _pair("PF_BBBUSD", "retest_up", 0.8),                        # retest
    _pair("PF_CCCUSD", "breakout_up", 0.4),                      # fresh
    _pair("PF_DDDUSD", "retest_after_breakout_up", 0.3),         # prime, lowest VI
    _pair("PF_EEEUSD", "retest_after_breakdown_down", 0.6),      # prime short
    _pair("PF_FFFUSD", "breakdown_down", 0.7),                   # fresh short
    _pair("PF_GGGUSD", "breakout_up", 0.95, regime="dead"),      # dead market → excluded
    _pair("PF_HHHUSD", "mixed", 0.99),
]


class TestRankSetups:
    def test_orders_by_tier_then_volatility(self):
        top, total, prime = rank_setups(_MIXED, long_only=False, top=10)

        assert [r["pair"] for r in top] == [
            "PF_EEEUSD", "PF_DDDUSD",   # prime, higher VI first
            "PF_FFFUSD", "PF_CCCUSD",   # fresh
            "PF_BBBUSD",                # retest
        ]
        assert total == 5 and prime == 2

    def test_states_mixed_and_dead_markets_are_excluded(self):
        top, _, _ = rank_setups(_MIXED, long_only=False, top=10)

        symbols = {r["pair"] for r in top}
        assert not symbols & {"PF_AAAUSD", "PF_GGGUSD", "PF_HHHUSD"}

    def test_long_only_drops_short_setups(self):
        top, total, prime = rank_setups(_MIXED, long_only=True, top=10)

        assert all(r["direction"] == "long" for r in top)
        assert total == 3 and prime == 1

    def test_top_cut_keeps_totals_of_everything_found(self):
        top, total, prime = rank_setups(_MIXED, long_only=False, top=2)

        assert len(top) == 2 and total == 5 and prime == 2

    def test_empty_snapshot(self):
        assert rank_setups([], long_only=False, top=5) == ([], 0, 0)


class TestSnapshotAge:
    def test_naive_timestamps_are_treated_as_utc(self):
        now = datetime(2026, 11, 15, 12, 0, tzinfo=UTC)

        assert snapshot_age_seconds(datetime(2026, 11, 15, 11, 30), now) == 1800

    def test_future_timestamps_do_not_go_negative(self):
        now = datetime(2026, 11, 15, 12, 0, tzinfo=UTC)

        assert snapshot_age_seconds(datetime(2026, 11, 15, 13, 0, tzinfo=UTC), now) == 0


def _profile(db: Session, name: str, account_type: str = "contracts") -> Profile:
    p = Profile(
        name=name, market_type="Crypto", account_type=account_type,
        capital_start=Decimal("1000"), capital_current=Decimal("1000"),
        risk_percentage_default=Decimal("2.0"), max_concurrent_risk_pct=Decimal("10.0"),
    )
    db.add(p)
    db.flush()
    return p


def _snapshot(db: Session, model, tf: str, pairs: list[dict], age_min: int = 5):
    db.add(model(
        name=f"{tf} test", timeframe=tf, regime="active", pairs_count=len(pairs), pairs=pairs,
        generated_at=datetime.now(UTC) - timedelta(minutes=age_min),
    ))
    db.flush()


class TestEmaSetupsEndpoint:
    def test_returns_top_setups_per_timeframe_with_freshness(self, client, db_session):
        profile = _profile(db_session, "Setups")
        _snapshot(db_session, WatchlistSnapshot, "4h", _MIXED, age_min=10)
        _snapshot(db_session, WatchlistSnapshot, "1h", _MIXED, age_min=200)  # older than 1.5 × 1H

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "top": 3, "timeframes": "4h,1h"})

        assert res.status_code == 200
        body = res.json()
        by_tf = {t["timeframe"]: t for t in body["timeframes"]}
        assert [s["pair"] for s in by_tf["4H"]["setups"]] == ["PF_EEEUSD", "PF_DDDUSD", "PF_FFFUSD"]
        assert by_tf["4H"]["total"] == 5 and by_tf["4H"]["prime_total"] == 2
        assert by_tf["4H"]["is_stale"] is False and by_tf["4H"]["age_minutes"] == 10
        assert by_tf["1H"]["is_stale"] is True
        assert body["prime_total"] == 4
        first = by_tf["4H"]["setups"][0]
        assert first["tier"] == "prime" and first["direction"] == "short" and first["ema_ref_period"] == 200

    def test_timeframe_without_snapshot_is_reported_empty(self, client, db_session):
        profile = _profile(db_session, "NoData")

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "1d"})

        tf = res.json()["timeframes"][0]
        assert tf["timeframe"] == "1D" and tf["setups"] == [] and tf["generated_at"] is None

    def test_active_pin_is_exposed_and_expired_pin_is_not(self, client, db_session):
        profile = _profile(db_session, "Pins")
        _snapshot(db_session, WatchlistSnapshot, "4h", _MIXED)
        now = datetime.now(UTC)
        active = RitualPinnedPair(profile_id=profile.id, pair="PF_DDDUSD", timeframe="4H", status="active",
                                  pinned_at=now, expires_at=now + timedelta(hours=5), source="watchlist")
        expired = RitualPinnedPair(profile_id=profile.id, pair="PF_EEEUSD", timeframe="4H", status="active",
                                   pinned_at=now - timedelta(days=9), expires_at=now - timedelta(days=1), source="watchlist")
        other_tf = RitualPinnedPair(profile_id=profile.id, pair="PF_CCCUSD", timeframe="1H", status="active",
                                    pinned_at=now, expires_at=now + timedelta(hours=2), source="watchlist")
        db_session.add_all([active, expired, other_tf])
        db_session.flush()

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "4h"})

        pins = {s["pair"]: s["pin_id"] for s in res.json()["timeframes"][0]["setups"]}
        assert pins["PF_DDDUSD"] == active.id
        assert pins["PF_EEEUSD"] is None
        assert pins["PF_CCCUSD"] is None  # pinned on another timeframe only

    def test_spot_profiles_get_long_setups_from_spot_snapshots_without_1h(self, client, db_session):
        profile = _profile(db_session, "SpotProfile", account_type="spot")
        _snapshot(db_session, SpotWatchlistSnapshot, "4h", _MIXED)
        _snapshot(db_session, WatchlistSnapshot, "1h", _MIXED)

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "1d,4h,1h"})

        body = res.json()
        assert body["is_spot"] is True
        assert [t["timeframe"] for t in body["timeframes"]] == ["1D", "4H"]
        four_h = next(t for t in body["timeframes"] if t["timeframe"] == "4H")
        assert {s["direction"] for s in four_h["setups"]} == {"long"}

    def test_unknown_profile_and_bad_timeframe_are_rejected(self, client, db_session):
        profile = _profile(db_session, "Valid")

        assert client.get("/api/volatility/ema-setups", params={"profile_id": 999999}).status_code == 404
        bad = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "15m"})
        assert bad.status_code == 422
