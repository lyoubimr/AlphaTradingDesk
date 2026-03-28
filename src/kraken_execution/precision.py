"""
src/kraken_execution/precision.py

Lot size quantization for Kraken Futures instruments.

Kraken's `contractValueTradePrecision` field (stored as instruments.contract_value_precision):
  - Positive integer → decimal places (e.g. 4 → min step 0.0001)
  - Negative integer → power-of-ten multiples (e.g. -3 → min step 1000)

All calculations use Decimal — never float — to avoid floating-point rounding errors.

Usage:
    from decimal import Decimal
    from src.kraken_execution.precision import quantize_size

    size = quantize_size(Decimal("0.03754"), precision=4)  # → Decimal("0.0375")
    size = quantize_size(Decimal("42600"), precision=-3)    # → Decimal("42000")
"""

from decimal import Decimal, ROUND_DOWN

from src.kraken_execution import InsufficientSizeError


def min_lot(precision: int) -> Decimal:
    """Return the minimum lot step for a given contractValueTradePrecision.

    Args:
        precision: the contractValueTradePrecision integer from the Kraken API.

    Returns:
        Decimal step size (e.g. 0.0001 for precision=4, 1000 for precision=-3).
    """
    if precision >= 0:
        return Decimal(10) ** -precision
    return Decimal(10) ** abs(precision)


def quantize_size(size: Decimal, precision: int) -> Decimal:
    """Floor a lot size to the nearest valid step for the given instrument precision.

    Always rounds DOWN (ROUND_DOWN) — never sends an order above the requested size.
    Uses only Decimal arithmetic — no float conversions.

    Args:
        size:      requested lot size as Decimal.
        precision: contractValueTradePrecision from instruments table.

    Returns:
        Quantized Decimal lot size (>= 0).

    Raises:
        InsufficientSizeError: if the quantized size is zero (size < min_lot).
    """
    step = min_lot(precision)
    quantized = (size / step).to_integral_value(rounding=ROUND_DOWN) * step
    if quantized <= Decimal("0"):
        raise InsufficientSizeError(
            f"Quantized size is zero: raw={size}, precision={precision}, step={step}. "
            f"Increase position size (minimum: {step})."
        )
    return quantized
