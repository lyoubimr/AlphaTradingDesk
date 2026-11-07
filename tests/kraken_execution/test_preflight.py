"""
tests/kraken_execution/test_preflight.py

Margin pre-check (nearest allowed position + explanatory message) and the
tighter-band close fallback used when Kraken refuses a close for margin.
"""

from __future__ import annotations

from decimal import Decimal as D
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from src.kraken_execution import PreflightMarginError
from src.kraken_execution.preflight import check_entry_margin, format_margin_error
from src.kraken_execution.service import (
    _send_close_with_margin_fallback,
    open_automated_trade,
    update_automation_settings,
)

# DOGE trade 158 (2026-11-07): 12 214 units, entry 0.073, SL 0.07179, x10, 100.1155 available.
_DOGE = dict(
    available=D("100.1155"),
    lot=D("12214"),
    entry=D("0.07279"),
    stop_loss=D("0.07179"),
    leverage=D("10"),
    buffer_pct=D("10"),
)


class TestCheckEntryMargin:
    def test_doge_incident_is_blocked_on_the_stop_condition(self):
        check = check_entry_margin(**_DOGE)

        assert not check.ok
        assert check.binding == "stop"
        assert check.shortfall > 0
        # free margin after entry (~11) cannot cover the 12.21 planned loss + reserve
        assert check.risk_at_stop == D("12214") * D("0.001")

    def test_max_lot_is_close_to_requested_and_passes(self):
        check = check_entry_margin(**_DOGE)

        assert D("11000") < check.max_lot_raw < D("12214")
        retry = check_entry_margin(**{**_DOGE, "lot": check.max_lot_raw})
        assert retry.ok
        assert retry.shortfall == 0

    def test_plenty_of_margin_passes(self):
        assert check_entry_margin(**{**_DOGE, "available": D("500")}).ok

    def test_entry_buffer_binds_with_a_distant_stop_free_account(self):
        # tiny risk (SL almost at entry): the safety buffer on margin is the limit
        check = check_entry_margin(**{**_DOGE, "stop_loss": D("0.07278"), "available": D("90")})

        assert not check.ok
        assert check.binding == "entry"

    def test_without_stop_loss_only_entry_and_reserve_apply(self):
        check = check_entry_margin(**{**_DOGE, "stop_loss": None})

        assert check.risk_at_stop == 0


class TestFormatMarginError:
    def _message(self, **over):
        check = check_entry_margin(**_DOGE)
        args = dict(
            symbol="PF_DOGEUSD", lot=D("12214"), max_lot=D("11731"), entry=D("0.07279"),
            stop_loss=D("0.07179"), leverage=D("10"), buffer_pct=D("10"),
        )
        args.update(over)
        return format_margin_error(check, **args)

    def test_stop_message_explains_the_cause_and_the_nearest_position(self):
        msg = self._message()

        assert "could not survive its own stop-loss" in msg
        assert "insufficient closing margin" in msg
        assert "Largest position that passes: 11,731 units of PF_DOGEUSD" in msg
        assert "How to fix" in msg
        assert "Lower this trade's risk to about" in msg
        assert "deposit at least" in msg

    def test_entry_message_shows_needed_vs_available(self):
        check = check_entry_margin(**{**_DOGE, "stop_loss": D("0.07278"), "available": D("90")})
        msg = format_margin_error(
            check, symbol="PF_DOGEUSD", lot=D("12214"), max_lot=D("10000"), entry=D("0.07279"),
            stop_loss=D("0.07278"), leverage=D("10"), buffer_pct=D("10"),
        )

        assert "not enough free margin" in msg
        assert "Needed:" in msg and "Available on Kraken: 90.00 USD" in msg
        assert "10% safety buffer" in msg

    def test_no_valid_size_asks_for_a_deposit(self):
        msg = self._message(max_lot=None)

        assert "Even the smallest order does not fit" in msg
        assert "Deposit at least" in msg

    def test_message_does_not_contain_raw_kraken_codes_that_get_rewritten(self):
        # the router rewrites any body containing these codes with a generic hint
        msg = self._message()

        for code in ("insufficientFunds", "wouldCauseLiquidation", "insufficientClosingMargin"):
            assert code not in msg


