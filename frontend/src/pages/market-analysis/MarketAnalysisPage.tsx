// ── Market Analysis page ───────────────────────────────────────────────────
import { BarChart2, CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { ComingSoon } from '../../components/ui/ComingSoon'
import { InfoBubble } from '../../components/ui/InfoBubble'

// ── Module card (placeholder) ─────────────────────────────────────────────
interface ModuleCardProps {
  emoji: string
  name: string
  description: string
  indicators: number
  staleness: 'fresh' | 'stale' | 'never'
}

function ModuleCard({ emoji, name, description, indicators, staleness }: ModuleCardProps) {
  const stalenessConfig = {
    fresh: { icon: <CheckCircle2 size={12} />, label: 'Fresh',         cls: 'text-green-400' },
    stale: { icon: <AlertTriangle size={12} />, label: 'Stale (>7d)',  cls: 'text-amber-400' },
    never: { icon: <Clock size={12} />,         label: 'No analysis',  cls: 'text-slate-600' },
  }
  const s = stalenessConfig[staleness]

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-3 hover:border-brand-700/50 transition-colors cursor-pointer">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{emoji}</span>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{name}</h3>
            <p className="text-xs text-slate-600 mt-0.5">{description}</p>
          </div>
        </div>
        <Badge label={`${indicators} indicators`} />
      </div>
      <div className={`flex items-center gap-1.5 text-xs ${s.cls}`}>
        {s.icon}
        <span>{s.label}</span>
      </div>
    </div>
  )
}

// ── Bias pill ─────────────────────────────────────────────────────────────
function BiasPill({ bias }: { bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' }) {
  const styles = {
    BULLISH: 'text-green-400 bg-green-900/30 border-green-800/50',
    BEARISH: 'text-red-400 bg-red-900/30 border-red-800/50',
    NEUTRAL: 'text-amber-400 bg-amber-900/30 border-amber-800/50',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-widest ${styles[bias]}`}>
      {bias}
    </span>
  )
}

// ── Placeholder modules ───────────────────────────────────────────────────
const MODULES = [
  { emoji: '₿',  name: 'Crypto',      description: 'BTC, ETH, major pairs',  indicators: 8,  staleness: 'stale' as const },
  { emoji: '🥇', name: 'Gold (XAU)',   description: 'Commodities & metals',   indicators: 6,  staleness: 'never' as const },
  { emoji: '💱', name: 'Forex Major',  description: 'EUR/USD, GBP/USD, etc.', indicators: 7,  staleness: 'fresh' as const },
  { emoji: '📊', name: 'Indices',      description: 'SP500, NQ, DAX',         indicators: 5,  staleness: 'never' as const },
]

type Bias = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

const SCORE_ROWS: { module: string; score: number; bias: Bias; date: string }[] = [
  { module: 'Crypto',      score: 68, bias: 'BULLISH', date: '2026-02-23' },
  { module: 'Forex Major', score: 52, bias: 'NEUTRAL', date: '2026-03-01' },
]

// ── Page ──────────────────────────────────────────────────────────────────
export function MarketAnalysisPage() {
  return (
    <div>
      <PageHeader
        icon="🧭"
        title="Market Analysis"
        subtitle="Score-based market bias for each instrument group"
        badge="Phase 1"
        badgeVariant="phase"
        info="Run a structured indicator checklist for each module. The server computes a composite score and bias (BULLISH / BEARISH / NEUTRAL). Sessions older than 7 days are flagged as stale."
      />

      {/* ── Module grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {MODULES.map((m) => <ModuleCard key={m.name} {...m} />)}
      </div>

      {/* ── Last session scores ───────────────────────────────────────── */}
      <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={15} className="text-slate-500" />
          <h2 className="text-sm font-medium text-slate-400">Last Session Scores</h2>
          <InfoBubble text="Score ranges: 0–39 = BEARISH, 40–60 = NEUTRAL, 61–100 = BULLISH. Computed server-side from your indicator answers." />
        </div>

        <div className="space-y-3">
          {SCORE_ROWS.map((row) => (
            <div key={row.module} className="flex items-center gap-4">
              <span className="text-xs text-slate-500 w-28 shrink-0">{row.module}</span>
              {/* Score bar */}
              <div className="flex-1 h-2 rounded-full bg-surface-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    row.bias === 'BULLISH' ? 'bg-green-500' :
                    row.bias === 'BEARISH' ? 'bg-red-500' :
                    'bg-amber-400'
                  }`}
                  style={{ width: `${row.score}%` }}
                />
              </div>
              <span className="text-xs font-mono tabular-nums text-slate-400 w-8 text-right">{row.score}</span>
              <BiasPill bias={row.bias} />
              <span className="text-[10px] text-slate-700 w-24 text-right">{row.date}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-700 mt-4 text-center">
          Showing placeholder scores — connect to <code className="font-mono">/api/market-analysis/sessions</code> to load real data
        </p>
      </div>

      <ComingSoon
        feature="Analysis session form, indicator checklist, per-profile toggles"
        phase="Phase 1 — Step 9+"
      />
    </div>
  )
}
