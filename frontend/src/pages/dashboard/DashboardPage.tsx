// ── Dashboard ─────────────────────────────────────────────────────────────────────
// Goals widget:
//   • Style selector (persisted in localStorage per profile)
//   • ALL 3 periods (daily / weekly / monthly) shown simultaneously
//   • When trade_count === 0 → greyed "No trades [this period]" row, no bars
//   • Status badge: ✅ ON TRACK / ⚠️ WARNING (≥75% risk) / 🛑 BLOCKED / 🎯 GOAL HIT
//   • Override friction: "I understand — trade anyway" when blocked
// MA widget: HTF/MTF/LTF scores inline with progress bars
// Performance: Win Rate, Profit Factor, Avg R:R, equity curve

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Target, Activity,
  Loader2, RefreshCw, AlertTriangle, ChevronRight,
  CheckCircle2, Minus, Plus, ShieldAlert,
  Zap,
} from 'lucide-react'
import { PageHeader }  from '../../components/ui/PageHeader'
import { StatCard }    from '../../components/ui/StatCard'
import { useProfile }  from '../../context/ProfileContext'
import { MarketVIWidget }  from '../../components/dashboard/MarketVIWidget'
import {
  goalsApi, tradesApi, riskApi,
} from '../../lib/api'
import { RiskAlertBanner } from '../../components/risk/RiskAlertBanner'
import type {
  GoalProgressItem, TradeListItem, RiskBudgetOut,
} from '../../types/api'

// ── Helpers ────────────────────────────────────────────────────────────────

function pct(v: string | number | null | undefined): number {
  if (v == null) return 0
  return typeof v === 'string' ? parseFloat(v) : v
}

