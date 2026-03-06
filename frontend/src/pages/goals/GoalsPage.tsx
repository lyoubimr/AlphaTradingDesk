// ── Goals page ────────────────────────────────────────────────────────────
// Tracking view: live progress cards + goals table + period plan.
// Goal creation → /settings/goals (dedicated settings page).

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Target, Plus, RefreshCw, Loader2, CheckCircle2,
  AlertTriangle, TrendingUp, Settings,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { useProfile } from '../../context/ProfileContext'
import { goalsApi } from '../../lib/api'
import type { GoalOut, GoalProgressItem, GoalUpdate } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pct(v: string | number): number {
  return typeof v === 'string' ? parseFloat(v) : v
}

const PERIOD_LABELS: Record<string, string> = {
  daily:   '📅 Daily',
  weekly:  '📆 Weekly',
  monthly: '🗓️ Monthly',
}

const PERIOD_ORDER: Record<string, number> = { daily: 0, weekly: 1, monthly: 2 }

// ─────────────────────────────────────────────────────────────────────────────
// ProgressCard
// ─────────────────────────────────────────────────────────────────────────────

function fmtAmount(pctVal: number, capital: number, currency: string, signed = false): string {
  const amount = (capital * Math.abs(pctVal)) / 100
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
  }).format(amount)
  if (!signed) return formatted
  return pctVal < 0 ? `-${formatted}` : `+${formatted}`
}

