"""EMA setups: ranking of breakout / retest opportunities and the profile-aware endpoint."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from src.core.models.broker import Profile
from src.ritual.models import RitualPinnedPair
from src.spot_volatility.models import SpotWatchlistSnapshot
from src.volatility.ema_setups import (
    assess_outcome,
    build_timeline,
    rank_setups,
    snapshot_age_seconds,
)
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


_T0 = datetime(2026, 11, 15, 6, 0, tzinfo=UTC)


def _at(hours: int) -> datetime:
    return _T0 + timedelta(hours=hours)


class TestBuildTimeline:
    def _entry(self, timeline: list[dict], pair: str, direction: str) -> dict:
        return next(e for e in timeline if e["pair"] == pair and e["direction"] == direction)

    def test_lifecycle_path_and_streak_of_an_active_setup(self):
        timeline = build_timeline(
            [
                (_at(0), [_pair("PF_AAAUSD", "breakout_up", 0.5)]),
                (_at(1), [_pair("PF_AAAUSD", "retest_after_breakout_up", 0.5)]),
                (_at(2), [_pair("PF_AAAUSD", "retest_after_breakout_up", 0.5)]),
            ],
            long_only=False,
        )

        e = self._entry(timeline, "PF_AAAUSD", "long")
        assert e["active"] is True
        assert e["path"] == ["breakout_up", "retest_after_breakout_up"]
        assert e["times_seen"] == 3 and e["best_tier"] == "prime"
        assert e["streak_start"] == _at(0) and e["last_seen"] == _at(2)

    def test_setup_that_disappeared_is_not_active(self):
        timeline = build_timeline(
            [(_at(0), [_pair("PF_BBBUSD", "breakout_up", 0.5)]), (_at(1), [_pair("PF_BBBUSD", "mixed", 0.5)])],
            long_only=False,
        )

        e = self._entry(timeline, "PF_BBBUSD", "long")
        assert e["active"] is False and e["last_seen"] == _at(0)

    def test_a_gap_restarts_the_streak(self):
        timeline = build_timeline(
            [
                (_at(0), [_pair("PF_CCCUSD", "breakout_up", 0.5)]),
                (_at(1), [_pair("PF_CCCUSD", "mixed", 0.5)]),
                (_at(2), [_pair("PF_CCCUSD", "breakout_up", 0.5)]),
            ],
            long_only=False,
        )

        e = self._entry(timeline, "PF_CCCUSD", "long")
        assert e["active"] is True and e["times_seen"] == 2
        assert e["streak_start"] == _at(2) and e["first_seen"] == _at(0)

    def test_a_direction_flip_creates_two_entries(self):
        timeline = build_timeline(
            [(_at(0), [_pair("PF_DDDUSD", "breakout_up", 0.5)]), (_at(1), [_pair("PF_DDDUSD", "breakdown_down", 0.5)])],
            long_only=False,
        )

        assert self._entry(timeline, "PF_DDDUSD", "long")["active"] is False
        assert self._entry(timeline, "PF_DDDUSD", "short")["active"] is True

    def test_long_only_and_dead_markets_are_ignored(self):
        timeline = build_timeline(
            [(_at(0), [_pair("PF_EEEUSD", "breakdown_down", 0.5), _pair("PF_FFFUSD", "breakout_up", 0.5, regime="dead")])],
            long_only=True,
        )

        assert timeline == []


class TestAssessOutcome:
    @pytest.mark.parametrize(
        ("direction", "signal", "expected"),
        [
            ("long", "above_all", "holding"),
            ("long", "retest_up", "holding"),
            ("long", "below_all", "failed"),
            ("long", "breakdown_down", "failed"),
            ("long", "mixed", "neutral"),
            ("short", "below_all", "holding"),
            ("short", "breakout_up", "failed"),
            ("short", "mixed", "neutral"),
            ("long", None, "unknown"),
        ],
    )
    def test_follow_through_is_judged_from_the_current_signal(self, direction, signal, expected):
        assert assess_outcome(direction, signal) == expected


class TestEmaSetupsHistory:
    def test_earlier_setups_with_outcome_and_active_lifecycle(self, client, db_session):
        profile = _profile(db_session, "History")
        # oldest → newest: AAA goes breakout → prime (still active); BBB breaks out then holds above all;
        # CCC breaks out then loses the EMA
        _snapshot(db_session, WatchlistSnapshot, "1h", [
            _pair("PF_AAAUSD", "breakout_up", 0.5), _pair("PF_BBBUSD", "breakout_up", 0.5), _pair("PF_CCCUSD", "breakout_up", 0.5),
        ], age_min=180)
        _snapshot(db_session, WatchlistSnapshot, "1h", [
            _pair("PF_AAAUSD", "retest_after_breakout_up", 0.5), _pair("PF_BBBUSD", "above_all", 0.5), _pair("PF_CCCUSD", "below_all", 0.5),
        ], age_min=5)

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "1h"})

        tf = res.json()["timeframes"][0]
        assert tf["history_hours"] == 24
        active = tf["setups"][0]
        assert active["pair"] == "PF_AAAUSD" and active["path"] == ["breakout_up", "retest_after_breakout_up"]
        assert active["since"] is not None
        earlier = {e["pair"]: e for e in tf["earlier"]}
        assert tf["earlier_total"] == 2 and set(earlier) == {"PF_BBBUSD", "PF_CCCUSD"}
        assert earlier["PF_BBBUSD"]["outcome"] == "holding" and earlier["PF_BBBUSD"]["current_signal"] == "above_all"
        assert earlier["PF_CCCUSD"]["outcome"] == "failed"
        assert earlier["PF_BBBUSD"]["best_tier"] == "fresh" and earlier["PF_BBBUSD"]["times_seen"] == 1

    def test_pair_missing_from_latest_snapshot_has_unknown_outcome(self, client, db_session):
        profile = _profile(db_session, "Unknown")
        _snapshot(db_session, WatchlistSnapshot, "4h", [_pair("PF_AAAUSD", "breakout_up", 0.5)], age_min=300)
        _snapshot(db_session, WatchlistSnapshot, "4h", [_pair("PF_ZZZUSD", "mixed", 0.5)], age_min=5)

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "4h"})

        assert res.json()["timeframes"][0]["earlier"][0]["outcome"] == "unknown"

    def test_history_window_is_24h_for_1h_and_5_days_for_1d(self, client, db_session):
        profile = _profile(db_session, "Window")
        _snapshot(db_session, WatchlistSnapshot, "1h", [_pair("PF_OLDUSD", "breakout_up", 0.5)], age_min=26 * 60)
        _snapshot(db_session, WatchlistSnapshot, "1h", [_pair("PF_NEWUSD", "mixed", 0.5)], age_min=5)
        _snapshot(db_session, WatchlistSnapshot, "1d", [_pair("PF_DAYUSD", "breakout_up", 0.5)], age_min=4 * 24 * 60)
        _snapshot(db_session, WatchlistSnapshot, "1d", [_pair("PF_NEWUSD", "mixed", 0.5)], age_min=5)

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "1h,1d"})

        by_tf = {t["timeframe"]: t for t in res.json()["timeframes"]}
        assert by_tf["1H"]["earlier"] == []
        assert [e["pair"] for e in by_tf["1D"]["earlier"]] == ["PF_DAYUSD"]
        assert by_tf["1D"]["history_hours"] == 120

    def test_history_top_zero_disables_the_history(self, client, db_session):
        profile = _profile(db_session, "NoHistory")
        _snapshot(db_session, WatchlistSnapshot, "4h", [_pair("PF_AAAUSD", "breakout_up", 0.5)], age_min=300)
        _snapshot(db_session, WatchlistSnapshot, "4h", [_pair("PF_BBBUSD", "breakout_up", 0.5)], age_min=5)

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "4h", "history_top": 0})

        tf = res.json()["timeframes"][0]
        assert tf["earlier"] == [] and tf["history_hours"] == 0
        assert [s["pair"] for s in tf["setups"]] == ["PF_BBBUSD"] and tf["setups"][0]["since"] is None

    def test_earlier_setups_are_most_recent_first_and_can_be_pinned(self, client, db_session):
        profile = _profile(db_session, "Order")
        _snapshot(db_session, WatchlistSnapshot, "4h", [_pair("PF_AAAUSD", "breakout_up", 0.5)], age_min=400)
        _snapshot(db_session, WatchlistSnapshot, "4h", [_pair("PF_BBBUSD", "retest_down", 0.5)], age_min=200)
        _snapshot(db_session, WatchlistSnapshot, "4h", [_pair("PF_ZZZUSD", "mixed", 0.5)], age_min=5)
        now = datetime.now(UTC)
        pin = RitualPinnedPair(profile_id=profile.id, pair="PF_AAAUSD", timeframe="4H", status="active",
                               pinned_at=now, expires_at=now + timedelta(hours=5), source="watchlist")
        db_session.add(pin)
        db_session.flush()

        res = client.get("/api/volatility/ema-setups", params={"profile_id": profile.id, "timeframes": "4h"})

        earlier = res.json()["timeframes"][0]["earlier"]
        assert [e["pair"] for e in earlier] == ["PF_BBBUSD", "PF_AAAUSD"]
        assert earlier[0]["direction"] == "short" and earlier[0]["best_tier"] == "retest"
        assert earlier[1]["pin_id"] == pin.id