function fmt(n: number, dp = 2): string {
  return n.toFixed(dp)
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
const PERIOD_EMPTY_LABEL: Record<string, string> = {
  daily:   'No trades today',
  weekly:  'No trades this week',
  monthly: 'No trades this month',
}
const PERIOD_ORDER: Record<string, number> = { daily: 0, weekly: 1, monthly: 2 }

// ── Single period row ─────────────────────────────────────────────────────

function GoalRow({
  item,
  onOverride,
  overridden,
}: {
  item: GoalProgressItem
  onOverride: (period: string) => void
  overridden: boolean
}) {
  const pnlPct       = parseFloat(item.pnl_pct)
  const goalPct      = parseFloat(item.goal_pct)
  const limitPct     = parseFloat(item.limit_pct)        // negative
  const goalProgress = Math.min(100, Math.max(0, parseFloat(item.goal_progress_pct)))
  const riskProgress = Math.min(100, Math.max(0, parseFloat(item.risk_progress_pct)))

  // No trades this period → greyed placeholder
  if (item.trade_count === 0) {
    return (
      <div className="flex flex-col gap-1 py-3 border-b border-surface-700 last:border-none opacity-40">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-slate-500">{PERIOD_LABELS[item.period] ?? item.period}</span>
          <span className="text-[10px] text-slate-600 italic">{PERIOD_EMPTY_LABEL[item.period] ?? '— No activity'}</span>
        </div>
        {/* Ghost bars */}
        <div className="h-1 rounded-full bg-surface-700/60" />
        <div className="h-1 rounded-full bg-surface-700/40" />
      </div>
    )
  }

  let status: 'hit' | 'blocked' | 'warning' | 'ok' = 'ok'
  if (item.goal_hit)            status = 'hit'
  else if (item.limit_hit)      status = 'blocked'
  else if (riskProgress >= 75)  status = 'warning'

  const statusBadge = {
    hit:     <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">🎯 HIT</span>,
    blocked: <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-900/40 text-red-400 border border-red-700/40">🛑 BLOCKED</span>,
    warning: <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 border border-amber-700/40">⚠️ WARNING</span>,
    ok:      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-surface-700 text-slate-400 border border-surface-600">✅ ON TRACK</span>,
  }[status]

  return (
    <div className="flex flex-col gap-2 py-3 border-b border-surface-700 last:border-none">
      {/* Period header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-300">{PERIOD_LABELS[item.period] ?? item.period}</span>
          {statusBadge}
          <span className="text-[9px] text-slate-700">{item.trade_count} trade{item.trade_count !== 1 ? 's' : ''}</span>
        </div>
        <span className={`text-sm font-bold tabular-nums ${pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%
        </span>
      </div>

      {/* Goal bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-600">Goal progress</span>
          <span className="text-[10px] text-slate-500 tabular-nums">{goalProgress.toFixed(0)}% of {goalPct > 0 ? '+' : ''}{goalPct.toFixed(2)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${status === 'hit' ? 'bg-emerald-500' : 'bg-brand-500'}`}
            style={{ width: `${goalProgress}%` }}
          />
        </div>
      </div>

      {/* Risk bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-600">Risk used</span>
          <span className="text-[10px] text-slate-500 tabular-nums">
            {riskProgress.toFixed(0)}% of {Math.abs(limitPct).toFixed(2)}% limit
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              status === 'blocked' ? 'bg-red-500'
              : status === 'warning' ? 'bg-amber-500'
              : riskProgress > 0 ? 'bg-surface-400'
              : 'bg-surface-600'
            }`}
            style={{ width: `${riskProgress}%` }}
          />
        </div>
      </div>

      {/* Blocked override button */}
      {status === 'blocked' && !overridden && (
        <button
          type="button"
          onClick={() => onOverride(item.period)}
          className="text-[10px] text-amber-400 hover:text-amber-300 bg-amber-900/10 border border-amber-800/30 rounded px-2.5 py-1.5 transition-colors text-left"
        >
          ⚠️ Limit hit — I understand, let me trade anyway →
        </button>
      )}
      {status === 'blocked' && overridden && (
        <p className="text-[10px] text-slate-600 italic">Override active — trade carefully.</p>
      )}
    </div>
  )
}

function GoalsWidget({ profileId }: { profileId: number }) {
  const [progress, setProgress]   = useState<GoalProgressItem[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)
  // override map: period → overridden (anti-revenge-trade friction)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const prog = await goalsApi.progress(profileId)
      setProgress(prog)
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }, [profileId])

  useEffect(() => { void load() }, [load])

  const handleOverride = (period: string) => {
    setOverrides((prev) => ({ ...prev, [period]: true }))
  }

  // Global goals (style_id = null) sorted daily → weekly → monthly
  const filtered = useMemo(() =>
    [...progress].sort((a, b) => (PERIOD_ORDER[a.period] ?? 99) - (PERIOD_ORDER[b.period] ?? 99)),
    [progress],
  )

  const blockedCount = filtered.filter((i) => i.limit_hit && !overrides[i.period]).length
  const hitCount     = filtered.filter((i) => i.goal_hit).length

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-4">
      {/* Widget header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={14} className="text-brand-400" />
          <h2 className="text-sm font-semibold text-slate-200">Goals</h2>
          {!loading && blockedCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-900/30 text-red-400 border border-red-700/40">
              🛑 {blockedCount} blocked
            </span>
          )}
          {!loading && hitCount > 0 && blockedCount === 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/30 text-emerald-400 border border-emerald-700/40">
              🎯 {hitCount} hit
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} className="text-slate-600 hover:text-slate-400 transition-colors" title="Refresh"><RefreshCw size={12} /></button>
          <Link to="/goals" className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-0.5">Manage <ChevronRight size={10} /></Link>
        </div>
      </div>

      {/* Style tabs — removed: goals are now global (style_id = null) */}

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 size={16} className="text-slate-600 animate-spin" /></div>
      ) : error ? (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg p-3">{error}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8">
          <Target size={20} className="text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-600">No active goals for this style.</p>
          <Link to="/goals" className="text-[10px] text-brand-400 hover:underline">Set a goal →</Link>
        </div>
      ) : (
        <div>
          {filtered.map((item) => (
            <GoalRow
              key={`${item.goal_id}-${item.period}`}
              item={item}
              onOverride={handleOverride}
              overridden={overrides[item.period] ?? false}
            />
          ))}
        </div>
      )}

      {/* Footer: period date range for first item */}
      {!loading && filtered.length > 0 && (
        <p className="text-[9px] text-slate-700 tabular-nums">
          {filtered[0]?.period_start} → {filtered[filtered.length - 1]?.period_end}
        </p>
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
  const pending = useMemo(() => trades.filter((t) => t.status === 'pending'), [trades])

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
        <Link to="/trades" className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5">
          Journal <ChevronRight size={10} />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 size={16} className="text-slate-600 animate-spin" /></div>
      ) : error ? (
        <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg p-3">{error}</div>
      ) : open.length === 0 ? (
        <div className="text-center py-8">
          <Minus size={20} className="text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-600">No open positions.</p>
          <Link to="/trades/new" className="inline-flex items-center gap-1 mt-2 text-[10px] text-emerald-400 hover:underline">
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
// 4. PERFORMANCE WIDGET — WR & R:R shown from 1 trade
// ─────────────────────────────────────────────────────────────────────────────

interface PerfStats {
  winRate:        number          // always computed (even N=1)
  winRateCount:   number          // number of closed trades used
  profitFactor:   number | null
  totalClosedPnl: number
  avgRR:          number | null
  bestTrade:      number | null
  worstTrade:     number | null
  equity:         number[]
}

function computePerf(trades: TradeListItem[]): PerfStats | null {
  const closed = trades.filter((t) => t.status === 'closed' && t.realized_pnl !== null)
  if (closed.length === 0) return null

  const pnls   = closed.map((t) => pct(t.realized_pnl))
  const wins   = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p <= 0)

  const winRate      = (wins.length / closed.length) * 100
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
    winRateCount: closed.length,
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
    return <div className="flex items-center justify-center h-14 text-[10px] text-slate-700">Not enough data</div>
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
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
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
  const lowSample   = perf !== null && perf.winRateCount < 5

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-slate-200">Performance</h2>
          {!loading && <span className="text-[10px] text-slate-600">{closedCount} closed</span>}
        </div>
        <Link to="/trades" className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5">
          Journal <ChevronRight size={10} />
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8"><Loader2 size={16} className="text-slate-600 animate-spin" /></div>
      ) : error ? (
        <div className="text-xs text-red-400">{error}</div>
      ) : perf === null ? (
        <div className="text-center py-8">
          <TrendingUp size={20} className="text-slate-700 mx-auto mb-2" />
          <p className="text-xs text-slate-600">No closed trades yet.</p>
        </div>
      ) : (
        <>
          {lowSample && (
            <div className="flex items-center gap-1.5 text-[10px] text-amber-400/80 bg-amber-900/10 border border-amber-800/20 rounded px-2.5 py-1.5">
              <Zap size={10} />
              Low sample — N={perf.winRateCount} trade{perf.winRateCount > 1 ? 's' : ''}. Stats are indicative.
            </div>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Win Rate</div>
              <div className={`text-base font-bold tabular-nums ${perf.winRate >= 55 ? 'text-emerald-400' : perf.winRate >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                {fmt(perf.winRate)}%
              </div>
              {lowSample && <div className="text-[9px] text-slate-700 mt-0.5">N={perf.winRateCount}</div>}
            </div>
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Profit Factor</div>
              {perf.profitFactor !== null ? (
                <div className={`text-base font-bold tabular-nums ${perf.profitFactor >= 1.5 ? 'text-emerald-400' : perf.profitFactor >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
                  {fmt(perf.profitFactor, 2)}
                </div>
              ) : (
                <div className="text-sm text-slate-600">N/A<span className="text-[9px] ml-0.5">(no losses)</span></div>
              )}
            </div>
            <div className="bg-surface-700/50 rounded-lg px-3 py-2">
              <div className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">Avg R:R</div>
              {perf.avgRR !== null ? (
                <div className={`text-base font-bold tabular-nums ${perf.avgRR >= 1.5 ? 'text-emerald-400' : perf.avgRR >= 1 ? 'text-amber-400' : 'text-red-400'}`}>
                  {fmt(perf.avgRR, 2)}R
                </div>
              ) : (
                <div className="text-sm text-slate-600">N/A<span className="text-[9px] ml-0.5">(no losses)</span></div>
              )}
            </div>
          </div>

          {/* Equity mini-chart */}
          <div className="bg-surface-700/30 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-600 uppercase tracking-wide">
                Equity — last {Math.min(closedCount, 30)} trades
              </span>
              <span className={`text-xs font-semibold tabular-nums ${perf.totalClosedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
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
// TOP KPI BAR — Capital + Portfolio Risk (with available risk + warnings)
// ─────────────────────────────────────────────────────────────────────────────

function KpiBar({ trades, loading, profile }: {
  trades: TradeListItem[]
  loading: boolean
  profile: { capital_current: string; capital_start: string; currency: string | null; max_concurrent_risk_pct: string }
}) {
  const capital     = parseFloat(profile.capital_current)
  const capitalStart = parseFloat(profile.capital_start)
  const maxRiskPct  = parseFloat(profile.max_concurrent_risk_pct)
  const currency    = profile.currency ?? 'USD'

  // Partial trades: booked_pnl is already locked-in but not yet in capital_current
  const partialBooked   = trades
    .filter((t) => t.status === 'partial' && t.booked_pnl != null)
    .reduce((sum, t) => sum + pct(t.booked_pnl), 0)
  const capitalAdjusted = capital + partialBooked

  const pnlAmount = capitalAdjusted - capitalStart
  const pnlPct    = capitalStart > 0 ? (pnlAmount / capitalStart) * 100 : 0

  // Include pending — their risk_amount is already committed against the budget
  const openTrades  = trades.filter((t) => t.status === 'open' || t.status === 'partial' || t.status === 'pending')
  const closedToday = trades.filter((t) => {
    if (t.status !== 'closed' || !t.closed_at) return false
    return new Date(t.closed_at).toDateString() === new Date().toDateString()
  })
  const todayPnl = closedToday.reduce((sum, t) => sum + pct(t.realized_pnl), 0)

  // Live risk = open/partial trades only (capital actively at risk).
  // Pending LIMITs are not yet filled — shown in parentheses as "if filled" preview.
  const liveTrades    = openTrades.filter((t) => t.status !== 'pending')
  const pendingTrades = openTrades.filter((t) => t.status === 'pending')
  // current_risk handles: open trades (actual risk), BE moves (0), etc.
  const liveRisk      = liveTrades.reduce((sum, t) => sum + pct(t.current_risk ?? t.risk_amount), 0)
  const pendingRisk   = pendingTrades.reduce((sum, t) => sum + pct(t.risk_amount), 0)
  const liveRiskPct    = capital > 0 ? (liveRisk    / capital) * 100 : 0
  const pendingRiskPct = capital > 0 ? (pendingRisk / capital) * 100 : 0
  const riskPct        = liveRiskPct   // committed = live only
  const maxRiskAmt     = capital * (maxRiskPct / 100)
  const availRiskPct   = Math.max(0, maxRiskPct - riskPct)

  // Risk status
  const riskExceeded  = riskPct > maxRiskPct
  const riskWarning   = !riskExceeded && riskPct >= maxRiskPct * 0.75
  const riskEmoji     = riskExceeded ? '🛑' : riskWarning ? '⚠️' : riskPct > 0 ? '🟡' : '🟢'
  const riskColor     = riskExceeded ? 'text-red-400' : riskWarning ? 'text-amber-400' : 'text-slate-100'

  const closedAll = trades.filter((t) => t.status === 'closed' && t.realized_pnl !== null)
  const wins      = closedAll.filter((t) => pct(t.realized_pnl) > 0)
  const winRate   = closedAll.length > 0 ? (wins.length / closedAll.length) * 100 : null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* Capital card */}
      <StatCard
        label="Portfolio Balance"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : <span className="text-sm font-bold tabular-nums text-slate-100">
              {fmtCurrency(capitalAdjusted, currency)}
            </span>
        }
        sub={loading ? '' : (
          <span className={`font-semibold tabular-nums ${pnlAmount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {pnlAmount >= 0 ? '+' : ''}{pnlPct.toFixed(2)}% ({pnlAmount >= 0 ? '+' : ''}{fmtCurrency(pnlAmount, currency)})
          </span>
        ) as unknown as string}
        accent="brand"
        info="Current capital vs starting capital. P&L % = (current − start) / start."
      />

      {/* Today P&L */}
      <StatCard
        label="Today's P&L"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : closedToday.length === 0
          ? '—'
          : <span className={todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {todayPnl >= 0 ? '+' : ''}{fmtCurrency(todayPnl, currency)}
            </span>
        }
        sub={loading ? '' : closedToday.length === 0
          ? 'No closes today'
          : `${closedToday.length} trade${closedToday.length > 1 ? 's' : ''} closed`
        }
        accent="bull"
        info="Realized P&L from trades closed today."
      />

      {/* Portfolio Risk — committed (live + pending LIMITs) vs max */}
      <StatCard
        label={`${riskEmoji} Portfolio Risk`}
        valueSize="text-base"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : <span className="tabular-nums font-mono">
              <span className={riskColor}>-{fmtCurrency(liveRisk, currency)}</span>
              <span className="text-slate-600">&nbsp;/&nbsp;-{fmtCurrency(maxRiskAmt, currency)}</span>
            </span>
        }
        sub={loading ? '' :
          riskExceeded
            ? <span className="text-red-400 font-semibold">🛑 LIMIT EXCEEDED — reduce positions</span> as unknown as string
            : <span className="text-slate-500">
                <span className="text-slate-400 font-mono">{fmt(riskPct)}%</span>
                <span className="text-slate-600"> / {fmt(maxRiskPct)}%</span>
                {availRiskPct > 0 && (
                  <span>
                    {' · Avail: '}
                    <span className="text-slate-300 font-mono">{fmt(availRiskPct)}%</span>
                  </span>
                )}
                {pendingRiskPct > 0 && (
                  <span className="text-slate-500">
                    {' (⏳ '}
                    <span className="text-amber-500/70">{fmt(pendingRiskPct)}%</span>
                    {' if filled)'}
                  </span>
                )}
              </span> as unknown as string
        }
        accent="neutral"
        info={`Live risk = open/partial trades (using current_risk; 0 at BE). Pending LIMITs shown in parentheses as potential risk if filled. Avail = max − live risk.`}
      />

      {/* Win Rate — shown from 1 trade */}
      <StatCard
        label="Win Rate"
        value={loading
          ? <Loader2 size={18} className="animate-spin text-slate-500" />
          : winRate !== null
          ? <span className={winRate >= 55 ? 'text-emerald-400' : winRate >= 45 ? 'text-amber-400' : 'text-blue-400'}>
              {fmt(winRate)}%
            </span>
          : '—'
        }
        sub={loading ? '' : closedAll.length === 0
          ? 'No closed trades'
          : closedAll.length < 5
            ? `N=${closedAll.length} — low sample`
            : `${closedAll.length} closed trades`
        }
        accent="blue"
        info="Win rate from all closed trades. Shown from 1 trade with N= label when below 5 trades."
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk exceeded banner (shown above widgets when limit is hit)
// ─────────────────────────────────────────────────────────────────────────────

function RiskExceededBanner({ riskPct, maxRiskPct }: { riskPct: number; maxRiskPct: number }) {
  if (riskPct <= maxRiskPct) return null
  return (
    <div className="flex items-start gap-3 mb-5 px-4 py-3 rounded-xl bg-red-900/20 border border-red-700/40 text-sm text-red-300">
      <ShieldAlert size={18} className="shrink-0 mt-0.5 text-red-400" />
      <div>
        <p className="font-semibold">🛑 Portfolio risk limit exceeded</p>
        <p className="text-xs text-red-400/80 mt-0.5">
          You are at <strong>{fmt(riskPct)}%</strong> risk vs your maximum of <strong>{fmt(maxRiskPct)}%</strong>.
          You can still open new trades, but consider reducing or closing existing positions first.
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGE
// ─────────────────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { activeProfile } = useProfile()

  const [trades,    setTrades]    = useState<TradeListItem[]>([])
  const [tLoading,  setTLoading]  = useState(false)
  const [tError,    setTError]    = useState<string | null>(null)

  const [budget,    setBudget]    = useState<RiskBudgetOut | null>(null)

  const loadTrades = useCallback(async () => {
    if (!activeProfile) return
    setTLoading(true); setTError(null)
    try { setTrades(await tradesApi.list(activeProfile.id)) }
    catch (e) { setTError((e as Error).message) }
    finally { setTLoading(false) }
  }, [activeProfile])

  const loadBudget = useCallback(async () => {
    if (!activeProfile) return
    try { setBudget(await riskApi.getBudget(activeProfile.id)) }
    catch { /* non-blocking — dashboard still works without budget */ }
  }, [activeProfile])

  useEffect(() => { void loadTrades() }, [loadTrades])
  useEffect(() => { void loadBudget() }, [loadBudget])

  // Compute risk for the hard-limit banner (local, no API roundtrip needed)
  // Only live (open/partial) trades count — pending LIMITs are not yet capital-at-risk
  const openTrades    = trades.filter((t) => t.status === 'open' || t.status === 'partial')
  const capital       = activeProfile ? parseFloat(activeProfile.capital_current) : 0
  const maxRiskPct    = activeProfile ? parseFloat(activeProfile.max_concurrent_risk_pct) : 0
  const currentRiskPct = capital > 0
    ? (openTrades.reduce((sum, t) => sum + pct(t.current_risk ?? t.risk_amount), 0) / capital) * 100
    : 0

  return (
    <div>
      <PageHeader
        icon="📈"
        title="Dashboard"
        subtitle={activeProfile ? `Overview for ${activeProfile.name}` : 'Overview of your trading activity'}
      />

      {/* No profile selected */}
      {!activeProfile && (
        <div className="rounded-xl bg-surface-800 border border-amber-700/40 p-6 text-center mb-6">
          <p className="text-sm text-amber-400 mb-2">No profile selected.</p>
          <Link to="/settings/profiles" className="text-xs text-brand-400 underline">Create or select a profile →</Link>
        </div>
      )}

      {activeProfile && (
        <>
          {/* ── Risk alert banner (amber — configurable threshold from budget API) ── */}
          <RiskAlertBanner budget={budget} />

          {/* ── Risk exceeded banner (red — hard limit exceeded, local computation) ── */}
          <RiskExceededBanner riskPct={currentRiskPct} maxRiskPct={maxRiskPct} />

          {/* ── KPI bar ─────────────────────────────────────────────────── */}
          <KpiBar trades={trades} loading={tLoading} profile={activeProfile} />

          {/* ── 2-column widget grid ─────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <MarketVIWidget profileId={activeProfile.id} />
            <GoalsWidget    profileId={activeProfile.id} />
            <PositionsWidget  trades={trades} loading={tLoading} error={tError} />
            <PerformanceWidget trades={trades} loading={tLoading} error={tError} />
          </div>
        </>
      )}
    </div>
  )
}
