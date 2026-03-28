"""Tests for src/kraken_execution/precision.py"""

from decimal import Decimal

import pytest

from src.kraken_execution import InsufficientSizeError
from src.kraken_execution.precision import min_lot, quantize_size


class TestMinLot:
    def test_positive_precision_btc(self):
        # PF_XBTUSD: precision=4 → step 0.0001
        assert min_lot(4) == Decimal("0.0001")

    def test_positive_precision_eth(self):
        # PF_ETHUSD: precision=3 → step 0.001
        assert min_lot(3) == Decimal("0.001")

    def test_zero_precision(self):
        # precision=0 → step 1
        assert min_lot(0) == Decimal("1")

    def test_negative_precision_bonk(self):
        # PF_BONKUSD: precision=-3 → step 1000
        assert min_lot(-3) == Decimal("1000")

    def test_negative_precision_small(self):
        # precision=-1 → step 10
        assert min_lot(-1) == Decimal("10")


class TestQuantizeSize:
    def test_btc_precision4_standard(self):
        result = quantize_size(Decimal("0.03754"), precision=4)
        assert result == Decimal("0.0375")

    def test_btc_precision4_exact_multiple(self):
        result = quantize_size(Decimal("0.1000"), precision=4)
        assert result == Decimal("0.1000")

    def test_eth_precision3_rounds_down(self):
        result = quantize_size(Decimal("0.1376"), precision=3)
        assert result == Decimal("0.137")

    def test_bonk_precision_neg3(self):
        # PF_BONKUSD: precision=-3, raw=42600 → floor to nearest 1000 → 42000
        result = quantize_size(Decimal("42600"), precision=-3)
        assert result == Decimal("42000")

    def test_bonk_exact_multiple(self):
        result = quantize_size(Decimal("5000"), precision=-3)
        assert result == Decimal("5000")

    def test_always_rounds_down_not_up(self):
        # 0.0009 with precision=3 (step=0.001) → must floor to 0, but that's zero → error
        # 0.0011 with precision=3 → floor to 0.001 (never round up to 0.002)
        result = quantize_size(Decimal("0.0019"), precision=3)
        assert result == Decimal("0.001")

    def test_zero_size_raises(self):
        with pytest.raises(InsufficientSizeError):
            quantize_size(Decimal("0.00001"), precision=3)  # smaller than min_lot 0.001

    def test_zero_input_raises(self):
        with pytest.raises(InsufficientSizeError):
            quantize_size(Decimal("0"), precision=4)

    def test_large_size_precision4(self):
        result = quantize_size(Decimal("10.12345678"), precision=4)
        assert result == Decimal("10.1234")

    def test_return_type_is_decimal(self):
        result = quantize_size(Decimal("1.5"), precision=2)
        assert isinstance(result, Decimal)
