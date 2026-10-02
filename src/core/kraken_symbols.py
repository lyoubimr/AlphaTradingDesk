"""
Kraken ↔ TradingView symbol normalization — single source of truth.

Kraken uses a handful of non-standard asset tickers (legacy ISO 4217-style
codes) that don't match the ticker TradingView / the rest of the industry
expects. The only one still relevant for the symbols this app deals with is
``XBT`` (Bitcoin) — Kraken never renamed it to ``BTC`` like it did for most
other legacy codes (e.g. ``XDG`` → ``DOGE`` is already returned as ``DOGE``
by Kraken's modern API, no translation needed).

Everything that turns an internal ``pair`` string (as stored on trades /
watchlists / ritual pins) into a human label or a TradingView symbol MUST go
through this module so a new Kraken quirk only needs to be added once, here.
"""

from __future__ import annotations

# Kraken asset code → standard/TradingView ticker. Add new entries here only —
# every caller (display name, TV symbol, …) picks them up automatically.
KRAKEN_ASSET_ALIASES: dict[str, str] = {
    "XBT": "BTC",
}

# Kraken Futures perpetual prefixes (expiring "FF_" futures are intentionally
# excluded from this app's catalogs, but kept here for symbol-parsing safety).
_FUTURES_PREFIXES: tuple[str, ...] = ("PF_", "PI_", "FF_")

# Known quote currencies, longest-first so e.g. "USDT" matches before "USD".
# NOTE: intentionally excludes rare stablecoins (e.g. "TUSD") whose suffix can
# collide with an aliased base + a common quote (e.g. "XBT" + "USD" also ends
# in "TUSD") — aliased bases are resolved via prefix matching below instead.
_QUOTE_SUFFIXES: tuple[str, ...] = (
    "USDT", "USDC", "BUSD",
    "USD", "EUR", "GBP", "CAD", "CHF", "JPY", "AUD",
    "BTC", "ETH",
)

# Alias keys sorted longest-first for deterministic prefix matching.
_ALIAS_KEYS: tuple[str, ...] = tuple(
    sorted(KRAKEN_ASSET_ALIASES, key=len, reverse=True)
)


def _normalize_asset(token: str) -> str:
    """Map a Kraken asset code to its standard ticker (no-op if not aliased)."""
    return KRAKEN_ASSET_ALIASES.get(token, token)


def split_pair(pair: str) -> tuple[str, str, bool]:
    """Parse an ATD pair string into (base, quote, is_perpetual).

    Handles:
      'PF_XBTUSD' / 'PI_XBTUSD' → ('BTC', 'USD', True)
      'XBT/USD'                 → ('BTC', 'USD', False)
      'XBTUSD'                  → ('BTC', 'USD', False)
      'ORCAUSD'                 → ('ORCA', 'USD', False)
      unrecognized quote        → (whole token, '', False)

    Aliased bases (e.g. 'XBT') are matched as a prefix *before* the generic
    quote-suffix scan — this avoids ambiguity where an aliased base plus a
    quote currency could coincidentally spell another known quote suffix.
    """
    p = pair.strip().upper()

    is_perp = p.startswith(_FUTURES_PREFIXES)
    if is_perp:
        p = p[3:]

    if "/" in p:
        base, _, quote = p.partition("/")
        return _normalize_asset(base), quote, is_perp

    for alias_key in _ALIAS_KEYS:
        if p.startswith(alias_key) and len(p) > len(alias_key):
            return KRAKEN_ASSET_ALIASES[alias_key], p[len(alias_key):], is_perp

    for suffix in _QUOTE_SUFFIXES:
        if p.endswith(suffix) and len(p) > len(suffix):
            base = p[: -len(suffix)]
            return _normalize_asset(base), suffix, is_perp

    return _normalize_asset(p), "", is_perp


def display_name(pair: str) -> str:
    """Short human-readable label, e.g. 'PI_XBTUSD' → 'BTC', 'PF_ORCAUSD' → 'ORCA'."""
    base, _quote, _is_perp = split_pair(pair)
    return base


def to_tv_symbol(pair: str, exchange: str = "KRAKEN") -> str:
    """Convert an ATD pair string to a TradingView symbol.

    'XBT/USD'    → 'KRAKEN:BTCUSD'
    'ETH/BTC'    → 'KRAKEN:ETHBTC'
    'PF_ORCAUSD' → 'KRAKEN:ORCAUSD.PM'  (perpetual — .PM suffix)
    'PI_XBTUSD'  → 'KRAKEN:BTCUSD.PM'   (perpetual — .PM suffix)
    """
    base, quote, is_perp = split_pair(pair)
    suffix = ".PM" if is_perp else ""
    return f"{exchange}:{base}{quote}{suffix}"