class TestCloseMarginFallback:
    def _client(self, statuses: list[str]) -> MagicMock:
        client = MagicMock()
        client.send_order.side_effect = [
            {"sendStatus": {"status": s, "order_id": f"o{i}"}} for i, s in enumerate(statuses)
        ]
        client.get_tickers.return_value = {
            "PF_DOGEUSD": {"markPrice": 0.0719, "bid": 0.07189, "ask": 0.07191, "last": 0.0719}
        }
        return client

    def test_ordinary_close_is_untouched(self):
        client = self._client(["placed"])

        result = _send_close_with_margin_fallback(client, symbol="PF_DOGEUSD", side="sell", size="12214")

        assert result["sendStatus"]["status"] == "placed"
        assert client.send_order.call_count == 1
        assert client.send_order.call_args.kwargs["order_type"] == "mkt"

    def test_retries_as_tighter_reduce_only_ioc_below_mark_for_a_sell(self):
        client = self._client(["insufficientClosingMargin", "placed"])

        result = _send_close_with_margin_fallback(client, symbol="PF_DOGEUSD", side="sell", size="12214")

        assert result["sendStatus"]["status"] == "placed"
        retry = client.send_order.call_args_list[1].kwargs
        assert retry["order_type"] == "ioc"
        assert retry["reduce_only"] is True
        assert D(retry["limit_price"]) == D("0.07154")  # 0.0719 * (1 - 0.5%) rounded down to the tick

    def test_walks_down_the_ladder_then_gives_up_with_the_last_rejection(self):
        client = self._client(["insufficientClosingMargin", "insufficientClosingMargin", "iocWouldNotExecute"])

        result = _send_close_with_margin_fallback(client, symbol="PF_DOGEUSD", side="sell", size="12214")

        assert result["sendStatus"]["status"] == "iocWouldNotExecute"
        assert client.send_order.call_count == 3

    def test_buy_side_limits_sit_above_the_mark(self):
        client = self._client(["insufficientClosingMargin", "placed"])

        _send_close_with_margin_fallback(client, symbol="PF_DOGEUSD", side="buy", size="100")

        assert D(client.send_order.call_args_list[1].kwargs["limit_price"]) > D("0.0719")

    def test_other_rejections_are_not_retried(self):
        client = self._client(["wouldNotReducePosition"])

        result = _send_close_with_margin_fallback(client, symbol="PF_DOGEUSD", side="sell", size="1")

        assert result["sendStatus"]["status"] == "wouldNotReducePosition"
        assert client.send_order.call_count == 1


class _FakeKraken:
    def __init__(self, available: float):
        self._available = available
        self.send_order = MagicMock()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def get_accounts_summary(self):
        return {"accounts": {"flex": {"availableMargin": self._available, "initialMargin": 0, "portfolioValue": self._available}}}

    def get_open_orders(self):
        return []

    def get_open_positions(self):
        return []

    def set_leverage_preferences(self, **_):
        pass


class TestOpenAutomatedTradePreflight:
    def test_blocks_before_any_order_and_explains(self, db_session: Session, monkeypatch: pytest.MonkeyPatch):
        from tests.kraken_execution.test_service import _setup_trade_for_sl_test  # noqa: PLC0415

        profile, _instr, trade = _setup_trade_for_sl_test(db_session, name_suffix="Preflight")
        # lot = 15 / 1000 = 0.015 -> margin 60, risk 15, reserve ~2.1 -> needs ~77.1
        update_automation_settings(profile.id, {"enabled": True, "preflight_margin_buffer_pct": 10}, db_session)
        fake = _FakeKraken(available=70.0)
        monkeypatch.setattr("src.kraken_execution.service._make_client", lambda _row: fake)

        with pytest.raises(PreflightMarginError) as exc:
            open_automated_trade(trade.id, db_session)

        fake.send_order.assert_not_called()
        msg = exc.value.body
        assert "could not survive its own stop-loss" in msg
        assert "Largest position that passes: 0.0136 units of PF_XBTUSD" in msg
        assert "How to fix" in msg
