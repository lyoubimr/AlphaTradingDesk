// Kraken ↔ TradingView symbol normalization — single source of truth.
//
// Kraken uses a handful of non-standard asset tickers that don't match what
// TradingView / the rest of the industry expects. Add new quirks to
// KRAKEN_ASSET_ALIASES only — every caller (table display, .txt export, …)
// picks them up automatically instead of re-implementing ad-hoc replaces.

// Kraken asset code → standard/TradingView ticker (XBT is the only one still
// relevant — Kraken already returns modern tickers like "DOGE" directly).
export const KRAKEN_ASSET_ALIASES: Record<string, string> = {
  XBT: 'BTC',
}

// Kraken Futures perpetual prefixes.
const FUTURES_PREFIXES = ['PF_', 'PI_', 'FF_']

// Known quote currencies, longest-first so e.g. "USDT" matches before "USD".
// NOTE: intentionally excludes rare stablecoins (e.g. "TUSD") whose suffix can
// collide with an aliased base + a common quote (e.g. "XBT" + "USD" also ends
// in "TUSD") — aliased bases are resolved via prefix matching below instead.
const QUOTE_SUFFIXES = [
  'USDT', 'USDC', 'BUSD',
  'USD', 'EUR', 'GBP', 'CAD', 'CHF', 'JPY', 'AUD',
  'BTC', 'ETH',
]

// Alias keys sorted longest-first for deterministic prefix matching.
const ALIAS_KEYS = Object.keys(KRAKEN_ASSET_ALIASES).sort((a, b) => b.length - a.length)

function normalizeAsset(token: string): string {
  return KRAKEN_ASSET_ALIASES[token] ?? token
}

export interface SplitPair {
  base: string
  quote: string
  isPerp: boolean
}

/** Parse an ATD pair string into { base, quote, isPerp }.
 *
 *  'PF_XBTUSD' / 'PI_XBTUSD' → { base: 'BTC', quote: 'USD', isPerp: true }
 *  'XBT/USD'                 → { base: 'BTC', quote: 'USD', isPerp: false }
 *  'XBTUSD'                  → { base: 'BTC', quote: 'USD', isPerp: false }
 *  'ORCAUSD'                 → { base: 'ORCA', quote: 'USD', isPerp: false }
 *  unrecognized quote        → { base: wholeToken, quote: '', isPerp }
 *
 *  Aliased bases (e.g. 'XBT') are matched as a prefix *before* the generic
 *  quote-suffix scan — this avoids ambiguity where an aliased base plus a
 *  quote currency could coincidentally spell another known quote suffix.
 */
export function splitPair(symbol: string): SplitPair {
  let p = symbol.trim().toUpperCase()

  const futuresPrefix = FUTURES_PREFIXES.find((prefix) => p.startsWith(prefix))
  const isPerp = futuresPrefix !== undefined
  if (futuresPrefix) p = p.slice(futuresPrefix.length)

  if (p.includes('/')) {
    const [base, quote] = p.split('/')
    return { base: normalizeAsset(base), quote, isPerp }
  }

  for (const aliasKey of ALIAS_KEYS) {
    if (p.startsWith(aliasKey) && p.length > aliasKey.length) {
      return { base: KRAKEN_ASSET_ALIASES[aliasKey], quote: p.slice(aliasKey.length), isPerp }
    }
  }

  for (const suffix of QUOTE_SUFFIXES) {
    if (p.endsWith(suffix) && p.length > suffix.length) {
      return { base: normalizeAsset(p.slice(0, -suffix.length)), quote: suffix, isPerp }
    }
  }

  return { base: normalizeAsset(p), quote: '', isPerp }
}

/** Legacy-shaped helper kept for existing callers that only need base/quote. */
export function formatPair(symbol: string): { base: string; quote: string } {
  const { base, quote } = splitPair(symbol)
  return { base, quote }
}

/** Convert an ATD pair string to a TradingView symbol.
 *
 *  'XBT/USD'    → 'KRAKEN:BTCUSD'
 *  'PF_ORCAUSD' → 'KRAKEN:ORCAUSD.PM'  (perpetual — .PM suffix)
 *  'PI_XBTUSD'  → 'KRAKEN:BTCUSD.PM'   (perpetual — .PM suffix)
 */
export function toTradingViewSymbol(symbol: string, exchange = 'KRAKEN'): string {
  const { base, quote, isPerp } = splitPair(symbol)
  return `${exchange}:${base}${quote}${isPerp ? '.PM' : ''}`
}
