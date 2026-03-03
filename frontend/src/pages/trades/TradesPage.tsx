// ── Trade Journal page ─────────────────────────────────────────────────────
import { Plus, Filter, Download } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/ui/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { ComingSoon } from '../../components/ui/ComingSoon'
import { StatCard } from '../../components/ui/StatCard'

// ── Fake trade rows (placeholder) ─────────────────────────────────────────
interface TradeRow {
  id: number
  symbol: string
  side: 'LONG' | 'SHORT'
  entry: string
  exit: string | null
  size: string
  pnl: string | null
  rr: string | null
  strategy: string
  date: string
}

const SAMPLE_TRADES: TradeRow[] = [
  { id: 1, symbol: 'BTC/USD', side: 'LONG',  entry: '64,200', exit: '65,800', size: '0.05', pnl: '+$80',  rr: '1.6R', strategy: 'Breakout', date: '2026-03-01' },
  { id: 2, symbol: 'ETH/USD', side: 'SHORT', entry: '3,310',  exit: '3,180',  size: '0.5',  pnl: '+$65',  rr: '1.3R', strategy: 'Range',    date: '2026-02-28' },
  { id: 3, symbol: 'XAU/USD', side: 'LONG',  entry: '2,310',  exit: null,     size: '0.1',  pnl: null,    rr: null,   strategy: 'Trend',    date: '2026-03-02' },
]

export function TradesPage() {
  const navigate = useNavigate()
  return (
    <div>
      <PageHeader
        icon="📒"
        title="Trade Journal"
        subtitle="Log, review, and analyse every trade you take"
        badge="Phase 1"
        badgeVariant="phase"
        info="Each trade can have multiple take-profit positions (multi-TP). Win rate is only shown after 5+ trades."
        actions={
          <>
            <button type="button" className="atd-btn-ghost" disabled>
              <Filter size={14} /> Filters
            </button>
            <button type="button" className="atd-btn-ghost" disabled>
              <Download size={14} /> Export
            </button>
            <button
              type="button"
              className="atd-btn-primary"
              onClick={() => navigate('/trades/new')}
            >
              <Plus size={14} /> New Trade
            </button>
          </>
        }
      />

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Trades"   value="—" sub="No data yet"         accent="brand"   info="Total closed + open trades in your journal." />
        <StatCard label="Win Rate"       value="—" sub="Min 5 trades"        accent="bull"    info="Percentage of winning trades. Requires at least 5 closed trades." />
        <StatCard label="Avg R:R"        value="—" sub="Risk / Reward ratio"  accent="neutral" info="Average realised risk-to-reward ratio across all closed trades." />
        <StatCard label="Total P&L"      value="—" sub="Gross, no commission" accent="bull"    info="Sum of all closed trade P&L. Does not include open positions." />
      </div>

      {/* ── Placeholder table ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden mb-6">
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
          <span className="text-sm font-medium text-slate-400">Recent Trades</span>
          <Badge label="Sample data" variant="neutral" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-700">
                {['Date', 'Symbol', 'Side', 'Entry', 'Exit', 'Size', 'P&L', 'R:R', 'Strategy'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-slate-600 font-medium uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SAMPLE_TRADES.map((t) => (
                <tr key={t.id} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                  <td className="px-4 py-2.5 text-slate-500 font-mono">{t.date}</td>
                  <td className="px-4 py-2.5 text-slate-200 font-medium">{t.symbol}</td>
                  <td className="px-4 py-2.5">
                    <span className={t.side === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                      {t.side}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400 tabular-nums font-mono">{t.entry}</td>
                  <td className="px-4 py-2.5 text-slate-400 tabular-nums font-mono">{t.exit ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums">{t.size}</td>
                  <td className="px-4 py-2.5 tabular-nums font-mono">
                    {t.pnl
                      ? <span className={t.pnl.startsWith('+') ? 'text-green-400' : 'text-red-400'}>{t.pnl}</span>
                      : <span className="text-slate-600">Open</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums">{t.rr ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-600">{t.strategy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ComingSoon
        feature="Real trade data, multi-TP tracking, filters, and P&L chart"
        phase="Phase 1 — Step 11+"
      />
    </div>
  )
}
