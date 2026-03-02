// ── Dashboard page ─────────────────────────────────────────────────────────
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { Badge } from '../../components/ui/Badge'

// ── Fake candlestick SVG (decorative) ─────────────────────────────────────
function CandlestickArt() {
  // 12 candles, alternating bull/bear — purely decorative
  const candles = [
    { x: 10,  h: 30, y: 50, bull: true  },
    { x: 25,  h: 20, y: 60, bull: false },
    { x: 40,  h: 40, y: 35, bull: true  },
    { x: 55,  h: 15, y: 65, bull: false },
    { x: 70,  h: 35, y: 45, bull: true  },
    { x: 85,  h: 25, y: 55, bull: true  },
    { x: 100, h: 45, y: 30, bull: true  },
    { x: 115, h: 20, y: 60, bull: false },
    { x: 130, h: 30, y: 48, bull: true  },
    { x: 145, h: 18, y: 62, bull: false },
    { x: 160, h: 38, y: 40, bull: true  },
    { x: 175, h: 28, y: 52, bull: true  },
  ]

  return (
    <svg
      viewBox="0 0 200 100"
      className="w-full h-20 opacity-20"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {candles.map((c, i) => (
        <g key={i}>
          {/* Wick */}
          <line
            x1={c.x + 4} y1={c.y - 5}
            x2={c.x + 4} y2={c.y + c.h + 5}
            stroke={c.bull ? '#22c55e' : '#ef4444'}
            strokeWidth="1"
          />
          {/* Body */}
          <rect
            x={c.x} y={c.y}
            width={8} height={c.h}
            fill={c.bull ? '#22c55e' : '#ef4444'}
            rx={1}
          />
        </g>
      ))}
    </svg>
  )
}

// ── Activity row ──────────────────────────────────────────────────────────
interface ActivityItem {
  symbol: string
  side: 'BUY' | 'SELL'
  size: string
  time: string
  status: 'open' | 'closed' | 'pending'
}

const FAKE_ACTIVITY: ActivityItem[] = [
  { symbol: 'BTC/USD', side: 'BUY',  size: '0.05 BTC', time: 'Today 09:14',    status: 'open'    },
  { symbol: 'ETH/USD', side: 'SELL', size: '0.8 ETH',  time: 'Today 08:02',    status: 'closed'  },
  { symbol: 'XAU/USD', side: 'BUY',  size: '0.1 oz',   time: 'Yesterday 15:30', status: 'closed' },
]

const statusStyles = {
  open:    'text-green-400 bg-green-900/30 border-green-800/50',
  closed:  'text-slate-400 bg-surface-700 border-surface-600',
  pending: 'text-amber-400 bg-amber-900/30 border-amber-800/50',
}

// ── Page ──────────────────────────────────────────────────────────────────
export function DashboardPage() {
  return (
    <div>
      <PageHeader
        icon="📈"
        title="Dashboard"
        subtitle="Overview of your trading activity and account health"
        badge="Phase 1"
        badgeVariant="phase"
        info="Real-time data will be connected once the profile & trade endpoints are wired up."
      />

      {/* ── KPI grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Open Positions"
          value="—"
          sub="No live data yet"
          accent="brand"
          info="Number of currently active trades across all instruments."
        />
        <StatCard
          label="Today's P&L"
          value="—"
          sub="No live data yet"
          accent="bull"
          info="Realised + unrealised P&L for today. Updates on trade close."
        />
        <StatCard
          label="Portfolio Risk"
          value="—"
          sub="No live data yet"
          accent="neutral"
          info="Total capital at risk across all open positions, expressed as % of account."
        />
        <StatCard
          label="Win Rate"
          value="—"
          sub="Min 5 trades required"
          accent="bear"
          info="Win rate is only shown after 5+ closed trades to avoid statistical noise."
        />
      </div>

      {/* ── Chart teaser ──────────────────────────────────────────────── */}
      <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-300">Equity Curve</span>
            <Badge label="Coming Soon" variant="soon" />
          </div>
          <div className="flex gap-2">
            {['1W', '1M', '3M', 'YTD', 'ALL'].map((r) => (
              <button
                key={r}
                type="button"
                disabled
                className="text-[10px] px-2 py-0.5 rounded text-slate-600 cursor-not-allowed"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <CandlestickArt />
        <p className="text-center text-xs text-slate-700 mt-2">
          Chart will render once trade history is available
        </p>
      </div>

      {/* ── Recent activity ───────────────────────────────────────────── */}
      <div className="rounded-xl bg-surface-800 border border-surface-700 p-5">
        <h2 className="text-sm font-medium text-slate-400 mb-4">Recent Activity</h2>
        <div className="space-y-2">
          {FAKE_ACTIVITY.map((item, i) => (
            <div
              key={i}
              className="flex items-center justify-between text-xs py-2 border-b border-surface-700 last:border-none"
            >
              <div className="flex items-center gap-3">
                {item.side === 'BUY'
                  ? <TrendingUp size={14} className="text-green-500 shrink-0" />
                  : <TrendingDown size={14} className="text-red-400 shrink-0" />
                }
                <div>
                  <span className="text-slate-200 font-medium">{item.symbol}</span>
                  <span className={`ml-2 font-semibold ${item.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                    {item.side}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-slate-500 tabular-nums">{item.size}</span>
                <span className="text-slate-600">{item.time}</span>
                <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider ${statusStyles[item.status]}`}>
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-700 mt-3 text-center">
          Showing placeholder data — Trade Journal API not yet connected
        </p>
      </div>

      {/* ── Quick stats row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4 mt-6">
        <QuickStat label="Avg R:R" value="—" icon={<Minus size={12} />} />
        <QuickStat label="Max Drawdown" value="—" icon={<TrendingDown size={12} className="text-red-500" />} />
        <QuickStat label="Best Trade" value="—" icon={<TrendingUp size={12} className="text-green-500" />} />
      </div>
    </div>
  )
}

function QuickStat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-800/60 border border-surface-700 px-4 py-3 flex items-center gap-3">
      <span className="text-slate-600">{icon}</span>
      <div>
        <div className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</div>
        <div className="text-sm font-semibold text-slate-400 tabular-nums">{value}</div>
      </div>
    </div>
  )
}
