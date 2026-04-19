// ── PerformancePage ───────────────────────────────────────────────────────
// Phase 6A — Deep Performance Analytics
import { useCallback, useEffect, useState } from 'react'
import { BarChart2, ChevronDown, ChevronUp } from 'lucide-react'
import { useProfile } from '../../context/ProfileContext'
import { analyticsApi } from '../../lib/api'
import type {
  PerformanceReport,
  AnalyticsSettingsOut,
  AIKeysStatusOut,
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
import { AISettingsPanel } from './components/AISettingsPanel'

type Period = '30d' | '90d' | '180d' | 'all'

const PERIODS: { value: Period; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '180d', label: '6 months' },
  { value: 'all', label: 'All time' },
]

function SectionCard({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-surface-900 border border-surface-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-800/50 transition-colors"
      >
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
        {open ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}

function DirectionStats({ rows }: { rows: DirectionRow[] }) {
  if (!rows.length) return <div className="text-slate-500 text-sm py-4 text-center">No data</div>
  return (
    <div className="grid grid-cols-2 gap-3">
      {rows.map(r => (
        <div key={r.direction} className="bg-surface-800 rounded-lg p-3 border border-surface-700">
          <div className="text-xs text-slate-500 capitalize mb-1">{r.direction}</div>
          <div className="text-xl font-bold text-slate-100">{r.wr_pct?.toFixed(1)}%</div>
          <div className="text-xs text-slate-500">{r.trades} trades</div>
        </div>
      ))}
    </div>
  )
}

function PairLeaderboard({ rows }: { rows: WRByStat[] }) {
  if (!rows.length) return <div className="text-slate-500 text-sm py-4 text-center">No data</div>
  return (
    <div className="space-y-1.5">
      {rows.slice(0, 10).map((r, i) => {
        const wr = r.wr_pct ?? 0
        const color = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'
        return (
          <div key={r.label} className="flex items-center justify-between py-1.5 border-b border-surface-800 last:border-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-600 w-4">#{i + 1}</span>
              <span className="text-sm text-slate-200">{r.label}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span>{r.trades} trades</span>
              <span style={{ color }} className="font-semibold">{wr.toFixed(1)}%</span>
              {r.avg_pnl != null && (
                <span className={r.avg_pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {r.avg_pnl >= 0 ? '+' : ''}{r.avg_pnl.toFixed(2)}%
                </span>
              )}
            </div>
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
  const [aiKeys, setAiKeys] = useState<AIKeysStatusOut | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    try {
      const [rep, cfg, keys] = await Promise.all([
        analyticsApi.getPerformance(profileId, period),
        analyticsApi.getSettings(profileId),
        analyticsApi.getAIKeysStatus(profileId),
      ])
      setReport(rep)
      setSettings(cfg)
      setAiKeys(keys)
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
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-violet-400" />
          <h1 className="text-lg font-semibold text-slate-100">Performance Analytics</h1>
        </div>
        <div className="flex items-center gap-1 bg-surface-900 border border-surface-800 rounded-lg p-1">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${period === p.value ? 'bg-violet-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-4 py-3">
          {error}
        </div>
      )}

      {loading && !report && (
        <div className="space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-32 bg-surface-900 border border-surface-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* KPIs */}
          <SectionCard title="Key Metrics">
            <SummaryKPIs kpi={report.kpi} />
          </SectionCard>

          {/* Equity + Drawdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Equity Curve">
              <EquityCurve data={report.equity_curve} />
            </SectionCard>
            <SectionCard title="Drawdown">
              <DrawdownChart data={report.drawdown} />
            </SectionCard>
          </div>

          {/* WR breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="WR by Strategy">
              <WRBarChart data={report.wr_by_strategy} />
            </SectionCard>
            <SectionCard title="WR by Session">
              <WRBarChart data={report.wr_by_session} />
            </SectionCard>
          </div>

          {/* Pair leaderboard — full width */}
          <SectionCard title="Pair Leaderboard">
            <PairLeaderboard rows={report.pair_leaderboard} />
          </SectionCard>

          {/* Hourly WR */}
          <SectionCard title="WR by Hour (UTC)">
            <HourlyWRChart data={report.wr_by_hour} />
          </SectionCard>

          {/* TP hit rates + Direction */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="TP Hit Rates">
              <TPHitRateChart data={report.tp_hit_rates} />
            </SectionCard>
            <SectionCard title="Direction Bias">
              <DirectionStats rows={report.direction_bias} />
            </SectionCard>
          </div>

          {/* Trade type + R:R scatter */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="Trade Type Distribution">
              <TradeTypeDist data={report.trade_type_dist} />
            </SectionCard>
            <SectionCard title="R:R Planned vs Actual">
              <RRScatterChart data={report.rr_scatter} />
            </SectionCard>
          </div>

          {/* Tag insights */}
          <SectionCard title="Tag Insights">
            <TagInsights winners={report.top_tags_winners} losers={report.top_tags_losers} />
          </SectionCard>

          {/* Repeat errors */}
          <SectionCard title="Repeat Errors">
            <RepeatErrors data={report.repeat_errors} />
          </SectionCard>

          {/* AI insight */}
          <SectionCard title="AI Insights">
            <AIInsightPanel
              profileId={profileId}
              period={period}
              aiEnabled={settings?.config?.ai_enabled ?? false}
              existing={null}
            />
          </SectionCard>

          {/* AI settings */}
          {settings && aiKeys && (
            <SectionCard title="AI Settings" defaultOpen={false}>
              <AISettingsPanel
                profileId={profileId}
                settings={settings}
                aiKeys={aiKeys}
                onSettingsChange={setSettings}
              />
            </SectionCard>
          )}
        </div>
      )}
    </div>
  )
}
