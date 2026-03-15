// ── Goals Settings ─────────────────────────────────────────────────────────
//
// Displays and manages global goals (style_id = null).
// Each goal is identified by its DB id — no more style_id/period composite key.
//
// Backend:
//   GET    /api/profiles/{id}/goals
//   POST   /api/profiles/{id}/goals
//   PUT    /api/profiles/{id}/goals/{goal_id}
//   DELETE /api/profiles/{id}/goals/{goal_id}
// ───────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Target, Plus, Loader2, RefreshCw, Trash2,
  Check, Ban, Pencil, X,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { goalsApi } from '../../lib/api'
import type { GoalOut, GoalCreate, GoalPeriod, GoalUpdate } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<string, string> = {
  daily:   '📅 Daily',
  weekly:  '📆 Weekly',
  monthly: '🗓️ Monthly',
}

const PERIOD_ORDER: Record<string, number> = { daily: 0, weekly: 1, monthly: 2 }

const TYPE_CFG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  outcome: {
    label:  'Outcome',
    color:  'text-slate-300',
    bg:     'bg-surface-700',
    border: 'border-surface-600',
  },
  process: {
    label:  'Process',
    color:  'text-sky-400',
    bg:     'bg-sky-500/10',
    border: 'border-sky-500/20',
  },
}

const inputCls = [
  'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600',
  'text-sm text-slate-200 placeholder-slate-500',
  'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 transition-colors',
].join(' ')

// ─────────────────────────────────────────────────────────────────────────────
// GoalRow — compact view + inline edit
// ─────────────────────────────────────────────────────────────────────────────

