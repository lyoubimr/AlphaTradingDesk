// ── Topbar component ───────────────────────────────────────────────────────
import { Bell } from 'lucide-react'
import { ProfilePicker } from './ProfilePicker'

interface TopbarProps {
  currentTime?: string
}

export function Topbar({ currentTime }: TopbarProps) {
  return (
    <header className="
      h-12 shrink-0
      flex items-center justify-between px-5
      bg-surface-900 border-b border-surface-800
      sticky top-0 z-40
    ">
      {/* ── Left: profile picker ───────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <ProfilePicker />
      </div>

      {/* ── Right: market pills + clock + actions ──────────────────── */}
      <div className="flex items-center gap-4">
        {/* Market summary pills */}
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
