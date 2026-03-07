// ── Topbar component ───────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { Bell, TrendingUp } from 'lucide-react'
import { ProfilePicker } from './ProfilePicker'
import { useProfile } from '../../context/ProfileContext'
import { statsApi } from '../../lib/api'
import type { WinRateStats } from '../../types/api'

interface TopbarProps {
  currentTime?: string
}

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

  const capitalFmt = capital.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })

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

export function Topbar({ currentTime }: TopbarProps) {
  return (
    <header className="
      h-12 shrink-0
      flex items-center justify-between px-5
      bg-surface-900 border-b border-surface-800
      sticky top-0 z-40
    ">
      {/* ── Left: profile picker + capital chip ───────────────────────── */}
      <div className="flex items-center gap-3">
        <ProfilePicker />
        <CapitalChip />
      </div>

      {/* ── Right: WR pill + market pills + clock + actions ────────── */}
      <div className="flex items-center gap-4">
        {/* Global win-rate across all profiles */}
        <GlobalWRPill />

        {/* Market summary pills (indicative — static placeholder for now) */}
        <div className="hidden md:flex items-center gap-3">
          <MarketPill symbol="BTC" value="~65,420" change="+1.4%" bull />
          <MarketPill symbol="ETH" value="~3,210" change="-0.3%" />
          <MarketPill symbol="XAU" value="~2,340" change="+0.7%" bull />
          <span className="text-[10px] text-slate-700">· Indicative</span>
        </div>

        {currentTime && (
          <span className="text-xs font-mono text-slate-600 tabular-nums hidden lg:inline">
            {currentTime}
          </span>
        )}
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

// ── Inline sub-component ──────────────────────────────────────────────────
interface MarketPillProps {
  symbol: string
  value: string
  change: string
  bull?: boolean
}

function MarketPill({ symbol, value, change, bull = false }: MarketPillProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-slate-500 font-medium">{symbol}</span>
      <span className="text-slate-400 tabular-nums font-mono">{value}</span>
      <span className={bull ? 'text-green-500' : 'text-red-400'}>{change}</span>
    </div>
  )
}