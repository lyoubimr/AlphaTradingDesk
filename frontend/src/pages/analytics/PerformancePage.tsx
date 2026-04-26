// ── PerformancePage ───────────────────────────────────────────────────────────
// Phase 6A — Deep Performance Analytics
import React, { useCallback, useEffect, useState } from 'react'
import { BarChart2, ChevronDown, ChevronUp, Info, TrendingDown, TrendingUp } from 'lucide-react'
import { useProfile } from '../../context/ProfileContext'
import { analyticsApi } from '../../lib/api'
import { sessionTooltip } from '../../utils/sessionUtils'
import type {
  PerformanceReport,
  AnalyticsSettingsOut,
  DirectionRow,
  WRByStat,
  TradeSummaryRow,
  StrategySessionRow,
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

const SESSION_COLORS: Record<string, string> = {
  Asian: 'bg-sky-500/20 text-sky-300 border-sky-500/30',
  London: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Overlap: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  'New York': 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  Weekend: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  Unknown: 'bg-slate-700/20 text-slate-500 border-slate-700/30',
}

/** Tooltip text for a session — computed at render time in browser's local tz. */
function sessionHint(s: string): string {
  return sessionTooltip(s)
}

function SessionInfoIcon({ session }: { session: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const text = sessionHint(session)
  if (!text) return null
  return (
    <>
      <Info
        size={10}
        className="text-slate-600 hover:text-slate-300 cursor-help ml-0.5 shrink-0 transition-colors"
        onMouseEnter={e => {
          const r = (e.currentTarget as SVGElement).getBoundingClientRect()
          setPos({ x: r.left + r.width / 2, y: r.top })
        }}
        onMouseLeave={() => setPos(null)}
      />
      {pos && (
        <span
          className="pointer-events-none fixed z-[9999] whitespace-nowrap text-[11px] bg-slate-900 border border-slate-700 text-slate-200 px-2.5 py-1.5 rounded-lg shadow-xl"
          style={{ left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}
        >
          {text}
        </span>
      )}
    </>
  )
}

function SessionBadge({ session }: { session: string }) {
  const cls = SESSION_COLORS[session] ?? SESSION_COLORS.Unknown
  return (
    <span className={`inline-flex items-center text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${cls}`}>
      {session}
      <SessionInfoIcon session={session} />
    </span>
  )
}

// ── Screenshot split-screen lightbox (read-only, analytics context) ──────────
type SplitViewState = { entryUrls: string[]; closeUrls: string[] }

function ScreenshotSplitLightbox({ state, onClose }: { state: SplitViewState; onClose: () => void }) {
  const [entryIdx, setEntryIdx] = useState(0)
  const [closeIdx, setCloseIdx] = useState(0)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') {
        setEntryIdx(i => Math.max(0, i - 1))
        setCloseIdx(i => Math.max(0, i - 1))
      }
      if (e.key === 'ArrowRight') {
        setEntryIdx(i => Math.min(state.entryUrls.length - 1, i + 1))
        setCloseIdx(i => Math.min(state.closeUrls.length - 1, i + 1))
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, state.entryUrls.length, state.closeUrls.length])

  function ImagePanel({ urls, idx, setIdx, label, accentCls }: {
    urls: string[]
    idx: number
    setIdx: React.Dispatch<React.SetStateAction<number>>
    label: string
    accentCls: string
  }) {
    if (!urls.length) return (
      <div className="flex-1 flex items-center justify-center border-r border-white/10 last:border-r-0">
        <div className="text-center text-slate-700">
          <p className="text-sm">{label}</p>
          <p className="text-[11px] mt-1">No screenshots</p>
        </div>
      </div>
    )
    return (
      <div className="flex-1 flex flex-col min-w-0 border-r border-white/10 last:border-r-0">
        {/* Panel header */}
        <div className={`px-4 py-2 text-xs font-semibold ${accentCls} border-b border-white/10 flex items-center gap-2 shrink-0`}>
          <span>{label}</span>
          {urls.length > 1 && <span className="text-slate-600 font-normal">{idx + 1} / {urls.length}</span>}
        </div>
        {/* Image */}
        <div className="flex-1 relative overflow-hidden bg-black flex items-center justify-center">
          <img src={urls[idx]} alt={label} className="max-w-full max-h-full object-contain" />
        </div>
        {/* Nav dots */}
        {urls.length > 1 && (
          <div className="flex items-center justify-center gap-3 py-2.5 border-t border-white/10 shrink-0">
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={idx === 0}
              className="text-slate-400 hover:text-white disabled:opacity-20 transition-colors px-1"
            >←</button>
            <div className="flex gap-1.5">
              {urls.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === idx ? 'bg-white' : 'bg-slate-600 hover:bg-slate-400'}`}
                />
              ))}
            </div>
            <button
              onClick={() => setIdx(i => Math.min(urls.length - 1, i + 1))}
              disabled={idx === urls.length - 1}
              className="text-slate-400 hover:text-white disabled:opacity-20 transition-colors px-1"
            >→</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col" onClick={onClose}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-xs text-slate-400">
          Entry ↔ Close comparison
          <span className="text-slate-600 ml-2">· Esc or click outside to close · ← → to navigate</span>
        </span>
        <button onClick={onClose} className="text-slate-500 hover:text-white text-xl leading-none transition-colors">×</button>
      </div>
      {/* Split panels */}
      <div className="flex-1 flex min-h-0" onClick={e => e.stopPropagation()}>
        <ImagePanel urls={state.entryUrls} idx={entryIdx} setIdx={setEntryIdx} label="🎯 Entry" accentCls="text-blue-300" />
        <ImagePanel urls={state.closeUrls} idx={closeIdx} setIdx={setCloseIdx} label="✅ Close" accentCls="text-emerald-300" />
      </div>
    </div>
  )
}

function TopWorstTrades({ top, worst }: { top: TradeSummaryRow[]; worst: TradeSummaryRow[] }) {
  const [splitView, setSplitView] = useState<SplitViewState | null>(null)

  if (!top.length && !worst.length) {
    return <div className="text-slate-600 text-sm py-4 text-center">No data</div>
  }

  function TradeRow({ rank, row, isWin }: { rank: number; row: TradeSummaryRow; isWin: boolean }) {
    const pnlColor = isWin ? 'text-emerald-400' : 'text-red-400'
    const pnl = row.realized_pnl
    const hasScreenshots = row.entry_screenshot_urls.length > 0 || row.close_screenshot_urls.length > 0
    return (
      <div className="bg-surface-800/50 rounded-xl p-3 border border-surface-700/50 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] w-4 shrink-0 font-mono text-slate-700">#{rank}</span>
          <span className="text-sm shrink-0">{isWin ? '🏆' : '💀'}</span>
          <span className="flex-1 text-xs font-bold text-slate-100 truncate">
            {cleanPairName(row.pair)}
            <span className="text-slate-500 font-normal ml-1 text-[10px]">{row.direction}</span>
          </span>
          <SessionBadge session={row.session_tag} />
          <span className="text-[10px] text-slate-600 shrink-0 tabular-nums">{row.closed_at}</span>
          <span className={`text-xs font-bold tabular-nums shrink-0 ${pnlColor}`}>
            {pnl >= 0 ? '+$' : '-$'}{Math.abs(pnl).toFixed(0)}
          </span>
        </div>
        {row.strategy_name && (
          <div className="pl-6 text-[10px] text-slate-500">{row.strategy_name}</div>
        )}
        {row.close_notes && (
          <div className="pl-6 text-[11px] text-slate-400 italic leading-snug line-clamp-3 border-l-2 border-surface-600 ml-6">
            {row.close_notes}
          </div>
        )}
        {/* Screenshot thumbnails — entry (blue border) | close (green border) */}
        {hasScreenshots && (
          <div className="pl-6 flex flex-wrap items-center gap-1.5 pt-0.5">
            {row.entry_screenshot_urls.slice(0, 3).map((url, i) => (
              <img
                key={url}
                src={url}
                alt={`entry ${i + 1}`}
                title="Click to compare entry vs close"
                className="w-14 h-10 object-cover rounded border border-blue-500/30 cursor-pointer hover:border-blue-400/70 hover:scale-105 transition-all duration-150"
                onClick={() => setSplitView({ entryUrls: row.entry_screenshot_urls, closeUrls: row.close_screenshot_urls })}
              />
            ))}
            {row.entry_screenshot_urls.length > 0 && row.close_screenshot_urls.length > 0 && (
              <div className="w-px h-7 bg-surface-600 mx-0.5 shrink-0" />
            )}
            {row.close_screenshot_urls.slice(0, 3).map((url, i) => (
              <img
                key={url}
                src={url}
                alt={`close ${i + 1}`}
                title="Click to compare entry vs close"
                className="w-14 h-10 object-cover rounded border border-emerald-500/30 cursor-pointer hover:border-emerald-400/70 hover:scale-105 transition-all duration-150"
                onClick={() => setSplitView({ entryUrls: row.entry_screenshot_urls, closeUrls: row.close_screenshot_urls })}
              />
            ))}
            <button
              className="ml-1 text-[9px] text-slate-700 hover:text-slate-300 transition-colors flex items-center gap-0.5"
              onClick={() => setSplitView({ entryUrls: row.entry_screenshot_urls, closeUrls: row.close_screenshot_urls })}
              title="Open side-by-side comparison"
            >
              <span>⇔</span><span>compare</span>
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {splitView && <ScreenshotSplitLightbox state={splitView} onClose={() => setSplitView(null)} />}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {top.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">
              🏆 Best trades
            </p>
            <div className="space-y-2">
              {top.map((r, i) => <TradeRow key={r.trade_id} rank={i + 1} row={r} isWin />)}
            </div>
          </div>
        )}
        {worst.length > 0 && (
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-widest font-semibold mb-2">
              💀 Worst trades
            </p>
            <div className="space-y-2">
              {worst.map((r, i) => <TradeRow key={r.trade_id} rank={i + 1} row={r} isWin={false} />)}
            </div>
          </div>
        )}
      </div>
    </>
  )
}

const ALL_SESSIONS = ['Asian', 'London', 'Overlap', 'New York', 'Weekend']

function StrategySessionMatrix({ data, period }: { data: StrategySessionRow[]; period: string }) {
  if (!data.length) {
    return <div className="text-slate-600 text-sm py-4 text-center">No data</div>
  }
  // Always show all 6 sessions — empty cells show "—"
  // This ensures Asia/Tokyo/Weekend always appear even when period filter hides their trades

  function cellColor(wr: number | null): string {
    if (wr === null) return 'bg-surface-700/30 text-slate-700'
    if (wr >= 65) return 'bg-emerald-500/25 text-emerald-300'
    if (wr >= 55) return 'bg-emerald-500/15 text-emerald-400'
    if (wr >= 45) return 'bg-amber-500/15 text-amber-400'
    return 'bg-red-500/15 text-red-400'
  }

  const hasDataForSession = (s: string) =>
    data.some(row => row.cells.some(c => c.session === s && c.trades > 0))

  return (
    <div className="space-y-2">
      {period !== 'all' && (
        <p className="text-[10px] text-slate-600">
          Period: <span className="text-slate-400 font-medium">{period}</span>
          {' '}— switch to <span className="text-slate-400 font-medium">All</span> to see full session history
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-separate border-spacing-0.5">
          <thead>
            <tr>
              <th className="text-left text-[10px] text-slate-600 uppercase tracking-wider font-medium pb-1 pr-3 whitespace-nowrap">
                Strategy
              </th>
              {ALL_SESSIONS.map(s => (
                <th
                  key={s}
                  className={`text-center text-[9px] uppercase tracking-wider font-medium pb-1 px-1 whitespace-nowrap ${hasDataForSession(s) ? 'text-slate-500' : 'text-slate-700'}`}
                >
                  <span className="inline-flex items-center justify-center gap-0.5">
                    {s}
                    <SessionInfoIcon session={s} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map(row => (
              <tr key={row.strategy}>
                <td className="pr-3 py-0.5 text-[11px] text-slate-300 font-medium whitespace-nowrap max-w-[8rem] truncate">
                  {row.strategy}
                </td>
                {ALL_SESSIONS.map(s => {
                  const cell = row.cells.find(c => c.session === s)
                  const wr = cell?.wr_pct ?? null
                  const trades = cell?.trades ?? 0
                  return (
                    <td key={s} className={`rounded px-1 py-0.5 text-center ${cellColor(wr)}`}>
                      {wr !== null ? (
                        <div className="flex flex-col items-center leading-none">
                          <span className="font-bold tabular-nums text-[11px]">{wr.toFixed(0)}%</span>
                          <span className="text-[8px] opacity-60 tabular-nums">{trades}t</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-800">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function PerformancePage() {
  const { activeProfileId: profileId } = useProfile()
  const [period, setPeriod] = useState<Period>('all')
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
            <Section title="Equity Curve">
              <EquityCurve data={report.equity_curve} />
            </Section>
            <Section title="Drawdown">
              <DrawdownChart data={report.drawdown} />
            </Section>
          </div>

          {/* ── 7. WR by Hour + WR by Session ────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="WR by Trade Open Hour">
              <HourlyWRChart data={report.wr_by_hour} />
            </Section>
            <Section title="WR by Session">
              <WRBarChart
                data={report.wr_by_session.filter(r => r.label !== 'Unknown')}
                labelTooltips={Object.fromEntries(
                  ['Asian', 'London', 'Overlap', 'New York', 'Weekend'].map(s => [s, sessionHint(s)])
                )}
              />
            </Section>
          </div>

          {/* ── 8. Pair Leaderboard + Trade Type Distribution ────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Pair Leaderboard">
              <PairLeaderboard rows={report.pair_leaderboard} />
            </Section>
            <Section title="Trade Type Distribution">
              <TradeTypeDist data={report.trade_type_dist} />
            </Section>
          </div>

          {/* ── 10. Tag Insights + Repeat Errors ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Section title="Tag Insights">
              <TagInsights winners={report.top_tags_winners} losers={report.top_tags_losers} />
            </Section>
            <Section title="Repeat Errors">
              <RepeatErrors data={report.repeat_errors} />
            </Section>
          </div>

          {/* ── 11. Top / Worst Trades ────────────────────────────────────── */}
          {(report.top_trades.length > 0 || report.worst_trades.length > 0) && (
            <Section title="Top / Worst Trades" hint="by realized P&L">
              <TopWorstTrades top={report.top_trades} worst={report.worst_trades} />
            </Section>
          )}

          {/* ── 12. Strategy × Session ────────────────────────────────────── */}
          {report.wr_by_strategy_session.length > 0 && (
            <Section title="Strategy × Session">
              <StrategySessionMatrix data={report.wr_by_strategy_session} period={period} />
            </Section>
          )}
        </div>
      )}
    </div>
  )
}
