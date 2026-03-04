// ── Dashboard — Step 12 ───────────────────────────────────────────────────
// All 4 widgets connected to real API:
//   1. Goals widget        — style selector + daily/weekly/monthly rows
//   2. Market Analysis     — one chip per module, staleness color
//   3. Open Positions      — live open/partial trades
//   4. Performance summary — win rate, profit factor, equity mini-curve
//
// Data sources:
//   goalsApi.progress(profileId)          → goals widget
//   maApi.getStaleness(profileId)         → MA badge
//   tradesApi.list(profileId)             → positions + performance
//   stylesApi.list()                      → style names for goals widget

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Target, BarChart3, Activity,
  Loader2, RefreshCw, AlertTriangle, ChevronRight,
  CheckCircle2, Minus, Plus,
} from 'lucide-react'
import { PageHeader }  from '../../components/ui/PageHeader'
import { StatCard }    from '../../components/ui/StatCard'
import { useProfile }  from '../../context/ProfileContext'
import {
  goalsApi, stylesApi, maApi, tradesApi,
} from '../../lib/api'
import type {
  GoalProgressItem, TradingStyle,
  MAStalenessItem, TradeListItem,
} from '../../types/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(v: string | number | null | undefined): number {
  if (v == null) return 0
  return typeof v === 'string' ? parseFloat(v) : v
}

function fmt(n: number, dp = 2): string {
  return n.toFixed(dp)
}

