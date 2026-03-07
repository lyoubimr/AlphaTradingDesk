"""
Integration tests for Trade Journal API — Step 6.

  POST   /api/trades
  GET    /api/trades
  GET    /api/trades/{id}
  PUT    /api/trades/{id}
  POST   /api/trades/{id}/close
  POST   /api/trades/{id}/partial
  DELETE /api/trades/{id}

  POST   /api/brokers/{id}/instruments   ← custom instrument creation
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from src.core.models.broker import Broker, Instrument, Profile
from src.core.models.trade import Strategy

# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_broker(db: Session, *, name: str = "TestBroker", market_type: str = "Crypto") -> Broker:
    b = Broker(
        name=name,
        market_type=market_type,
        default_currency="USD",
        is_predefined=True,
        status="active",
    )
    db.add(b)
    db.flush()
    return b


def _make_instrument(
    db: Session,
    broker: Broker,
    *,
    symbol: str = "PF_BTCUSD",
    asset_class: str = "Crypto",
    tick_value: Decimal | None = None,
    max_leverage: int | None = None,
) -> Instrument:
    inst = Instrument(
        broker_id=broker.id,
        symbol=symbol,
        display_name=symbol,
        asset_class=asset_class,
        tick_value=tick_value,
        max_leverage=max_leverage,
        is_active=True,
    )
    db.add(inst)
    db.flush()
    return inst


def _make_profile(
    db: Session,
    broker: Broker | None = None,
    *,
    name: str = "Trader",
    market_type: str = "Crypto",
    capital: Decimal = Decimal("10000"),
) -> Profile:
    p = Profile(
        name=name,
        market_type=market_type,
        broker_id=broker.id if broker else None,
        capital_start=capital,
        capital_current=capital,
        risk_percentage_default=Decimal("2.0"),
        max_concurrent_risk_pct=Decimal("2.0"),
        status="active",
    )
    db.add(p)
    db.flush()
    return p


def _make_strategy(db: Session, profile: Profile, *, name: str = "My Strategy") -> Strategy:
    s = Strategy(profile_id=profile.id, name=name, status="active")
    db.add(s)
    db.flush()
    return s


def _open_payload(
    profile: Profile,
    instrument: Instrument | None = None,
    *,
    pair: str = "BTC/USD",
    direction: str = "long",
    entry: str = "50000",
    sl: str = "49000",
    tp1: str = "52000",
) -> dict:
    return {
        "profile_id": profile.id,
        "instrument_id": instrument.id if instrument else None,
        "pair": pair,
        "direction": direction,
        "entry_price": entry,
        "entry_date": datetime.utcnow().isoformat(),
        "stop_loss": sl,
        "positions": [
            {"position_number": 1, "take_profit_price": tp1, "lot_percentage": "100"},
        ],
    }


# ── Tests: POST /api/brokers/{id}/instruments ─────────────────────────────────


class TestCreateInstrument:
    def test_creates_custom_instrument(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="CustomBroker")
        resp = client.post(
            f"/api/brokers/{broker.id}/instruments",
            json={
                "symbol": "DOGEUSDT",
                "display_name": "Dogecoin",
                "asset_class": "Crypto",
                "tick_value": "0.00001",
            },
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["symbol"] == "DOGEUSDT"
        assert data["is_active"] is True

    def test_rejects_duplicate_symbol(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="DupBroker")
        payload = {"symbol": "PF_XRPUSD", "display_name": "XRP", "asset_class": "Crypto"}
        client.post(f"/api/brokers/{broker.id}/instruments", json=payload)
        resp = client.post(f"/api/brokers/{broker.id}/instruments", json=payload)
        assert resp.status_code == 409

    def test_returns_404_for_unknown_broker(self, client: TestClient):
        resp = client.post(
            "/api/brokers/99999/instruments",
            json={"symbol": "XYZUSD", "display_name": "XYZ", "asset_class": "Crypto"},
        )
        assert resp.status_code == 404

    def test_same_symbol_different_brokers_allowed(self, client: TestClient, db_session: Session):
        b1 = _make_broker(db_session, name="Broker1")
        b2 = _make_broker(db_session, name="Broker2")
        payload = {"symbol": "ETHUSD", "display_name": "Ethereum", "asset_class": "Crypto"}
        r1 = client.post(f"/api/brokers/{b1.id}/instruments", json=payload)
        r2 = client.post(f"/api/brokers/{b2.id}/instruments", json=payload)
        assert r1.status_code == 201
        assert r2.status_code == 201


# ── Tests: POST /api/trades (open) ────────────────────────────────────────────


class TestOpenTrade:
    def test_opens_crypto_trade(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="KrakenOpen")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        resp = client.post("/api/trades", json=_open_payload(profile, inst))

        assert resp.status_code == 201
        data = resp.json()
        assert data["status"] == "open"
        assert data["profile_id"] == profile.id
        assert data["direction"] == "LONG"  # API always returns uppercase direction
        assert len(data["positions"]) == 1
        assert data["positions"][0]["status"] == "open"

    def test_risk_amount_computed_from_capital(self, client: TestClient, db_session: Session):
        # 2% of 10000 = 200
        broker = _make_broker(db_session, name="RiskBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker, capital=Decimal("10000"))

        resp = client.post("/api/trades", json=_open_payload(profile, inst))

        assert resp.status_code == 201
        assert Decimal(resp.json()["risk_amount"]) == Decimal("200.00")

    def test_size_info_present_on_open(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="SizeBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        resp = client.post("/api/trades", json=_open_payload(profile, inst))

        data = resp.json()
        assert data["size_info"] is not None
        assert data["size_info"]["market_type"] == "Crypto"
        assert Decimal(data["size_info"]["units_or_lots"]) > 0

    def test_crypto_units_formula(self, client: TestClient, db_session: Session):
        # units = risk_amount / |entry - sl| = 200 / |50000 - 49000| = 200/1000 = 0.2
        broker = _make_broker(db_session, name="FormulaBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker, capital=Decimal("10000"))

        resp = client.post(
            "/api/trades", json=_open_payload(profile, inst, entry="50000", sl="49000")
        )

        assert Decimal(resp.json()["size_info"]["units_or_lots"]) == Decimal("0.20000000")

    def test_risk_pct_override(self, client: TestClient, db_session: Session):
        # Override risk to 1% → risk_amount = 100 on 10000 capital
        broker = _make_broker(db_session, name="OverrideBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker, capital=Decimal("10000"))

        payload = _open_payload(profile, inst)
        payload["risk_pct_override"] = "1.0"
        resp = client.post("/api/trades", json=payload)

        assert Decimal(resp.json()["risk_amount"]) == Decimal("100.00")

    def test_rejects_invalid_sl_long(self, client: TestClient, db_session: Session):
        # SL above entry for a long → invalid
        broker = _make_broker(db_session, name="SlBrokerL")
        profile = _make_profile(db_session, broker)

        payload = _open_payload(profile, entry="50000", sl="51000")
        resp = client.post("/api/trades", json=payload)
        assert resp.status_code == 422

    def test_rejects_invalid_sl_short(self, client: TestClient, db_session: Session):
        # SL below entry for a short → invalid
        broker = _make_broker(db_session, name="SlBrokerS")
        profile = _make_profile(db_session, broker)

        payload = _open_payload(profile, direction="short", entry="50000", sl="49000")
        resp = client.post("/api/trades", json=payload)
        assert resp.status_code == 422

    def test_rejects_positions_not_summing_100(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="SumBroker")
        profile = _make_profile(db_session, broker)

        payload = _open_payload(profile)
        payload["positions"] = [
            {"position_number": 1, "take_profit_price": "52000", "lot_percentage": "60"},
            {"position_number": 2, "take_profit_price": "54000", "lot_percentage": "30"},
            # 60+30 = 90, not 100
        ]
        resp = client.post("/api/trades", json=payload)
        assert resp.status_code == 422

    def test_rejects_unknown_profile(self, client: TestClient):
        payload = _open_payload(Profile(id=99999, market_type="Crypto"))
        payload["profile_id"] = 99999
        resp = client.post("/api/trades", json=payload)
        assert resp.status_code == 404

    def test_rejects_instrument_from_wrong_broker(self, client: TestClient, db_session: Session):
        broker_a = _make_broker(db_session, name="BrokerA_mismatch")
        broker_b = _make_broker(db_session, name="BrokerB_mismatch")
        inst_b = _make_instrument(db_session, broker_b, symbol="INST_B")
        profile = _make_profile(db_session, broker_a)

        resp = client.post("/api/trades", json=_open_payload(profile, inst_b))
        assert resp.status_code == 422

    def test_multi_tp_positions(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="MultiTPBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        payload = _open_payload(profile, inst)
        payload["positions"] = [
            {"position_number": 1, "take_profit_price": "52000", "lot_percentage": "33"},
            {"position_number": 2, "take_profit_price": "54000", "lot_percentage": "33"},
            {"position_number": 3, "take_profit_price": "56000", "lot_percentage": "34"},
        ]
        resp = client.post("/api/trades", json=payload)

        assert resp.status_code == 201
        assert resp.json()["nb_take_profits"] == 3
        assert len(resp.json()["positions"]) == 3


# ── Tests: GET /api/trades ────────────────────────────────────────────────────


class TestListTrades:
    def test_returns_trades(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="ListBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        client.post("/api/trades", json=_open_payload(profile, inst))
        resp = client.get("/api/trades")

        assert resp.status_code == 200
        assert len(resp.json()) >= 1

    def test_filters_by_profile_id(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="FilterBroker")
        inst = _make_instrument(db_session, broker)
        p1 = _make_profile(db_session, broker, name="P1")
        p2 = _make_profile(db_session, broker, name="P2")

        client.post("/api/trades", json=_open_payload(p1, inst))
        client.post("/api/trades", json=_open_payload(p2, inst))

        resp = client.get(f"/api/trades?profile_id={p1.id}")
        assert all(t["profile_id"] == p1.id for t in resp.json())

    def test_filters_by_status(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="StatusFilterBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        client.post("/api/trades", json=_open_payload(profile, inst))
        resp = client.get("/api/trades?status=open")

        assert all(t["status"] == "open" for t in resp.json())

    def test_does_not_return_deleted_trades(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="DeletedFilterBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        # Open two trades; delete one; only the remaining one should appear
        r1 = client.post("/api/trades", json=_open_payload(profile, inst, pair="BTC/USD"))
        client.post("/api/trades", json=_open_payload(profile, inst, pair="ETH/USD"))
        trade_id = r1.json()["id"]
        client.delete(f"/api/trades/{trade_id}")

        resp = client.get(f"/api/trades?profile_id={profile.id}")
        assert all(t["id"] != trade_id for t in resp.json())

    def test_pagination(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="PaginBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        for _ in range(3):
            client.post("/api/trades", json=_open_payload(profile, inst))

        resp = client.get(f"/api/trades?profile_id={profile.id}&limit=2&offset=0")
        assert len(resp.json()) == 2


# ── Tests: GET /api/trades/{id} ───────────────────────────────────────────────


class TestGetTrade:
    def test_returns_trade_detail(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="DetailBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        r = client.post("/api/trades", json=_open_payload(profile, inst))
        trade_id = r.json()["id"]

        resp = client.get(f"/api/trades/{trade_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == trade_id
        assert "positions" in resp.json()

    def test_returns_404_for_unknown(self, client: TestClient):
        resp = client.get("/api/trades/99999")
        assert resp.status_code == 404


# ── Tests: PUT /api/trades/{id} ───────────────────────────────────────────────


class TestUpdateTrade:
    def test_updates_stop_loss(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="UpdateSLBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        r = client.post("/api/trades", json=_open_payload(profile, inst))
        trade_id = r.json()["id"]

        resp = client.put(f"/api/trades/{trade_id}", json={"stop_loss": "49500"})

        assert resp.status_code == 200
        assert Decimal(resp.json()["stop_loss"]) == Decimal("49500")

    def test_updates_notes(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="NotesBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        r = client.post("/api/trades", json=_open_payload(profile, inst))
        trade_id = r.json()["id"]

        resp = client.put(f"/api/trades/{trade_id}", json={"notes": "RSI divergence"})
        assert resp.status_code == 200
        assert resp.json()["notes"] == "RSI divergence"

    def test_cannot_update_closed_trade(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="ClosedUpdateBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        r = client.post("/api/trades", json=_open_payload(profile, inst))
        trade_id = r.json()["id"]
        client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "51000"})

        resp = client.put(f"/api/trades/{trade_id}", json={"notes": "late update"})
        assert resp.status_code == 422


# ── Tests: POST /api/trades/{id}/close ────────────────────────────────────────


class TestFullClose:
    def test_closes_trade_and_computes_pnl(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="CloseBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker, capital=Decimal("10000"))

        r = client.post(
            "/api/trades", json=_open_payload(profile, inst, entry="50000", sl="49000", tp1="52000")
        )
        trade_id = r.json()["id"]

        resp = client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "52000"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "closed"
        assert data["realized_pnl"] is not None
        assert Decimal(data["realized_pnl"]) > 0

    def test_capital_updated_after_close(self, client: TestClient, db_session: Session):
        """profile.capital_current must reflect realized_pnl after close."""
        broker = _make_broker(db_session, name="CapUpdateBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker, capital=Decimal("10000"))

        r = client.post("/api/trades", json=_open_payload(profile, inst, entry="50000", sl="49000"))
        trade_id = r.json()["id"]

        # Close at a profit
        close_resp = client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "51000"})
        realized_pnl = Decimal(close_resp.json()["realized_pnl"])

        # Fetch updated profile
        db_session.expire(profile)
        db_session.refresh(profile)
        assert profile.capital_current == Decimal("10000") + realized_pnl

    def test_cannot_double_close(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="DoubleCloseBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        r = client.post("/api/trades", json=_open_payload(profile, inst))
        trade_id = r.json()["id"]
        client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "51000"})

        resp = client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "52000"})
        assert resp.status_code == 409

    def test_strategy_stats_incremented_on_win(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="StatsBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)
        strategy = _make_strategy(db_session, profile)

        payload = _open_payload(profile, inst)
        payload["strategy_id"] = strategy.id
        r = client.post("/api/trades", json=payload)
        trade_id = r.json()["id"]
        client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "52000"})

        db_session.expire(strategy)
        db_session.refresh(strategy)
        assert strategy.trades_count == 1
        assert strategy.win_count == 1

    def test_strategy_win_count_not_incremented_on_loss(
        self, client: TestClient, db_session: Session
    ):
        broker = _make_broker(db_session, name="LossBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)
        strategy = _make_strategy(db_session, profile, name="Loss Strategy")

        payload = _open_payload(profile, inst)
        payload["strategy_id"] = strategy.id
        r = client.post("/api/trades", json=payload)
        trade_id = r.json()["id"]

        # Close at a loss (below entry_price for long)
        client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "48000"})

        db_session.expire(strategy)
        db_session.refresh(strategy)
        assert strategy.trades_count == 1
        assert strategy.win_count == 0

    def test_close_loss_decreases_capital(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="LossCapBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker, capital=Decimal("10000"))

        r = client.post("/api/trades", json=_open_payload(profile, inst, entry="50000", sl="49000"))
        trade_id = r.json()["id"]

        close_resp = client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "49000"})
        realized_pnl = Decimal(close_resp.json()["realized_pnl"])

        db_session.expire(profile)
        db_session.refresh(profile)
        assert realized_pnl < 0
        assert profile.capital_current == Decimal("10000") + realized_pnl


# ── Tests: POST /api/trades/{id}/partial ─────────────────────────────────────


class TestPartialClose:
    def _open_3tp(self, client: TestClient, profile: Profile, inst: Instrument) -> dict:
        payload = _open_payload(profile, inst)
        payload["positions"] = [
            {"position_number": 1, "take_profit_price": "51000", "lot_percentage": "33"},
            {"position_number": 2, "take_profit_price": "52000", "lot_percentage": "33"},
            {"position_number": 3, "take_profit_price": "53000", "lot_percentage": "34"},
        ]
        return client.post("/api/trades", json=payload).json()

    def test_partial_close_tp1(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="PartialBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        trade = self._open_3tp(client, profile, inst)
        trade_id = trade["id"]

        resp = client.post(
            f"/api/trades/{trade_id}/partial",
            json={"position_number": 1, "exit_price": "51000"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "partial"
        closed_pos = next(p for p in data["positions"] if p["position_number"] == 1)
        assert closed_pos["status"] == "closed"
        assert Decimal(closed_pos["exit_price"]) == Decimal("51000")
        assert closed_pos["realized_pnl"] is not None

    def test_move_to_be_sets_sl_to_entry(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="BEBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        trade = self._open_3tp(client, profile, inst)
        trade_id = trade["id"]

        resp = client.post(
            f"/api/trades/{trade_id}/partial",
            json={"position_number": 1, "exit_price": "51000", "move_to_be": True},
        )

        data = resp.json()
        assert Decimal(data["stop_loss"]) == Decimal("50000")  # entry_price
        assert Decimal(data["current_risk"]) == Decimal("0")

    def test_current_risk_recalculated_without_be(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="RiskRecalcBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker, capital=Decimal("10000"))

        trade = self._open_3tp(client, profile, inst)
        trade_id = trade["id"]
        original_risk = Decimal(trade["risk_amount"])  # 200.00

        resp = client.post(
            f"/api/trades/{trade_id}/partial",
            json={"position_number": 1, "exit_price": "51000", "move_to_be": False},
        )

        new_risk = Decimal(resp.json()["current_risk"])
        # Position 1 = 33%, remaining = 67% → current_risk ≈ 200 × 0.67 = 134.00
        assert new_risk < original_risk
        assert new_risk > 0

    def test_cannot_partially_close_same_position_twice(
        self, client: TestClient, db_session: Session
    ):
        broker = _make_broker(db_session, name="DoublePartialBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        trade = self._open_3tp(client, profile, inst)
        trade_id = trade["id"]

        client.post(
            f"/api/trades/{trade_id}/partial",
            json={"position_number": 1, "exit_price": "51000"},
        )
        resp = client.post(
            f"/api/trades/{trade_id}/partial",
            json={"position_number": 1, "exit_price": "51500"},
        )
        assert resp.status_code == 409

    def test_returns_404_for_unknown_position(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="UnknownPosBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        r = client.post("/api/trades", json=_open_payload(profile, inst))
        trade_id = r.json()["id"]

        resp = client.post(
            f"/api/trades/{trade_id}/partial",
            json={"position_number": 3, "exit_price": "51000"},  # only 1 position exists
        )
        assert resp.status_code == 404

    def test_full_close_after_partial_sums_all_pnl(self, client: TestClient, db_session: Session):
        """
        Partial close TP1, then full close → realized_pnl = TP1 pnl + TP2 + TP3 pnl.
        """
        broker = _make_broker(db_session, name="SumPnlBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        trade = self._open_3tp(client, profile, inst)
        trade_id = trade["id"]

        client.post(
            f"/api/trades/{trade_id}/partial",
            json={"position_number": 1, "exit_price": "51000"},
        )

        close_resp = client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "52000"})
        data = close_resp.json()

        assert data["status"] == "closed"
        assert Decimal(data["realized_pnl"]) > 0
        # All 3 positions must be closed
        assert all(p["status"] == "closed" for p in data["positions"])


# ── Tests: DELETE /api/trades/{id} ────────────────────────────────────────────


class TestDeleteTrade:
    def test_soft_deletes_open_trade(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="DelBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        # Open two trades so one remains after the delete
        r = client.post("/api/trades", json=_open_payload(profile, inst, pair="BTC/USD"))
        client.post("/api/trades", json=_open_payload(profile, inst, pair="ETH/USD"))
        trade_id = r.json()["id"]

        resp = client.delete(f"/api/trades/{trade_id}")
        assert resp.status_code == 204

        # Trade is no longer in the list
        list_resp = client.get(f"/api/trades?profile_id={profile.id}")
        assert all(t["id"] != trade_id for t in list_resp.json())

    def test_cannot_delete_closed_trade(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="DelClosedBroker")
        inst = _make_instrument(db_session, broker)
        profile = _make_profile(db_session, broker)

        r = client.post("/api/trades", json=_open_payload(profile, inst))
        trade_id = r.json()["id"]
        client.post(f"/api/trades/{trade_id}/close", json={"exit_price": "51000"})

        resp = client.delete(f"/api/trades/{trade_id}")
        assert resp.status_code == 422

    def test_returns_404_for_unknown_trade(self, client: TestClient):
        resp = client.delete("/api/trades/99999")
        assert resp.status_code == 404


# ── Tests: CFD margin warning ─────────────────────────────────────────────────


class TestCFDMarginWarning:
    def test_margin_warning_present_for_cfd(self, client: TestClient, db_session: Session):
        broker = _make_broker(db_session, name="VantageCFD", market_type="CFD")
        inst = _make_instrument(
            db_session,
            broker,
            symbol="XAUUSD",
            asset_class="Commodities",
            tick_value=Decimal("0.01"),
            max_leverage=100,
        )
        profile = _make_profile(db_session, broker, market_type="CFD")

        payload = {
            "profile_id": profile.id,
            "instrument_id": inst.id,
            "pair": "XAUUSD",
            "direction": "long",
            "entry_price": "2000.00",
            "entry_date": datetime.utcnow().isoformat(),
            "stop_loss": "1990.00",
            "positions": [
                {"position_number": 1, "take_profit_price": "2020.00", "lot_percentage": "100"},
            ],
        }
        resp = client.post("/api/trades", json=payload)

        assert resp.status_code == 201
        # margin_warning is a bool — present either way
        assert "margin_warning" in resp.json()["size_info"]