function GoalRow({
  goal,
  onSave,
  onDelete,
  onToggle,
  saving,
  deleting,
  toggling,
}: {
  goal: GoalOut
  onSave: (g: GoalOut, patch: GoalUpdate) => Promise<void>
  onDelete: (g: GoalOut) => Promise<void>
  onToggle: (g: GoalOut) => Promise<void>
  saving: boolean
  deleting: boolean
  toggling: boolean
}) {
  const [editing,    setEditing]    = useState(false)
  const [goalPct,    setGoalPct]    = useState(parseFloat(goal.goal_pct).toFixed(2))
  const [limitPct,   setLimitPct]   = useState(parseFloat(goal.limit_pct).toFixed(2))
  const [periodType, setPeriodType] = useState<'outcome' | 'process'>(goal.period_type)
  const [avgRMin,    setAvgRMin]    = useState(goal.avg_r_min ? parseFloat(goal.avg_r_min).toFixed(2) : '')
  const [maxTrades,  setMaxTrades]  = useState(goal.max_trades != null ? String(goal.max_trades) : '')
  const [showDash,   setShowDash]   = useState(goal.show_on_dashboard)
  const [err,        setErr]        = useState<string | null>(null)

  const goalNum  = parseFloat(goalPct)
  const limitNum = parseFloat(limitPct)
  const goalOk   = !isNaN(goalNum)  && goalNum  > 0
  const limitOk  = !isNaN(limitNum) && limitNum < 0
  const canSave  = goalOk && limitOk

  const ptCfg = TYPE_CFG[goal.period_type] ?? TYPE_CFG.outcome

  const handleSave = async () => {
    if (!canSave) return
    setErr(null)
    try {
      await onSave(goal, {
        goal_pct:          String(goalNum),
        limit_pct:         String(limitNum),
        period_type:       periodType,
        avg_r_min:         avgRMin.trim() || null,
        max_trades:        maxTrades.trim() ? parseInt(maxTrades, 10) : null,
        show_on_dashboard: showDash,
      })
      setEditing(false)
    } catch (e: unknown) {
      setErr((e as Error).message)
    }
  }

  const handleCancel = () => {
    setGoalPct(parseFloat(goal.goal_pct).toFixed(2))
    setLimitPct(parseFloat(goal.limit_pct).toFixed(2))
    setPeriodType(goal.period_type)
    setAvgRMin(goal.avg_r_min ? parseFloat(goal.avg_r_min).toFixed(2) : '')
    setMaxTrades(goal.max_trades != null ? String(goal.max_trades) : '')
    setShowDash(goal.show_on_dashboard)
    setErr(null)
    setEditing(false)
  }

  return (
    <div className={`rounded-xl border transition-all ${
      !goal.is_active ? 'border-surface-700 opacity-50' : 'border-surface-600 bg-surface-800'
    }`}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className="text-xs font-medium text-slate-300">{PERIOD_LABELS[goal.period] ?? goal.period}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${ptCfg.color} ${ptCfg.bg} ${ptCfg.border}`}>
            {ptCfg.label}
          </span>
          {!goal.is_active && (
            <span className="text-[10px] text-slate-600 bg-surface-700 border border-surface-600 px-1.5 py-0.5 rounded">
              Inactive
            </span>
          )}
          {!editing && (
            <span className="text-xs font-mono text-slate-400 ml-1">
              <span className="text-emerald-400">+{parseFloat(goal.goal_pct).toFixed(2)}%</span>
              {' / '}
              <span className="text-red-400">{parseFloat(goal.limit_pct).toFixed(2)}%</span>
              {goal.avg_r_min && <span className="text-sky-400 ml-1.5">R≥{parseFloat(goal.avg_r_min).toFixed(1)}</span>}
              {goal.max_trades != null && <span className="text-slate-500 ml-1.5">≤{goal.max_trades}t</span>}
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <button
                type="button" disabled={!canSave || saving} onClick={handleSave}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-40 transition-colors"
                title="Save"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button type="button" onClick={handleCancel} className="text-slate-500 hover:text-slate-300" title="Cancel">
                <Ban size={13} />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)} className="text-slate-600 hover:text-brand-400 transition-colors" title="Edit">
                <Pencil size={12} />
              </button>
              <button
                type="button" disabled={toggling} onClick={() => onToggle(goal)}
                className="text-[10px] text-slate-500 hover:text-slate-200 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                {toggling ? <Loader2 size={10} className="animate-spin" /> : goal.is_active ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button" disabled={deleting} onClick={() => onDelete(goal)}
                className="text-slate-600 hover:text-red-400 transition-colors disabled:opacity-40" title="Delete"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="px-4 pb-4 pt-1 border-t border-surface-700 space-y-3">
          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['outcome', 'process'] as const).map((pt) => {
                const cfg = TYPE_CFG[pt]
                return (
                  <button key={pt} type="button" onClick={() => setPeriodType(pt)}
                    className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
                      periodType === pt ? `${cfg.color} ${cfg.bg} ${cfg.border}` : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Target / Limit */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">🎯 Target %</label>
              <input type="number" step="0.01" min="0.01" value={goalPct}
                onChange={(e) => setGoalPct(e.target.value)}
                className={`${inputCls} ${!goalOk && goalPct !== '' ? 'border-red-500/60' : ''}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500">🛑 Limit %</label>
              <input type="number" step="0.01" max="-0.01" value={limitPct}
                onChange={(e) => setLimitPct(e.target.value)}
                className={`${inputCls} ${!limitOk && limitPct !== '' ? 'border-red-500/60' : ''}`}
              />
            </div>
          </div>

          {/* Process extras */}
          {periodType === 'process' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500">Avg R min</label>
                <input type="number" step="0.1" min="0.1" placeholder="e.g. 2.0"
                  value={avgRMin} onChange={(e) => setAvgRMin(e.target.value)} className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500">Max trades</label>
                <input type="number" step="1" min="1" placeholder="e.g. 3"
                  value={maxTrades} onChange={(e) => setMaxTrades(e.target.value)} className={inputCls}
                />
              </div>
            </div>
          )}

          {/* Dashboard toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <div onClick={() => setShowDash((v) => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${showDash ? 'bg-brand-500' : 'bg-surface-600'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${showDash ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-[11px] text-slate-400">Show on dashboard</span>
          </label>

          {err && <p className="text-[10px] text-red-400">⚠️ {err}</p>}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart defaults per period
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_DEFAULTS: Record<GoalPeriod, { goal_pct: string; limit_pct: string }> = {
  daily:   { goal_pct: '0.50',  limit_pct: '-0.30' },
  weekly:  { goal_pct: '1.50',  limit_pct: '-0.80' },
  monthly: { goal_pct: '4.00',  limit_pct: '-2.00' },
}

// ─────────────────────────────────────────────────────────────────────────────
// NewGoalModal
// ─────────────────────────────────────────────────────────────────────────────

function NewGoalModal({
  profileId,
  existingGoals,
  onClose,
  onCreated,
}: {
  profileId: number
  existingGoals: GoalOut[]
  onClose: () => void
  onCreated: (g: GoalOut) => void
}) {
  const [period,     setPeriod]     = useState<GoalPeriod>('monthly')
  const [goalPct,    setGoalPct]    = useState(PERIOD_DEFAULTS['monthly'].goal_pct)
  const [limitPct,   setLimitPct]   = useState(PERIOD_DEFAULTS['monthly'].limit_pct)
  const [periodType, setPeriodType] = useState<'outcome' | 'process'>('outcome')
  const [avgRMin,    setAvgRMin]    = useState('')
  const [maxTrades,  setMaxTrades]  = useState('')
  const [showDash,   setShowDash]   = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  // When period changes, pre-fill defaults (only if user hasn't typed custom values)
  const handlePeriodChange = (p: GoalPeriod) => {
    setPeriod(p)
    setGoalPct(PERIOD_DEFAULTS[p].goal_pct)
    setLimitPct(PERIOD_DEFAULTS[p].limit_pct)
  }

  const goalNum  = parseFloat(goalPct)
  const limitNum = parseFloat(limitPct)
  const goalOk   = !isNaN(goalNum)  && goalNum  > 0
  const limitOk  = !isNaN(limitNum) && limitNum < 0
  const canSubmit = goalOk && limitOk

  // Coherence: ratio limit/goal. 1:2 is ideal (risk half of reward)
  const coherenceRatio = (goalOk && limitOk) ? Math.abs(limitNum) / goalNum : null
  const coherenceLabel =
    coherenceRatio === null      ? null :
    coherenceRatio <= 0.4        ? { text: 'Conservative (tight stop)', color: 'text-sky-400',    bar: 'bg-sky-500',     pct: 25 } :
    coherenceRatio <= 0.65       ? { text: 'Balanced ✓',               color: 'text-emerald-400', bar: 'bg-emerald-500', pct: 75 } :
    coherenceRatio <= 0.85       ? { text: 'Aggressive (wide stop)',   color: 'text-amber-400',   bar: 'bg-amber-500',   pct: 55 } :
                                   { text: 'Risky — limit > target',   color: 'text-red-400',     bar: 'bg-red-500',     pct: 20 }

  const alreadyExists = existingGoals.some(
    (g) => g.style_id == null && g.period === period && g.period_type === periodType,
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setErr(null)
    try {
      const payload: GoalCreate = {
        style_id:          null,
        period,
        goal_pct:          String(goalNum),
        limit_pct:         String(limitNum),
        period_type:       periodType,
        avg_r_min:         avgRMin.trim() || null,
        max_trades:        maxTrades.trim() ? parseInt(maxTrades, 10) : null,
        show_on_dashboard: showDash,
      }
      const created = await goalsApi.create(profileId, payload)
      onCreated(created)
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target size={14} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-slate-200">New Goal</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={15} /></button>
        </div>

        {/* Scope badge */}
        <div className="px-3 py-2 rounded-lg bg-brand-500/10 border border-brand-500/20">
          <span className="text-[11px] text-brand-400">🌐 Global — applies to all trading styles</span>
        </div>

        {/* Period */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Period</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(['daily', 'weekly', 'monthly'] as GoalPeriod[]).map((p) => (
              <button key={p} type="button" onClick={() => handlePeriodChange(p)}
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

        {/* Type */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Type</label>
          <div className="grid grid-cols-2 gap-1.5">
            {(['outcome', 'process'] as const).map((pt) => {
              const cfg = TYPE_CFG[pt]
              return (
                <button key={pt} type="button" onClick={() => setPeriodType(pt)}
                  className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
                    periodType === pt
                      ? `${cfg.color} ${cfg.bg} ${cfg.border}`
                      : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {cfg.label}
                </button>
              )
            })}
          </div>
          <p className="text-[10px] text-slate-600 leading-snug">
            {periodType === 'outcome'
              ? 'P&L-based — % gain target + loss circuit-breaker.'
              : 'Discipline-based — avg R ≥ min + optional trade cap.'}
          </p>
        </div>

        {alreadyExists && (
          <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-3 py-1.5">
            ⚠️ A {period} {periodType} goal already exists — creating will return a conflict error. Delete the existing one first.
          </p>
        )}

        {/* Target / Limit */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400">🎯 Target %</label>
            <input type="number" step="0.01" min="0.01"
              value={goalPct} onChange={(e) => setGoalPct(e.target.value)}
              className={inputCls + (goalPct !== '' && !goalOk ? ' border-red-500/60' : '')}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400">🛑 Limit %</label>
            <input type="number" step="0.01" max="-0.01"
              value={limitPct} onChange={(e) => setLimitPct(e.target.value)}
              className={inputCls + (limitPct !== '' && !limitOk ? ' border-red-500/60' : '')}
            />
          </div>
        </div>

        {/* Coherence bar */}
        {coherenceLabel && (
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-slate-500">Risk/Reward coherence</span>
              <span className={`text-[10px] font-medium ${coherenceLabel.color}`}>{coherenceLabel.text}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${coherenceLabel.bar}`}
                style={{ width: `${coherenceLabel.pct}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-600">
              Limit is <span className="font-mono">{(Math.abs(limitNum) / goalNum * 100).toFixed(0)}%</span> of target
              {coherenceRatio !== null && coherenceRatio <= 0.65 ? ' — ideal range is 40–65%.' : '.'}
            </p>
          </div>
        )}

        {/* Process extras */}
        {periodType === 'process' && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Avg R min</label>
              <input type="number" step="0.1" min="0.1" placeholder="e.g. 2.0"
                value={avgRMin} onChange={(e) => setAvgRMin(e.target.value)} className={inputCls}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-400">Max trades</label>
              <input type="number" step="1" min="1" placeholder="e.g. 3"
                value={maxTrades} onChange={(e) => setMaxTrades(e.target.value)} className={inputCls}
              />
            </div>
          </div>
        )}

        {/* Dashboard */}
        <label className="flex items-center gap-2 cursor-pointer">
          <div onClick={() => setShowDash((v) => !v)}
            className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${showDash ? 'bg-brand-500' : 'bg-surface-600'}`}
          >
            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform shadow-sm ${showDash ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-xs text-slate-400">Show on dashboard</span>
        </label>

        {err && <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 atd-btn-ghost">Cancel</button>
          <button
            type="button" disabled={!canSubmit || saving || alreadyExists} onClick={handleSubmit}
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
// GoalsSettingsPage
// ─────────────────────────────────────────────────────────────────────────────

export function GoalsSettingsPage() {
  const { activeProfile } = useProfile()
  const [searchParams, setSearchParams] = useSearchParams()

  const [goals,    setGoals]    = useState<GoalOut[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [showNew,  setShowNew]  = useState(searchParams.get('new') === '1')
  const [saving,   setSaving]   = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [toggling, setToggling] = useState<number | null>(null)

  // Clear ?new=1 from URL once modal is open
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setShowNew(true)
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const fetchGoals = useCallback(() => {
    if (!activeProfile) { setGoals([]); return }
    setLoading(true); setError(null)
    goalsApi.list(activeProfile.id)
      .then(setGoals)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [activeProfile])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  const handleSave = async (goal: GoalOut, patch: GoalUpdate) => {
    if (!activeProfile) return
    setSaving(goal.id)
    try {
      const updated = await goalsApi.update(activeProfile.id, goal.id, patch)
      setGoals((prev) => prev.map((g) => g.id === goal.id ? updated : g))
    } finally {
      setSaving(null)
    }
  }

  const handleDelete = async (goal: GoalOut) => {
    if (!activeProfile) return
    if (!window.confirm(`Delete the ${goal.period} ${goal.period_type} goal?`)) return
    setDeleting(goal.id)
    try {
      await goalsApi.delete(activeProfile.id, goal.id)
      setGoals((prev) => prev.filter((g) => g.id !== goal.id))
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  const handleToggle = async (goal: GoalOut) => {
    if (!activeProfile) return
    setToggling(goal.id)
    try {
      const updated = await goalsApi.update(activeProfile.id, goal.id, { is_active: !goal.is_active })
      setGoals((prev) => prev.map((g) => g.id === goal.id ? updated : g))
    } finally {
      setToggling(null)
    }
  }

  // Sort: daily → weekly → monthly, then outcome before process
  const sortedGoals = [...goals].sort((a, b) => {
    const pDiff = (PERIOD_ORDER[a.period] ?? 0) - (PERIOD_ORDER[b.period] ?? 0)
    if (pDiff !== 0) return pDiff
    return a.period_type === 'outcome' ? -1 : 1
  })

  return (
    <div className="max-w-2xl">
      <PageHeader
        icon="🎯"
        title="Goals"
        subtitle="P&L targets and discipline limits — global across all styles"
        actions={
          <>
            <button type="button" className="atd-btn-ghost" onClick={fetchGoals} disabled={loading} title="Refresh">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              disabled={!activeProfile}
              className="atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setShowNew(true)}
            >
              <Plus size={14} /> New Goal
            </button>
          </>
        }
      />

      {/* Period Plan — helpful but compact */}
      <div className="mb-5 rounded-xl border border-surface-700 bg-surface-800/50 px-4 py-4 space-y-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">📐 Period Plan</p>

        {/* 3-column hierarchy */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { emoji: '📅', label: 'Daily',   color: 'text-emerald-400', desc: 'Session cap — stops you over-trading in one day.' },
            { emoji: '📆', label: 'Weekly',  color: 'text-sky-400',     desc: 'Mid-term check — ≈ ¼ of monthly target.' },
            { emoji: '🗓️', label: 'Monthly', color: 'text-brand-400',  desc: 'Growth target — anchors the whole plan.' },
          ].map(({ emoji, label, color, desc }) => (
            <div key={label} className="space-y-1">
              <p className={`text-xs font-semibold ${color}`}>{emoji} {label}</p>
              <p className="text-[10px] text-slate-500 leading-snug">{desc}</p>
            </div>
          ))}
        </div>

        {/* Key rules */}
        <div className="border-t border-surface-700 pt-3 space-y-1">
          <p className="text-[10px] text-slate-500 leading-snug">
            <span className="text-slate-300 font-medium">Outcome</span> — profit target (%) + loss limit circuit-breaker.
            When the limit fires, stop trading for that period. Losses roll up: a daily loss counts toward weekly and monthly.
          </p>
          <p className="text-[10px] text-slate-500 leading-snug">
            <span className="text-slate-300 font-medium">Process</span> — discipline metrics: min avg R-multiple + optional max trades per period. No P&L trigger.
          </p>
        </div>
      </div>

      {!activeProfile && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 p-10 text-center text-slate-500 text-sm">
          Select a profile to manage goals.
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
          <Loader2 size={16} className="animate-spin" /> Loading goals…
        </div>
      )}

      {activeProfile && !loading && (
        <div className="space-y-2">
          {sortedGoals.length === 0 && (
            <div className="rounded-xl bg-surface-800 border border-surface-700 p-10 text-center text-slate-600 text-sm">
              No goals yet.{' '}
              <button type="button" className="text-brand-400 hover:text-brand-300 underline" onClick={() => setShowNew(true)}>
                Create your first goal →
              </button>
            </div>
          )}

          {sortedGoals.map((g) => (
            <GoalRow
              key={g.id}
              goal={g}
              onSave={handleSave}
              onDelete={handleDelete}
              onToggle={handleToggle}
              saving={saving === g.id}
              deleting={deleting === g.id}
              toggling={toggling === g.id}
            />
          ))}
        </div>
      )}

      {showNew && activeProfile && (
        <NewGoalModal
          profileId={activeProfile.id}
          existingGoals={goals}
          onClose={() => setShowNew(false)}
          onCreated={(g) => {
            setGoals((prev) => {
              const idx = prev.findIndex((x) => x.id === g.id)
              return idx >= 0 ? prev.map((x, i) => i === idx ? g : x) : [...prev, g]
            })
            setShowNew(false)
          }}
        />
      )}
    </div>
  )
}
