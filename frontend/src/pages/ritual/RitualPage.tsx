// ── Ritual Page ──────────────────────────────────────────────────────────────
// Trading Session Planner — start sessions, follow steps, track discipline.
//
// Layout (desktop): 2-col — main (steps + WL) | sidebar (pinned pairs)
// Layout (mobile):  1-col — sections stack vertically

import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Star, Pin, PinOff, Plus, Download, RefreshCw,
  ChevronRight, ChevronLeft, CheckCircle2, SkipForward,
  Timer, Flame, BookOpen, Clock, XCircle,
  ExternalLink, Loader2, Settings,
  ChevronDown, ChevronUp, Minus, FileText,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { ritualApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type {
  RitualSession, RitualStep, PinnedPair,
  SmartWLResult, WeeklyScore, StepLog,
  SessionType, SessionOutcome, PinnedTF,
} from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Constants & helpers
// ─────────────────────────────────────────────────────────────────────────────

// inline type for market analysis staleness (field names match backend StalenessItem)
type MAStaleness = { module_name: string; last_analyzed_at: string | null; days_old: number | null; is_stale: boolean }

const SESSION_TYPES: { type: SessionType; emoji: string; label: string; when: string; desc: string; est: string; accent: string; gradient: string; steps: string[] }[] = [
  {
    type: 'weekly_setup',
    emoji: '📅',
    label: 'Weekly Setup',
    when: 'Monday',
    desc: 'Full market scan + watchlist for the week',
    est: '~45 min',
    accent: '#6366f1',
    gradient: 'from-indigo-950/60 to-surface-800/40',
    steps: ['Market Analysis', 'Smart Watchlist', 'TradingView', 'Goals Review'],
  },
  {
    type: 'trade_session',
    emoji: '🎯',
    label: 'Trade Session',
    when: 'Before each session',
    desc: 'Quick VI check + pins + trade decision',
    est: '~30 min',
    accent: '#f59e0b',
    gradient: 'from-amber-950/60 to-surface-800/40',
    steps: ['VI Check', 'Pins Review', 'Smart WL', 'Outcome'],
  },
  {
    type: 'weekend_review',
    emoji: '📊',
    label: 'Weekend Review',
    when: 'Sat / Sun',
    desc: 'Analytics + Journal + Goals + Learning',
    est: '~35 min',
    accent: '#2dd4bf',
    gradient: 'from-teal-950/60 to-surface-800/40',
    steps: ['Analytics', 'Journal', 'Goals', 'Learning Note'],
  },
]

const OUTCOME_OPTIONS: { value: SessionOutcome; label: string; emoji: string; color: string }[] = [
  { value: 'trade_opened',   label: 'Trade Opened',   emoji: '✅', color: 'text-green-400' },
  { value: 'pairs_pinned',   label: 'Pairs Pinned',   emoji: '📌', color: 'text-brand-400' },
  { value: 'no_opportunity', label: 'No Opportunity', emoji: '🔵', color: 'text-blue-400' },
  { value: 'vol_too_low',    label: 'Vol Too Low',    emoji: '⚠️', color: 'text-amber-400' },
]

const TF_OPTIONS: PinnedTF[] = ['1W', '1D', '4H', '1H', '15m']
const TF_COLORS: Record<string, string> = {
  '1W': 'text-purple-400 border-purple-700/40 bg-purple-900/20',
  '1D': 'text-blue-400 border-blue-700/40 bg-blue-900/20',
  '4H': 'text-cyan-400 border-cyan-700/40 bg-cyan-900/20',
  '1H': 'text-green-400 border-green-700/40 bg-green-900/20',
  '15m': 'text-amber-400 border-amber-700/40 bg-amber-900/20',
}

function ttlColor(pct: number | null): string {
  if (pct === null) return 'text-slate-400 border-slate-700'
  if (pct > 0.5) return 'text-green-400 border-green-700/60 bg-green-900/20'
  if (pct > 0.25) return 'text-amber-400 border-amber-700/60 bg-amber-900/20'
  return 'text-red-400 border-red-700/60 bg-red-900/20'
}

function fmtTTL(h: number | null): string {
  if (h === null) return '—'
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 24) return `${h.toFixed(1)}h`
  return `${Math.round(h / 24)}d`
}

function gradeColor(grade: string): string {
  switch (grade) {
    case 'S': return 'text-yellow-400'
    case 'A': return 'text-green-400'
    case 'B': return 'text-blue-400'
    case 'C': return 'text-amber-400'
    default:  return 'text-red-400'
  }
}

