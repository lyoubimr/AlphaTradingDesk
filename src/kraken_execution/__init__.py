"""
src/kraken_execution — Phase 5: Kraken Futures execution automation.

Responsible for:
  - Placing / cancelling orders on Kraken Futures (HMAC-SHA512 auth)
  - Tracking order lifecycle in kraken_orders table
  - Reconciling open positions via Celery tasks
  - Notifying users on fills, SL hits, TP takes

All per-profile config (API keys, intervals) is stored in automation_settings (JSONB).
Nothing is hardcoded — every business setting comes from the DB.
"""

# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class KrakenAPIError(RuntimeError):
    """Raised when the Kraken Futures API returns a non-2xx response."""

    def __init__(self, status_code: int, body: str) -> None:
        self.status_code = status_code
        self.body = body
        super().__init__(f"Kraken API error {status_code}: {body}")


class InsufficientSizeError(ValueError):
    """Raised when the quantized lot size is below the instrument minimum."""


class ExceedsMaxSizeError(ValueError):
    """Raised when the requested size exceeds the instrument maximum."""


class AutomationNotEnabledError(RuntimeError):
    """Raised when automation action is requested on a non-automated trade."""


class MissingPrecisionError(RuntimeError):
    """Raised when contract_value_precision is NULL (sync_instruments not run yet)."""


class MissingAPIKeysError(RuntimeError):
    """Raised when the profile has no Kraken API keys configured."""
