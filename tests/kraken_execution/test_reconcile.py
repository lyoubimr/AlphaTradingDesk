"""Tests for src/kraken_execution/reconcile.py and fills.py (pure logic, no DB)."""

from decimal import Decimal as D
from types import SimpleNamespace

from src.kraken_execution.fills import aggregate_fills_by_order, is_fully_filled
from src.kraken_execution.reconcile import allocate_to_positions, summarize_account_log


def _entry(info, contract, old, new, pnl=None, fee=None, execution=None, asset="usd", funding=None):
    return {
        "info": info, "contract": contract, "asset": asset, "old_balance": old, "new_balance": new,
        "realized_pnl": pnl, "fee": fee, "execution": execution, "realized_funding": funding,
    }


class TestAggregateFills:
    def test_merges_chunks_with_weighted_price(self):
        fills = [
            {"order_id": "o1", "fill_id": "a", "size": 0.03, "price": 2449.8},
            {"order_id": "o1", "fill_id": "b", "size": 0.041, "price": 2449.7},
            {"order_id": "o1", "fill_id": "c", "size": 0.005, "price": 2449.7},
        ]
        agg = aggregate_fills_by_order(fills)["o1"]
        assert agg["size"] == D("0.076")
        assert agg["fill_id"] == "c"
        assert D("2449.7") < agg["price"] < D("2449.8")

    def test_partial_fill_is_not_fully_filled(self):
        agg = aggregate_fills_by_order([{"order_id": "o1", "fill_id": "a", "size": 0.03, "price": 1}])
        assert not is_fully_filled(agg["o1"], 0.076)
        assert is_fully_filled(agg["o1"], 0.03)


class TestSummarizeAccountLog:
    def test_net_uses_balance_delta_and_splits_fees(self):
        log = [
            _entry("futures trade", "pf_zecusd", 100, 99.99, pnl=0, fee=0.01, execution="e-entry"),
            _entry("futures trade", "pf_zecusd", 99.99, 110.4, pnl=10.45, fee=0.04, execution="e-tp1"),
            _entry("funding rate change", "pf_zecusd", 110.4, 110.39),
            _entry("futures trade", "pf_ethusd", 110.39, 120.0, pnl=9.7, fee=0.09, execution="e-other"),
        ]
        s = summarize_account_log(log, "PF_ZECUSD", {"e-entry": "o-entry", "e-tp1": "o-tp1"})
        assert s.net == D("10.39")
        assert s.gross == D("10.45")
        assert s.fees == D("0.05")
        assert s.funding == D("-0.01")
        assert s.per_order["o-tp1"] == D("10.41")
        assert s.executions == {"e-entry", "e-tp1"}

    def test_includes_unlinked_dust_fill_in_net(self):
        log = [_entry("futures trade", "pf_zecusd", 10, 10.95, pnl=0.961, fee=0.0057, execution="manual")]
        s = summarize_account_log(log, "pf_zecusd", {})
        assert s.net == D("0.95")
        assert s.per_order == {}

    def test_ignores_contract_unit_leg_of_a_fill(self):
        # Kraken logs every fill twice: position size (asset=contract) and cash (asset=usd).
        log = [
            _entry("futures trade", "pf_tiausd", 0.0, -434.3, execution="e1", asset="pf_tiausd"),
            _entry("futures trade", "pf_tiausd", 60.3155, 60.2648, pnl=0.0, fee=0.0507, execution="e1"),
        ]
        s = summarize_account_log(log, "pf_tiausd", {"e1": "o1"})
        assert s.net == D("-0.0507")
        assert s.fees == D("0.0507")

    def test_realized_funding_on_fill_counts_as_funding(self):
        log = [_entry("futures trade", "pf_tiausd", 60.2756, 55.9731, pnl=-4.2331, fee=0.0636, funding=-0.0058, execution="e2")]
        s = summarize_account_log(log, "pf_tiausd", {})
        assert s.funding == D("-0.0058")
        assert s.net == s.gross - s.fees + s.funding


def _pos(pid, num, lot):
    return SimpleNamespace(id=pid, position_number=num, lot_percentage=D(lot))


class TestAllocate:
    def test_tp_fills_direct_and_sl_shared_on_uncovered(self):
        positions = [_pos(1, 1, "55"), _pos(2, 2, "45")]
        out = allocate_to_positions(positions, {1: D("4.86")}, D("4.72"))
        assert out == {1: D("4.86"), 2: D("-0.14")}

    def test_all_covered_shares_remainder_on_last_position(self):
        positions = [_pos(1, 1, "45"), _pos(2, 2, "55")]
        out = allocate_to_positions(positions, {1: D("11.09"), 2: D("21.012")}, D("33.0604"))
        assert sum(out.values()) == D("33.06")
        assert out[1] == D("11.09")

    def test_sum_always_matches_quantized_net(self):
        positions = [_pos(1, 1, "33.33"), _pos(2, 2, "33.33"), _pos(3, 3, "33.34")]
        out = allocate_to_positions(positions, {}, D("-8.8771"))
        assert sum(out.values()) == D("-8.88")


class TestOrderEndReason:
    def test_rejected_triggered_stop(self):
        from src.kraken_execution.fills import find_order_end_reason

        events = [{"event": {"OrderRejected": {
            "order": {"uid": "sl-1"}, "orderError": "insufficient_closing_margin",
            "reason": "stop_order_triggered",
        }}}]
        assert find_order_end_reason(events, "sl-1") == (
            "rejected by Kraken: insufficient_closing_margin (reason: stop_order_triggered)"
        )

    def test_cancelled_and_unknown(self):
        from src.kraken_execution.fills import find_order_end_reason

        events = [{"event": {"OrderCancelled": {
            "order": {"uid": "tp-1"}, "reason": "would_not_reduce_position", "origin": "Rest API",
        }}}]
        assert "would_not_reduce_position" in find_order_end_reason(events, "tp-1")
        assert find_order_end_reason(events, "other") is None
