// ── Topbar component ───────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { Bell, TrendingUp, Palette } from 'lucide-react'
import { ProfilePicker } from './ProfilePicker'
import { SessionsIndicator } from '../dashboard/TradingSessions'
import { useProfile } from '../../context/ProfileContext'
import { useTheme } from '../../context/ThemeContext'
import { statsApi, volatilityApi } from '../../lib/api'
import type { WinRateStats, LivePricesResponse } from '../../types/api'

type TopbarProps = Record<string, never>

// ── Capital + PnL chip ────────────────────────────────────────────────────
// Shows active profile's current capital and overall PnL% inline in the topbar.
// Renders nothing if no active profile.
function CapitalChip() {
  const { activeProfile } = useProfile()
  if (!activeProfile) return null

  const capital    = parseFloat(activeProfile.capital_current)
  const start      = parseFloat(activeProfile.capital_start)
  const pnlPct     = start > 0 ? ((capital - start) / start) * 100 : 0
  const pnlPos     = pnlPct >= 0
  const currency   = activeProfile.currency ?? 'USD'

  const capitalFmt = capital.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

  return (
    <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-lg bg-surface-800 border border-surface-700 text-xs tabular-nums">
      <span className="text-slate-300 font-mono font-semibold">{capitalFmt}</span>
      <span className="text-slate-600 text-[10px]">{currency}</span>
      <span className="text-slate-700">·</span>
      <span className={pnlPos ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
        {pnlPos ? '+' : ''}{pnlPct.toFixed(2)}%
      </span>
    </div>
  )
}

// ── Global WR pill ────────────────────────────────────────────────────────
// Displays the mean win-rate across all profiles that have ≥5 closed trades.
// Fetches once on mount and refreshes every 60s. Silent on error.
function GlobalWRPill() {
  const [wr, setWr] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetch_ = () => {
      statsApi.winrate().then((data: WinRateStats) => {
        if (cancelled) return
        const eligible = data.profiles.filter((p) => p.has_data && p.win_rate_pct !== null)
        if (eligible.length === 0) return
        const mean = eligible.reduce((sum, p) => sum + (p.win_rate_pct ?? 0), 0) / eligible.length
        setWr(Math.round(mean * 10) / 10)
      }).catch(() => { /* silent */ })
    }
    fetch_()
    const id = setInterval(fetch_, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (wr === null) return null

  const color = wr >= 55 ? 'text-green-400' : wr >= 45 ? 'text-amber-400' : 'text-red-400'
  return (
    <div
      className="hidden lg:flex items-center gap-1.5 text-xs px-2 py-1 rounded
                 bg-surface-800 border border-surface-700"
      title="Global win-rate — mean across all profiles with ≥5 trades"
    >
      <TrendingUp size={11} className={color} />
      <span className="text-slate-500">Global WR</span>
      <span className={`font-mono font-semibold tabular-nums ${color}`}>
        {wr.toFixed(1)}%
      </span>
    </div>
  )
}

// ── Local clock ───────────────────────────────────────────────────────────
function LocalClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const hhmm = now.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false })
  const tz   = new Intl.DateTimeFormat('default', { timeZoneName: 'short' }).formatToParts(now)
    .find((p) => p.type === 'timeZoneName')?.value ?? ''
  return (
    <div className="hidden lg:flex items-center gap-1.5 text-xs tabular-nums">
      <span className="text-slate-300 font-mono font-semibold">{hhmm}</span>
      <span className="text-slate-600 text-[10px]">{tz}</span>
    </div>
  )
}

export function Topbar(_: TopbarProps) {
  return (
    <header className="
      h-12 shrink-0
      flex items-center justify-between px-5
      bg-surface-900 border-b border-surface-800
      sticky top-0 z-40
    ">
      {/* ── Left: profile picker + capital chip + sessions indicator ─── */}
      <div className="flex items-center gap-3">
        <ProfilePicker />
        <CapitalChip />
        <SessionsIndicator />
      </div>

      {/* ── Right: WR pill + market pills + clock + theme picker + bell ── */}
      <div className="flex items-center gap-4">
        {/* Global win-rate across all profiles */}
        <GlobalWRPill />

        {/* Live market prices — polls /api/volatility/prices/live every 30s */}
        <LivePricesBar />

        {/* Local time + timezone */}
        <LocalClock />

        {/* Theme picker */}
        <ThemePicker />

        <button
          type="button"
          className="text-slate-600 hover:text-slate-300 transition-colors"
          aria-label="Notifications"
        >
          <Bell size={16} />
        </button>
      </div>
    </header>
  )
}

// ── Live prices bar ───────────────────────────────────────────────────────
// Polls /api/volatility/prices/live every 30s. Silent on error (keeps last known).
function LivePricesBar() {
  const [prices, setPrices] = useState<LivePricesResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      volatilityApi.getLivePrices()
        .then((d) => { if (!cancelled) setPrices(d) })
        .catch(() => { /* silent — keep last known */ })
    }
    poll()
    const id = setInterval(poll, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  if (!prices) return null

  const sym = prices.currency_symbol ?? prices.currency ?? '$'
  const fmt = (v: number) =>
    v >= 1_000
      ? v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const fmtChg = (v: number | null | undefined): string | undefined => {
    if (v == null) return undefined
    return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
  }

  return (
    <div className="hidden md:flex items-center gap-3">
      <MarketPill symbol="BTC" value={`${sym}${fmt(prices.btc ?? 0)}`}
        change={fmtChg(prices.btc_change_pct)} bull={(prices.btc_change_pct ?? 0) >= 0} />
      <MarketPill symbol="ETH" value={`${sym}${fmt(prices.eth ?? 0)}`}
        change={fmtChg(prices.eth_change_pct)} bull={(prices.eth_change_pct ?? 0) >= 0} />
      <MarketPill symbol="XAU" value={`${sym}${fmt(prices.xau ?? 0)}`}
        change={fmtChg(prices.xau_change_pct)} bull={(prices.xau_change_pct ?? 0) >= 0} />
    </div>
  )
}

// ── Theme picker ──────────────────────────────────────────────────────────
function ThemePicker() {
  const { theme, setTheme, themes } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = themes.find((t) => t.id === theme)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Change theme"
        className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded-lg hover:bg-surface-800"
      >
        <Palette size={14} />
        <span className="hidden lg:inline text-[11px]">{current?.emoji ?? '🌌'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-52
          bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden">
          <div className="px-3 py-2 border-b border-surface-700">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">Theme</p>
          </div>
          <div className="py-1">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setTheme(t.id); setOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-700 ${
                  theme === t.id ? 'bg-brand-600/15' : ''
                }`}
              >
                <span
                  className="w-4 h-4 rounded-full border-2 border-white/20 shrink-0"
                  style={{ backgroundColor: t.swatch }}
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-slate-200">{t.emoji} {t.label}</span>
                    {theme === t.id && (
                      <span className="text-[9px] text-brand-400 font-semibold">✓</span>
                    )}
                  </div>
                  <p className="text-[9px] text-slate-600 truncate">{t.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Inline sub-component ──────────────────────────────────────────────────
interface MarketPillProps {
  symbol: string
  value: string
  change?: string
  bull?: boolean
}

function MarketPill({ symbol, value, change, bull = false }: MarketPillProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-500 font-medium">{symbol}</span>
      <span className="text-slate-400 tabular-nums font-mono">{value}</span>
      {change && (
        <span className={bull ? 'text-green-500' : 'text-red-400'}>{change}</span>
      )}
    </div>
  )
}