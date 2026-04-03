// ── RiskAdvisorPanel ─────────────────────────────────────────────────────────
// Auto-triggered in New Trade form when pair + timeframe + direction are set.
// Fetches GET /api/risk/advisor and shows:
//  - Criteria breakdown table (factor color-coded green/red/gray)
//  - Multiplier × base = adjusted risk suggestion
//  - Budget remaining + blocking status
//  - 3 buttons: Accept · Override · Reset
//
// Collapsible: auto-expanded if multiplier ≠ 1.0; auto-collapsed if ≈ 1.0.

import { useEffect, useState, useCallback } from 'react'
import { Loader2, ChevronDown, ChevronUp, ShieldAlert, AlertTriangle, CheckCircle2, Zap } from 'lucide-react'
import { riskApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { RiskAdvisorOut, CriterionDetail } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  profileId: number
  pair: string | null
  timeframe: string | null
  direction: 'LONG' | 'SHORT'
  strategyId?: number | null
  confidence?: number | null
  /** Latest Market Analysis session ID — used to resolve MA direction alignment */
  maSessionId?: number | null
  /** Called when user clicks "Accept" — passes the suggested risk% and audit snapshot */
  onAccept: (riskPct: number, snapshot: Record<string, unknown>) => void
  /** Called when user clicks "Reset to base" — clears any advisor override */
  onReset: () => void
  /** Called when user confirms "Force open" to bypass budget block */
  onForce: () => void
}

// ─────────────────────────────────────────────────────────────────────────────

function factorColor(factor: number, enabled: boolean): string {
  if (!enabled) return 'text-slate-600'
  if (factor > 1.02) return 'text-emerald-400'
  if (factor < 0.98) return 'text-red-400'
  return 'text-slate-400'
}

function factorBg(factor: number, enabled: boolean): string {
  if (!enabled) return 'bg-surface-700/30'
  if (factor > 1.02) return 'bg-emerald-500/8'
  if (factor < 0.98) return 'bg-red-500/8'
  return ''
}

function multiplierColor(m: number): 'text-emerald-300' | 'text-red-300' | 'text-slate-400' {
  if (m > 1.02) return 'text-emerald-300'
  if (m < 0.98) return 'text-red-300'
  return 'text-slate-400'
}

function fmt2(n: number): string { return n.toFixed(2) }
function fmtFactor(n: number): string { return (n >= 1 ? '+' : '') + ((n - 1) * 100).toFixed(0) + '%' }

// ─────────────────────────────────────────────────────────────────────────────

