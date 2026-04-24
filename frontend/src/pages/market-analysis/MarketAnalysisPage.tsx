// ── Market Analysis — Hub ─────────────────────────────────────────────────────
//
// Layout:
//   ① KPI strip     — fresh / stale / never / last session
//   ② Stale alert   — named modules that need refreshing
//   ③ Module grid   — cards with score ring, bias, freshness, last scores
//   ④ History table — last 30 sessions with full TF breakdown
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, Clock, BarChart2,
  TrendingUp, TrendingDown, Minus, Activity,
  ChevronRight, Zap,
} from 'lucide-react'
import { PageHeader }  from '../../components/ui/PageHeader'
import { StatCard }    from '../../components/ui/StatCard'
import { useProfile }  from '../../context/ProfileContext'
import { maApi }       from '../../lib/api'
import type { MAModule, MASessionListItem, MAStalenessItem, MABias, MATradeConclusion } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}
function fmtShort(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}
function daysAgo(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return 'Today'
  if (days === 1) return '1d ago'
  return `${days}d ago`
}

const MODULE_EMOJIS: Record<string, string> = {
  Crypto: '₿', Gold: '🥇', 'Gold (XAU)': '🥇', Forex: '💱', Indices: '📊',
}
const moduleEmoji = (name: string) => MODULE_EMOJIS[name] ?? '🧭'

const BIAS_CFG: Record<MABias, { text: string; bg: string; border: string; ring: string }> = {
  bullish: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', ring: '#22c55e' },
  bearish: { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     ring: '#ef4444' },
  neutral: { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   ring: '#f59e0b' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function BiasBadge({ bias, xs }: { bias: MABias | null; xs?: boolean }) {
  if (!bias) return <span className="text-slate-700 text-[10px]">—</span>
  const { text, bg, border } = BIAS_CFG[bias]
  const icon = bias === 'bullish'
    ? <TrendingUp  size={xs ? 8 : 10} />
    : bias === 'bearish'
      ? <TrendingDown size={xs ? 8 : 10} />
      : <Minus size={xs ? 8 : 10} />
  return (
    <span className={`inline-flex items-center gap-1 border rounded-full font-semibold uppercase tracking-wide
      ${text} ${bg} ${border} ${xs ? 'text-[9px] px-1.5 py-0.5' : 'text-[10px] px-2 py-0.5'}`}>
      {icon}{bias === 'bullish' ? 'Bullish' : bias === 'bearish' ? 'Bearish' : 'Neutral'}
    </span>
  )
}

function ScoreBar({ score, bias }: { score: string | null; bias: MABias | null }) {
  const pct = score ? parseFloat(score) : null
  if (pct === null) return <span className="text-slate-700 text-[10px]">—</span>
  const fill = bias === 'bullish' ? 'bg-emerald-500' : bias === 'bearish' ? 'bg-red-500' : 'bg-amber-400'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-surface-700 overflow-hidden">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono tabular-nums text-slate-500 w-6 text-right">{pct.toFixed(0)}</span>
    </div>
  )
}

function ScoreRing({ score, bias, size = 52 }: { score: string | null; bias: MABias | null; size?: number }) {
  const pct         = score ? parseFloat(score) : null
  const R           = (size - 8) / 2
  const C           = 2 * Math.PI * R
  const strokeColor = bias ? BIAS_CFG[bias].ring : '#1e1e35'
  const dashOffset  = pct !== null ? C - (pct / 100) * C : C
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#1e1e35" strokeWidth={6} />
        {pct !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={R}
            fill="none" stroke={strokeColor} strokeWidth={6} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {pct !== null
          ? <span className={`text-[11px] font-bold tabular-nums ${bias ? BIAS_CFG[bias].text : 'text-slate-600'}`}>{pct.toFixed(0)}</span>
          : <span className="text-slate-700 text-[9px]">—</span>}
      </div>
    </div>
  )
}

function FreshnessPill({ item }: { item: MAStalenessItem | undefined }) {
  if (!item) return null
  if (!item.last_analyzed_at) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-slate-500 bg-surface-700 border border-surface-600 rounded-full px-2 py-0.5">
        <Clock size={8} /> Never analyzed
      </span>
    )
  }
  if (item.is_stale) {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
        <AlertTriangle size={8} /> Stale · {daysAgo(item.days_old)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
      <CheckCircle2 size={8} /> Fresh · {daysAgo(item.days_old)}
    </span>
  )
}

