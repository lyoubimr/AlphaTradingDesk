// ── Goals page — Step 11 ──────────────────────────────────────────────────
// Real backend integration: CRUD goals + live progress from closed trades.
//
// Layout:
//   ① KPI bar (active goals, goals hit, avg progress, worst risk)
//   ② Progress cards — one per active goal (live pnl% vs target/limit)
//   ③ All goals table — toggle active, see all periods/styles
//   ④ New Goal modal

import { useEffect, useState, useCallback } from 'react'
import {
  Target, Plus, RefreshCw, Loader2, CheckCircle2,
  AlertTriangle, TrendingUp, X, ChevronDown,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { useProfile } from '../../context/ProfileContext'
import { goalsApi, stylesApi } from '../../lib/api'
import type { GoalOut, GoalProgressItem, TradingStyle, GoalPeriod } from '../../types/api'

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
// ProgressCard — one live goal with P&L bar
// ─────────────────────────────────────────────────────────────────────────────

function ProgressCard({ item }: { item: GoalProgressItem }) {
  const pnlPct       = pct(item.pnl_pct)
  const goalPct      = pct(item.goal_pct)
  const limitPct     = pct(item.limit_pct)  // negative
  const goalProgress = Math.min(100, Math.max(0, pct(item.goal_progress_pct)))
  const riskProgress = Math.min(100, Math.max(0, pct(item.risk_progress_pct)))

  const isPositive = pnlPct >= 0
  const sign       = pnlPct >= 0 ? '+' : ''

  let barColor = 'bg-brand-500'
  if (item.goal_hit)           barColor = 'bg-emerald-500'
  else if (item.limit_hit)     barColor = 'bg-red-500'
  else if (riskProgress >= 75) barColor = 'bg-amber-500'

  return (
    <div className={`rounded-xl bg-surface-800 border p-5 flex flex-col gap-4 transition-colors ${
      item.limit_hit
        ? 'border-red-500/40'
        : item.goal_hit
          ? 'border-emerald-500/40'
          : 'border-surface-700'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-200">{item.style_name}</p>
          <p className="text-[10px] text-slate-600 mt-0.5">
            {PERIOD_LABELS[item.period] ?? item.period}
            <span className="ml-2 font-mono text-slate-700">
              {item.period_start} → {item.period_end}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {item.goal_hit && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              <CheckCircle2 size={9} /> Goal hit!
            </span>
          )}
          {item.limit_hit && (
            <span className="flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
              <AlertTriangle size={9} /> Limit hit!
            </span>
          )}
        </div>
      </div>

      {/* Current P&L */}
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[10px] text-slate-600 mb-0.5">Period P&amp;L</p>
          <p className={`text-xl font-bold tabular-nums ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
            {sign}{pnlPct.toFixed(3)}%
          </p>
          <p className="text-[9px] text-slate-700 mt-0.5">closed + partial profits</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-600 mb-0.5">Target / Limit</p>
          <p className="text-xs font-mono text-slate-400">
            <span className="text-emerald-500">+{goalPct.toFixed(2)}%</span>
            {' / '}
            <span className="text-red-500">{limitPct.toFixed(2)}%</span>
          </p>
        </div>
      </div>

      {/* Goal progress bar */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-600 mb-1">
          <span>Progress toward goal</span>
          <span className="font-mono">{goalProgress.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${goalProgress}%` }}
          />
        </div>
      </div>

      {/* Risk bar */}
      <div>
        <div className="flex justify-between text-[10px] text-slate-600 mb-1">
          <span>Risk limit usage</span>
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
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GoalRow — compact row in the "All Goals" table
// ─────────────────────────────────────────────────────────────────────────────

function GoalRow({
  goal,
  styleName,
  onToggle,
  toggling,
}: {
  goal: GoalOut
  styleName: string
  onToggle: (goal: GoalOut) => void
  toggling: boolean
}) {
  return (
    <tr className={`border-b border-surface-700/50 transition-colors ${goal.is_active ? '' : 'opacity-40'}`}>
      <td className="px-4 py-2.5 text-sm text-slate-200">{styleName}</td>
      <td className="px-4 py-2.5 text-xs text-slate-400">{PERIOD_LABELS[goal.period] ?? goal.period}</td>
      <td className="px-4 py-2.5 text-xs font-mono text-emerald-400">+{parseFloat(goal.goal_pct).toFixed(2)}%</td>
      <td className="px-4 py-2.5 text-xs font-mono text-red-400">{parseFloat(goal.limit_pct).toFixed(2)}%</td>
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
          type="button"
          disabled={toggling}
          onClick={() => onToggle(goal)}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
        >
          {toggling ? <Loader2 size={10} className="animate-spin" /> : goal.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NewGoalModal
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = [
  'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600',
  'text-sm text-slate-200 placeholder-slate-600',
  'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 transition-colors',
].join(' ')

function NewGoalModal({
  profileId,
  styles,
  existingGoals,
  onClose,
  onCreated,
}: {
  profileId: number
  styles: TradingStyle[]
  existingGoals: GoalOut[]
  onClose: () => void
  onCreated: (goal: GoalOut) => void
}) {
  const [styleId,  setStyleId]  = useState<number | ''>('')
  const [period,   setPeriod]   = useState<GoalPeriod>('monthly')
  const [goalPct,  setGoalPct]  = useState('')
  const [limitPct, setLimitPct] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [err,      setErr]      = useState<string | null>(null)

  const goalNum  = goalPct  !== '' ? parseFloat(goalPct)  : NaN
  const limitNum = limitPct !== '' ? parseFloat(limitPct) : NaN
  const goalOk   = !isNaN(goalNum)  && goalNum  >  0
  const limitOk  = !isNaN(limitNum) && limitNum <  0

  const alreadyExists = existingGoals.some(
    (g) => g.style_id === Number(styleId) && g.period === period,
  )

  const canSubmit = styleId !== '' && goalOk && limitOk && !alreadyExists

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setErr(null)
    try {
      const created = await goalsApi.create(profileId, {
        style_id:  Number(styleId),
        period,
        goal_pct:  String(goalNum),
        limit_pct: String(limitNum),
      })
      onCreated(created)
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-slate-200">New Goal</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* Trading style */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Trading style</label>
          <select
            value={styleId}
            onChange={(e) => setStyleId(e.target.value === '' ? '' : Number(e.target.value))}
            className={inputCls}
          >
            <option value="">Select a style…</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>{s.display_name}</option>
            ))}
          </select>
        </div>

        {/* Period */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Period</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(['daily', 'weekly', 'monthly'] as GoalPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                  period === p
                    ? 'bg-brand-500/15 border-brand-500/40 text-brand-300'
                    : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Goal % + Limit % */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">
              🎯 Profit target <span className="text-slate-600">(%)</span>
            </label>
            <div className="flex">
              <input
                type="number" step="0.01" min="0.01" max="100"
                placeholder="1.5"
                value={goalPct}
                onChange={(e) => setGoalPct(e.target.value)}
                className={`${inputCls} rounded-r-none border-r-0`}
              />
              <span className="shrink-0 px-2.5 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500 flex items-center">%</span>
            </div>
            {goalPct !== '' && !goalOk && (
              <p className="text-[10px] text-red-400">Must be &gt; 0</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">
              🛑 Loss limit <span className="text-slate-600">(%)</span>
            </label>
            <div className="flex">
              <input
                type="number" step="0.01" max="-0.01"
                placeholder="-1.5"
                value={limitPct}
                onChange={(e) => setLimitPct(e.target.value)}
                className={`${inputCls} rounded-r-none border-r-0`}
              />
              <span className="shrink-0 px-2.5 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500 flex items-center">%</span>
            </div>
            {limitPct !== '' && !limitOk && (
              <p className="text-[10px] text-red-400">Must be &lt; 0 (e.g. −1.5)</p>
            )}
          </div>
        </div>

        {alreadyExists && (
          <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-1.5">
            ⚠️ A goal for this style + period already exists. Toggle it in the table below.
          </p>
        )}

        {err && (
          <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5">
            {err}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 atd-btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit || saving}
            onClick={handleSubmit}
            className="flex-1 atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Create
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// GoalsPage
// ─────────────────────────────────────────────────────────────────────────────

export function GoalsPage() {
  const { activeProfile } = useProfile()

  const [goals,           setGoals]           = useState<GoalOut[]>([])
  const [progress,        setProgress]        = useState<GoalProgressItem[]>([])
  const [styles,          setStyles]          = useState<TradingStyle[]>([])
  const [loadingGoals,    setLoadingGoals]    = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [showModal,       setShowModal]       = useState(false)
  const [toggling,        setToggling]        = useState<number | null>(null)
  const [showAll,         setShowAll]         = useState(false)

  // Fetch trading styles once (reference data)
  useEffect(() => {
    stylesApi.list().then(setStyles).catch(() => {})
  }, [])

  // Fetch goals + progress whenever the active profile changes
  const fetchAll = useCallback(() => {
    if (!activeProfile) { setGoals([]); setProgress([]); return }
    setLoadingGoals(true)
    setLoadingProgress(true)
    setError(null)

    goalsApi.list(activeProfile.id)
      .then(setGoals)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingGoals(false))

    goalsApi.progress(activeProfile.id)
      .then(setProgress)
      .catch(() => {})  // silent — no closed trades is normal
      .finally(() => setLoadingProgress(false))
  }, [activeProfile])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Toggle goal active/inactive
  async function handleToggle(goal: GoalOut) {
    if (!activeProfile) return
    setToggling(goal.id)
    try {
      const updated = await goalsApi.update(activeProfile.id, goal.style_id, goal.period, {
        is_active: !goal.is_active,
      })
      setGoals((prev) => prev.map((g) => g.id === goal.id ? updated : g))
      goalsApi.progress(activeProfile.id).then(setProgress).catch(() => {})
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setToggling(null)
    }
  }

  // Derived KPIs
  const activeGoals = goals.filter((g) => g.is_active)
  const goalsHit    = progress.filter((p) => p.goal_hit).length
  const limitsHit   = progress.filter((p) => p.limit_hit).length
  const avgProgress = progress.length > 0
    ? (progress.reduce((s, p) => s + Math.min(100, pct(p.goal_progress_pct)), 0) / progress.length).toFixed(0)
    : null
  const worstRisk   = progress.length > 0
    ? Math.max(0, ...progress.map((p) => pct(p.risk_progress_pct))).toFixed(0)
    : null

  const styleMap = Object.fromEntries(styles.map((s) => [s.id, s.display_name]))

  const sortedProgress = [...progress].sort(
    (a, b) => (PERIOD_ORDER[b.period] ?? 0) - (PERIOD_ORDER[a.period] ?? 0),
  )

  const sortedGoals = [...goals].sort((a, b) => {
    if (a.style_id !== b.style_id) return a.style_id - b.style_id
    return (PERIOD_ORDER[a.period] ?? 0) - (PERIOD_ORDER[b.period] ?? 0)
  })
  const displayedGoals = showAll ? sortedGoals : sortedGoals.slice(0, 8)

  const isLoading = loadingGoals || loadingProgress

  return (
    <div>
      <PageHeader
        icon="🎯"
        title="Goals"
        subtitle="Track your performance targets and trading discipline"
        badge="Phase 1 — Step 11"
        badgeVariant="phase"
        info="Goals are linked to your profile. Progress counts all realized P&L in the current period window: fully closed trades + partial TP profits already booked."
        actions={
          <>
            <button
              type="button"
              className="atd-btn-ghost"
              onClick={fetchAll}
              disabled={isLoading}
              title="Refresh"
            >
              <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              disabled={!activeProfile}
              className="atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setShowModal(true)}
            >
              <Plus size={14} /> New Goal
            </button>
          </>
        }
      />

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active Goals"
          value={isLoading ? '…' : String(activeGoals.length)}
          sub={`${goals.length} total`}
          accent="brand"
          info="Goals currently active for this profile (across daily, weekly, and monthly periods)."
        />
        <StatCard
          label="Goals Hit"
          value={isLoading ? '…' : progress.length === 0 ? '—' : String(goalsHit)}
          sub={progress.length > 0 ? 'this period' : 'no data yet'}
          accent="bull"
          info="Active goals where the profit target has been reached in the current period."
        />
        <StatCard
          label="Avg Progress"
          value={isLoading ? '…' : avgProgress != null ? `${avgProgress}%` : '—'}
          sub="toward targets"
          accent="neutral"
          info="Average completion percentage across all active goals for the current period. Includes both fully closed trades and partial TP profits."
        />
        <StatCard
          label="Worst Risk"
          value={isLoading ? '…' : worstRisk != null ? `${worstRisk}%` : '—'}
          sub={limitsHit > 0 ? `⚠️ ${limitsHit} limit(s) hit!` : 'of limit consumed'}
          accent={limitsHit > 0 ? 'bear' : Number(worstRisk) >= 75 ? 'bear' : 'neutral'}
          info="Highest risk-limit usage across all active goals. 100% = loss limit reached."
        />
      </div>

      {/* ── No profile ────────────────────────────────────────────────── */}
      {!activeProfile && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 p-10 text-center text-slate-500 text-sm">
          Select or create a profile to manage your goals.
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {activeProfile && (
        <>
          {/* ── Live progress cards ───────────────────────────────────── */}
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp size={14} className="text-brand-500" />
            <h2 className="text-sm font-medium text-slate-300">Current Period Progress</h2>
            <span className="text-[10px] text-slate-600">closed trades + partial profits</span>
            {loadingProgress && <Loader2 size={12} className="animate-spin text-slate-600" />}
          </div>

          {!loadingProgress && activeGoals.length === 0 && (
            <div className="mb-8 rounded-xl bg-surface-800 border border-surface-700 px-5 py-10 text-center text-slate-600 text-sm">
              No active goals.{' '}
              <button
                type="button"
                className="text-brand-400 hover:text-brand-300 underline underline-offset-2"
                onClick={() => setShowModal(true)}
              >
                Create your first goal →
              </button>
            </div>
          )}

          {!loadingProgress && activeGoals.length > 0 && sortedProgress.length === 0 && (
            <div className="mb-8 rounded-xl bg-surface-800 border border-surface-700 px-5 py-8 text-center text-slate-500 text-sm">
              No realized P&amp;L in the current period yet — progress will appear after your first closed trade or partial TP hit.
            </div>
          )}

          {sortedProgress.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {sortedProgress.map((item) => (
                <ProgressCard
                  key={`${item.style_id}-${item.period}`}
                  item={item}
                />
              ))}
            </div>
          )}

          {/* ── All goals table ───────────────────────────────────────── */}
          <div className="mb-2 flex items-center gap-2">
            <Target size={14} className="text-slate-500" />
            <h2 className="text-sm font-medium text-slate-400">All Goals</h2>
            {loadingGoals && <Loader2 size={12} className="animate-spin text-slate-600" />}
          </div>

          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden mb-6">
            {!loadingGoals && goals.length === 0 && (
              <div className="px-5 py-10 text-center text-slate-600 text-sm">
                No goals yet.{' '}
                <button
                  type="button"
                  className="text-brand-400 hover:text-brand-300 underline underline-offset-2"
                  onClick={() => setShowModal(true)}
                >
                  New Goal
                </button>
              </div>
            )}

            {goals.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-surface-700">
                        {['Style', 'Period', 'Target', 'Limit', 'Status', ''].map((h, i) => (
                          <th
                            key={i}
                            className="px-4 py-2.5 text-left text-slate-600 font-medium uppercase tracking-wider whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayedGoals.map((goal) => (
                        <GoalRow
                          key={goal.id}
                          goal={goal}
                          styleName={styleMap[goal.style_id] ?? `Style ${goal.style_id}`}
                          onToggle={handleToggle}
                          toggling={toggling === goal.id}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {goals.length > 8 && (
                  <div className="px-4 py-2 border-t border-surface-700">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      onClick={() => setShowAll((v) => !v)}
                    >
                      <ChevronDown size={12} className={showAll ? 'rotate-180 transition-transform' : 'transition-transform'} />
                      {showAll ? 'Show less' : `Show all ${goals.length} goals`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Explanation ───────────────────────────────────────────── */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 space-y-5">
            <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">
              How goals work
            </p>

            {/* Row 1 — Periods */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                {
                  emoji: '📅',
                  title: 'Daily goal',
                  desc: 'Resets every calendar day (00:00 → 23:59). Useful for controlling intraday drawdown or locking in a daily profit target before stopping.',
                },
                {
                  emoji: '📆',
                  title: 'Weekly goal',
                  desc: 'Covers Monday → Sunday (ISO week). Good for swing traders reviewing at end of week. Resets each Monday.',
                },
                {
                  emoji: '🗓️',
                  title: 'Monthly goal',
                  desc: 'Covers the 1st → last day of the month. Best for measuring long-term growth vs. your overall risk budget.',
                },
              ].map(({ emoji, title, desc }) => (
                <div key={title} className="rounded-lg bg-surface-700/40 border border-surface-700 p-3.5 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-300">{emoji} {title}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>

            {/* Row 2 — Progress, Limits, Style */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-lg bg-surface-700/40 border border-surface-700 p-3.5 space-y-1.5">
                <p className="text-xs font-semibold text-slate-300">� P&amp;L calculation</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Progress counts <strong className="text-slate-400">all realized profits and losses</strong> in the current window:
                </p>
                <ul className="text-[11px] text-slate-500 space-y-0.5 pl-3 list-disc">
                  <li><strong className="text-slate-400">Closed trades</strong> — full P&amp;L at close</li>
                  <li><strong className="text-slate-400">Partial trades</strong> — TP positions already hit (booked profits), even if the trade is still open</li>
                </ul>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Still-open unrealized P&amp;L is <strong className="text-slate-400">not</strong> included.
                </p>
              </div>

              <div className="rounded-lg bg-surface-700/40 border border-surface-700 p-3.5 space-y-1.5">
                <p className="text-xs font-semibold text-slate-300">🛑 Loss limit (circuit-breaker)</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  The loss limit is a <strong className="text-red-400">negative %</strong>. When the period P&amp;L drops below it, the card turns red and <em>Limit hit</em> appears.
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Example: limit = −2% → if you lose more than 2% of your capital this week, you're over limit. Use it as a signal to <strong className="text-slate-400">stop trading for the period</strong>.
                </p>
              </div>

              <div className="rounded-lg bg-surface-700/40 border border-surface-700 p-3.5 space-y-1.5">
                <p className="text-xs font-semibold text-slate-300">🏷️ Trading style &amp; goals</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Each goal is tagged to a <strong className="text-slate-400">trading style</strong> (e.g. Scalp, Swing, Position) to help you organize targets by strategy.
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  In Phase 1 the style is <strong className="text-slate-400">organizational only</strong> — P&amp;L is summed across all trades in the period, regardless of which style they used. Per-style filtering comes in a future phase.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── New Goal modal ────────────────────────────────────────────── */}
      {showModal && activeProfile && (
        <NewGoalModal
          profileId={activeProfile.id}
          styles={styles}
          existingGoals={goals}
          onClose={() => setShowModal(false)}
          onCreated={(g) => {
            setGoals((prev) => [...prev, g])
            setShowModal(false)
            goalsApi.progress(activeProfile.id).then(setProgress).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
