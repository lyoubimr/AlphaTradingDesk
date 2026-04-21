// ── PerformancePage ───────────────────────────────────────────────────────────
// Phase 6A — Deep Performance Analytics
import { useCallback, useEffect, useState } from 'react'
import { BarChart2, ChevronDown, ChevronUp, TrendingDown, TrendingUp } from 'lucide-react'
import { useProfile } from '../../context/ProfileContext'
import { analyticsApi } from '../../lib/api'
import type {
  PerformanceReport,
  AnalyticsSettingsOut,
  DirectionRow,
  WRByStat,
} from '../../types/api'
import { SummaryKPIs } from './components/SummaryKPIs'
import { EquityCurve } from './components/EquityCurve'
import { DrawdownChart } from './components/DrawdownChart'
import { WRBarChart } from './components/WRBarChart'
import { HourlyWRChart } from './components/HourlyWRChart'
import { TPHitRateChart } from './components/TPHitRateChart'
import { TradeTypeDist } from './components/TradeTypeDist'
import { RRScatterChart } from './components/RRScatterChart'
import { TagInsights } from './components/TagInsights'
import { RepeatErrors } from './components/RepeatErrors'
import { AIInsightPanel } from './components/AIInsightPanel'
import { ViCorrelation } from './components/ViCorrelation'

type Period = '30d' | '90d' | '180d' | 'all'

const PERIODS: { value: Period; label: string }[] = [
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '180d', label: '6m' },
  { value: 'all', label: 'All' },
]

/** Strip broker prefixes like PF_ from pair names */
function cleanPairName(pair: string): string {
  return pair.replace(/^PF[_.]/i, '')
}

