// ── RiskSettingsPage ─────────────────────────────────────────────────────────
// P3-10 — Settings > Risk: Dynamic Risk engine configuration
//
// Tabs:
//   Criteria  — enable/disable + weight (%) per criterion
//   Factors   — VI regime factors, MA direction factors, WR & confidence bounds
//   Guard     — global multiplier cap + risk guard + alert banner
//   Simulator — live multiplier preview
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Loader2, RefreshCw, Save, Check, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { riskApi } from '../../lib/api'
import { CriterionConfig } from '../../components/risk/CriterionConfig'
import { cn } from '../../lib/cn'

// ── Types ─────────────────────────────────────────────────────────────────────

const VI_REGIMES = ['DEAD', 'CALM', 'NORMAL', 'TRENDING', 'ACTIVE', 'EXTREME'] as const
type VIRegimeKey = typeof VI_REGIMES[number]

interface RiskConfig {
  criteria: {
    market_vi:    { enabled: boolean; weight: number; factors: Record<VIRegimeKey, number> }
    pair_vi:      { enabled: boolean; weight: number; factors: Record<VIRegimeKey, number> }
    ma_direction: { enabled: boolean; weight: number; factors: { aligned: number; neutral: number; opposed: number } }
    strategy_wr:  { enabled: boolean; weight: number; min_factor: number; max_factor: number }
    confidence:   { enabled: boolean; weight: number; min_factor: number; max_factor: number }
  }
  global_multiplier_max: number
  risk_guard:   { enabled: boolean; force_allowed: boolean; hard_block_at_zero: boolean }
  alert_banner: { enabled: boolean; trigger_threshold_pct: number }
}

const DEFAULTS: RiskConfig = {
  criteria: {
    market_vi:    { enabled: true, weight: 0.20, factors: { DEAD: 0.30, CALM: 0.60, NORMAL: 1.00, TRENDING: 1.50, ACTIVE: 1.20, EXTREME: 0.50 } },
    pair_vi:      { enabled: true, weight: 0.25, factors: { DEAD: 0.30, CALM: 0.60, NORMAL: 1.00, TRENDING: 1.50, ACTIVE: 1.20, EXTREME: 0.50 } },
    ma_direction: { enabled: true, weight: 0.20, factors: { aligned: 1.30, neutral: 1.00, opposed: 0.60 } },
    strategy_wr:  { enabled: true, weight: 0.20, min_factor: 0.50, max_factor: 1.50 },
    confidence:   { enabled: true, weight: 0.15, min_factor: 0.50, max_factor: 1.50 },
  },
  global_multiplier_max: 2.0,
  risk_guard:   { enabled: true, force_allowed: true, hard_block_at_zero: false },
  alert_banner: { enabled: true, trigger_threshold_pct: 100.0 },
}