// ── v2 Trade Conclusion badge ─────────────────────────────────────────────

function ConclusionBadge({ conclusion }: { conclusion: MATradeConclusion | null }) {
  if (!conclusion) return null
  const colorMap: Record<string, { bg: string; border: string; text: string }> = {
    green:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', text: 'text-emerald-300' },
    amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   text: 'text-amber-300'   },
    red:     { bg: 'bg-red-500/10',     border: 'border-red-500/25',     text: 'text-red-300'     },
    neutral: { bg: 'bg-surface-700',    border: 'border-surface-600',    text: 'text-slate-400'   },
  }
  const { bg, border, text } = colorMap[conclusion.color] ?? colorMap.neutral
  return (
    <div className={`rounded-xl border px-3 py-2 ${bg} ${border}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm leading-none">{conclusion.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] font-semibold leading-tight truncate ${text}`}>{conclusion.label}</p>
          <p className="text-[9px] text-slate-600 mt-0.5 leading-tight line-clamp-2">{conclusion.detail}</p>
        </div>
      </div>
      <p className="text-[9px] text-slate-700 mt-1.5">
        Size: <span className="text-slate-500">{conclusion.size_advice}</span>
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ModuleCard
// ─────────────────────────────────────────────────────────────────────────────

function ModuleCard({
  mod, staleness, last, onNew, onView,
}: {
  mod: MAModule
  staleness: MAStalenessItem | undefined
  last: MASessionListItem | undefined
  onNew: () => void
  onView: () => void
}) {
  const isStale   = !staleness?.last_analyzed_at || staleness.is_stale
  const isNever   = !staleness?.last_analyzed_at
  const mainBias  = (last?.bias_composite_a ?? last?.bias_htf_a ?? null) as MABias | null
  const mainScore = last?.score_composite_a ?? last?.score_htf_a ?? null

  const [conclusion, setConclusion] = useState<MATradeConclusion | null>(null)

  // Derive whether we have a v2 session to fetch a conclusion for
  const lastId  = last?.id ?? null
  const hasV2   = !!last?.score_composite_a

  useEffect(() => {
    if (!lastId || !hasV2) {
      // Schedule state reset outside the synchronous effect body
      const timer = setTimeout(() => setConclusion(null), 0)
      return () => clearTimeout(timer)
    }
    let cancelled = false
    maApi.getConclusion(lastId).then((c) => { if (!cancelled) setConclusion(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [lastId, hasV2])

  const borderCls = isNever
    ? 'border-surface-700 hover:border-surface-600'
    : isStale
      ? 'border-amber-500/25 hover:border-amber-500/45'
      : 'border-emerald-500/20 hover:border-emerald-500/35'

  return (
    <div
      onClick={last ? onView : onNew}
      className={`group relative rounded-2xl bg-surface-800 border p-5 flex flex-col gap-3.5 cursor-pointer
        transition-all duration-200 hover:bg-surface-700/50 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/20
        ${borderCls}`}
    >
      {/* Header: emoji + name + ring */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-surface-700 border border-surface-600 flex items-center justify-center text-lg shrink-0">
            {moduleEmoji(mod.name)}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <h3 className="text-sm font-semibold text-slate-200 leading-tight truncate">{mod.name}</h3>
            {mod.is_dual && (
              <p className="text-[9px] text-slate-600 mt-0.5">
                {mod.asset_a} <span className="text-slate-700">vs</span> {mod.asset_b}
              </p>
            )}
            {!mod.is_dual && mod.description && (
              <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-1">{mod.description}</p>
            )}
          </div>
        </div>
        <ScoreRing score={mainScore} bias={mainBias} size={48} />
      </div>

      {/* Freshness */}
      <FreshnessPill item={staleness} />

      {/* v2 Trade Conclusion */}
      {conclusion && <ConclusionBadge conclusion={conclusion} />}

      {/* Last scores */}
      {last ? (
        <div className="space-y-2 flex-1">
          {mod.is_dual ? (
            <>
              {/* ── Asset A ── */}
              <p className="text-[9px] text-slate-500 uppercase tracking-wide font-medium">{mod.asset_a ?? 'A'}</p>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-700 w-6 shrink-0">HTF</span>
                <ScoreBar score={last.score_htf_a} bias={last.bias_htf_a as MABias | null} />
                <BiasBadge bias={last.bias_htf_a as MABias | null} xs />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-700 w-6 shrink-0">MTF</span>
                <ScoreBar score={last.score_mtf_a} bias={last.bias_mtf_a as MABias | null} />
                <BiasBadge bias={last.bias_mtf_a as MABias | null} xs />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-700 w-6 shrink-0">LTF</span>
                <ScoreBar score={last.score_ltf_a} bias={last.bias_ltf_a as MABias | null} />
                <BiasBadge bias={last.bias_ltf_a as MABias | null} xs />
              </div>
              {/* ── Asset B ── */}
              <p className="text-[9px] text-slate-500 uppercase tracking-wide font-medium mt-1">{mod.asset_b ?? 'B'}</p>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-700 w-6 shrink-0">HTF</span>
                <ScoreBar score={last.score_htf_b} bias={last.bias_htf_b as MABias | null} />
                <BiasBadge bias={last.bias_htf_b as MABias | null} xs />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-700 w-6 shrink-0">MTF</span>
                <ScoreBar score={last.score_mtf_b} bias={last.bias_mtf_b as MABias | null} />
                <BiasBadge bias={last.bias_mtf_b as MABias | null} xs />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-700 w-6 shrink-0">LTF</span>
                <ScoreBar score={last.score_ltf_b} bias={last.bias_ltf_b as MABias | null} />
                <BiasBadge bias={last.bias_ltf_b as MABias | null} xs />
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-600 w-8 shrink-0 uppercase tracking-wide">HTF</span>
                <ScoreBar score={last.score_htf_a} bias={last.bias_htf_a as MABias | null} />
                <BiasBadge bias={last.bias_htf_a as MABias | null} xs />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-600 w-8 shrink-0 uppercase tracking-wide">MTF</span>
                <ScoreBar score={last.score_mtf_a} bias={last.bias_mtf_a as MABias | null} />
                <BiasBadge bias={last.bias_mtf_a as MABias | null} xs />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-600 w-8 shrink-0 uppercase tracking-wide">LTF</span>
                <ScoreBar score={last.score_ltf_a} bias={last.bias_ltf_a as MABias | null} />
                <BiasBadge bias={last.bias_ltf_a as MABias | null} xs />
              </div>
            </>
          )}
          <p className="text-[9px] text-slate-700 pt-0.5">
            Last: <span className="text-slate-600">{fmt(last.analyzed_at)}</span>
          </p>
        </div>
      ) : (
        <div className="flex-1 rounded-xl border border-dashed border-surface-600 py-5 flex flex-col items-center justify-center gap-1.5">
          <Activity size={16} className="text-slate-700" />
          <p className="text-[11px] text-slate-600">No analysis yet</p>
        </div>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onNew() }}
        className="w-full mt-auto flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl
          text-[11px] font-medium text-brand-400 border border-brand-500/20 bg-brand-500/5
          hover:bg-brand-500/12 hover:border-brand-500/35 transition-all duration-150"
      >
        <Plus size={11} /> New Analysis
        <ChevronRight size={10} className="ml-auto opacity-30 group-hover:opacity-70 transition-opacity" />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// History row
// ─────────────────────────────────────────────────────────────────────────────

function HistoryRow({ s, modules }: { s: MASessionListItem; modules: MAModule[] }) {
  const mod = modules.find((m) => m.id === s.module_id)
  return (
    <tr className="border-b border-surface-700/40 hover:bg-surface-700/20 transition-colors">
      <td className="px-4 py-3 whitespace-nowrap">
        <span className="text-[11px] text-slate-500 font-mono">{fmtShort(s.analyzed_at)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">{mod ? moduleEmoji(mod.name) : '🧭'}</span>
          <span className="text-xs font-medium text-slate-200">{mod ? mod.name : `Module #${s.module_id}`}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ScoreBar score={s.score_htf_a} bias={s.bias_htf_a as MABias | null} />
          <BiasBadge bias={s.bias_htf_a as MABias | null} xs />
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ScoreBar score={s.score_mtf_a} bias={s.bias_mtf_a as MABias | null} />
          <BiasBadge bias={s.bias_mtf_a as MABias | null} xs />
        </div>
      </td>
      {/* v2 composite */}
      <td className="px-4 py-3">
        {s.score_composite_a != null ? (
          <div className="flex items-center gap-1.5">
            <Zap size={9} className="text-brand-400 shrink-0" />
            <ScoreBar score={s.score_composite_a} bias={s.bias_composite_a as MABias | null} />
            <BiasBadge bias={s.bias_composite_a as MABias | null} xs />
          </div>
        ) : <span className="text-slate-700 text-[10px]">—</span>}
      </td>
      <td className="px-4 py-3">
        {s.score_htf_b != null ? (
          <div className="flex items-center gap-2">
            <ScoreBar score={s.score_htf_b} bias={s.bias_htf_b as MABias | null} />
            <BiasBadge bias={s.bias_htf_b as MABias | null} xs />
          </div>
        ) : <span className="text-slate-700 text-[10px]">—</span>}
      </td>
      <td className="px-4 py-3 max-w-[200px]">
        {s.notes
          ? <p className="text-[11px] text-slate-500 truncate" title={s.notes}>{s.notes}</p>
          : <span className="text-slate-700 text-[10px]">—</span>}
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function MarketAnalysisPage() {
  const { activeProfile } = useProfile()
  const navigate = useNavigate()

  const [modules,   setModules]   = useState<MAModule[]>([])
  const [staleness, setStaleness] = useState<MAStalenessItem[]>([])
  const [sessions,  setSessions]  = useState<MASessionListItem[]>([])
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const mods = await maApi.listModules()
      setModules(mods)
      if (activeProfile) {
        const [stale, sess] = await Promise.all([
          maApi.getStaleness(activeProfile.id),
          maApi.listSessions(undefined, 30),   // global — no profile filter
        ])
        setStaleness(stale)
        setSessions(sess)
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeProfile])

  useEffect(() => { fetchAll() }, [fetchAll])

  const freshCount = staleness.filter((s) => !s.is_stale && s.last_analyzed_at !== null).length
  const staleCount = staleness.filter((s) =>  s.is_stale && s.last_analyzed_at !== null).length
  const neverCount = staleness.filter((s) =>  s.last_analyzed_at === null).length
  const staleNames = staleness.filter((s) =>  s.is_stale).map((s) => s.module_name)

  const latestSess = sessions[0] ?? null
  const latestDays = latestSess
    ? Math.floor((Date.now() - new Date(latestSess.analyzed_at).getTime()) / 86_400_000)
    : null

  const lastByMod: Record<number, MASessionListItem> = {}
  for (const s of [...sessions].reverse()) lastByMod[s.module_id] = s

  const goNew = (moduleId?: number) => {
    if (!activeProfile) return
    navigate(`/market-analysis/new${moduleId != null ? `?module=${moduleId}` : ''}`)
  }

  const goView = (sessionId: number) => {
    // Do NOT pass ?module= here — it would init step=2 and trigger loadIndicators
    // which clears answers before the session fetch completes.
    navigate(`/market-analysis/new?session=${sessionId}`)
  }

  return (
    <div>
      <PageHeader
        icon="🧭"
        title="Market Analysis"
        subtitle="Structured indicator checklist — compute bias scores per module"
        info="Scores 0–39 = Bearish · 40–60 = Neutral · 61–100 = Bullish. Sessions older than 7 days are flagged stale."
        actions={
          <>
            <button type="button" className="atd-btn-ghost" onClick={fetchAll} disabled={loading} title="Refresh">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              disabled={!activeProfile}
              className="atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => goNew()}
            >
              <Plus size={14} /> New Analysis
            </button>
          </>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Fresh"
          value={loading ? <Loader2 size={18} className="animate-spin text-slate-600" /> : String(freshCount)}
          sub={`of ${modules.length} modules`}
          accent="bull"
          info="Modules with analysis done in the last 7 days."
        />
        <StatCard
          label="Stale"
          value={loading ? '…' : String(staleCount)}
          sub={staleCount > 0 ? '⚠️ needs update' : 'none — great!'}
          accent={staleCount > 0 ? 'neutral' : 'bull'}
          info="Modules with last analysis > 7 days ago."
        />
        <StatCard
          label="Never Analyzed"
          value={loading ? '…' : String(neverCount)}
          sub={neverCount > 0 ? 'no data yet' : 'all covered ✓'}
          accent={neverCount > 0 ? 'bear' : 'bull'}
          info="Modules with no session recorded yet."
        />
        <StatCard
          label="Last Analysis"
          value={loading ? '…' : latestDays != null ? daysAgo(latestDays) : '—'}
          sub={latestSess ? fmt(latestSess.analyzed_at) : 'no sessions yet'}
          accent="brand"
          info="How long ago the most recent analysis session was run."
        />
      </div>

      {/* No profile guard */}
      {!activeProfile && (
        <div className="rounded-2xl bg-surface-800 border border-surface-700 p-12 text-center">
          <Activity size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-slate-500 text-sm">Select or create a profile to run market analysis.</p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 flex items-center gap-2 text-sm text-red-400">
          <AlertTriangle size={14} className="shrink-0" /> {error}
        </div>
      )}

      {activeProfile && (
        <>
          {/* Stale alert */}
          {staleNames.length > 0 && (
            <div className="mb-6 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3.5 flex items-start gap-3">
              <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-amber-300 font-medium mb-0.5">
                  {staleNames.length === 1
                    ? `${staleNames[0]} is stale (>7 days)`
                    : `${staleNames.join(', ')} are stale (>7 days)`}
                </p>
                <p className="text-[11px] text-amber-400/60">
                  Run a fresh analysis before placing trades in {staleNames.length === 1 ? 'this market' : 'these markets'}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => goNew()}
                className="shrink-0 text-[11px] font-medium text-amber-400 border border-amber-500/30 rounded-lg px-3 py-1.5 hover:bg-amber-500/10 transition-colors"
              >
                Run now →
              </button>
            </div>
          )}

          {/* Module grid header */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart2 size={14} className="text-brand-400" />
              <h2 className="text-sm font-semibold text-slate-200">Modules</h2>
              <span className="text-[10px] text-slate-600">{loading ? '…' : `${modules.length} active`}</span>
              {loading && <Loader2 size={11} className="animate-spin text-slate-600 ml-1" />}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-600">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block opacity-70" /> Fresh</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block opacity-70" /> Stale</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-surface-500 inline-block" /> Never</span>
            </div>
          </div>

          {/* Module cards */}
          {!loading && modules.length === 0 ? (
            <div className="mb-8 rounded-2xl bg-surface-800 border border-surface-700 p-10 text-center text-slate-600 text-sm">
              No active modules found.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-10">
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-2xl bg-surface-800 border border-surface-700 h-52 animate-pulse" />
                  ))
                : modules.map((mod) => (
                    <ModuleCard
                      key={mod.id}
                      mod={mod}
                      staleness={staleness.find((s) => s.module_id === mod.id)}
                      last={lastByMod[mod.id]}
                      onNew={() => goNew(mod.id)}
                      onView={() => lastByMod[mod.id] && goView(lastByMod[mod.id].id)}
                    />
                  ))}
            </div>
          )}

          {/* History header */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-300">Session History</h2>
              <span className="text-[10px] text-slate-600">last 30</span>
              {loading && <Loader2 size={11} className="animate-spin text-slate-600" />}
            </div>
            <span className="text-[10px] text-slate-600 tabular-nums">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* History table */}
          <div className="rounded-2xl bg-surface-800 border border-surface-700 overflow-hidden mb-3">
            {!loading && sessions.length === 0 ? (
              <div className="px-5 py-14 flex flex-col items-center gap-3 text-center">
                <BarChart2 size={28} className="text-slate-700" />
                <p className="text-slate-600 text-sm">No sessions recorded yet.</p>
                <button type="button" onClick={() => goNew()} className="atd-btn-primary text-xs py-1.5">
                  <Plus size={12} /> Run first analysis
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-surface-700 bg-surface-800/80">
                      {['Date', 'Module', 'HTF Score', 'MTF Score', 'Composite ⚡', 'Dual HTF', 'Notes'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-[10px] font-semibold text-slate-600 uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => <HistoryRow key={s.id} s={s} modules={modules} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-slate-600 px-1">
            <span>Score legend (v1 HTF/MTF):</span>
            <span className="text-red-400">▌ 0–39 Bearish</span>
            <span className="text-amber-400">▌ 40–60 Neutral</span>
            <span className="text-emerald-400">▌ 61–100 Bullish</span>
            <span className="text-slate-700">·</span>
            <span className="text-brand-400">⚡ Composite v2: ≤34 Bear · 35–64 Neutral · ≥65 Bull</span>
          </div>
        </>
      )}
    </div>
  )
}
