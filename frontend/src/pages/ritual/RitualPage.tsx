// ── Ritual Page ──────────────────────────────────────────────────────────────
// Trading Session Planner — start sessions, follow steps, track discipline.
//
// Layout (desktop): 2-col — main (steps + WL) | sidebar (pinned pairs)
// Layout (mobile):  1-col — sections stack vertically

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Star, Pin, PinOff, Plus, Download, RefreshCw,
  ChevronRight, CheckCircle2, SkipForward, Circle,
  Timer, Flame, BookOpen, Clock, XCircle,
  ExternalLink, Loader2,
  ChevronDown, ChevronUp,
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

const SESSION_TYPES: { type: SessionType; emoji: string; label: string; desc: string; est: string }[] = [
  {
    type: 'weekly_setup',
    emoji: '📅',
    label: 'Weekly Setup',
    desc: 'Structure your week: Market Analysis → Goals → Watchlist 1W/1D → Pin pairs',
    est: '~50 min',
  },
  {
    type: 'daily_prep',
    emoji: '☀️',
    label: 'Daily Prep',
    desc: 'VI check + Smart Watchlist 1D/4H → TradingView analysis',
    est: '~25 min',
  },
  {
    type: 'trade_session',
    emoji: '🎯',
    label: 'Trade Session',
    desc: 'AI Brief → VI → Pinned pairs → Smart WL 4H/1H/15m → Outcome',
    est: '~30 min',
  },
  {
    type: 'weekend_review',
    emoji: '📊',
    label: 'Weekend Review',
    desc: 'Analytics → Trade Journal → Goals review → Learning note',
    est: '~35 min',
  },
]

const OUTCOME_OPTIONS: { value: SessionOutcome; label: string; emoji: string; color: string }[] = [
  { value: 'trade_opened',    label: 'Trade Opened',    emoji: '✅', color: 'text-green-400' },
  { value: 'no_opportunity',  label: 'No Opportunity',  emoji: '🔵', color: 'text-blue-400' },
  { value: 'vol_too_low',     label: 'Vol Too Low',     emoji: '⚠️', color: 'text-amber-400' },
]

const TF_OPTIONS: PinnedTF[] = ['1W', '1D', '4H', '1H', '15m']
const TF_COLORS: Record<string, string> = {
  '1W': 'text-purple-400 border-purple-700/40 bg-purple-900/20',
  '1D': 'text-blue-400 border-blue-700/40 bg-blue-900/20',
  '4H': 'text-cyan-400 border-cyan-700/40 bg-cyan-900/20',
  '1H': 'text-green-400 border-green-700/40 bg-green-900/20',
  '15m': 'text-amber-400 border-amber-700/40 bg-amber-900/20',
}