function ProgressCard({
  item,
  capital,
  currency,
}: {
  item: GoalProgressItem
  capital: number
  currency: string
}) {
  const pnlPct       = pct(item.pnl_pct)
  const goalPct      = pct(item.goal_pct)
  const limitPct     = pct(item.limit_pct)
  const goalProgress = Math.min(100, Math.max(0, pct(item.goal_progress_pct)))
  const riskProgress = Math.min(100, Math.max(0, pct(item.risk_progress_pct)))
  const isPositive   = pnlPct >= 0

  // Avg R — no bar, just badge
  const avgRCurrent = item.avg_r != null && !isNaN(parseFloat(item.avg_r)) ? parseFloat(item.avg_r) : null
  const avgRMin     = item.avg_r_min != null && !isNaN(parseFloat(item.avg_r_min)) ? parseFloat(item.avg_r_min) : null

  let barColor = 'bg-brand-500'
  if (item.goal_hit)           barColor = 'bg-emerald-500'
  else if (item.limit_hit)     barColor = 'bg-red-500'
  else if (riskProgress >= 75) barColor = 'bg-amber-500'

  const ptCfg = item.period_type === 'process'
    ? { color: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20', label: 'Process' }
    : { color: 'text-slate-400', bg: 'bg-surface-700', border: 'border-surface-600', label: 'Outcome' }

  return (
    <div className={`rounded-xl bg-surface-800 border p-5 flex flex-col gap-3 transition-colors ${
      item.limit_hit ? 'border-red-500/40' : item.goal_hit ? 'border-emerald-500/40' : 'border-surface-700'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-semibold text-slate-200">{PERIOD_LABELS[item.period] ?? item.period}</p>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${ptCfg.color} ${ptCfg.bg} ${ptCfg.border}`}>
              {ptCfg.label}
            </span>
          </div>
          <p className="text-[10px] text-slate-600 mt-0.5 font-mono">
            {item.period_start} → {item.period_end}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.goal_hit && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <CheckCircle2 size={9} /> Goal hit
            </span>
          )}
          {item.limit_hit && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
              <AlertTriangle size={9} /> Limit hit
            </span>
          )}
        </div>
      </div>

      {/* P&L + Target/Limit */}
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] text-slate-600 mb-0.5">Period P&amp;L</p>
          <p className={`text-xl font-bold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {isPositive ? '+' : ''}{pnlPct.toFixed(3)}%
          </p>
          <p className={`text-[10px] font-mono italic mt-0.5 ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmtAmount(pnlPct, capital, currency, true)}
          </p>
          <p className="text-[9px] text-slate-700 mt-0.5">
            {item.trade_count > 0
              ? `${item.trade_count} trade${item.trade_count !== 1 ? 's' : ''}`
              : 'No trades yet'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-600 mb-0.5">Target / Limit</p>
          <p className="text-xs font-mono">
            <span className="text-emerald-500">+{goalPct.toFixed(2)}%</span>
            {' / '}
            <span className="text-red-500">{limitPct.toFixed(2)}%</span>
          </p>
          <p className="text-[10px] font-mono italic text-slate-600 mt-0.5">
            <span className="text-emerald-700">+{fmtAmount(goalPct, capital, currency)}</span>
            {' / '}
            <span className="text-red-700">-{fmtAmount(limitPct, capital, currency)}</span>
          </p>
        </div>
      </div>

      {/* Goal progress */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-600 mb-1">
          <span>Goal progress</span>
          <span className="font-mono">{goalProgress.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${goalProgress}%` }} />
        </div>
      </div>

      {/* Loss limit usage — always shown (process goals too: loss is loss) */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-600 mb-1">
          <span>Loss limit usage</span>
          <span className={`font-mono ${riskProgress >= 100 ? 'text-red-400' : riskProgress >= 75 ? 'text-amber-400' : ''}`}>
            {riskProgress.toFixed(0)}%
          </span>
        </div>
        <div className="h-1 rounded-full bg-surface-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${riskProgress >= 100 ? 'bg-red-500' : riskProgress >= 75 ? 'bg-amber-500' : 'bg-surface-600'}`}
            style={{ width: `${riskProgress}%` }}
          />
        </div>
        {item.period_type === 'process' && riskProgress > 0 && (
          <p className="text-[9px] text-slate-700 italic mt-0.5">
            Process goal — limit hit doesn't block trading, but monitor your drawdown.
          </p>
        )}
      </div>

      {/* Avg R badge — last, only if goal has avg_r_min or trades have avg_r */}
      {(avgRCurrent != null || avgRMin != null) && (
        <div className="flex items-center justify-between pt-0.5 border-t border-surface-700/60">
          <span className="text-[10px] text-slate-600">Avg R</span>
          <div className="flex items-center gap-1.5">
            {avgRMin != null && (
              <span className="text-[10px] font-mono text-violet-400/60 border border-violet-500/20 bg-violet-500/5 px-1.5 py-0.5 rounded">
                goal ≥ {avgRMin.toFixed(1)}R
              </span>
            )}
            <span className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full border ${
              item.avg_r_hit === true
                ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                : item.avg_r_hit === false
                  ? 'text-amber-300 bg-amber-500/10 border-amber-500/25'
                  : avgRCurrent != null && avgRCurrent < 0
                    ? 'text-red-300 bg-red-500/10 border-red-500/20'
                    : 'text-violet-300 bg-violet-500/10 border-violet-500/20'
            }`}>
              {avgRCurrent != null ? avgRCurrent.toFixed(2) + 'R' : '—'}
              {item.avg_r_hit === true  && ' ✓'}
              {item.avg_r_hit === false && ' ↓'}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GoalRow — compact table row, inline toggle only (no edit — use /settings/goals)
// ─────────────────────────────────────────────────────────────────────────────

function GoalRow({
  goal,
  onToggle,
  toggling,
}: {
  goal: GoalOut
  onToggle: (goal: GoalOut) => void
  toggling: boolean
}) {
  const ptCfg = goal.period_type === 'process'
    ? 'text-sky-400 bg-sky-500/10 border-sky-500/20'
    : 'text-slate-500 bg-surface-700 border-surface-600'

  return (
    <tr className={`border-b border-surface-700/50 transition-colors ${goal.is_active ? '' : 'opacity-40'}`}>
      <td className="px-4 py-2.5 text-xs text-slate-300">{PERIOD_LABELS[goal.period] ?? goal.period}</td>
      <td className="px-4 py-2.5">
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-medium ${ptCfg}`}>
          {goal.period_type}
        </span>
      </td>
      <td className="px-4 py-2.5 text-xs font-mono text-emerald-400">+{parseFloat(goal.goal_pct).toFixed(2)}%</td>
      <td className="px-4 py-2.5 text-xs font-mono text-red-400">{parseFloat(goal.limit_pct).toFixed(2)}%</td>
      <td className="px-4 py-2.5 text-xs font-mono text-slate-500">
        {goal.avg_r_min ? `${parseFloat(goal.avg_r_min).toFixed(1)}R` : '—'}
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
          goal.is_active
            ? 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20'
            : 'text-slate-600 bg-surface-700 border border-surface-600'
        }`}>
          {goal.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <button
          type="button" disabled={toggling} onClick={() => onToggle(goal)}
          className="text-[10px] text-slate-500 hover:text-slate-200 transition-colors disabled:opacity-40 whitespace-nowrap"
        >
          {toggling ? <Loader2 size={10} className="animate-spin" /> : goal.is_active ? 'Disable' : 'Enable'}
        </button>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GoalsPage
// ─────────────────────────────────────────────────────────────────────────────

export function GoalsPage() {
  const { activeProfile } = useProfile()
  const navigate = useNavigate()

  const [goals,           setGoals]           = useState<GoalOut[]>([])
  const [progress,        setProgress]        = useState<GoalProgressItem[]>([])
  const [loadingGoals,    setLoadingGoals]     = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [toggling,        setToggling]        = useState<number | null>(null)

  const fetchAll = useCallback(() => {
    if (!activeProfile) { setGoals([]); setProgress([]); return }
    setLoadingGoals(true); setLoadingProgress(true); setError(null)

    goalsApi.list(activeProfile.id)
      .then(setGoals)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingGoals(false))

    goalsApi.progress(activeProfile.id)
      .then(setProgress)
      .catch(() => {})
      .finally(() => setLoadingProgress(false))
  }, [activeProfile])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function handleToggle(goal: GoalOut) {
    if (!activeProfile) return
    setToggling(goal.id)
    try {
      const patch: GoalUpdate = { is_active: !goal.is_active }
      const updated = await goalsApi.update(activeProfile.id, goal.id, patch)
      setGoals((prev) => prev.map((g) => g.id === goal.id ? updated : g))
      goalsApi.progress(activeProfile.id).then(setProgress).catch(() => {})
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setToggling(null)
    }
  }

  // KPIs
  const activeGoals = goals.filter((g) => g.is_active)
  const goalsHit    = progress.filter((p) => p.goal_hit).length
  const limitsHit   = progress.filter((p) => p.limit_hit).length
  const avgProgress = progress.length > 0
    ? (progress.reduce((s, p) => s + Math.min(100, pct(p.goal_progress_pct)), 0) / progress.length).toFixed(0)
    : null
  const worstRisk = progress.length > 0
    ? Math.max(0, ...progress.map((p) => pct(p.risk_progress_pct))).toFixed(0)
    : null

  const sortedProgress = [...progress].sort(
    (a, b) => (PERIOD_ORDER[b.period] ?? 0) - (PERIOD_ORDER[a.period] ?? 0),
  )
  const sortedGoals = [...goals].sort((a, b) => {
    const pDiff = (PERIOD_ORDER[a.period] ?? 0) - (PERIOD_ORDER[b.period] ?? 0)
    if (pDiff !== 0) return pDiff
    return a.period_type === 'outcome' ? -1 : 1
  })

  const isLoading = loadingGoals || loadingProgress

  return (
    <div>
      <PageHeader
        icon="🎯"
        title="Goals"
        subtitle="Live progress for the current period"
        badge="Phase 1"
        badgeVariant="phase"
        actions={
          <>
            <button type="button" className="atd-btn-ghost" onClick={fetchAll} disabled={isLoading} title="Refresh">
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              disabled={!activeProfile}
              className="atd-btn-ghost disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => navigate('/settings/goals')}
              title="Manage goals in Settings"
            >
              <Settings size={14} /> Manage
            </button>
            <button
              type="button"
              disabled={!activeProfile}
              className="atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => navigate('/settings/goals?new=1')}
            >
              <Plus size={14} /> New Goal
            </button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Goals"
          value={isLoading ? '…' : String(activeGoals.length)}
          sub={`${goals.length} total`}
          accent="brand"
        />
        <StatCard
          label="Goals Hit"
          value={isLoading ? '…' : progress.length === 0 ? '—' : String(goalsHit)}
          sub={progress.length > 0 ? 'this period' : 'no data yet'}
          accent="bull"
        />
        <StatCard
          label="Avg Progress"
          value={isLoading ? '…' : avgProgress != null ? `${avgProgress}%` : '—'}
          sub="toward targets"
          accent="neutral"
          info="Average % progression toward each active goal's target for the current period. 100% = goal reached. Computed across all active goals (daily + weekly + monthly)."
        />
        <StatCard
          label="Worst Risk"
          value={isLoading ? '…' : worstRisk != null ? `${worstRisk}%` : '—'}
          sub={limitsHit > 0 ? `⚠️ ${limitsHit} limit(s) hit` : 'of limit consumed'}
          accent={limitsHit > 0 || Number(worstRisk) >= 75 ? 'bear' : 'neutral'}
          info="Highest loss limit consumption across all active goals. Shows how close you are to hitting your worst drawdown limit. 75%+ = warning zone, 100% = limit hit → stop trading that period."
        />
      </div>

      {!activeProfile && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 p-10 text-center text-slate-500 text-sm">
          Select a profile to track goals.
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {activeProfile && (
        <>
          {/* ── Live progress cards ─────────────────────────────────── */}
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp size={13} className="text-brand-500" />
            <h2 className="text-sm font-medium text-slate-300">Current Period Progress</h2>
            {loadingProgress && <Loader2 size={11} className="animate-spin text-slate-600" />}
          </div>

          {!loadingProgress && activeGoals.length === 0 && (
            <div className="mb-8 rounded-xl bg-surface-800 border border-surface-700 px-5 py-10 text-center text-slate-600 text-sm">
              No active goals.{' '}
              <button type="button" className="text-brand-400 hover:text-brand-300 underline" onClick={() => navigate('/settings/goals')}>
                Create your first goal →
              </button>
            </div>
          )}

          {!loadingProgress && activeGoals.length > 0 && sortedProgress.length === 0 && (
            <div className="mb-8 rounded-xl bg-surface-800 border border-surface-700 px-5 py-8 text-center text-slate-500 text-sm">
              No closed P&amp;L this period yet — progress appears after your first closed trade.
            </div>
          )}

          {sortedProgress.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {sortedProgress.map((item) => (
                <ProgressCard
                  key={`${item.goal_id}`}
                  item={item}
                  capital={parseFloat(activeProfile.capital_current)}
                  currency={activeProfile.currency ?? 'USD'}
                />
              ))}
            </div>
          )}

          {/* ── All goals table ──────────────────────────────────────── */}
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target size={13} className="text-slate-500" />
              <h2 className="text-sm font-medium text-slate-400">All Goals</h2>
              {loadingGoals && <Loader2 size={11} className="animate-spin text-slate-600" />}
            </div>
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-400 transition-colors"
              onClick={() => navigate('/settings/goals')}
            >
              <Settings size={11} /> Edit in Settings
            </button>
          </div>

          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden mb-6">
            {!loadingGoals && goals.length === 0 && (
              <div className="px-5 py-10 text-center text-slate-600 text-sm">
                No goals yet.{' '}
                <button type="button" className="text-brand-400 hover:text-brand-300 underline" onClick={() => navigate('/settings/goals')}>
                  Create in Settings →
                </button>
              </div>
            )}
            {goals.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-700">
                      {['Period', 'Type', 'Target', 'Limit', 'Avg R min', 'Status', ''].map((h, i) => (
                        <th key={i} className="px-4 py-2.5 text-left text-slate-600 font-medium uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedGoals.map((goal) => (
                      <GoalRow
                        key={goal.id}
                        goal={goal}
                        onToggle={handleToggle}
                        toggling={toggling === goal.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Period Plan — minimal reference ─────────────────────────── */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 px-4 py-3 mb-6 flex items-center justify-between gap-4">
            <p className="text-[11px] text-slate-500 leading-snug">
              <span className="text-slate-300 font-medium">Period Plan:</span>{' '}
              🗓️ Monthly = growth target &nbsp;·&nbsp; 📆 Weekly ≈ ¼ monthly &nbsp;·&nbsp; 📅 Daily = session cap.
              When a limit fires, stop trading that period. Daily losses roll up to weekly and monthly.
            </p>
            <button
              type="button"
              className="shrink-0 text-[10px] text-slate-500 hover:text-brand-400 transition-colors whitespace-nowrap"
              onClick={() => navigate('/settings/goals')}
            >
              Configure →
            </button>
          </div>
        </>
      )}
    </div>
  )
}