function fmtPct(n: number, dp = 2): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${fmt(n, dp)}%`
}

function fmtCurrency(n: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency, maximumFractionDigits: 2,
  }).format(n)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GOALS WIDGET
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<string, string> = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
}
const PERIOD_ORDER: Record<string, number> = { daily: 0, weekly: 1, monthly: 2 }

function GoalRow({ item }: { item: GoalProgressItem }) {
  const pnlPct       = pct(item.pnl_pct)
  const goalPct      = pct(item.goal_pct)
  const limitPct     = pct(item.limit_pct)       // negative
  const goalProgress = Math.min(100, Math.max(0, pct(item.goal_progress_pct)))
  const riskProgress = Math.min(100, Math.max(0, pct(item.risk_progress_pct)))

  let status: 'hit' | 'blocked' | 'warning' | 'ok' = 'ok'
  if (item.goal_hit)           status = 'hit'
  else if (item.limit_hit)     status = 'blocked'
  else if (riskProgress >= 75) status = 'warning'

  const statusBadge = {
    hit:     <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">✅ HIT</span>,
    blocked: <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-700/40">🛑 BLOCKED</span>,
    warning: <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/40">⚠️ WARNING</span>,
    ok:      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-700 text-slate-400 border border-surface-600">ON TRACK</span>,
  }[status]

  return (
    <div className="flex flex-col gap-2 py-3 border-b border-surface-700 last:border-none">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400">{PERIOD_LABELS[item.period] ?? item.period}</span>
          {statusBadge}
        </div>
        <span className={`text-sm font-bold tabular-nums ${pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {fmtPct(pnlPct)}
        </span>
      </div>

      {/* Goal progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-600">Goal progress</span>
          <span className="text-[10px] text-slate-500 tabular-nums">{fmt(goalProgress)}% of {fmtPct(goalPct)}</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${status === 'hit' ? 'bg-emerald-500' : 'bg-brand-500'}`}
            style={{ width: `${goalProgress}%` }}
          />
        </div>
      </div>

      {/* Risk / loss-limit bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-600">Risk used</span>
          <span className="text-[10px] text-slate-500 tabular-nums">
            {fmt(riskProgress)}% of {fmtPct(Math.abs(limitPct))} limit
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              status === 'blocked' ? 'bg-red-500' : status === 'warning' ? 'bg-amber-500' : 'bg-surface-500'
            }`}
            style={{ width: `${riskProgress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function GoalsWidget({ profileId }: { profileId: number }) {
  const [progress, setProgress]     = useState<GoalProgressItem[]>([])
  const [styles, setStyles]         = useState<TradingStyle[]>([])
  const [selectedStyleId, setSelectedStyleId] = useState<number | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [prog, styleList] = await Promise.all([
        goalsApi.progress(profileId),
        stylesApi.list(),
      ])
      setProgress(prog)
      setStyles(styleList)
      setSelectedStyleId((prev) => {
        if (prev !== null) return prev
        if (prog.length > 0) return prog[0].style_id
        if (styleList.length > 0) return styleList[0].id
        return null
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => { void load() }, [load])

  const activeStyleIds = useMemo(
    () => [...new Set(progress.map((p) => p.style_id))],
    [progress],
  )
  const visibleStyles = styles.filter((s) => activeStyleIds.includes(s.id))

  const filtered = useMemo(() => {
    if (!selectedStyleId) return []
    return [...progress.filter((p) => p.style_id === selectedStyleId)]
      .sort((a, b) => (PERIOD_ORDER[a.period] ?? 99) - (PERIOD_ORDER[b.period] ?? 99))
  }, [progress, selectedStyleId])

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-slate-200">Goals</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="text-slate-600 hover:text-slate-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
          <Link
            to="/goals"
            className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5"
          >
            Manage <ChevronRight size={10} />
          </Link>
        </div>
      </div>

      {/* Style tabs (only shown when multiple styles have goals) */}
      {visibleStyles.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {visibleStyles.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedStyleId(s.id)}
              className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
                selectedStyleId === s.id
                  ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                  : 'bg-surface-700 text-slate-500 border border-surface-600 hover:text-slate-300'
              }`}
            >
              {s.display_name}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="text-slate-600 animate-spin" />
        </div>
      ) : error ? (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg p-3">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <Target size={20} className="text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-600">No active goals for this style.</p>
          <Link to="/goals" className="text-[10px] text-brand-400 hover:underline">
            Set a goal →
          </Link>
        </div>
      ) : (
        <div>
          {filtered.map((item) => (
            <GoalRow key={`${item.style_id}-${item.period}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. MARKET ANALYSIS WIDGET
// ─────────────────────────────────────────────────────────────────────────────

function StalenessChip({ item }: { item: MAStalenessItem }) {
  const daysOld = item.days_old
  const hasData = item.last_analyzed_at !== null

  let color = 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40'
  let dot   = '🟢'
  if (!hasData) {
    color = 'text-slate-500 bg-surface-700 border-surface-600'
    dot   = '⚪'
  } else if (daysOld !== null && daysOld > 14) {
    color = 'text-orange-400 bg-orange-900/30 border-orange-700/40'
    dot   = '🟠'
  } else if (daysOld !== null && daysOld > 7) {
    color = 'text-amber-400 bg-amber-900/30 border-amber-700/40'
    dot   = '🟡'
  }

  const ageLabel = !hasData
    ? 'Never'
    : daysOld === 0
    ? 'Today'
    : daysOld === 1
    ? '1d ago'
    : `${daysOld}d ago`

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border ${color}`}
    >
      <span>{dot}</span>
      <span>{item.module_name}</span>
      <span className="opacity-60">·</span>
      <span className="opacity-80">{ageLabel}</span>
    </span>
  )
}

function MAWidget({ profileId }: { profileId: number }) {
  const [staleness, setStaleness] = useState<MAStalenessItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setStaleness(await maApi.getStaleness(profileId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => { void load() }, [load])

  const staleCount = staleness.filter((s) => s.is_stale).length
  const neverCount = staleness.filter((s) => s.last_analyzed_at === null).length

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-purple-400" />
          <h2 className="text-sm font-semibold text-slate-200">Market Analysis</h2>
          {!loading && staleCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-700/40">
              {staleCount} stale
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="text-slate-600 hover:text-slate-400 transition-colors"
          >
            <RefreshCw size={12} />
          </button>
          <Link
            to="/market-analysis"
            className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-0.5"
          >
            View all <ChevronRight size={10} />
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 size={16} className="text-slate-600 animate-spin" />
        </div>
      ) : error ? (
        <div className="text-xs text-red-400">{error}</div>
      ) : staleness.length === 0 ? (
        <p className="text-xs text-slate-600 text-center py-4">No modules configured.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {staleness.map((s) => (
            <Link key={s.module_id} to="/market-analysis">
              <StalenessChip item={s} />
            </Link>
          ))}
        </div>
      )}

      {!loading && neverCount > 0 && (
        <div className="flex items-start gap-2 text-xs text-amber-400/80 bg-amber-900/10 border border-amber-800/20 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            {neverCount} module{neverCount > 1 ? 's' : ''} never analyzed —{' '}
            <Link to="/market-analysis/new" className="underline">
              run analysis →
            </Link>
          </span>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OPEN POSITIONS WIDGET
// ─────────────────────────────────────────────────────────────────────────────

function PositionRow({ trade }: { trade: TradeListItem }) {
  const navigate = useNavigate()
  const isLong   = trade.direction === 'LONG'
  const risk     = pct(trade.risk_amount)
  const bookedPnl = pct(trade.booked_pnl)

  const statusColor = trade.status === 'partial'
    ? 'text-amber-400 bg-amber-900/30 border-amber-700/40'
    : 'text-emerald-400 bg-emerald-900/30 border-emerald-700/40'

  return (
    <button
      type="button"
      onClick={() => void navigate(`/trades/${trade.id}`)}
      className="w-full flex items-center justify-between text-xs py-2.5 border-b border-surface-700 last:border-none hover:bg-surface-700/30 transition-colors rounded px-1 -mx-1 group"
    >
      <div className="flex items-center gap-3">
        <span className={`shrink-0 ${isLong ? 'text-emerald-500' : 'text-red-400'}`}>
          {isLong ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
        </span>
        <div className="text-left">
          <div className="font-semibold text-slate-200 group-hover:text-white transition-colors">
            {trade.instrument_display_name ?? trade.pair}
          </div>
          <div className="text-slate-600 text-[10px]">
            Entry {parseFloat(trade.entry_price).toLocaleString()} ·{' '}
            <span className={isLong ? 'text-emerald-500' : 'text-red-400'}>{trade.direction}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right hidden sm:block">
          <div className="text-slate-500 text-[10px]">Risk</div>
          <div className="text-slate-400 tabular-nums">{fmtCurrency(risk)}</div>
        </div>
        {trade.status === 'partial' && (
          <div className="text-right">
            <div className="text-slate-500 text-[10px]">Booked P&L</div>
            <div className={`font-semibold tabular-nums ${bookedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {bookedPnl >= 0 ? '+' : ''}{fmtCurrency(bookedPnl)}
            </div>
          </div>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide ${statusColor}`}>
          {trade.status}
        </span>
        <ChevronRight size={12} className="text-slate-700 group-hover:text-slate-400 transition-colors" />
      </div>
    </button>
  )
}

function PositionsWidget({ trades, loading, error }: {
  trades: TradeListItem[]
  loading: boolean
  error: string | null
}) {
  const open = useMemo(
    () => trades.filter((t) => t.status === 'open' || t.status === 'partial'),
    [trades],
  )
  const pending = useMemo(
    () => trades.filter((t) => t.status === 'pending'),
    [trades],
  )

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-200">Open Positions</h2>
          {!loading && open.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 tabular-nums">
              {open.length}
            </span>
          )}
        </div>
        <Link
          to="/trades"
          className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5"
        >
          Journal <ChevronRight size={10} />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="text-slate-600 animate-spin" />
        </div>
      ) : error ? (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg p-3">{error}</div>
      ) : open.length === 0 ? (
        <div className="text-center py-8">
          <Minus size={20} className="text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-600">No open positions.</p>
          <Link
            to="/trades/new"
            className="inline-flex items-center gap-1 mt-2 text-[10px] text-emerald-400 hover:underline"
          >
            <Plus size={10} /> Open a trade
          </Link>
        </div>
      ) : (
        <div>{open.map((t) => <PositionRow key={t.id} trade={t} />)}</div>
      )}

      {!loading && pending.length > 0 && (
        <div className="flex items-center justify-between text-xs text-amber-400/80 bg-amber-900/10 border border-amber-800/20 rounded-lg px-3 py-2">
          <span>⏳ {pending.length} pending LIMIT order{pending.length > 1 ? 's' : ''}</span>
          <Link to="/trades" className="text-[10px] underline">View →</Link>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. PERFORMANCE WIDGET
// ─────────────────────────────────────────────────────────────────────────────

interface PerfStats {
  winRate:        number | null
  profitFactor:   number | null
  totalClosedPnl: number
  avgRR:          number | null
  bestTrade:      number | null
  worstTrade:     number | null
  equity:         number[]   // cumulative P&L of last ≤30 closed trades
}

function computePerf(trades: TradeListItem[]): PerfStats {
  const closed = trades.filter((t) => t.status === 'closed' && t.realized_pnl !== null)
  if (closed.length === 0) {
    return {
      winRate: null, profitFactor: null, totalClosedPnl: 0,
      avgRR: null, bestTrade: null, worstTrade: null, equity: [],
    }
  }

  const pnls   = closed.map((t) => pct(t.realized_pnl))
  const wins   = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p <= 0)

  const winRate      = closed.length >= 5 ? (wins.length / closed.length) * 100 : null
  const grossWin     = wins.reduce((a, b) => a + b, 0)
  const grossLoss    = Math.abs(losses.reduce((a, b) => a + b, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : null
  const total        = pnls.reduce((a, b) => a + b, 0)
  const avgWin       = wins.length  > 0 ? grossWin  / wins.length  : 0
  const avgLoss      = losses.length > 0 ? grossLoss / losses.length : 0
  const avgRR        = avgLoss > 0 ? avgWin / avgLoss : null

  const last30: number[] = pnls.slice(-30)
  const equity: number[] = []
  let cum = 0
  for (const p of last30) { cum += p; equity.push(cum) }

  return {
    winRate,
    profitFactor,
    totalClosedPnl: total,
    avgRR,
    bestTrade:  pnls.length > 0 ? Math.max(...pnls) : null,
    worstTrade: pnls.length > 0 ? Math.min(...pnls) : null,
    equity,
  }
}

function MiniEquityCurve({ equity }: { equity: number[] }) {
  if (equity.length < 2) {
    return (
      <div className="flex items-center justify-center h-14 text-[10px] text-slate-700">
        Not enough data
      </div>
    )
  }
  const min   = Math.min(...equity)
  const max   = Math.max(...equity)
  const range = max - min || 1
  const W = 240; const H = 48; const padX = 4

  const points = equity.map((v, i) => {
    const x = padX + (i / (equity.length - 1)) * (W - padX * 2)
    const y = H - ((v - min) / range) * (H - 6) - 3
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })

  const last = equity[equity.length - 1]
  const color = last >= 0 ? '#22c55e' : '#ef4444'
  const fillPath = `M${points.join('L')} L${W - padX},${H} L${padX},${H} Z`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#eq-fill)" />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function PerformanceWidget({ trades, loading, error }: {
  trades: TradeListItem[]
  loading: boolean
  error: string | null
}) {
  const perf        = useMemo(() => computePerf(trades), [trades])
  const closedCount = trades.filter((t) => t.status === 'closed').length

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-200">Performance</h2>
          {!loading && (
            <span className="text-[10px] text-slate-600">{closedCount} closed</span>
          )}
        </div>
        <Link
          to="/trades"
          className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
        >
          Journal <ChevronRight size={10} />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 size={16} className="text-slate-600 animate-spin" />
        </div>
      ) : error ? (
        <div className="text-xs text-red-400">{error}</div>
      ) : closedCount === 0 ? (
        <div className="text-center py-8">
          <TrendingUp size={20} className="text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-600">No closed trades yet.</p>
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Win Rate</div>
              {perf.winRate !== null ? (
                <div className={`text-base font-bold tabular-nums ${
                  perf.winRate >= 55 ? 'text-emerald-400' : perf.winRate >= 45 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {fmt(perf.winRate)}%
                </div>
              ) : (
                <div className="text-sm text-slate-600">N/A<span className="text-[9px] ml-0.5">(min 5)</span></div>
              )}
            </div>
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Profit Factor</div>
              {perf.profitFactor !== null ? (
                <div className={`text-base font-bold tabular-nums ${
                  perf.profitFactor >= 1.5 ? 'text-emerald-400' : perf.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {fmt(perf.profitFactor, 2)}
                </div>
              ) : (
                <div className="text-sm text-slate-600">N/A</div>
              )}
            </div>
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Avg R:R</div>
              {perf.avgRR !== null ? (
                <div className={`text-base font-bold tabular-nums ${
                  perf.avgRR >= 1.5 ? 'text-emerald-400' : perf.avgRR >= 1 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {fmt(perf.avgRR, 2)}R
                </div>
              ) : (
                <div className="text-sm text-slate-600">N/A</div>
              )}
            </div>
          </div>

          {/* Equity mini-chart */}
          <div className="bg-surface-700/30 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-600 uppercase tracking-wide">
                Equity curve — last {Math.min(closedCount, 30)} trades
              </span>
              <span className={`text-xs font-semibold tabular-nums ${
                perf.totalClosedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {perf.totalClosedPnl >= 0 ? '+' : ''}{fmtCurrency(perf.totalClosedPnl)}
              </span>
            </div>
            <MiniEquityCurve equity={perf.equity} />
          </div>

          {/* Best / worst */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-600">Best trade</div>
                <div className="text-xs font-semibold text-emerald-400 tabular-nums">
                  {perf.bestTrade !== null ? `+${fmtCurrency(perf.bestTrade)}` : '—'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={12} className="text-red-500 shrink-0" />
              <div>
                <div className="text-[10px] text-slate-600">Worst trade</div>
                <div className="text-xs font-semibold text-red-400 tabular-nums">
                  {perf.worstTrade !== null ? fmtCurrency(perf.worstTrade) : '—'}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP KPI BAR
// ─────────────────────────────────────────────────────────────────────────────

function KpiBar({ trades, loading, profileCapital }: {
  trades: TradeListItem[]
  loading: boolean
  profileCapital: string | null
}) {
  const capital = profileCapital ? parseFloat(profileCapital) : null

  const openTrades = trades.filter((t) => t.status === 'open' || t.status === 'partial')

  const closedToday = trades.filter((t) => {
    if (t.status !== 'closed' || !t.closed_at) return false
    const d   = new Date(t.closed_at)
    const now = new Date()
    return d.toDateString() === now.toDateString()
  })
  const todayPnl = closedToday.reduce((sum, t) => sum + pct(t.realized_pnl), 0)

  const totalRisk = openTrades.reduce((sum, t) => sum + pct(t.current_risk ?? t.risk_amount), 0)
  const riskPct   = capital && capital > 0 ? (totalRisk / capital) * 100 : null

  const closedAll = trades.filter((t) => t.status === 'closed' && t.realized_pnl !== null)
  const wins      = closedAll.filter((t) => pct(t.realized_pnl) > 0)
  const winRate   = closedAll.length >= 5 ? (wins.length / closedAll.length) * 100 : null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <StatCard
        label="Open Positions"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : openTrades.length
        }
        sub={loading ? '' : openTrades.length === 0
          ? 'No live positions'
          : `${openTrades.filter((t) => t.status === 'partial').length} partial`
        }
        accent="brand"
        info="Open + partially closed positions."
      />
      <StatCard
        label="Today's P&L"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : closedToday.length === 0
          ? '—'
          : <span className={todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {todayPnl >= 0 ? '+' : ''}{fmtCurrency(todayPnl)}
            </span>
        }
        sub={loading ? '' : closedToday.length === 0
          ? 'No closes today'
          : `${closedToday.length} trade${closedToday.length > 1 ? 's' : ''} closed`
        }
        accent="bull"
        info="Realized P&L from trades closed today."
      />
      <StatCard
        label="Portfolio Risk"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : riskPct !== null
          ? <span className={riskPct > 5 ? 'text-red-400' : riskPct > 3 ? 'text-amber-400' : 'text-slate-100'}>
              {fmt(riskPct)}%
            </span>
          : openTrades.length === 0 ? '0%' : '—'
        }
        sub={loading ? '' : `${fmtCurrency(totalRisk)} at risk`}
        accent="neutral"
        info="Sum of current_risk across open positions ÷ capital. Trades at BE show 0 risk."
      />
      <StatCard
        label="Win Rate"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : winRate !== null
          ? <span className={winRate >= 55 ? 'text-emerald-400' : winRate >= 45 ? 'text-amber-400' : 'text-red-400'}>
              {fmt(winRate)}%
            </span>
          : '—'
        }
        sub={loading ? '' : closedAll.length < 5
          ? `${closedAll.length}/5 trades (min 5)`
          : `${closedAll.length} closed trades`
        }
        accent="bear"
        info="Shown after 5+ closed trades to avoid statistical noise."
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { activeProfile } = useProfile()

  const [trades, setTrades]   = useState<TradeListItem[]>([])
  const [tLoading, setTLoading] = useState(false)
  const [tError, setTError]     = useState<string | null>(null)

  const loadTrades = useCallback(async () => {
    if (!activeProfile) return
    setTLoading(true)
    setTError(null)
    try {
      setTrades(await tradesApi.list(activeProfile.id))
    } catch (e) {
      setTError((e as Error).message)
    } finally {
      setTLoading(false)
    }
  }, [activeProfile])

  useEffect(() => { void loadTrades() }, [loadTrades])

  return (
    <div>
      <PageHeader
        icon="📈"
        title="Dashboard"
        subtitle={
          activeProfile
            ? `Overview for ${activeProfile.name}`
            : 'Overview of your trading activity'
        }
        badge="Phase 1"
        badgeVariant="phase"
      />

      {/* No profile selected */}
      {!activeProfile && (
        <div className="rounded-xl bg-surface-800 border border-amber-700/40 p-6 text-center mb-6">
          <p className="text-sm text-amber-400 mb-2">No profile selected.</p>
          <Link to="/settings/profiles" className="text-xs text-brand-400 underline">
            Create or select a profile →
          </Link>
        </div>
      )}

      {activeProfile && (
        <>
          {/* ── KPI bar ─────────────────────────────────────────────────── */}
          <KpiBar
            trades={trades}
            loading={tLoading}
            profileCapital={activeProfile.capital_current}
          />

          {/* ── 2-column widget grid ─────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <GoalsWidget    profileId={activeProfile.id} />
            <MAWidget       profileId={activeProfile.id} />
            <PositionsWidget  trades={trades} loading={tLoading} error={tError} />
            <PerformanceWidget trades={trades} loading={tLoading} error={tError} />
          </div>
        </>
      )}
    </div>
  )
}
