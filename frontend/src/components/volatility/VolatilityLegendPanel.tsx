// ── VolatilityLegendPanel ────────────────────────────────────────────────────
// Shared legend panel used in WatchlistsPage and MarketVIPage.
// Explains: Volatility Index formula · Regimes · EMA Signals · TF+1 · EMA ref per TF

import { useRef, useEffect } from 'react'
import { X } from 'lucide-react'

const REGIME_COLOR_HEX: Record<string, string> = {
  DEAD:     '#a1a1aa',
  CALM:     '#0ea5e9',
  NORMAL:   '#10b981',
  TRENDING: '#818cf8',  // indigo-400 — gem color — sweet spot trading regime
  ACTIVE:   '#f59e0b',
  EXTREME:  '#ef4444',
}

const REGIME_EMOJI: Record<string, string> = {
  DEAD:     '⬜',
  CALM:     '💧',
  NORMAL:   '📊',
  TRENDING: '💎',
  ACTIVE:   '⚠️',
  EXTREME:  '🚫',
}

const EMA_DISPLAY: Record<string, { label: string; color: string; symbol: string }> = {
  above_all:      { label: 'Above All',   color: '#10b981', symbol: '▲'  },
  below_all:      { label: 'Below All',   color: '#ef4444', symbol: '▼'  },
  breakout_up:    { label: 'Breakout ↑',  color: '#0ea5e9', symbol: '🚀' },
  breakdown_down: { label: 'Breakdown ↓', color: '#f97316', symbol: '💥' },
  retest_up:      { label: 'Retest ↑',    color: '#a855f7', symbol: '🔄' },
  retest_down:    { label: 'Retest ↓',    color: '#c084fc', symbol: '🔁' },
  mixed:          { label: 'Mixed',       color: '#71717a', symbol: '∿'  },
}