const REGIME_COLORS: Record<string, string> = {
  DEAD: 'text-slate-500',
  CALM: 'text-blue-400',
  NORMAL: 'text-slate-300',
  TRENDING: 'text-green-400',
  ACTIVE: 'text-amber-400',
  EXTREME: 'text-red-400',
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

function RegimeBadge({ regime }: { regime: string }) {
  return (
    <span className={cn('text-[10px] font-medium', REGIME_COLORS[regime.toUpperCase()] ?? 'text-slate-400')}>
      {regime || '—'}
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

// ── Step item ──────────────────────────────────────────────────────────────────
interface StepItemProps {
  log: StepLog
  step?: RitualStep
  isCurrent: boolean
  onComplete: (logId: number, status: 'done' | 'skipped', output?: Record<string, unknown>) => void
  onGenerateWL?: () => void
  wlResult?: SmartWLResult | null
  wlLoading?: boolean
  downloadUrl?: string
  topN?: number
  setTopN?: (n: number) => void
}

function StepItem({
  log, step, isCurrent,
  onComplete, onGenerateWL, wlResult, wlLoading, downloadUrl, topN, setTopN,
}: StepItemProps) {
  const navigate = useNavigate()
  const isDone = log.status === 'done'
  const isSkipped = log.status === 'skipped'
  const isDoneOrSkipped = isDone || isSkipped

  return (
    <div className={cn(
      'relative rounded-xl border transition-all',
      isCurrent && !isDoneOrSkipped
        ? 'border-brand-600/60 bg-brand-950/30 shadow-md shadow-brand-900/20'
        : isDone
          ? 'border-green-800/30 bg-green-950/10'
          : isSkipped
            ? 'border-surface-700 bg-surface-800/30 opacity-60'
            : 'border-surface-700 bg-surface-800/40',
    )}>
      <div className="flex items-start gap-3 p-3">
        {/* Status icon */}
        <div className="mt-0.5 shrink-0">
          {isDone ? (
            <CheckCircle2 size={18} className="text-green-500" />
          ) : isSkipped ? (
            <SkipForward size={18} className="text-slate-500" />
          ) : isCurrent ? (
            <div className="w-[18px] h-[18px] rounded-full border-2 border-brand-500 bg-brand-900/40 animate-pulse" />
          ) : (
            <Circle size={18} className="text-slate-700" />
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
          {step?.module_path && isCurrent && !isDoneOrSkipped && (
            <button
              onClick={() => navigate(step.module_path!)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 transition-colors"
            >
              <ExternalLink size={10} />
              Open {step.linked_module}
            </button>
          )}

          {/* Smart WL panel */}
          {log.step_type === 'smart_wl' && isCurrent && !isDoneOrSkipped && (
            <SmartWLPanel
              result={wlResult ?? null}
              loading={wlLoading ?? false}
              downloadUrl={downloadUrl ?? ''}
              topN={topN ?? 20}
              setTopN={setTopN ?? (() => {})}
              onGenerate={onGenerateWL ?? (() => {})}
            />
          )}

          {/* Outcome selector */}
          {log.step_type === 'outcome' && isCurrent && !isDoneOrSkipped && (
            <OutcomeSelector onSelect={(o) => onComplete(log.id, 'done', { outcome: o })} />
          )}
        </div>

        {/* Action buttons */}
        {isCurrent && !isDoneOrSkipped && log.step_type !== 'outcome' && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onComplete(log.id, 'done')}
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
  result, loading, downloadUrl, topN, setTopN, onGenerate,
}: {
  result: SmartWLResult | null
  loading: boolean
  downloadUrl: string
  topN: number
  setTopN: (n: number) => void
  onGenerate: () => void
}) {
  return (
    <div className="mt-3 space-y-3">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-slate-400 whitespace-nowrap">Top N:</label>
          <input
            type="range" min={5} max={50} step={5} value={topN}
            onChange={(e) => setTopN(Number(e.target.value))}
            className="w-24 accent-brand-500"
          />
          <span className="text-[12px] text-slate-300 w-4 text-right">{topN}</span>
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

      {/* Result preview */}
      {result && (
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
          {Object.entries(result.timeframes).map(([tf, pairs]) => (
            <div key={tf} className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1.5">
                <TFBadge tf={tf} />
                <span className="text-[10px] text-slate-500">{pairs.length} pairs</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {pairs.slice(0, 8).map((p) => (
                  <div key={p.pair} className={cn(
                    'flex items-center gap-1.5 rounded px-1.5 py-1',
                    p.is_pinned ? 'bg-brand-900/30 border border-brand-700/30' : 'bg-surface-800/60',
                  )}>
                    {p.is_pinned && <span className="text-[10px] text-yellow-400">★</span>}
                    <span className="text-[11px] text-slate-300 font-medium truncate">{p.tv_symbol}</span>
                    <RegimeBadge regime={p.regime} />
                  </div>
                ))}
                {pairs.length > 8 && (
                  <span className="col-span-2 text-[10px] text-slate-500 pl-1.5">
                    +{pairs.length - 8} more pairs in file
                  </span>
                )}
              </div>
            </div>
          ))}
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
  const extendHours = pin.timeframe === '1W' ? 24 * 7 : 24
  const ttlClass = ttlColor(pin.ttl_pct)

  return (
    <div className={cn(
      'rounded-lg border p-2.5 transition-all',
      pin.is_suspended
        ? 'border-blue-700/40 bg-blue-900/10'
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
              <span className={cn(
                'inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium border',
                ttlClass,
              )}>
                <Clock size={8} />
                {fmtTTL(pin.hours_remaining)}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-0.5 shrink-0">
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
    if (!pair) return
    onAdd(pair, tf, note)
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
              placeholder="Search instruments…"
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

          <div className="flex gap-2">
            {/* TF select */}
            <select
              value={tf}
              onChange={e => setTf(e.target.value as PinnedTF)}
              className="rounded-lg border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500"
            >
              {TF_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>

            {/* Note input */}
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Note (optional)"
              className="flex-1 rounded-lg border border-surface-600 bg-surface-800 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand-500"
            />

            <button
              onClick={handleSubmit}
              disabled={!pair}
              className="px-3 py-1.5 rounded-lg bg-brand-700/30 border border-brand-600/40 text-brand-400 text-xs font-medium hover:bg-brand-700/50 disabled:opacity-40 transition-colors"
            >
              <Pin size={12} />
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

  // Load instruments for add-pin dropdown
  useEffect(() => {
    fetch(`/api/brokers/instruments?profile_id=${profileId}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setInstruments(data as { symbol: string; display_name: string }[])
        }
      })
      .catch(() => setInstruments([]))
  }, [profileId])

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
  const { profile } = useProfile()
  const profileId = profile?.id

  const [activeSession, setActiveSession] = useState<RitualSession | null>(null)
  const [steps, setSteps] = useState<RitualStep[]>([])
  const [score, setScore] = useState<WeeklyScore | null>(null)
  const [recentSessions, setRecentSessions] = useState<RitualSession[]>([])
  const [starting, setStarting] = useState<SessionType | null>(null)

  // Smart WL state
  const [wlResult, setWlResult] = useState<SmartWLResult | null>(null)
  const [wlLoading, setWlLoading] = useState(false)
  const [topN, setTopN] = useState(20)

  const elapsed = useElapsed(activeSession?.started_at ?? null)

  const reload = useCallback(async () => {
    if (!profileId) return
    const [sess, sc, recent] = await Promise.all([
      ritualApi.getActiveSession(profileId).catch(() => null),
      ritualApi.getScore(profileId).catch(() => null),
      ritualApi.listSessions(profileId, 5).catch(() => []),
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

  // Determine current (first pending) step log
  const currentIndex = activeSession?.step_logs.findIndex(l => l.status === 'pending') ?? -1
  const doneCount = activeSession?.step_logs.filter(l => l.status !== 'pending').length ?? 0
  const totalCount = activeSession?.step_logs.length ?? 0
  const allDone = activeSession && doneCount === totalCount

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
        title="Trading Ritual 🎯"
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
                    {(['weekly_setup', 'daily_prep', 'trade_session', 'weekend_review'] as SessionType[]).map(st => {
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
                <span className="text-xl">{activeSession.session_emoji}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-100">{activeSession.session_label}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <Timer size={10} />
                      {elapsed}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {doneCount}/{totalCount} steps
                    </span>
                    <div className="flex-1 bg-surface-800 rounded-full h-1">
                      <div
                        className="h-1 rounded-full bg-brand-500 transition-all"
                        style={{ width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%` }}
                      />
                    </div>
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

              {/* Steps list */}
              <div className="p-4 space-y-2">
                {activeSession.step_logs.map((log, idx) => {
                  const step = steps.find(s => s.id === log.step_id || s.position === log.position)
                  const isCurrent = log.status === 'pending' && idx === currentIndex
                  return (
                    <StepItem
                      key={log.id}
                      log={log}
                      step={step}
                      isCurrent={isCurrent}
                      onComplete={handleCompleteStep}
                      onGenerateWL={handleGenerateWL}
                      wlResult={wlResult}
                      wlLoading={wlLoading}
                      downloadUrl={downloadUrl}
                      topN={topN}
                      setTopN={setTopN}
                    />
                  )
                })}
              </div>
            </div>
          ) : (
            /* ── Session type picker ─────────────────────────────────────── */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SESSION_TYPES.map((st) => (
                <button
                  key={st.type}
                  onClick={() => handleStart(st.type)}
                  disabled={starting !== null}
                  className={cn(
                    'rounded-xl border p-4 text-left transition-all group',
                    'border-surface-700 bg-surface-800/40',
                    'hover:border-brand-600/60 hover:bg-brand-950/20',
                    'focus:outline-none focus:ring-2 focus:ring-brand-500/40',
                    starting === st.type && 'opacity-60 cursor-wait',
                  )}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">{st.emoji}</span>
                    {starting === st.type && <Loader2 size={14} className="animate-spin text-brand-400 mt-1" />}
                  </div>
                  <p className="text-sm font-semibold text-slate-200 group-hover:text-slate-100">
                    {st.label}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">{st.desc}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                      <Clock size={10} />
                      {st.est}
                    </span>
                    <ChevronRight size={14} className="text-slate-600 group-hover:text-brand-400 transition-colors" />
                  </div>
                </button>
              ))}
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
                {recentSessions.slice(0, 5).map((s) => (
                  <div key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-base">{s.session_emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-300">{s.session_label}</p>
                      <p className="text-[10px] text-slate-500">
                        {new Date(s.started_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                        {s.duration_minutes && ` · ${s.duration_minutes}m`}
                      </p>
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
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Pinned pairs sidebar ─────────────────────────────────────────── */}
        <div className="rounded-xl border border-surface-700 bg-surface-800/40 p-4 lg:sticky lg:top-4 min-h-[300px]">
          <PinnedPanel profileId={profileId} onPinsChanged={reload} />
        </div>
      </div>
    </div>
  )
}
