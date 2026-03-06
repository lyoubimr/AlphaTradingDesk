// ── Goals Settings — v2 ────────────────────────────────────────────────────
//
// Full goal management with v2 fields:
//   - period_type: outcome | process | review
//   - avg_r_min: minimum R-multiple target (process goals)
//   - max_trades: max trades per period (process goals)
//   - show_on_dashboard: whether to show progress card on dashboard
//
// Backend:
//   GET  /api/profiles/{id}/goals
//   POST /api/profiles/{id}/goals
//   PUT  /api/profiles/{id}/goals/{style_id}/{period}
//   DELETE /api/profiles/{id}/goals/{style_id}/{period}
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import {
  Target, Plus, Loader2, RefreshCw, Trash2,
  Check, Ban, Pencil, ChevronDown, X, Info,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { goalsApi, stylesApi } from '../../lib/api'
import type { GoalOut, GoalCreate, GoalPeriod, TradingStyle } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PERIOD_LABELS: Record<string, string> = {
  daily:   '📅 Daily',
  weekly:  '📆 Weekly',
  monthly: '🗓️ Monthly',
}

const PERIOD_TYPE_CFG: Record<string, { label: string; color: string; bg: string; border: string; desc: string }> = {
  outcome: {
    label: 'Outcome',
    color: 'text-slate-400',
    bg:    'bg-surface-700',
    border:'border-surface-600',
    desc:  'P&L target: hit goal_pct → stop or reduce size. Loss limit = circuit-breaker.',
  },
  process: {
    label: 'Process',
    color: 'text-sky-400',
    bg:    'bg-sky-500/10',
    border:'border-sky-500/20',
    desc:  'Discipline target: maintain avg R-multiple ≥ min, stay within max trades.',
  },
  review: {
    label: 'Review',
    color: 'text-violet-400',
    bg:    'bg-violet-500/10',
    border:'border-violet-500/20',
    desc:  'Post-period review cadence goal — track whether you completed your weekly/monthly review.',
  },
}

const inputCls = [
  'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600',
  'text-sm text-slate-200 placeholder-slate-600',
  'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 transition-colors',
].join(' ')

// ─────────────────────────────────────────────────────────────────────────────
// GoalCard — full v2 goal display + inline edit
// ─────────────────────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  styleName,
  onSave,
  onDelete,
  onToggle,
  saving,
  deleting,
  toggling,
}: {
  goal: GoalOut
  styleName: string
  onSave: (g: GoalOut, patch: Partial<GoalOut>) => Promise<void>
  onDelete: (g: GoalOut) => Promise<void>
  onToggle: (g: GoalOut) => Promise<void>
  saving: boolean
  deleting: boolean
  toggling: boolean
}) {
  const [editing,    setEditing]    = useState(false)
  const [goalPct,    setGoalPct]    = useState(parseFloat(goal.goal_pct).toFixed(2))
  const [limitPct,   setLimitPct]   = useState(parseFloat(goal.limit_pct).toFixed(2))
  const [periodType, setPeriodType] = useState<'outcome' | 'process' | 'review'>(goal.period_type)
  const [avgRMin,    setAvgRMin]    = useState(goal.avg_r_min ? parseFloat(goal.avg_r_min).toFixed(2) : '')
  const [maxTrades,  setMaxTrades]  = useState(goal.max_trades != null ? String(goal.max_trades) : '')
  const [showDash,   setShowDash]   = useState(goal.show_on_dashboard)
  const [err,        setErr]        = useState<string | null>(null)

  const goalNum   = parseFloat(goalPct)
  const limitNum  = parseFloat(limitPct)
  const goalOk    = !isNaN(goalNum)  && goalNum  > 0
  const limitOk   = !isNaN(limitNum) && limitNum < 0
  const canSave   = goalOk && limitOk

  const ptCfg  = PERIOD_TYPE_CFG[goal.period_type]
  const editPt = PERIOD_TYPE_CFG[periodType]

  const handleSave = async () => {
    if (!canSave) return
    setErr(null)
    try {
      await onSave(goal, {
        goal_pct:          String(goalNum),
        limit_pct:         String(limitNum),
        period_type:       periodType,
        avg_r_min:         avgRMin.trim() ? avgRMin.trim() : null,
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
    <div className={`rounded-2xl border transition-all duration-200 ${
      !goal.is_active ? 'border-surface-700 opacity-50' : 'border-surface-600 bg-surface-800'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-surface-700">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-slate-200">{styleName}</span>
          <span className="text-slate-700">·</span>
          <span className="text-xs text-slate-400">{PERIOD_LABELS[goal.period] ?? goal.period}</span>
          <span className="text-slate-700">·</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${ptCfg.color} ${ptCfg.bg} ${ptCfg.border}`}>
            {ptCfg.label}
          </span>
          {!goal.is_active && (
            <span className="text-[10px] text-slate-600 bg-surface-700 border border-surface-600 px-1.5 py-0.5 rounded">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editing ? (
            <>
              <button
                type="button"
                disabled={!canSave || saving}
                onClick={handleSave}
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
                type="button"
                disabled={toggling}
                onClick={() => onToggle(goal)}
                className="text-[10px] text-slate-500 hover:text-slate-200 transition-colors disabled:opacity-40"
              >
                {toggling ? <Loader2 size={10} className="animate-spin" /> : goal.is_active ? 'Deactivate' : 'Activate'}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => onDelete(goal)}
                className="text-slate-600 hover:text-red-400 transition-colors disabled:opacity-40"
                title="Delete"
              >
                {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-3">
        {editing ? (
          <>
            {/* Period type selector */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Goal type</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['outcome', 'process', 'review'] as const).map((pt) => {
                  const cfg = PERIOD_TYPE_CFG[pt]
                  return (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => setPeriodType(pt)}
                      className={`py-2 px-3 rounded-lg border text-[11px] font-medium transition-colors ${
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
              <p className="text-[10px] text-slate-600 leading-snug">{editPt.desc}</p>
            </div>

            {/* Target / Limit */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500">🎯 Target %</label>
                <input
                  type="number" step="0.01" min="0.01"
                  value={goalPct}
                  onChange={(e) => setGoalPct(e.target.value)}
                  className={`${inputCls} text-sm ${!goalOk && goalPct !== '' ? 'border-red-500/60' : ''}`}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500">🛑 Limit %</label>
                <input
                  type="number" step="0.01" max="-0.01"
                  value={limitPct}
                  onChange={(e) => setLimitPct(e.target.value)}
                  className={`${inputCls} text-sm ${!limitOk && limitPct !== '' ? 'border-red-500/60' : ''}`}
                />
              </div>
            </div>

            {/* Process goal v2 fields */}
            {(periodType === 'process') && (
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-slate-500">Avg R min</label>
                  <input
                    type="number" step="0.1" min="0.1"
                    placeholder="e.g. 2.0"
                    value={avgRMin}
                    onChange={(e) => setAvgRMin(e.target.value)}
                    className={inputCls + ' text-sm'}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-slate-500">Max trades</label>
                  <input
                    type="number" step="1" min="1"
                    placeholder="e.g. 3"
                    value={maxTrades}
                    onChange={(e) => setMaxTrades(e.target.value)}
                    className={inputCls + ' text-sm'}
                  />
                </div>
              </div>
            )}

            {/* Dashboard toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                role="checkbox"
                aria-checked={showDash}
                onClick={() => setShowDash((v) => !v)}
                className={`w-8 h-4 rounded-full transition-colors cursor-pointer ${showDash ? 'bg-brand-500' : 'bg-surface-600'}`}
              >
                <div className={`w-3 h-3 rounded-full bg-white mt-0.5 transition-transform ${showDash ? 'translate-x-4 ml-0.5' : 'translate-x-0.5 ml-0.5'}`} />
              </div>
              <span className="text-[11px] text-slate-400">Show progress on dashboard</span>
            </label>
          </>
        ) : (
          /* View mode */
          <div className="flex flex-wrap gap-4">
            <div>
              <p className="text-[10px] text-slate-600 mb-0.5">Target / Limit</p>
              <p className="text-xs font-mono">
                <span className="text-emerald-400">+{parseFloat(goal.goal_pct).toFixed(2)}%</span>
                {' / '}
                <span className="text-red-400">{parseFloat(goal.limit_pct).toFixed(2)}%</span>
              </p>
            </div>
            {goal.avg_r_min && (
              <div>
                <p className="text-[10px] text-slate-600 mb-0.5">Avg R min</p>
                <p className="text-xs font-mono text-sky-400">{parseFloat(goal.avg_r_min).toFixed(2)}R</p>
              </div>
            )}
            {goal.max_trades != null && (
              <div>
                <p className="text-[10px] text-slate-600 mb-0.5">Max trades</p>
                <p className="text-xs font-mono text-slate-300">{goal.max_trades}</p>
              </div>
            )}
            <div>
              <p className="text-[10px] text-slate-600 mb-0.5">Dashboard</p>
              <p className={`text-xs font-mono ${goal.show_on_dashboard ? 'text-emerald-400' : 'text-slate-600'}`}>
                {goal.show_on_dashboard ? '✓ Yes' : '— No'}
              </p>
            </div>
          </div>
        )}

        {err && <p className="text-[10px] text-red-400">⚠️ {err}</p>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NewGoalModal — full v2
// ─────────────────────────────────────────────────────────────────────────────

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
  onCreated: (g: GoalOut) => void
}) {
  const [styleId,    setStyleId]    = useState<number | ''>('')
  const [period,     setPeriod]     = useState<GoalPeriod>('monthly')
  const [goalPct,    setGoalPct]    = useState('')
  const [limitPct,   setLimitPct]   = useState('')
  const [periodType, setPeriodType] = useState<'outcome' | 'process' | 'review'>('outcome')
  const [avgRMin,    setAvgRMin]    = useState('')
  const [maxTrades,  setMaxTrades]  = useState('')
  const [showDash,   setShowDash]   = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  const goalNum  = parseFloat(goalPct)
  const limitNum = parseFloat(limitPct)
  const goalOk   = !isNaN(goalNum)  && goalNum  > 0
  const limitOk  = !isNaN(limitNum) && limitNum < 0
  const canSubmit = styleId !== '' && goalOk && limitOk

  const alreadyExists = existingGoals.some(
    (g) => g.style_id === Number(styleId) && g.period === period,
  )

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSaving(true); setErr(null)
    try {
      const payload: GoalCreate = {
        style_id:          Number(styleId),
        period,
        goal_pct:          String(goalNum),
        limit_pct:         String(limitNum),
        period_type:       periodType,
        avg_r_min:         avgRMin.trim() ? avgRMin.trim() : null,
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
      <div className="w-full max-w-md bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Target size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-slate-200">New Goal</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300"><X size={16} /></button>
        </div>

        {/* Style */}
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

        {/* Goal type */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Goal type</label>
          <div className="grid grid-cols-3 gap-1.5">
            {(['outcome', 'process', 'review'] as const).map((pt) => {
              const cfg = PERIOD_TYPE_CFG[pt]
              return (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setPeriodType(pt)}
                  className={`py-2 px-2 rounded-lg border text-[11px] font-medium transition-colors ${
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
          <p className="text-[10px] text-slate-600 leading-snug">{PERIOD_TYPE_CFG[periodType].desc}</p>
        </div>

        {alreadyExists && (
          <p className="text-[11px] text-sky-400 bg-sky-500/10 border border-sky-500/20 rounded px-3 py-1.5">
            ℹ️ A goal for this style + period already exists — saving will update it.
          </p>
        )}

        {/* Target / Limit */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">🎯 Target %</label>
            <input
              type="number" step="0.01" min="0.01" placeholder="e.g. 2.0"
              value={goalPct}
              onChange={(e) => setGoalPct(e.target.value)}
              className={inputCls + (goalPct !== '' && !goalOk ? ' border-red-500/60' : '')}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">🛑 Limit %</label>
            <input
              type="number" step="0.01" max="-0.01" placeholder="e.g. -1.5"
              value={limitPct}
              onChange={(e) => setLimitPct(e.target.value)}
              className={inputCls + (limitPct !== '' && !limitOk ? ' border-red-500/60' : '')}
            />
          </div>
        </div>

        {/* Process goal extras */}
        {periodType === 'process' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">
                Avg R min <span className="text-slate-600">(optional)</span>
              </label>
              <input
                type="number" step="0.1" min="0.1" placeholder="e.g. 2.0"
                value={avgRMin}
                onChange={(e) => setAvgRMin(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">
                Max trades <span className="text-slate-600">(optional)</span>
              </label>
              <input
                type="number" step="1" min="1" placeholder="e.g. 3"
                value={maxTrades}
                onChange={(e) => setMaxTrades(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
        )}

        {/* Dashboard toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <div
            role="checkbox"
            aria-checked={showDash}
            onClick={() => setShowDash((v) => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${showDash ? 'bg-brand-500' : 'bg-surface-600'}`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${showDash ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-xs text-slate-400">Show progress card on dashboard</span>
        </label>

        {err && <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-1.5">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className="flex-1 atd-btn-ghost">Cancel</button>
          <button
            type="button"
            disabled={!canSubmit || saving}
            onClick={handleSubmit}
            className="flex-1 atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            {alreadyExists ? 'Update' : 'Create'}
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

  const [goals,    setGoals]    = useState<GoalOut[]>([])
  const [styles,   setStyles]   = useState<TradingStyle[]>([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [showNew,  setShowNew]  = useState(false)
  const [saving,   setSaving]   = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)
  const [toggling, setToggling] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)   // group key

  useEffect(() => {
    stylesApi.list().then(setStyles).catch(() => {})
  }, [])

  const fetchGoals = useCallback(() => {
    if (!activeProfile) { setGoals([]); return }
    setLoading(true); setError(null)
    goalsApi.list(activeProfile.id)
      .then(setGoals)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [activeProfile])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  const handleSave = async (goal: GoalOut, patch: Partial<GoalOut>) => {
    if (!activeProfile) return
    setSaving(goal.id)
    try {
      const updated = await goalsApi.update(activeProfile.id, goal.style_id, goal.period, patch)
      setGoals((prev) => prev.map((g) => g.id === goal.id ? updated : g))
    } finally {
      setSaving(null)
    }
  }

  const handleDelete = async (goal: GoalOut) => {
    if (!activeProfile) return
    if (!window.confirm(`Delete the ${goal.period} goal? This cannot be undone.`)) return
    setDeleting(goal.id)
    try {
      await goalsApi.delete(activeProfile.id, goal.style_id, goal.period)
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
      const updated = await goalsApi.update(activeProfile.id, goal.style_id, goal.period, {
        is_active: !goal.is_active,
      })
      setGoals((prev) => prev.map((g) => g.id === goal.id ? updated : g))
    } finally {
      setToggling(null)
    }
  }

  const styleMap = Object.fromEntries(styles.map((s) => [s.id, s.display_name]))

  // Group goals by style
  const byStyle: Record<number, GoalOut[]> = {}
  for (const g of goals) {
    if (!byStyle[g.style_id]) byStyle[g.style_id] = []
    byStyle[g.style_id].push(g)
  }
  const styleIds = Object.keys(byStyle).map(Number).sort((a, b) => a - b)

  const PERIOD_ORDER: Record<string, number> = { daily: 0, weekly: 1, monthly: 2 }

  return (
    <div className="max-w-3xl">
      <PageHeader
        icon="🎯"
        title="Goals Settings"
        subtitle="Manage goal types, targets, loss limits, and v2 discipline fields"
        badge="Phase 1"
        badgeVariant="phase"
        info="Goals are scoped per profile. Outcome goals track P&L %. Process goals track avg R-multiple and trade count discipline. Review goals track cadence."
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

      {/* Goal type legend */}
      <div className="mb-6 rounded-xl border border-surface-700 bg-surface-800 p-4 space-y-2">
        <div className="flex items-center gap-2 mb-2">
          <Info size={12} className="text-brand-400" />
          <p className="text-[10px] font-semibold text-brand-400 uppercase tracking-wider">Goal types (v2)</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(['outcome', 'process', 'review'] as const).map((pt) => {
            const cfg = PERIOD_TYPE_CFG[pt]
            return (
              <div key={pt} className={`rounded-lg border p-3 space-y-1 ${cfg.bg} ${cfg.border}`}>
                <p className={`text-[11px] font-semibold ${cfg.color}`}>{cfg.label}</p>
                <p className="text-[10px] text-slate-500 leading-snug">{cfg.desc}</p>
              </div>
            )
          })}
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
        <div className="space-y-4">
          {goals.length === 0 && (
            <div className="rounded-xl bg-surface-800 border border-surface-700 p-10 text-center text-slate-600 text-sm">
              No goals yet.{' '}
              <button type="button" className="text-brand-400 hover:text-brand-300 underline" onClick={() => setShowNew(true)}>
                Create your first goal →
              </button>
            </div>
          )}

          {styleIds.map((styleId) => {
            const styleGoals = byStyle[styleId].sort(
              (a, b) => (PERIOD_ORDER[a.period] ?? 0) - (PERIOD_ORDER[b.period] ?? 0),
            )
            const name = styleMap[styleId] ?? `Style ${styleId}`
            const key  = String(styleId)
            const open = expanded === null || expanded === key   // default all open

            return (
              <div key={styleId} className="rounded-2xl border border-surface-700 overflow-hidden">
                {/* Group header */}
                <button
                  type="button"
                  onClick={() => setExpanded(open && expanded === key ? null : key)}
                  className="w-full flex items-center justify-between px-4 py-3 bg-surface-800 hover:bg-surface-700/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Target size={13} className="text-brand-400" />
                    <span className="text-sm font-semibold text-slate-200">{name}</span>
                    <span className="text-[10px] text-slate-600">{styleGoals.length} goals</span>
                    {styleGoals.some((g) => !g.is_active) && (
                      <span className="text-[9px] text-slate-600 bg-surface-700 border border-surface-600 px-1.5 rounded">
                        {styleGoals.filter((g) => !g.is_active).length} inactive
                      </span>
                    )}
                  </div>
                  <ChevronDown size={14} className={`text-slate-500 transition-transform duration-200 ${open ? '' : '-rotate-90'}`} />
                </button>

                {open && (
                  <div className="p-4 space-y-3 bg-surface-900/30">
                    {styleGoals.map((g) => (
                      <GoalCard
                        key={g.id}
                        goal={g}
                        styleName={name}
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
              </div>
            )
          })}
        </div>
      )}

      {showNew && activeProfile && (
        <NewGoalModal
          profileId={activeProfile.id}
          styles={styles}
          existingGoals={goals}
          onClose={() => setShowNew(false)}
          onCreated={(g) => {
            setGoals((prev) => {
              const idx = prev.findIndex((x) => x.style_id === g.style_id && x.period === g.period)
              return idx >= 0 ? prev.map((x, i) => i === idx ? g : x) : [...prev, g]
            })
            setShowNew(false)
          }}
        />
      )}
    </div>
  )
}