export function VolatilityLegendPanel({
  onClose,
  variant = 'market',
}: {
  onClose: () => void
  /** 'market' — full panel with Volatility Indicators section (default).
   *  'watchlist' — Regimes & EMA only, no Volatility Indicators section. */
  variant?: 'market' | 'watchlist'
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const title = variant === 'watchlist'
    ? 'Legend — Regimes & EMA Signals'
    : 'Indicators — Volatility & Regimes'

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 z-50 w-[540px] max-h-[80vh] overflow-y-auto
        bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <span className="text-sm font-semibold text-zinc-200">{title}</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-5">

        {/* ── Volatility Indicators — market variant only ── */}
        {variant === 'market' && <div>
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Volatility Indicators</p>
          <div className="space-y-2.5">
            {([
              {
                key: 'RVOL',
                full: 'Relative Volume',
                color: '#0ea5e9',
                desc: 'Current bar volume vs the 20-bar average. High RVOL = unusual activity — buyers or sellers are stepping in with conviction. Low RVOL = thin, unconvincing moves.'
              },
              {
                key: 'MFI',
                full: 'Money Flow Index',
                color: '#a855f7',
                desc: 'RSI-like oscillator weighted by volume. Captures buying vs selling pressure. High MFI = money flowing in (bullish pressure). Low MFI = money flowing out (selling pressure).'
              },
              {
                key: 'ATR%',
                full: 'Average True Range %',
                color: '#f59e0b',
                desc: 'Average candle range as % of price over 14 bars, normalised vs its own 100-bar history. High ATR% = wide, volatile candles — large swings. Low ATR% = compressed price action, potential squeeze.'
              },
              {
                key: 'BB Width',
                full: 'Bollinger Band Width',
                color: '#10b981',
                desc: '(Upper band − Lower band) / Middle band over 20 bars, normalised vs its own history. Expands during high volatility, contracts into squeezes. A squeeze followed by BB expansion = potential breakout signal.'
              },
              {
                key: 'EMA Score',
                full: 'EMA Alignment Score',
                color: '#818cf8',
                desc: 'Directional score (0–1) based on price position vs EMA 20 / 50 / 200 (weights: 50% / 30% / 20%). 1.0 = above all EMAs (full bull). 0.0 = below all. NOT included in VI — stored for context and watchlist ranking only.'
              },
            ] as const).map(({ key, full, color, desc }) => (
              <div key={key} className="flex gap-3">
                <div className="w-20 shrink-0">
                  <span className="font-mono font-bold text-[11px]" style={{ color }}>{key}</span>
                  <p className="text-[10px] text-zinc-600 leading-tight">{full}</p>
                </div>
                <p className="text-zinc-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-zinc-600">
            VI = mean(RVOL, MFI, ATR%, BB Width) — each normalised 0–1. EMA Score excluded from average.
          </p>
        </div>}

        {/* Regimes */}
        <div>
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-2">Regimes (based on VI score)</p>
          <div className="space-y-1.5">
            {([
              { r: 'DEAD',     range: '0 – 17',   desc: 'Market asleep. No meaningful volatility. Stay flat — zero edge. Avoid all entries.' },
              { r: 'CALM',     range: '17 – 33',  desc: 'Low momentum. Very tight ranges. Reduce position size significantly, scalp only if confluent.' },
              { r: 'NORMAL',   range: '33 – 50',  desc: 'Standard market conditions. Apply your usual strategy with normal sizing.' },
              { r: 'TRENDING', range: '50 – 67',  desc: 'Strong directional momentum. Favour trend-following entries, wider targets.' },
              { r: 'ACTIVE',   range: '67 – 83',  desc: 'High activity. Frequent breakouts. Use tighter stop-losses, expect fast moves.' },
              { r: 'EXTREME',  range: '83 – 100', desc: 'Extreme volatility spike. Minimise exposure, widen stops or skip. News/event driven.' },
            ] as const).map(({ r, range, desc }) => (
              <div key={r} className="flex gap-3">
                <div className="w-28 shrink-0 flex items-center gap-1.5">
                  <span className="text-base leading-none">{REGIME_EMOJI[r]}</span>
                  <span className="font-mono font-bold text-[11px]" style={{ color: REGIME_COLOR_HEX[r] }}>{r}</span>
                </div>
                <div>
                  <span className="font-mono text-zinc-500 mr-2">{range}</span>
                  <span className="text-zinc-400">{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* EMA Signals */}
        <div>
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">EMA Signals</p>
          <p className="text-zinc-600 mb-2">
            Scoring EMAs: <span className="font-mono text-zinc-400">20 (50%) · 50 (30%) · 200 (20%)</span> — determine the directional score (0–1).<br />
            Signal detection uses the <strong className="text-zinc-300">reference EMA per TF</strong>:{' '}
            <span className="font-mono text-zinc-400">EMA 50</span> on 15m ·{' '}
            <span className="font-mono text-zinc-400">EMA 100</span> on 1h ·{' '}
            <span className="font-mono text-zinc-400">EMA 200</span> on 4h / 1d ·{' '}
            <span className="font-mono text-zinc-400">EMA 50</span> on 1w.{' '}
            Configurable in <em>Settings → Volatility</em>.
          </p>
          <div className="space-y-2">
            {([
              { sig: 'above_all',      action: 'LONG BIAS',    detail: 'Price is above EMA 20, 50 AND 200 (all scoring EMAs). Full bullish alignment — all moving averages confirm uptrend. Strong long bias.' },
              { sig: 'below_all',      action: 'SHORT BIAS',   detail: 'Price is below EMA 20, 50 AND 200 (all scoring EMAs). Full bearish alignment — all moving averages confirm downtrend. Strong short bias.' },
              { sig: 'breakout_up',    action: 'MOMENTUM ↑',   detail: 'Price crossed ABOVE the reference EMA within the last 3 candles. Ref EMA: 50 (15m) · 100 (1h) · 200 (4h/1d) · 50 (1w). Fresh bullish momentum — look for volume confirmation.' },
              { sig: 'breakdown_down', action: 'MOMENTUM ↓',   detail: 'Price crossed BELOW the reference EMA within the last 3 candles. Ref EMA: 50 (15m) · 100 (1h) · 200 (4h/1d) · 50 (1w). Fresh bearish momentum — look for volume confirmation.' },
              { sig: 'retest_up',      action: 'SUPPORT TEST', detail: 'Price is ≤ 0.5% above the reference EMA — testing it as support from above. Ref per TF: 50 (15m) · 100 (1h) · 200 (4h/1d) · 50 (1w). Classic long entry zone if price bounces. Confluence with higher TF bias needed.' },
              { sig: 'retest_down',    action: 'RESIST TEST',  detail: 'Price is ≤ 0.5% below the reference EMA — testing it as resistance from below. Ref per TF: 50 (15m) · 100 (1h) · 200 (4h/1d) · 50 (1w). Classic short entry zone if price rejects. Confluence with higher TF bias needed.' },
              { sig: 'mixed',          action: 'NO SIGNAL',    detail: 'Price position is ambiguous relative to the 3 scoring EMAs (20 / 50 / 200) — some above, some below. No clear directional edge. Wait for cleaner alignment.' },
            ] as const).map(({ sig, action, detail }) => {
              const ema = EMA_DISPLAY[sig]
              return (
                <div key={sig} className="flex gap-3">
                  <div className="w-36 shrink-0">
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: ema.color }}>{ema.symbol}</span>
                      <span className="font-mono font-semibold" style={{ color: ema.color }}>{ema.label}</span>
                    </div>
                    <span className="text-[10px] text-zinc-600 font-mono">{action}</span>
                  </div>
                  <p className="text-zinc-400 leading-relaxed">{detail}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* TF+1 */}
        <div>
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-1">TF+1 Column</p>
          <p className="text-zinc-400 leading-relaxed">
            Shows the regime at the <em>next higher timeframe</em> (15m→1h, 1h→4h, 4h→1d, 1d→1w).
            The VI score is shown in parentheses.
            Same regime = strong confluence, opposite = caution.
          </p>
        </div>

      </div>
    </div>
  )
}