function CriterionRow({ c }: { c: CriterionDetail }) {
  return (
    <tr className={cn('border-b border-surface-700/40 text-xs', factorBg(c.factor, c.enabled))}>
      <td className={cn('py-1.5 pl-3 pr-2 font-medium', c.enabled ? 'text-slate-300' : 'text-slate-600 line-through')}>
        {c.name}
      </td>
      <td className="py-1.5 px-2 text-slate-500 text-[10px]">{c.value_label}</td>
      <td className={cn('py-1.5 px-2 font-mono font-bold text-center', factorColor(c.factor, c.enabled))}>
        {c.enabled ? `×${fmt2(c.factor)}` : '—'}
      </td>
      <td className="py-1.5 px-2 text-slate-500 text-[10px] text-center">{(c.weight * 100).toFixed(0)}%</td>
      <td className={cn('py-1.5 pr-3 font-mono text-[10px] text-right', c.enabled ? (c.contribution > 0.001 ? 'text-emerald-400' : c.contribution < -0.001 ? 'text-red-400' : 'text-slate-500') : 'text-slate-700')}>
        {c.enabled ? fmtFactor(1 + c.contribution) : '—'}
      </td>
    </tr>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export function RiskAdvisorPanel({
  profileId, pair, timeframe, direction,
  strategyId, confidence, maSessionId,
  onAccept, onReset, onForce,
}: Props) {
  const [advisor,  setAdvisor]  = useState<RiskAdvisorOut | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // Override mode: user types their own value
  const [overrideMode,  setOverrideMode]  = useState(false)
  const [overrideValue, setOverrideValue] = useState('')

  // Force-open acknowledgement (shown when budget_blocking + force_allowed)
  const [forceAcknowledged, setForceAcknowledged] = useState(false)

  const ready = !!(pair && timeframe && direction)

  const fetchAdvisor = useCallback(async () => {
    if (!ready) return
    setLoading(true); setError(null); setAdvisor(null)
    setOverrideMode(false); setOverrideValue(''); setForceAcknowledged(false)
    try {
      const result = await riskApi.getAdvisor({
        profile_id: profileId,
        pair,
        timeframe,
        direction: direction.toLowerCase() as 'long' | 'short',
        strategy_id: strategyId ?? null,
        confidence: confidence ?? null,
        ma_session_id: maSessionId ?? null,
      })
      setAdvisor(result)
      // Auto-expand if meaningful adjustment; auto-collapse if neutral
      const diff = Math.abs(result.multiplier - 1.0)
      setCollapsed(diff < 0.02)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [ready, profileId, pair, timeframe, direction, strategyId, confidence, maSessionId])

  useEffect(() => {
    if (ready) { void fetchAdvisor() }
    else { setAdvisor(null); setError(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, timeframe, direction, strategyId, confidence, maSessionId])

  // Don't render if trigger conditions not met
  if (!ready) return null

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-surface-800 border border-surface-700 text-xs text-slate-400">
        <Loader2 size={13} className="animate-spin text-brand-400 shrink-0" />
        <span>Fetching risk advisor for <strong className="text-slate-300">{pair} · {timeframe} · {direction}</strong>…</span>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-800 border border-surface-700 text-xs text-slate-500">
        <AlertTriangle size={12} className="shrink-0 text-amber-500/60" />
        Risk advisor unavailable — using profile default risk %.
      </div>
    )
  }

  if (!advisor) return null

  const mAdj   = advisor.multiplier
  const mColor = multiplierColor(mAdj)

  // ── Collapsed header ──────────────────────────────────────────────────────
  const header = (
    <button
      type="button"
      onClick={() => setCollapsed((v) => !v)}
      className="w-full flex items-center justify-between px-4 py-2.5 text-xs"
    >
      <div className="flex items-center gap-2">
        <Zap size={13} className="text-brand-400 shrink-0" />
        <span className="font-semibold text-slate-300">Risk Advisor</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-400 font-mono">
          ×{fmt2(mAdj)}
        </span>
        <span className={cn('font-mono font-bold text-[11px]', mColor)}>
          → {fmt2(advisor.adjusted_risk_pct)}%
        </span>
        {advisor.budget_blocking && (
          <span className="flex items-center gap-1 text-red-400 text-[10px] ml-1">
            <ShieldAlert size={10} /> Budget insufficient
          </span>
        )}
      </div>
      {collapsed ? <ChevronDown size={14} className="text-slate-500 shrink-0" /> : <ChevronUp size={14} className="text-slate-500 shrink-0" />}
    </button>
  )

  // ── Budget info bar ───────────────────────────────────────────────────────
  const hasPending = advisor.pending_risk_pct > 0
  const budgetBar = (
    <div className={cn(
      'px-4 py-2 border-t text-[10px] space-y-1',
      advisor.budget_blocking
        ? 'border-red-700/30 bg-red-900/10'
        : advisor.pending_budget_warning
        ? 'border-amber-700/30 bg-amber-900/10'
        : 'border-surface-700/40',
    )}>
      {/* Live budget row */}
      <div className="flex items-center gap-2">
        <span className={advisor.budget_blocking ? 'text-red-400' : 'text-slate-500'}>
          Budget remaining (live):
        </span>
        <span className={cn('font-mono font-bold', advisor.budget_remaining_pct < 1 ? 'text-red-400' : 'text-slate-300')}>
          {fmt2(advisor.budget_remaining_pct)}%
        </span>
        <span className="text-slate-600">({advisor.budget_remaining_amount.toFixed(2)})</span>
        {advisor.budget_blocking && !advisor.force_allowed && (
          <span className="ml-auto text-red-400">New trades blocked — reduce open positions first</span>
        )}
      </div>

      {/* Pending LIMITs warning row */}
      {hasPending && (
        <div className={cn(
          'flex items-center gap-2',
          advisor.pending_budget_warning ? 'text-amber-400' : 'text-slate-600',
        )}>
          <span>If LIMIT orders fill:</span>
          <span className="font-mono font-bold">
            {fmt2(advisor.budget_remaining_if_pending_fill_pct)}%
          </span>
          <span>({advisor.budget_remaining_if_pending_fill_amount.toFixed(2)})</span>
          <span className="text-slate-700">
            · {fmt2(advisor.pending_risk_pct)}% locked in {Math.round(advisor.pending_risk_amount)} pending
          </span>
          {advisor.pending_budget_warning && (
            <span className="ml-auto text-amber-400 font-medium">⚠ Would exceed budget if all LIMITs fill</span>
          )}
        </div>
      )}
    </div>
  )

  // ── Action buttons ────────────────────────────────────────────────────────
  const buildSnapshot = (): Record<string, unknown> => ({
    pair, timeframe, direction,
    multiplier:           advisor.multiplier,
    base_risk_pct:        advisor.base_risk_pct,
    adjusted_risk_pct:    advisor.adjusted_risk_pct,
    adjusted_risk_amount: advisor.adjusted_risk_amount,
    budget_remaining_pct: advisor.budget_remaining_pct,
    criteria:             advisor.criteria,
    // VI + EMA at entry — for trade history analysis
    pair_vi_score:        advisor.pair_vi_score ?? null,
    pair_vi_ema_score:    advisor.pair_vi_ema_score ?? null,
    pair_vi_ema_signal:   advisor.pair_vi_ema_signal ?? null,
    market_vi_score:      advisor.market_vi_score ?? null,
    captured_at: new Date().toISOString(),
  })

  const actions = (
    <div className="flex items-center gap-2 px-4 pt-1 pb-3 flex-wrap">
      {/* Accept */}
      {!advisor.budget_blocking && (
        <button
          type="button"
          onClick={() => {
            onAccept(advisor.adjusted_risk_pct, buildSnapshot())
            setOverrideMode(false)
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 transition-colors"
        >
          <CheckCircle2 size={12} /> Accept {fmt2(advisor.adjusted_risk_pct)}%
        </button>
      )}

      {/* Override */}
      {overrideMode ? (
        <div className="flex items-center gap-1.5">
          <input
            type="number" step="0.01" min="0.01" max="100"
            autoFocus
            value={overrideValue}
            onChange={(e) => setOverrideValue(e.target.value)}
            placeholder={fmt2(advisor.adjusted_risk_pct)}
            className="w-20 px-2 py-1.5 rounded-lg bg-surface-700 border border-brand-500/50 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-brand-500/30"
          />
          <span className="text-xs text-slate-500">%</span>
          <button
            type="button"
            disabled={!overrideValue || Number(overrideValue) <= 0}
            onClick={() => {
              if (!overrideValue || Number(overrideValue) <= 0) return
              onAccept(Number(overrideValue), { ...buildSnapshot(), override: true, override_value: Number(overrideValue) })
              setOverrideMode(false)
            }}
            className="px-2.5 py-1.5 rounded-lg bg-brand-600/20 border border-brand-500/50 text-brand-300 text-xs font-medium hover:bg-brand-600/30 transition-colors disabled:opacity-40"
          >
            Apply
          </button>
          <button type="button" onClick={() => setOverrideMode(false)}
            className="text-xs text-slate-500 hover:text-slate-300 px-1">✕</button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setOverrideMode(true); setOverrideValue('') }}
          className="px-3 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-slate-400 text-xs hover:text-slate-200 transition-colors"
        >
          Override…
        </button>
      )}

      {/* Reset */}
      <button
        type="button"
        onClick={() => { onReset(); setOverrideMode(false); setOverrideValue('') }}
        className="px-3 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-slate-500 text-xs hover:text-slate-300 transition-colors"
      >
        Reset to base
      </button>

      {/* Force open — only if budget_blocking + force_allowed */}
      {advisor.budget_blocking && advisor.force_allowed && (
        <div className="ml-auto flex items-center gap-2">
          {!forceAcknowledged ? (
            <button
              type="button"
              onClick={() => setForceAcknowledged(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-900/20 border border-amber-700/40 text-amber-400 text-xs hover:bg-amber-900/30 transition-colors"
            >
              <ShieldAlert size={12} /> Force open anyway…
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-amber-400/80">⚠ Trading outside budget limits</span>
              <button
                type="button"
                onClick={() => {
                  onForce()
                  onAccept(advisor.adjusted_risk_pct, { ...buildSnapshot(), forced: true })
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-900/25 border border-red-700/40 text-red-400 text-xs font-semibold hover:bg-red-900/35 transition-colors"
              >
                Confirm force open
              </button>
              <button type="button" onClick={() => setForceAcknowledged(false)}
                className="text-xs text-slate-500 hover:text-slate-300 px-1">✕</button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className={cn(
      'rounded-xl border overflow-hidden',
      advisor.budget_blocking
        ? 'bg-red-900/10 border-red-700/30'
        : mAdj > 1.02 ? 'bg-emerald-900/8 border-emerald-700/25'
        : mAdj < 0.98 ? 'bg-surface-800 border-amber-700/25'
        : 'bg-surface-800 border-surface-700',
    )}>
      {header}

      {!collapsed && (
        <>
          {/* Criteria table */}
          <div className="px-0 overflow-x-auto border-t border-surface-700/40">
            <table className="w-full min-w-[440px]">
              <thead>
                <tr className="text-[9px] text-slate-600 uppercase tracking-wider border-b border-surface-700/40">
                  <th className="py-1.5 pl-3 pr-2 text-left font-medium w-28">Criterion</th>
                  <th className="py-1.5 px-2 text-left font-medium">Value</th>
                  <th className="py-1.5 px-2 text-center font-medium">Factor</th>
                  <th className="py-1.5 px-2 text-center font-medium">Weight</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Contrib.</th>
                </tr>
              </thead>
              <tbody>
                {advisor.criteria.map((c) => (
                  <CriterionRow key={c.name} c={c} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Multiplier summary */}
          <div className="flex items-center gap-3 px-4 py-2.5 border-t border-surface-700/40 text-sm flex-wrap">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Result</span>
            <span className="font-mono text-slate-400">{fmt2(advisor.base_risk_pct)}%</span>
            <span className="text-slate-600">×</span>
            <span className={cn('font-mono font-bold', mColor)}>
              {fmt2(mAdj)}
            </span>
            <span className="text-slate-600">=</span>
            <span className={cn('font-mono font-bold text-base', mColor)}>
              {fmt2(advisor.adjusted_risk_pct)}%
            </span>
            <span className="text-slate-500 text-xs">
              ({advisor.adjusted_risk_amount.toFixed(2)})
            </span>
          </div>

          {budgetBar}
          {actions}
        </>
      )}

      {/* Collapsed summary — still show budget warning if blocking */}
      {collapsed && advisor.budget_blocking && (
        <div className="px-4 pb-2.5 text-[10px] text-red-400 flex items-center gap-1.5">
          <ShieldAlert size={11} className="shrink-0" />
          Budget insufficient — remaining {fmt2(advisor.budget_remaining_pct)}%
          {advisor.force_allowed && (
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              className="ml-2 underline hover:text-red-300"
            >
              expand to force open
            </button>
          )}
        </div>
      )}
    </div>
  )
}