function useElapsed(startedAt: string | null): string {
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    if (!startedAt) return
    const update = () => {
      const sec = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
      const m = Math.floor(sec / 60).toString().padStart(2, '0')
      const s = (sec % 60).toString().padStart(2, '0')
      setElapsed(`${m}:${s}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startedAt])
  return elapsed
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TFBadge({ tf }: { tf: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold border',
      TF_COLORS[tf] ?? 'text-slate-400 border-slate-700',
    )}>
      {tf}
    </span>
  )
}

// ── Score ring ────────────────────────────────────────────────────────────────
function ScoreRing({ score, maxScore, pct, grade }: { score: number; maxScore: number; pct: number; grade: string }) {
  const radius = 28
  const circumference = 2 * Math.PI * radius
  const strokeDash = circumference * (pct / 100)

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r={radius} fill="none" stroke="#1e293b" strokeWidth="5" />
          <circle
            cx="36" cy="36" r={radius} fill="none"
            stroke={pct >= 75 ? '#4ade80' : pct >= 50 ? '#60a5fa' : pct >= 30 ? '#facc15' : '#f87171'}
            strokeWidth="5"
            strokeDasharray={`${strokeDash} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-lg font-bold leading-none', gradeColor(grade))}>{grade}</span>
          <span className="text-[10px] text-slate-500">{pct}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-slate-200">{score} <span className="text-slate-500 text-xs">/ {maxScore}</span></p>
        <p className="text-[10px] text-slate-500">This week</p>
      </div>
    </div>
  )
}

// ── Market Analysis step panel ───────────────────────────────────────────────
function MarketAnalysisPanel({
  profileId, logId, onComplete,
}: {
  profileId: number
  logId: number
  onComplete: (logId: number, status: 'done' | 'skipped', output?: Record<string, unknown>) => void
}) {
  const navigate = useNavigate()
  const { activeProfile } = useProfile()
  const [staleness, setStaleness] = useState<MAStaleness[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/profiles/${profileId}/market-analysis/staleness`)
      .then(r => r.ok ? r.json() as Promise<MAStaleness[]> : [])
      .then(setStaleness)
      .catch(() => setStaleness([]))
      .finally(() => setLoading(false))
  }, [profileId])

  // Modules the profile has actually used before → these matter
  const relevantStaleness = staleness?.filter(s => s.last_analyzed_at !== null) ?? []
  // Modules never analyzed → optional, informational only
  const neverDone = staleness?.filter(s => s.last_analyzed_at === null) ?? []
  // Only alarming: previously-used modules now stale
  const trueStale = relevantStaleness.filter(s => s.is_stale)
  const allFresh = staleness !== null && staleness.length > 0 && trueStale.length === 0

  return (
    <div className="mt-2 rounded-lg border border-surface-700 bg-surface-900/60 p-3 space-y-2">
      {loading ? (
        <div className="flex items-center gap-2">
          <Loader2 size={12} className="animate-spin text-slate-500" />
          <span className="text-xs text-slate-500">Checking Market Analysis status…</span>
        </div>
      ) : staleness === null || staleness.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">No Market Analysis modules configured.</p>
          <button
            onClick={() => navigate('/market-analysis')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-700/20 border border-brand-600/40 text-brand-400 text-xs font-medium hover:bg-brand-700/30 transition-colors"
          >
            <ExternalLink size={11} /> Open Market Analysis
          </button>
        </div>
      ) : allFresh ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={14} className="text-green-500" />
              <span className="text-xs text-green-400 font-medium">Market Analysis up to date</span>
              {activeProfile?.market_type && (
                <span className="text-[10px] text-slate-600">({activeProfile.market_type})</span>
              )}
            </div>
            <button
              onClick={() => onComplete(logId, 'done', { market_analysis: 'fresh' })}
              className="px-2.5 py-1 rounded-lg bg-green-700/20 border border-green-700/40 text-green-400 text-xs font-medium hover:bg-green-700/30 transition-colors"
            >
              ✓ Done
            </button>
          </div>
          <button
            onClick={() => navigate('/market-analysis')}
            className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-brand-400 transition-colors"
          >
            <ExternalLink size={10} /> Open Market Analysis →
          </button>
          {neverDone.length > 0 && (
            <p className="text-[10px] text-slate-600">
              {neverDone.length} module(s) never analyzed — optional for {activeProfile?.market_type ?? 'your'} profile
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400 text-sm">⚠</span>
            <span className="text-xs text-amber-400 font-medium">
              {trueStale.length} module(s) not updated this week
            </span>
          </div>
          <div className="space-y-1 rounded-lg border border-surface-700 bg-surface-900 p-2">
            {relevantStaleness.map(s => (
              <div key={s.module_name} className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{s.module_name}</span>
                <span className={cn('text-[10px] font-medium', s.is_stale ? 'text-amber-400' : 'text-green-400')}>
                  {s.is_stale ? `${s.days_old ?? '?'}d ago` : '✓ OK'}
                </span>
              </div>
            ))}
            {neverDone.length > 0 && (
              <p className="text-[10px] text-slate-600 mt-1 pt-1 border-t border-surface-700/50">
                {neverDone.length} module(s) never used — likely not relevant to {activeProfile?.market_type ?? 'your'} profile
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/market-analysis')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-700/20 border border-brand-600/40 text-brand-400 text-xs font-medium hover:bg-brand-700/30 transition-colors"
            >
              <ExternalLink size={11} />
              Open Market Analysis
            </button>
            <button
              onClick={() => onComplete(logId, 'done', { market_analysis: 'skip_update' })}
              className="px-2.5 py-1 rounded-lg border border-surface-600 text-slate-500 text-xs hover:text-slate-300 transition-colors"
            >
              Continue anyway
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step item ──────────────────────────────────────────────────────────────────
interface StepItemProps {
  log: StepLog
  step?: RitualStep
  isCurrent: boolean
  profileId: number
  onComplete: (logId: number, status: 'done' | 'skipped', output?: Record<string, unknown>) => void
  onGenerateWL?: () => void
  wlResult?: SmartWLResult | null
  wlLoading?: boolean
  downloadUrl?: string
  topN?: number
  setTopN?: (n: number) => void
  onPin?: (pair: string, tf: string) => Promise<void>
}

function StepItem({
  log, step, isCurrent, profileId,
  onComplete, onGenerateWL, wlResult, wlLoading, downloadUrl, topN, setTopN, onPin,
}: StepItemProps) {
  const navigate = useNavigate()
  const isDone = log.status === 'done'
  const isSkipped = log.status === 'skipped'
  const isDoneOrSkipped = isDone || isSkipped
  const [note, setNote] = useState('')
  const [showNote, setShowNote] = useState(false)
  const isNoteStep = log.step_type === 'learning_note'
  const hasOptionalNote = ['vi_check', 'pinned_review', 'goals_review', 'analytics', 'journal'].includes(log.step_type)
  const handleDone = () => {
    const out: Record<string, unknown> = {}
    if (note.trim()) out.note = note.trim()
    onComplete(log.id, 'done', Object.keys(out).length > 0 ? out : undefined)
  }

  return (
    <div className={cn(
      'relative rounded-xl border transition-all overflow-hidden',
      isCurrent && !isDoneOrSkipped
        ? 'border-brand-600/60 bg-brand-950/30 shadow-lg shadow-brand-900/30'
        : isDone
          ? 'border-green-800/30 bg-green-950/10'
          : isSkipped
            ? 'border-surface-700 bg-surface-800/30 opacity-50'
            : 'border-surface-700/60 bg-surface-800/30',
    )}>
      {/* Left accent bar for current step */}
      {isCurrent && !isDoneOrSkipped && (
        <div className="absolute inset-y-0 left-0 w-[3px] bg-brand-500 rounded-l-xl" />
      )}
      <div className="flex items-start gap-3 p-3 pl-4">
        {/* Status icon */}
        <div className="mt-0.5 shrink-0">
          {isDone ? (
            <CheckCircle2 size={18} className="text-green-400" />
          ) : isSkipped ? (
            <SkipForward size={18} className="text-slate-500" />
          ) : (
            <div className={cn(
              'w-[18px] h-[18px] rounded-full border-2 shrink-0',
              isCurrent
                ? 'border-brand-400 bg-brand-900/40 shadow-[0_0_6px_rgba(99,102,241,0.4)]'
                : 'border-slate-700 bg-surface-800/30',
            )} />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base leading-none">{log.emoji}</span>
            <span className={cn(
              'text-sm font-medium',
              isDoneOrSkipped ? 'text-slate-400' : 'text-slate-200',
            )}>
              {step?.label ?? log.step_type}
            </span>
            {step?.est_minutes && (
              <span className="flex items-center gap-0.5 text-[11px] text-slate-500">
                <Clock size={10} />
                {step.est_minutes}m
              </span>
            )}
            {step?.is_mandatory === false && (
              <span className="text-[10px] text-slate-600 italic">optional</span>
            )}
          </div>

          {/* Linked module shortcut */}
          {step?.module_path && isCurrent && !isDoneOrSkipped && log.step_type !== 'market_analysis' && (
            <button
              onClick={() => navigate(step.module_path!)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 transition-colors"
            >
              <ExternalLink size={10} />
              Open {step.linked_module}
            </button>
          )}

          {/* Market Analysis status panel */}
          {log.step_type === 'market_analysis' && isCurrent && !isDoneOrSkipped && (
            <MarketAnalysisPanel
              profileId={profileId}
              logId={log.id}
              onComplete={onComplete}
            />
          )}

          {/* Smart WL panel */}
          {log.step_type === 'smart_wl' && isCurrent && !isDoneOrSkipped && (
            <SmartWLPanel
              result={wlResult ?? null}
              loading={wlLoading ?? false}
              downloadUrl={downloadUrl ?? ''}
              topN={topN ?? 12}
              setTopN={setTopN ?? (() => {})}
              onGenerate={onGenerateWL ?? (() => {})}
              onPin={onPin}
            />
          )}

          {/* TV analysis: show WL result with pin buttons, no generate controls */}
          {log.step_type === 'tv_analysis' && isCurrent && !isDoneOrSkipped && wlResult && (
            <SmartWLPanel
              result={wlResult}
              loading={false}
              downloadUrl={downloadUrl ?? ''}
              topN={topN ?? 12}
              setTopN={setTopN ?? (() => {})}
              onGenerate={onGenerateWL ?? (() => {})}
              onPin={onPin}
              readOnly
            />
          )}

          {/* Outcome selector */}
          {log.step_type === 'outcome' && isCurrent && !isDoneOrSkipped && (
            <OutcomeSelector onSelect={(o) => onComplete(log.id, 'done', { outcome: o })} />
          )}

          {/* Mandatory note textarea for learning_note step */}
          {isNoteStep && isCurrent && !isDoneOrSkipped && (
            <div className="mt-3 space-y-2">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you learn this week? Key setups, patterns, market dynamics, personal discipline..."
                rows={4}
                className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-brand-600 transition-colors"
              />
              <button
                onClick={handleDone}
                disabled={!note.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700/30 border border-green-700/50 text-green-400 text-xs font-medium hover:bg-green-700/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={12} />
                Save Note &amp; Done
              </button>
            </div>
          )}

          {/* Optional note for reflective steps */}
          {hasOptionalNote && isCurrent && !isDoneOrSkipped && (
            <div className="mt-2">
              {!showNote ? (
                <button
                  onClick={() => setShowNote(true)}
                  className="text-[11px] text-slate-600 hover:text-slate-400 flex items-center gap-1 transition-colors"
                >
                  <FileText size={10} />
                  Add a note
                </button>
              ) : (
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Your observations..."
                  rows={2}
                  autoFocus
                  className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-brand-600 transition-colors"
                />
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        {isCurrent && !isDoneOrSkipped && log.step_type !== 'outcome' && !isNoteStep && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleDone}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-green-700/20 border border-green-700/40 text-green-400 text-xs font-medium hover:bg-green-700/30 transition-colors"
              title="Mark as done"
            >
              <CheckCircle2 size={12} />
              Done
            </button>
            {step?.is_mandatory === false && (
              <button
                onClick={() => onComplete(log.id, 'skipped')}
                className="p-1 rounded-lg text-slate-600 hover:text-slate-400 transition-colors"
                title="Skip this step"
              >
                <SkipForward size={14} />
              </button>
            )}
          </div>
        )}

        {isDone && log.completed_at && (
          <span className="text-[10px] text-slate-600 shrink-0 mt-0.5">
            {new Date(log.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Outcome selector ──────────────────────────────────────────────────────────
function OutcomeSelector({ onSelect }: { onSelect: (o: SessionOutcome) => void }) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {OUTCOME_OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onSelect(o.value)}
          className={cn(
            'flex flex-col items-center gap-1 p-2.5 rounded-xl border text-center transition-all',
            'border-surface-600 bg-surface-800/40 hover:bg-surface-700/60',
            o.color,
          )}
        >
          <span className="text-lg">{o.emoji}</span>
          <span className="text-[11px] font-medium leading-tight">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

// ── Smart WL panel ────────────────────────────────────────────────────────────
function SmartWLPanel({
  result, loading, downloadUrl, topN, setTopN, onGenerate, onPin, readOnly,
}: {
  result: SmartWLResult | null
  loading: boolean
  downloadUrl: string
  topN: number
  setTopN: (n: number) => void
  onGenerate: () => void
  onPin?: (pair: string, tf: string) => Promise<void>
  readOnly?: boolean
}) {
  const navigate = useNavigate()
  const [expandedTFs, setExpandedTFs] = useState<Set<string>>(new Set())
  const hasData = result !== null && Object.values(result.timeframes).some(pairs => pairs.length > 0)
  const PREVIEW = 8

  const toggleTF = (tf: string) => setExpandedTFs(prev => {
    const next = new Set(prev)
    if (next.has(tf)) { next.delete(tf) } else { next.add(tf) }
    return next
  })
  return (
    <div className="mt-3 space-y-3">
      {/* Controls — hidden in readOnly (tv_analysis) mode */}
      {!readOnly && (
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-slate-400 whitespace-nowrap">Per TF:</label>
          <input
            type="range" min={3} max={16} step={1} value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="w-24 accent-brand-500"
          />
          <span className="text-[12px] text-brand-400 font-semibold w-6 text-right">{topN}</span>
          <span className="text-[10px] text-slate-600">/TF</span>
        </div>
        <button
          onClick={onGenerate}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-700/20 border border-brand-600/40 text-brand-400 text-xs font-medium hover:bg-brand-700/30 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Generate
        </button>
        {result && (
          <a
            href={downloadUrl}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-700/20 border border-green-700/40 text-green-400 text-xs font-medium hover:bg-green-700/30 transition-colors"
          >
            <Download size={12} />
            Download
          </a>
        )}
      </div>
      )}

      {/* Result preview — no data state */}
      {result && !hasData && (
        <div className="mt-2 rounded-lg border border-amber-700/40 bg-amber-900/10 p-3">
          <p className="text-xs text-amber-400 font-medium">⚠️ No volatility data</p>
          <p className="text-xs text-slate-500 mt-1">
            Run the volatility analysis first to populate the watchlists.
          </p>
          <button
            onClick={() => navigate('/volatility/market')}
            className="mt-2 flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors"
          >
            <ExternalLink size={11} /> Go to Volatility →
          </button>
        </div>
      )}

      {/* Result preview — data available */}
      {result && hasData && (
        <div className="rounded-lg border border-surface-700 bg-surface-900/60 divide-y divide-surface-700/60">
          {result.market_analysis_pairs.length > 0 && (
            <div className="px-3 py-2">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">
                📊 Market Analysis
              </p>
              <div className="flex flex-wrap gap-1">
                {result.market_analysis_pairs.map((sym) => (
                  <span key={sym} className="text-[11px] text-slate-400 bg-surface-800 rounded px-1.5 py-0.5 border border-surface-700">
                    {sym}
                  </span>
                ))}
              </div>
            </div>
          )}
          {Object.entries(result.timeframes)
            .filter(([, pairs]) => pairs.length > 0)
            .map(([tf, pairs]) => {
            const isExpanded = expandedTFs.has(tf)
            const visible = isExpanded ? pairs : pairs.slice(0, PREVIEW)
            const hidden = pairs.length - PREVIEW
            return (
            <div key={tf} className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <TFBadge tf={tf} />
                <span className="text-[10px] text-slate-500">{pairs.length} pairs</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {visible.map((p) => (
                  <div key={p.pair} className={cn(
                    'group relative flex flex-col rounded-lg overflow-hidden transition-colors',
                    p.is_pinned
                      ? 'bg-brand-900/30 border border-brand-700/40 shadow-sm shadow-brand-900/20'
                      : 'bg-surface-800/50 border border-surface-700/40 hover:bg-surface-700/50',
                  )}>
                    <div className="flex items-center gap-1.5 px-1.5 pt-1 pb-0.5">
                      {p.is_pinned && <span className="text-[9px] text-yellow-400 shrink-0">★</span>}
                      <span className="text-[11px] text-slate-200 font-semibold truncate flex-1">
                        {p.display_name}
                      </span>
                      <span className="text-[10px] tabular-nums text-slate-500 shrink-0">{p.vi_score.toFixed(2)}</span>
                      {!p.is_pinned && onPin && (
                        <button
                          onClick={() => onPin(p.pair, tf)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 p-0.5 text-slate-600 hover:text-yellow-400"
                          title={`Pin ${p.display_name} (${tf})`}
                        >
                          <Pin size={9} />
                        </button>
                      )}
                    </div>
                    {/* vi_score bar */}
                    <div className="h-[2px] bg-surface-700/60">
                      <div
                        className={cn(
                          'h-full transition-all rounded-sm',
                          p.vi_score > 0.67 ? 'bg-red-500/70' :
                          p.vi_score > 0.5  ? 'bg-amber-500/70' :
                          p.vi_score > 0.33 ? 'bg-green-500/70' : 'bg-blue-500/50',
                        )}
                        style={{ width: `${Math.round(p.vi_score * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
                {hidden > 0 && !isExpanded && (
                  <button
                    onClick={() => toggleTF(tf)}
                    className="col-span-2 text-left text-[10px] text-brand-400 hover:text-brand-300 pl-1.5 py-0.5 transition-colors"
                  >
                    + {hidden} more — click to show all
                  </button>
                )}
                {isExpanded && pairs.length > PREVIEW && (
                  <button
                    onClick={() => toggleTF(tf)}
                    className="col-span-2 text-left text-[10px] text-slate-500 hover:text-slate-400 pl-1.5 py-0.5 transition-colors"
                  >
                    ↑ Show less
                  </button>
                )}
              </div>
            </div>
          )})}

          {Object.entries(result.timeframes).some(([, p]) => p.length === 0) && (
            <div className="px-3 py-2 flex flex-wrap gap-1.5 items-center border-t border-surface-700/60">
              <span className="text-[10px] text-slate-500">No snapshot for:</span>
              {Object.entries(result.timeframes)
                .filter(([, p]) => p.length === 0)
                .map(([tf]) => <TFBadge key={tf} tf={tf} />)}
              <span className="text-[10px] text-slate-500">— run volatility analysis for these TFs first</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Pinned pair card ──────────────────────────────────────────────────────────
interface PinnedCardProps {
  pin: PinnedPair
  onRemove: (id: number) => void
  onExtend: (id: number, hours: number) => void
}

function PinnedCard({ pin, onRemove, onExtend }: PinnedCardProps) {
  const TF_EXTEND_HOURS: Record<string, number> = {
    '1W': 24 * 7, '1D': 24 * 3, '4H': 24, '1H': 12, '15m': 6,
  }
  const extendHours = TF_EXTEND_HOURS[pin.timeframe] ?? 24
  const ttlClass = ttlColor(pin.ttl_pct)

  return (
    <div className={cn(
      'rounded-lg border p-2.5 transition-all overflow-hidden',
      pin.is_suspended
        ? 'border-blue-700/40 bg-blue-900/10'
        : ttlColor(pin.ttl_pct).includes('green') ? 'border-green-800/30 bg-surface-800/40'
        : ttlColor(pin.ttl_pct).includes('amber') ? 'border-amber-800/30 bg-surface-800/40'
        : ttlColor(pin.ttl_pct).includes('red')   ? 'border-red-800/30 bg-surface-800/40'
        : 'border-surface-700 bg-surface-800/40',
    )}>
      <div className="flex items-start justify-between gap-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <TFBadge tf={pin.timeframe} />
            <span className="text-sm font-semibold text-slate-200 truncate">{pin.pair}</span>
            {pin.source === 'manual' && (
              <span className="text-[9px] text-slate-600 italic">manual</span>
            )}
          </div>
          {pin.note && (
            <p className="mt-0.5 text-[11px] text-slate-400 leading-tight truncate">{pin.note}</p>
          )}
          <div className="mt-1 flex items-center gap-2">
            {pin.is_suspended ? (
              <span className="flex items-center gap-1 text-[10px] text-blue-400">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
                  <rect x="1" y="1" width="2" height="6" rx="0.5"/>
                  <rect x="5" y="1" width="2" height="6" rx="0.5"/>
                </svg>
                Suspended — trade open
              </span>
            ) : (
              <div className="flex flex-col gap-0.5 flex-1">
                <span className={cn(
                  'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium border w-fit',
                  ttlClass,
                )}>
                  <Clock size={8} />
                  {fmtTTL(pin.hours_remaining)}
                </span>
                {pin.ttl_pct !== null && (
                  <div className="h-[2px] rounded-full bg-surface-700/60 w-full max-w-[80px]">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        pin.ttl_pct > 0.5 ? 'bg-green-500/70' :
                        pin.ttl_pct > 0.25 ? 'bg-amber-500/70' : 'bg-red-500/70',
                      )}
                      style={{ width: `${Math.round(pin.ttl_pct * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-0.5 shrink-0">
          <button
            onClick={() => onExtend(pin.id, -extendHours)}
            className="p-1 rounded text-slate-500 hover:text-amber-400 transition-colors"
            title={`Reduce by ${extendHours}h`}
          >
            <Minus size={13} />
          </button>
          <button
            onClick={() => onExtend(pin.id, extendHours)}
            className="p-1 rounded text-slate-500 hover:text-brand-400 transition-colors"
            title={`Extend by ${extendHours}h`}
          >
            <Timer size={13} />
          </button>
          <button
            onClick={() => onRemove(pin.id)}
            className="p-1 rounded text-slate-500 hover:text-red-400 transition-colors"
            title="Unpin"
          >
            <PinOff size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add pin form ───────────────────────────────────────────────────────────────
interface AddPinFormProps {
  instruments: { symbol: string; display_name: string }[]
  onAdd: (pair: string, tf: PinnedTF, note: string) => void
}

function AddPinForm({ instruments, onAdd }: AddPinFormProps) {
  const [pair, setPair] = useState('')
  const [tf, setTf] = useState<PinnedTF>('4H')
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const filtered = instruments
    .filter(i => i.symbol.toLowerCase().includes(query.toLowerCase()) || i.display_name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 20)

  const handleSubmit = () => {
    const value = (pair || query.trim()).toUpperCase()
    if (!value) return
    onAdd(value, tf, note)
    setPair('')
    setQuery('')
    setNote('')
    setOpen(false)
  }

  return (
    <div className="border-t border-surface-700 pt-3 mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[12px] text-brand-400 hover:text-brand-300 transition-colors"
      >
        <Plus size={13} />
        Pin a pair manually
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {/* Instrument search */}
          <div className="relative">
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setPair('') }}
              placeholder="Search or type symbol (e.g. ETH/USD)…"
              className={cn(
                'w-full rounded-lg border border-surface-600 bg-surface-800 px-3 py-1.5 text-sm text-slate-200',
                'placeholder:text-slate-500 focus:outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500/30',
              )}
            />
            {query && filtered.length > 0 && !pair && (
              <div className="absolute z-50 w-full mt-1 rounded-lg border border-surface-600 bg-surface-800 shadow-xl max-h-40 overflow-y-auto">
                {filtered.map(i => (
                  <button
                    key={i.symbol}
                    onClick={() => { setPair(i.symbol); setQuery(i.symbol) }}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-700 text-left"
                  >
                    <span className="text-sm text-slate-200 font-medium">{i.symbol}</span>
                    <span className="text-xs text-slate-500">{i.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-1.5 items-center">
            {/* TF select */}
            <select
              value={tf}
              onChange={e => setTf(e.target.value as PinnedTF)}
              className="shrink-0 rounded-lg border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500"
            >
              {TF_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Note input */}
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="min-w-0 flex-1 rounded-lg border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
            />

            <button
              onClick={handleSubmit}
              disabled={!pair && !query.trim()}
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-brand-700/30 border border-brand-600/40 text-brand-400 hover:bg-brand-700/50 disabled:opacity-40 transition-colors"
              title="Pin pair"
            >
              <Pin size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pinned pairs sidebar ───────────────────────────────────────────────────────
interface PinnedPanelProps {
  profileId: number
  onPinsChanged?: () => void
}

function PinnedPanel({ profileId, onPinsChanged }: PinnedPanelProps) {
  const { activeProfile } = useProfile()
  const [pins, setPins] = useState<PinnedPair[]>([])
  const [instruments, setInstruments] = useState<{ symbol: string; display_name: string }[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const data = await ritualApi.listPinned(profileId)
      setPins(data)
    } catch { /* ignore network errors */ }
  }, [profileId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload().finally(() => setLoading(false))
  }, [reload])

  // Load instruments for add-pin dropdown — via profile's broker
  useEffect(() => {
    const brokerId = activeProfile?.broker_id
    const url = brokerId
      ? `/api/brokers/${brokerId}/instruments`
      : `/api/brokers/instruments?profile_id=${profileId}`
    fetch(url)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setInstruments(data as { symbol: string; display_name: string }[])
        }
      })
      .catch(() => setInstruments([]))
  }, [profileId, activeProfile?.broker_id])

  const handleRemove = async (id: number) => {
    await ritualApi.removePinned(profileId, id)
    await reload()
    onPinsChanged?.()
  }

  const handleExtend = async (id: number, hours: number) => {
    await ritualApi.extendPinned(profileId, id, hours)
    await reload()
  }

  const handleAdd = async (pair: string, tf: PinnedTF, note: string) => {
    await ritualApi.addPinned(profileId, { pair, timeframe: tf, note: note || null, source: 'manual' })
    await reload()
    onPinsChanged?.()
  }

  // Group by TF
  const groups: Record<string, PinnedPair[]> = {}
  for (const pin of pins) {
    if (!groups[pin.timeframe]) groups[pin.timeframe] = []
    groups[pin.timeframe].push(pin)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <Star size={14} className="text-yellow-400" />
        <h3 className="text-sm font-semibold text-slate-200">Pinned Pairs</h3>
        {pins.length > 0 && (
          <span className="ml-auto text-[10px] text-slate-500">{pins.length} active</span>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={18} className="animate-spin text-slate-500" />
        </div>
      ) : pins.length === 0 ? (
        <p className="text-xs text-slate-500 text-center py-4">
          No pinned pairs yet.<br />
          <span className="text-slate-600">Pin pairs from the Smart Watchlist or add manually.</span>
        </p>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {TF_OPTIONS.filter(tf => groups[tf]).map(tf => (
            <div key={tf}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <TFBadge tf={tf} />
                <span className="text-[10px] text-slate-500">{groups[tf].length}</span>
              </div>
              <div className="space-y-1.5">
                {groups[tf].map(pin => (
                  <PinnedCard key={pin.id} pin={pin} onRemove={handleRemove} onExtend={handleExtend} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddPinForm instruments={instruments} onAdd={handleAdd} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────

export function RitualPage() {
  const { activeProfile } = useProfile()
  const profileId = activeProfile?.id

  const [activeSession, setActiveSession] = useState<RitualSession | null>(null)
  const [steps, setSteps] = useState<RitualStep[]>([])
  const [score, setScore] = useState<WeeklyScore | null>(null)
  const [recentSessions, setRecentSessions] = useState<RitualSession[]>([])
  const [starting, setStarting] = useState<SessionType | null>(null)

  // Smart WL state
  const [wlResult, setWlResult] = useState<SmartWLResult | null>(null)
  const [wlLoading, setWlLoading] = useState(false)
  const [topN, setTopN] = useState(12)
  const [pinnedKey, setPinnedKey] = useState(0)

  const elapsed = useElapsed(activeSession?.started_at ?? null)

  const reload = useCallback(async () => {
    if (!profileId) return
    const [sess, sc, recent] = await Promise.all([
      ritualApi.getActiveSession(profileId).catch(() => null),
      ritualApi.getScore(profileId).catch(() => null),
      ritualApi.listSessions(profileId, 20).catch(() => []),
    ])
    setActiveSession(sess)
    setScore(sc)
    setRecentSessions(recent)
  }, [profileId])

  useEffect(() => {
    if (!profileId) return
    reload()
  }, [profileId, reload])

  // Load steps when session changes
  useEffect(() => {
    if (!profileId || !activeSession) return
    ritualApi.getSteps(profileId, activeSession.session_type).catch(() => []).then(setSteps)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, activeSession?.id, activeSession?.session_type])

  const handleStart = async (type: SessionType) => {
    if (!profileId) return
    setStarting(type)
    try {
      const session = await ritualApi.startSession(profileId, type)
      setActiveSession(session)
      setWlResult(null)
      const st = await ritualApi.getSteps(profileId, type)
      setSteps(st)
      await reload()
    } finally {
      setStarting(null)
    }
  }

  const handleCompleteStep = async (logId: number, status: 'done' | 'skipped', stepOutput?: Record<string, unknown>) => {
    if (!profileId || !activeSession) return
    const output = stepOutput ?? {}
    await ritualApi.completeStep(profileId, activeSession.id, logId, status, output)
    // If last mandatory step done → auto-prompt to complete session
    await reload()
  }

  const handleCompleteSession = async (outcome?: SessionOutcome | null) => {
    if (!profileId || !activeSession) return
    await ritualApi.completeSession(profileId, activeSession.id, outcome, null)
    setActiveSession(null)
    setWlResult(null)
    await reload()
  }

  const handleAbandon = async () => {
    if (!profileId || !activeSession) return
    await ritualApi.abandonSession(profileId, activeSession.id)
    setActiveSession(null)
    setWlResult(null)
    await reload()
  }

  const handlePinFromWL = async (pair: string, tf: string) => {
    if (!profileId) return
    await ritualApi.addPinned(profileId, { pair, timeframe: tf as PinnedTF, note: null, source: 'watchlist' })
    setPinnedKey(k => k + 1)
    setWlResult(prev => {
      if (!prev) return prev
      return {
        ...prev,
        timeframes: Object.fromEntries(
          Object.entries(prev.timeframes).map(([t, pairs]) => [
            t,
            pairs.map(p => p.pair === pair && t === tf ? { ...p, is_pinned: true } : p),
          ])
        ),
      }
    })
  }

  const handleGenerateWL = async () => {
    if (!profileId || !activeSession) return
    setWlLoading(true)
    try {
      const result = await ritualApi.generateWatchlist(profileId, activeSession.session_type, topN)
      setWlResult(result)
    } finally {
      setWlLoading(false)
    }
  }

  const downloadUrl = profileId && activeSession
    ? ritualApi.downloadWatchlistUrl(profileId, activeSession.session_type, topN)
    : ''

  // Filter obsolete step types; all pending steps are independently actionable (non-procedural)
  const visibleLogs = activeSession?.step_logs.filter(l => l.step_type !== 'ai_brief') ?? []
  const doneCount = visibleLogs.filter(l => l.status !== 'pending').length
  const totalCount = visibleLogs.length
  const allDone = activeSession && totalCount > 0 && doneCount === totalCount

  // Outcome from outcome step log if done
  const outcomeLog = activeSession?.step_logs.find(l => l.step_type === 'outcome' && l.status === 'done')
  const sessionOutcome = outcomeLog?.output?.outcome as SessionOutcome | undefined

  if (!profileId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500">
        Select a profile to start your ritual.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon="🎯"
        title="Trading Ritual"
        subtitle="Your structured session workflow — build discipline, stay consistent"
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        {/* ── Main column ──────────────────────────────────────────────────── */}
        <div className="space-y-5">

          {/* ── Score card (compact, top) ────────────────────────────────── */}
          {score && (
            <div className="rounded-xl border border-surface-700 bg-surface-800/50 p-4">
              <div className="flex items-center gap-4">
                <ScoreRing score={score.score} maxScore={score.max_score} pct={score.pct} grade={score.grade} />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-semibold text-slate-200">Discipline Score</p>
                  <div className="w-full bg-surface-700 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{
                        width: `${score.pct}%`,
                        background: score.pct >= 75 ? '#4ade80' : score.pct >= 50 ? '#60a5fa' : score.pct >= 30 ? '#facc15' : '#f87171',
                      }}
                    />
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(['weekly_setup', 'trade_session', 'weekend_review'] as SessionType[]).map(st => {
                      const info = SESSION_TYPES.find(s => s.type === st)!
                      const count = (score.details as Record<string, Record<string, number>>)?.sessions?.[st] ?? 0
                      return (
                        <div key={st} className="text-center">
                          <span className="text-base">{info.emoji}</span>
                          <p className="text-[11px] text-slate-400 font-medium">{count}×</p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Active session ────────────────────────────────────────────── */}
          {activeSession ? (
            <div className="rounded-xl border border-brand-600/40 bg-brand-950/20 overflow-hidden">
              {/* Session header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-brand-700/30 bg-brand-900/20">
                <button
                  onClick={() => setActiveSession(null)}
                  className="shrink-0 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-surface-700/50 transition-colors"
                  title="Back to session picker (session stays in progress)"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xl">{activeSession.session_emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-100 truncate">{activeSession.session_label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Timer size={10} />
                      {elapsed}
                    </span>
                    <div className="flex-1 bg-surface-800 rounded-full h-1">
                      <div
                        className="h-1 rounded-full bg-brand-500 transition-all"
                        style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-slate-500 shrink-0">
                      {doneCount}/{totalCount}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {allDone && (
                    <button
                      onClick={() => handleCompleteSession(sessionOutcome ?? null)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600/20 border border-green-600/40 text-green-400 text-xs font-semibold hover:bg-green-600/30 transition-colors"
                    >
                      <CheckCircle2 size={13} />
                      Complete
                    </button>
                  )}
                  <button
                    onClick={handleAbandon}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-600 text-slate-500 text-xs hover:text-red-400 hover:border-red-700/40 transition-colors"
                    title="Abandon session"
                  >
                    <XCircle size={13} />
                  </button>
                </div>
              </div>

              {/* Steps list — non-procedural: all pending steps are independently actionable */}
              <div className="p-4 space-y-2">
                {visibleLogs.map((log) => {
                  const step = steps.find(s => s.id === log.step_id || s.position === log.position)
                  const isCurrent = log.status === 'pending'
                  return (
                    <StepItem
                      key={log.id}
                      log={log}
                      step={step}
                      isCurrent={isCurrent}
                      profileId={profileId}
                      onComplete={handleCompleteStep}
                      onGenerateWL={handleGenerateWL}
                      wlResult={wlResult}
                      wlLoading={wlLoading}
                      downloadUrl={downloadUrl}
                      topN={topN}
                      setTopN={setTopN}
                      onPin={handlePinFromWL}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            /* ── Session type picker ─────────────────────────────────── */
            <div className="space-y-3">
            {/* Resume banner — shown when a session was minimised via ← */}
            {recentSessions.find(s => s.status === 'in_progress') && (() => {
              const pending = recentSessions.find(s => s.status === 'in_progress')!
              return (
                <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-amber-600/40 bg-amber-950/20">
                  <span className="text-xl shrink-0">{pending.session_emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-300">{pending.session_label} — in progress</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">Your session is paused. Resume or abandon it.</p>
                  </div>
                  <button
                    onClick={() => setActiveSession(pending)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600/20 border border-amber-600/40 text-amber-300 text-xs font-semibold hover:bg-amber-600/30 transition-colors"
                  >
                    <ChevronRight size={13} />
                    Resume
                  </button>
                </div>
              )
            })()}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SESSION_TYPES.map((st) => (
                <button
                  key={st.type}
                  onClick={() => handleStart(st.type)}
                  disabled={starting !== null}
                  className={cn(
                    `relative rounded-xl border border-surface-700/60 bg-gradient-to-br ${st.gradient} p-4 text-left transition-all group overflow-hidden`,
                    'hover:border-surface-500/70 hover:shadow-lg',
                    'focus:outline-none',
                    starting === st.type && 'opacity-60 cursor-wait',
                  )}
                  style={{ '--accent': st.accent } as React.CSSProperties}
                >
                  {/* Accent top bar */}
                  <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl transition-all group-hover:h-[4px]" style={{ backgroundColor: st.accent }} />
                  {/* Subtle glow on hover */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl" style={{ background: `radial-gradient(ellipse at 50% 0%, ${st.accent}15 0%, transparent 60%)` }} />
                  <div className="relative">
                    <div className="flex items-start justify-between mb-3 pt-1">
                      <span className="text-3xl leading-none">{st.emoji}</span>
                      {starting === st.type
                        ? <Loader2 size={14} className="animate-spin text-slate-400 mt-0.5" />
                        : <ChevronRight size={14} className="text-slate-600 group-hover:text-slate-300 transition-colors mt-0.5" />}
                    </div>
                    <p className="text-sm font-bold text-slate-100 group-hover:text-white leading-tight">{st.label}</p>
                    <p className="text-[10px] font-semibold mt-0.5" style={{ color: st.accent }}>{st.when}</p>
                    <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">{st.desc}</p>
                    {/* Step pills */}
                    <div className="mt-3 flex flex-wrap gap-1">
                      {st.steps.map(s => (
                        <span key={s} className="text-[9px] px-1.5 py-0.5 rounded-full border border-slate-700/60 text-slate-500">{s}</span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[11px] text-slate-600">
                      <Clock size={10} />
                      {st.est}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            </div>
          )}

          {/* ── Recent sessions ───────────────────────────────────────────── */}
          {recentSessions.length > 0 && !activeSession && (
            <div className="rounded-xl border border-surface-700 bg-surface-800/30 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-surface-700">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <BookOpen size={12} />
                  Recent Sessions
                </p>
              </div>
              <div className="divide-y divide-surface-700/60">
                {recentSessions.slice(0, 10).map((s) => {
                  const visLogs = s.step_logs.filter(l => l.step_type !== 'ai_brief')
                  const total = visLogs.length
                  const done = visLogs.filter(l => l.status !== 'pending').length
                  const pct = total > 0 ? Math.round(done / total * 100) : null
                  return (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-base">{s.session_emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-300">{s.session_label}</p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(s.started_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                        {s.duration_minutes && ` · ${s.duration_minutes}m`}
                      </p>
                      {s.status !== 'completed' && pct !== null && (
                        <div className="mt-1 flex items-center gap-1.5">
                          <div className="flex-1 h-1 rounded-full bg-surface-700 max-w-[80px]">
                            <div
                              className={cn('h-1 rounded-full transition-all', s.status === 'abandoned' ? 'bg-red-500/60' : 'bg-amber-500/60')}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-slate-600">{done}/{total}</span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {s.outcome && (
                        <span className="text-[10px] text-slate-400 bg-surface-700 rounded px-1.5 py-0.5">
                          {s.outcome.replace('_', ' ')}
                        </span>
                      )}
                      <span className={cn(
                        'text-[10px] rounded px-1.5 py-0.5 font-medium',
                        s.status === 'completed' ? 'text-green-400 bg-green-900/20' :
                        s.status === 'abandoned' ? 'text-red-400 bg-red-900/20' :
                        'text-amber-400 bg-amber-900/20',
                      )}>
                        {s.status}
                      </span>
                      {s.discipline_points > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] text-yellow-400">
                          <Flame size={9} />
                          +{s.discipline_points}
                        </span>
                      )}
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Settings ─────────────────────────────────────────────────── */}
          <div className="rounded-xl border border-surface-700 bg-surface-800/30 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Settings size={14} className="text-slate-400" />
              <span className="text-sm font-semibold text-slate-300">Ritual Settings</span>
            </div>
            <Link to="/settings/ritual" className="flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors">
              <ExternalLink size={12} />
              Configure →
            </Link>
          </div>
        </div>

        {/* ── Pinned pairs sidebar ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-surface-700 bg-surface-800/40 p-4 lg:sticky lg:top-4 min-h-[300px] overflow-visible">
          <PinnedPanel key={pinnedKey} profileId={profileId} onPinsChanged={reload} />
        </div>
      </div>
    </div>
  )
}