function hydrate(raw: Record<string, unknown>): RiskConfig {
  const crit = (raw.criteria ?? {}) as Record<string, Record<string, unknown>>
  return {
    criteria: {
      market_vi: {
        ...DEFAULTS.criteria.market_vi,
        ...(crit.market_vi ?? {}),
        factors: { ...DEFAULTS.criteria.market_vi.factors, ...((crit.market_vi?.factors ?? {}) as Partial<Record<VIRegimeKey, number>>) },
      },
      pair_vi: {
        ...DEFAULTS.criteria.pair_vi,
        ...(crit.pair_vi ?? {}),
        factors: { ...DEFAULTS.criteria.pair_vi.factors, ...((crit.pair_vi?.factors ?? {}) as Partial<Record<VIRegimeKey, number>>) },
      },
      ma_direction: {
        ...DEFAULTS.criteria.ma_direction,
        ...(crit.ma_direction ?? {}),
        factors: { ...DEFAULTS.criteria.ma_direction.factors, ...((crit.ma_direction?.factors ?? {}) as Partial<{ aligned: number; neutral: number; opposed: number }>) },
      },
      strategy_wr: { ...DEFAULTS.criteria.strategy_wr, ...(crit.strategy_wr ?? {}) } as RiskConfig['criteria']['strategy_wr'],
      confidence:  { ...DEFAULTS.criteria.confidence,  ...(crit.confidence  ?? {}) } as RiskConfig['criteria']['confidence'],
    },
    global_multiplier_max: (raw.global_multiplier_max as number | undefined) ?? DEFAULTS.global_multiplier_max,
    risk_guard:   { ...DEFAULTS.risk_guard,   ...((raw.risk_guard   as Partial<RiskConfig['risk_guard']>)   ?? {}) },
    alert_banner: { ...DEFAULTS.alert_banner, ...((raw.alert_banner as Partial<RiskConfig['alert_banner']>) ?? {}) },
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type TabId = 'criteria' | 'factors' | 'guard' | 'simulator'

const TABS: { id: TabId; label: string }[] = [
  { id: 'criteria',  label: 'Criteria'  },
  { id: 'factors',   label: 'Factors'   },
  { id: 'guard',     label: 'Guard'     },
  { id: 'simulator', label: 'Simulator' },
]

// ── Simulator ─────────────────────────────────────────────────────────────────

interface SimInputs {
  market_vi:   VIRegimeKey | ''
  pair_vi:     VIRegimeKey | ''
  ma_dir:      'aligned' | 'neutral' | 'opposed' | ''
  strategy_wr: number | null   // 0–100 (%)
  confidence:  number | null   // 1–10
  base_risk:   number          // %
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function computeSim(cfg: RiskConfig, inp: SimInputs): { multiplier: number; adjusted: number } {
  const items: { factor: number; weight: number }[] = []

  if (cfg.criteria.market_vi.enabled) {
    const f = inp.market_vi ? (cfg.criteria.market_vi.factors[inp.market_vi] ?? 1.0) : 1.0
    items.push({ factor: f, weight: cfg.criteria.market_vi.weight })
  }
  if (cfg.criteria.pair_vi.enabled) {
    const f = inp.pair_vi ? (cfg.criteria.pair_vi.factors[inp.pair_vi] ?? 1.0) : 1.0
    items.push({ factor: f, weight: cfg.criteria.pair_vi.weight })
  }
  if (cfg.criteria.ma_direction.enabled) {
    const f = inp.ma_dir ? (cfg.criteria.ma_direction.factors[inp.ma_dir] ?? 1.0) : 1.0
    items.push({ factor: f, weight: cfg.criteria.ma_direction.weight })
  }
  if (cfg.criteria.strategy_wr.enabled && inp.strategy_wr !== null) {
    const wr = clamp(inp.strategy_wr / 100, 0, 1)
    const { min_factor, max_factor } = cfg.criteria.strategy_wr
    items.push({ factor: clamp(min_factor + wr * (max_factor - min_factor), min_factor, max_factor), weight: cfg.criteria.strategy_wr.weight })
  }
  if (cfg.criteria.confidence.enabled && inp.confidence !== null) {
    const score = clamp(inp.confidence, 0, 10)
    const { min_factor, max_factor } = cfg.criteria.confidence
    items.push({ factor: clamp(min_factor + (score / 10) * (max_factor - min_factor), min_factor, max_factor), weight: cfg.criteria.confidence.weight })
  }

  if (items.length === 0) return { multiplier: 1.0, adjusted: inp.base_risk }
  const totalW = items.reduce((s, d) => s + d.weight, 0)
  if (totalW === 0) return { multiplier: 1.0, adjusted: inp.base_risk }

  let m = items.reduce((s, d) => s + d.factor * d.weight, 0) / totalW
  m = clamp(m, 0, cfg.global_multiplier_max)
  return {
    multiplier: Math.round(m * 1000) / 1000,
    adjusted:   Math.round(inp.base_risk * m * 100) / 100,
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIME_COLORS: Record<VIRegimeKey, string> = {
  DEAD:     'text-slate-400',
  CALM:     'text-blue-400',
  NORMAL:   'text-slate-300',
  TRENDING: 'text-emerald-400',
  ACTIVE:   'text-amber-400',
  EXTREME:  'text-red-400',
}

const CRITERION_LABELS: Record<keyof RiskConfig['criteria'], string> = {
  market_vi:    'Market VI — market-wide volatility regime',
  pair_vi:      'Pair VI — per-pair volatility regime',
  ma_direction: 'MA Direction — trend alignment',
  strategy_wr:  'Strategy Win Rate — historical stats',
  confidence:   'Confidence Score — 1 to 10',
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        checked ? 'bg-brand-500' : 'bg-surface-600',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  )
}

const factorInputCls = [
  'px-2 py-1.5 rounded-lg text-center text-xs text-slate-300 tabular-nums',
  'bg-surface-700 border border-surface-600',
  'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 transition-colors',
  'disabled:opacity-40',
].join(' ')

const selectCls = [
  'w-full px-3 py-1.5 rounded-lg text-xs text-slate-300',
  'bg-surface-700 border border-surface-600',
  'focus:outline-none focus:border-brand-500/60 transition-colors',
].join(' ')

function SectionCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-surface-700">
        <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
        {description && <p className="text-xs text-slate-600 mt-0.5">{description}</p>}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

function SaveBar({
  saving,
  saveOk,
  dirty,
  onSave,
}: {
  saving: boolean
  saveOk: boolean
  dirty: boolean
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-end pt-5 mt-2 border-t border-surface-700">
      <button
        onClick={onSave}
        disabled={!dirty || saving}
        className={cn(
          'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40',
          saveOk
            ? 'bg-emerald-600 text-white'
            : 'bg-brand-600 hover:bg-brand-500 text-white',
        )}
      >
        {saving   ? <Loader2 size={12} className="animate-spin" />
         : saveOk ? <Check   size={12} />
         :          <Save    size={12} />}
        {saving ? 'Saving…' : saveOk ? 'Saved!' : 'Save changes'}
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RiskSettingsPage() {
  const { activeProfileId: profileId } = useProfile()

  const [config,  setConfig]  = useState<RiskConfig>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [dirty,   setDirty]   = useState(false)
  const [saveOk,  setSaveOk]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [tab,     setTab]     = useState<TabId>('criteria')

  const [sim, setSim] = useState<SimInputs>({
    market_vi: '', pair_vi: '', ma_dir: '', strategy_wr: null, confidence: null, base_risk: 1.0,
  })

  const simResult = useMemo(() => computeSim(config, sim), [config, sim])

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    try {
      const data = await riskApi.getSettings(profileId)
      setConfig(hydrate(data.config))
      setDirty(false)
    } catch {
      setError('Failed to load risk settings.')
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => { load() }, [load])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function upd(fn: (c: RiskConfig) => RiskConfig) {
    setConfig(fn)
    setDirty(true)
    setSaveOk(false)
  }

  function updCrit<K extends keyof RiskConfig['criteria']>(
    key: K,
    fn: (v: RiskConfig['criteria'][K]) => RiskConfig['criteria'][K],
  ) {
    upd(c => ({ ...c, criteria: { ...c.criteria, [key]: fn(c.criteria[key]) } }))
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function save() {
    if (!profileId) return
    setSaving(true)
    setError(null)
    try {
      const data = await riskApi.updateSettings(profileId, config as unknown as Record<string, unknown>)
      setConfig(hydrate(data.config))
      setDirty(false)
      setSaveOk(true)
      setTimeout(() => setSaveOk(false), 3000)
    } catch {
      setError('Failed to save risk settings.')
    } finally {
      setSaving(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <PageHeader
        icon="🛡"
        title="Risk Settings"
        subtitle="Configure the dynamic risk engine: criteria, factors and guard rules"
        badge="Phase 3"
        badgeVariant="phase"
        actions={
          <button
            onClick={load}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-400 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={12} />
            Reload
          </button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-900/20 border border-red-800/50 text-red-400 text-xs max-w-2xl">
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      {/* ─── Tabs nav ──────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-surface-800 border border-surface-700 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-medium transition-colors',
              tab === t.id
                ? 'bg-surface-600 text-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-400',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Criteria ─────────────────────────────────────────────── */}
      {tab === 'criteria' && (
        <div className="space-y-5 max-w-2xl">
          <SectionCard
            title="Criteria"
            description="Enable or disable each criterion and set its relative weight. Weights are normalized — only enabled criteria count."
          >
            {(Object.keys(config.criteria) as Array<keyof RiskConfig['criteria']>).map(key => (
              <CriterionConfig
                key={key}
                label={CRITERION_LABELS[key]}
                enabled={config.criteria[key].enabled}
                weight={config.criteria[key].weight}
                onToggle={enabled => updCrit(key, v => ({ ...v, enabled }))}
                onWeightChange={weight => updCrit(key, v => ({ ...v, weight }))}
              />
            ))}
            <SaveBar saving={saving} saveOk={saveOk} dirty={dirty} onSave={save} />
          </SectionCard>
        </div>
      )}

      {/* ─── Tab: Factors ──────────────────────────────────────────────── */}
      {tab === 'factors' && (
        <div className="space-y-5 max-w-2xl">

          {/* VI regime factors — market_vi & pair_vi */}
          {(['market_vi', 'pair_vi'] as const).map(key => (
            <SectionCard
              key={key}
              title={key === 'market_vi' ? 'Market VI — Regime Factors' : 'Pair VI — Regime Factors'}
              description="Risk multiplier factor applied per VI regime."
            >
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                {VI_REGIMES.map(regime => (
                  <div key={regime} className="flex flex-col gap-1.5">
                    <span className={cn('text-xs font-medium text-center', REGIME_COLORS[regime])}>
                      {regime}
                    </span>
                    <input
                      type="number"
                      min={0.1}
                      max={3.0}
                      step={0.05}
                      value={config.criteria[key].factors[regime]}
                      disabled={!config.criteria[key].enabled}
                      onChange={e => updCrit(key, c => ({ ...c, factors: { ...c.factors, [regime]: parseFloat(e.target.value) || 0 } }))}
                      className={cn(factorInputCls, 'w-full')}
                    />
                  </div>
                ))}
              </div>
            </SectionCard>
          ))}

          {/* MA Direction factors */}
          <SectionCard
            title="MA Direction — Alignment Factors"
            description="Factor applied based on whether the trade direction aligns with the MA analysis bias."
          >
            <div className="grid grid-cols-3 gap-3">
              {(['aligned', 'neutral', 'opposed'] as const).map(dir => (
                <div key={dir} className="flex flex-col gap-1.5">
                  <span className={cn(
                    'text-xs font-medium text-center',
                    dir === 'aligned' ? 'text-emerald-400' : dir === 'opposed' ? 'text-red-400' : 'text-slate-400',
                  )}>
                    {dir.charAt(0).toUpperCase() + dir.slice(1)}
                  </span>
                  <input
                    type="number"
                    min={0.1}
                    max={3.0}
                    step={0.05}
                    value={config.criteria.ma_direction.factors[dir]}
                    disabled={!config.criteria.ma_direction.enabled}
                    onChange={e => updCrit('ma_direction', c => ({ ...c, factors: { ...c.factors, [dir]: parseFloat(e.target.value) || 0 } }))}
                    className={cn(factorInputCls, 'w-full')}
                  />
                </div>
              ))}
            </div>
          </SectionCard>

          {/* WR & Confidence bounds */}
          <SectionCard
            title="WR & Confidence — Bounds"
            description="Linear interpolation: min_factor at 0% WR / confidence 1 · max_factor at 100% WR / confidence 10."
          >
            <div>
              {(['strategy_wr', 'confidence'] as const).map(key => (
                <div key={key} className="flex items-center justify-between gap-3 py-2.5 border-b border-surface-700 last:border-none">
                  <span className={cn('text-xs', config.criteria[key].enabled ? 'text-slate-300' : 'text-slate-600')}>
                    {key === 'strategy_wr' ? 'Strategy Win Rate' : 'Confidence (1–10)'}
                  </span>
                  <div className={cn('flex items-center gap-2', !config.criteria[key].enabled && 'opacity-40')}>
                    <span className="text-xs text-slate-500">min</span>
                    <input
                      type="number"
                      min={0.1} max={2.0} step={0.05}
                      value={config.criteria[key].min_factor}
                      disabled={!config.criteria[key].enabled}
                      onChange={e => updCrit(key, c => ({ ...c, min_factor: parseFloat(e.target.value) || 0 }))}
                      className={cn(factorInputCls, 'w-20')}
                    />
                    <span className="text-xs text-slate-500">max</span>
                    <input
                      type="number"
                      min={0.1} max={3.0} step={0.05}
                      value={config.criteria[key].max_factor}
                      disabled={!config.criteria[key].enabled}
                      onChange={e => updCrit(key, c => ({ ...c, max_factor: parseFloat(e.target.value) || 0 }))}
                      className={cn(factorInputCls, 'w-20')}
                    />
                  </div>
                </div>
              ))}
            </div>
            <SaveBar saving={saving} saveOk={saveOk} dirty={dirty} onSave={save} />
          </SectionCard>
        </div>
      )}

      {/* ─── Tab: Guard ────────────────────────────────────────────────── */}
      {tab === 'guard' && (
        <div className="space-y-5 max-w-2xl">

          {/* Global multiplier cap */}
          <SectionCard
            title="Global Multiplier Cap"
            description="Hard ceiling on the final multiplier regardless of individual criteria results."
          >
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={1.0} max={3.0} step={0.1}
                value={config.global_multiplier_max}
                onChange={e => upd(c => ({ ...c, global_multiplier_max: parseFloat(e.target.value) }))}
                className="flex-1 accent-brand-500"
              />
              <span className="w-14 text-center text-xl font-bold text-slate-200 tabular-nums">
                ×{config.global_multiplier_max.toFixed(1)}
              </span>
            </div>
          </SectionCard>

          {/* Risk Guard */}
          <SectionCard
            title="Risk Guard"
            description="Control budget enforcement behaviour and override rules."
          >
            {(
              [
                {
                  key:   'enabled' as const,
                  label: 'Guard enabled',
                  desc:  'When OFF, budget checking is skipped entirely — all trades open freely.',
                },
                {
                  key:   'force_allowed' as const,
                  label: 'Force override allowed',
                  desc:  'Allow force-opening trades that exceed the budget (two-step confirmation). Disable for strict discipline mode.',
                },
                {
                  key:   'hard_block_at_zero' as const,
                  label: 'Hard block at zero budget',
                  desc:  'When ON, even the base risk % is blocked if the concurrent budget is fully exhausted.',
                },
              ] as const
            ).map(({ key, label, desc }) => (
              <div key={key} className="flex items-start justify-between gap-3 py-2.5 border-b border-surface-700 last:border-none">
                <div>
                  <p className="text-xs text-slate-300">{label}</p>
                  <p className="text-xs text-slate-600 mt-0.5">{desc}</p>
                </div>
                <Toggle
                  checked={config.risk_guard[key]}
                  onChange={v => upd(c => ({ ...c, risk_guard: { ...c.risk_guard, [key]: v } }))}
                />
              </div>
            ))}
          </SectionCard>

          {/* Alert Banner */}
          <SectionCard
            title="Dashboard Alert Banner"
            description="Show an amber warning on the dashboard when concurrent risk usage exceeds the threshold."
          >
            <div className="flex items-start justify-between gap-3 py-2.5 border-b border-surface-700">
              <div>
                <p className="text-xs text-slate-300">Banner enabled</p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Displays an alert on the dashboard when risk saturation hits the trigger.
                </p>
              </div>
              <Toggle
                checked={config.alert_banner.enabled}
                onChange={v => upd(c => ({ ...c, alert_banner: { ...c.alert_banner, enabled: v } }))}
              />
            </div>
            <div className={cn('flex items-center gap-4 py-2.5', !config.alert_banner.enabled && 'opacity-40')}>
              <span className="text-xs text-slate-500 whitespace-nowrap">Trigger at</span>
              <input
                type="range"
                min={50} max={100} step={5}
                value={config.alert_banner.trigger_threshold_pct}
                disabled={!config.alert_banner.enabled}
                onChange={e => upd(c => ({ ...c, alert_banner: { ...c.alert_banner, trigger_threshold_pct: parseFloat(e.target.value) } }))}
                className="flex-1 accent-amber-500"
              />
              <span className="w-12 text-right text-sm font-bold text-amber-400 tabular-nums">
                {config.alert_banner.trigger_threshold_pct.toFixed(0)}%
              </span>
            </div>
            <SaveBar saving={saving} saveOk={saveOk} dirty={dirty} onSave={save} />
          </SectionCard>
        </div>
      )}

      {/* ─── Tab: Simulator ────────────────────────────────────────────── */}
      {tab === 'simulator' && (
        <div className="space-y-5 max-w-2xl">
          <SectionCard
            title="Live Simulator"
            description="Enter hypothetical inputs to preview the multiplier using current (unsaved) settings. Changes reflect instantly."
          >
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">

              {/* Market VI */}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Market VI Regime</label>
                <select
                  value={sim.market_vi}
                  onChange={e => setSim(s => ({ ...s, market_vi: e.target.value as VIRegimeKey | '' }))}
                  className={selectCls}
                >
                  <option value="">— No data (neutral)</option>
                  {VI_REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* Pair VI */}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Pair VI Regime</label>
                <select
                  value={sim.pair_vi}
                  onChange={e => setSim(s => ({ ...s, pair_vi: e.target.value as VIRegimeKey | '' }))}
                  className={selectCls}
                >
                  <option value="">— No data (neutral)</option>
                  {VI_REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* MA Direction */}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">MA Direction</label>
                <select
                  value={sim.ma_dir}
                  onChange={e => setSim(s => ({ ...s, ma_dir: e.target.value as SimInputs['ma_dir'] }))}
                  className={selectCls}
                >
                  <option value="">— Not set (neutral)</option>
                  <option value="aligned">Aligned ↑</option>
                  <option value="neutral">Neutral</option>
                  <option value="opposed">Opposed ↓</option>
                </select>
              </div>

              {/* Strategy WR */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Strategy WR:{' '}
                  <span className="text-slate-300 tabular-nums">
                    {sim.strategy_wr === null ? '—' : `${sim.strategy_wr}%`}
                  </span>
                </label>
                <input
                  type="range" min={0} max={100} step={5}
                  value={sim.strategy_wr ?? 50}
                  onChange={e => setSim(s => ({ ...s, strategy_wr: parseInt(e.target.value) }))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                  <span>0%</span>
                  <button
                    className="text-slate-500 hover:text-slate-300 transition-colors"
                    onClick={() => setSim(s => ({ ...s, strategy_wr: null }))}
                  >
                    clear
                  </button>
                  <span>100%</span>
                </div>
              </div>

              {/* Confidence */}
              <div>
                <label className="block text-xs text-slate-500 mb-1">
                  Confidence:{' '}
                  <span className="text-slate-300 tabular-nums">
                    {sim.confidence === null ? '—' : `${sim.confidence}/10`}
                  </span>
                </label>
                <input
                  type="range" min={1} max={10} step={1}
                  value={sim.confidence ?? 5}
                  onChange={e => setSim(s => ({ ...s, confidence: parseInt(e.target.value) }))}
                  className="w-full accent-brand-500"
                />
                <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                  <span>1</span>
                  <button
                    className="text-slate-500 hover:text-slate-300 transition-colors"
                    onClick={() => setSim(s => ({ ...s, confidence: null }))}
                  >
                    clear
                  </button>
                  <span>10</span>
                </div>
              </div>

              {/* Base Risk */}
              <div>
                <label className="block text-xs text-slate-500 mb-1.5">Base Risk %</label>
                <input
                  type="number" min={0.01} max={10} step={0.1}
                  value={sim.base_risk}
                  onChange={e => setSim(s => ({ ...s, base_risk: parseFloat(e.target.value) || 0 }))}
                  className={cn(factorInputCls, 'w-full')}
                />
              </div>
            </div>

            {/* Result */}
            <div className="mt-6 flex flex-wrap items-center gap-6 px-5 py-4 rounded-xl bg-surface-700 border border-surface-600">
              <div className="text-center min-w-[80px]">
                <p className="text-xs text-slate-500 mb-1">Multiplier</p>
                <p className={cn(
                  'text-3xl font-bold tabular-nums',
                  simResult.multiplier > 1.02 ? 'text-emerald-400' :
                  simResult.multiplier < 0.98 ? 'text-red-400' : 'text-slate-300',
                )}>
                  ×{simResult.multiplier.toFixed(3)}
                </p>
              </div>
              <div className="h-12 w-px bg-surface-600 hidden sm:block" />
              <div className="text-center min-w-[100px]">
                <p className="text-xs text-slate-500 mb-1">Adjusted Risk</p>
                <p className="text-3xl font-bold tabular-nums text-slate-200">
                  {simResult.adjusted.toFixed(2)}%
                </p>
              </div>
              <div className="h-12 w-px bg-surface-600 hidden sm:block" />
              <p className="flex-1 text-xs text-slate-600 min-w-[160px]">
                Computed from current settings using the same engine as the backend.
                Save first to persist the config.
              </p>
            </div>
          </SectionCard>
        </div>
      )}
    </div>
  )
}