function Section({ title, hint, children, defaultOpen = true }: {
  title: string; hint?: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-surface-900 border border-surface-800 rounded-xl">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-800/60 transition-colors rounded-t-xl"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">{title}</h2>
          {hint && <span className="text-[10px] text-slate-700 normal-case tracking-normal font-normal">{hint}</span>}
        </div>
        {open
          ? <ChevronUp size={13} className="text-slate-700" />
          : <ChevronDown size={13} className="text-slate-700" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function DirectionBias({ rows }: { rows: DirectionRow[] }) {
  if (!rows.length) return <div className="text-slate-600 text-sm py-4 text-center">No data</div>
  return (
    <div className="grid grid-cols-2 gap-3">
      {rows.map(r => {
        const wr = r.wr_pct ?? 0
        const isLong = r.direction.toLowerCase() === 'long'
        const wrColor = wr >= 55 ? 'text-emerald-400' : wr >= 45 ? 'text-amber-400' : 'text-red-400'
        const pnlColor = (r.total_pnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
        return (
          <div
            key={r.direction}
            className="bg-surface-800 rounded-xl p-4 border border-surface-700 hover:border-surface-600 transition-colors"
          >
            <div className="flex items-center gap-2 mb-3">
              {isLong
                ? <TrendingUp size={14} className="text-emerald-400" />
                : <TrendingDown size={14} className="text-red-400" />}
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 capitalize">
                {r.direction}
              </span>
            </div>
            <div className={`text-3xl font-bold tabular-nums leading-none ${wrColor}`}>
              {wr.toFixed(1)}%
            </div>
            <div className="text-[10px] text-slate-600 mt-0.5 mb-3">win rate</div>
            <div className="flex justify-between text-xs text-slate-500">
              <span>{r.trades} trades</span>
              {r.total_pnl != null && (
                <span className={pnlColor}>
                  {r.total_pnl >= 0 ? '+$' : '-$'}{Math.abs(r.total_pnl).toFixed(0)} total
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PairLeaderboard({ rows }: { rows: WRByStat[] }) {
  if (!rows.length) return <div className="text-slate-600 text-sm py-4 text-center">No data</div>
  const active = rows.filter(r => r.trades > 0)
    .sort((a, b) => (b.trades * (b.wr_pct ?? 50)) - (a.trades * (a.wr_pct ?? 50)))
    .slice(0, 12)
  const maxTrades = active[0]?.trades ?? 1
  return (
    <div className="space-y-1">
      {active.map((r, i) => {
        const wr = r.wr_pct ?? 0
        const pnl = r.avg_pnl ?? 0
        const barColor = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'
        const pnlColor = pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
        return (
          <div key={r.label} className="flex items-center gap-2 py-1.5 hover:bg-surface-800/40 rounded-lg px-2 transition-colors group">
            <span className="text-[10px] text-slate-700 w-5 shrink-0 font-mono">#{i + 1}</span>
            <span className="w-20 shrink-0 text-xs font-medium text-slate-300 truncate">
              {cleanPairName(r.label)}
            </span>
            {/* Volume micro-bar */}
            <div className="flex-1 h-3.5 bg-surface-700 rounded relative overflow-hidden">
              <div
                className="h-full rounded"
                style={{ width: `${Math.round(wr)}%`, background: barColor, opacity: 0.8 }}
              />
              <div
                className="absolute bottom-0 left-0 h-0.5 opacity-30"
                style={{ width: `${(r.trades / maxTrades) * 100}%`, background: barColor }}
              />
            </div>
            <span className="w-10 text-xs font-bold tabular-nums text-right shrink-0" style={{ color: barColor }}>
              {wr.toFixed(0)}%
            </span>
            <span className="w-12 text-[10px] text-slate-600 text-right shrink-0 tabular-nums">
              {r.trades}tr
            </span>
            <span className={`w-16 shrink-0 text-[10px] font-medium tabular-nums text-right shrink-0 ${pnlColor}`}>
              {pnl >= 0 ? '+$' : '-$'}{Math.abs(pnl).toFixed(0)}
            </span>
            {r.avg_pnl_pct != null && (
              <span
                title="avg P&L as % of capital"
                className={`w-14 shrink-0 text-[10px] tabular-nums text-right ${r.avg_pnl_pct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}
              >
                {r.avg_pnl_pct >= 0 ? '+' : ''}{r.avg_pnl_pct.toFixed(1)}%
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function PerformancePage() {
  const { activeProfileId: profileId } = useProfile()
  const [period, setPeriod] = useState<Period>('30d')
  const [report, setReport] = useState<PerformanceReport | null>(null)
  const [settings, setSettings] = useState<AnalyticsSettingsOut | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    setReport(null)  // reset so AIInsightPanel remounts with correct existing
    try {
      const [rep, cfg] = await Promise.all([
        analyticsApi.getPerformance(profileId, period),
        analyticsApi.getSettings(profileId),
      ])
      setReport(rep)
      setSettings(cfg)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [profileId, period])

  useEffect(() => { void load() }, [load])

  if (!profileId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Select a profile to view analytics
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={18} className="text-violet-400 shrink-0" />
          <h1 className="text-base font-semibold text-slate-100">Performance Analytics</h1>
          {loading && <span className="text-xs text-slate-600 ml-1">Refreshing…</span>}
        </div>
        <div className="flex items-center gap-1 bg-surface-900 border border-surface-700 rounded-lg p-0.5">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
                period === p.value
                  ? 'bg-violet-700 text-white shadow'
                  : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-28 bg-surface-900 border border-surface-800 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* ── 1. AI Hero ───────────────────────────────────────────────── */}
          <AIInsightPanel
            profileId={profileId}
            period={period}
            aiEnabled={settings?.config?.ai_enabled ?? false}
            existing={
              report.ai_summary
                ? {
                    summary: report.ai_summary,
                    provider: '',
                    model: '',
                    tokens_used: null,
                    generated_at: report.ai_generated_at ?? '',
                  }
                : null
            }
          />

          {/* ── 2. KPI Summary ───────────────────────────────────────────── */}
          <Section title="Key Metrics">
            <SummaryKPIs kpi={report.kpi} reviewRate={report.review_rate} />
            {report.direction_bias.length > 0 && (
              <div className="mt-3 pt-3 border-t border-surface-800">
                <DirectionBias rows={report.direction_bias} />
              </div>
            )}
          </Section>

          {/* ── 3. Volatility Correlation ─────────────────────────────────── */}
          <Section title="Volatility Correlation">
            <ViCorrelation
              pairData={report.vi_correlation}
              marketData={report.vi_correlation_market ?? []}
            />
          </Section>

          {/* ── 4. Top Strategies ─────────────────────────────────────────────── */}
          <Section title="Top Strategies" hint="disciplined only">
            <WRBarChart data={report.wr_by_strategy} />
          </Section>

          {/* ── 5. TP Hit Rates + R:R Scatter ────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="TP Hit Rates">
              <TPHitRateChart data={report.tp_hit_rates} />
            </Section>
            <Section title="R:R — Planned vs Actual">
              <RRScatterChart data={report.rr_scatter} />
            </Section>
          </div>

          {/* ── 6. Equity Curve + Drawdown ───────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Equity Curve" hint="all closed trades">
              <EquityCurve data={report.equity_curve} />
            </Section>
            <Section title="Drawdown" hint="all closed trades">
              <DrawdownChart data={report.drawdown} />
            </Section>
          </div>

          {/* ── 7. WR by Hour + WR by Session ────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="WR by Trade Open Hour" hint="all closed trades">
              <HourlyWRChart data={report.wr_by_hour} />
            </Section>
            <Section title="WR by Session" hint="all closed trades">
              <WRBarChart data={report.wr_by_session} />
            </Section>
          </div>

          {/* ── 8. Pair Leaderboard ───────────────────────────────────────── */}
          <Section title="Pair Leaderboard" hint="all closed trades">
            <PairLeaderboard rows={report.pair_leaderboard} />
          </Section>

          {/* ── 9. Trade Type Distribution ───────────────────────────────── */}
          <Section title="Trade Type Distribution" hint="all closed trades">
            <TradeTypeDist data={report.trade_type_dist} />
          </Section>

          {/* ── 10. Tag Insights + Repeat Errors ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Tag Insights">
              <TagInsights winners={report.top_tags_winners} losers={report.top_tags_losers} />
            </Section>
            <Section title="Repeat Errors">
              <RepeatErrors data={report.repeat_errors} />
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}
