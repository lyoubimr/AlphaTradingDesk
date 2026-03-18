// ── RiskSettingsPage ─────────────────────────────────────────────────────────
// P3-10 — Settings > Risk: Dynamic Risk engine configuration
//
// Sections:
//   1. Criteria active  — enable/disable + weight per criterion
//   2. VI Factors       — regime → factor for market_vi and pair_vi
//   3. MA Direction     — aligned / neutral / opposed factors
//   4. WR & Confidence  — min_factor / max_factor
//   5. Global Cap       — global_multiplier_max slider
//   6. Risk Guard       — 3 toggles (enabled, force_allowed, hard_block_at_zero)
//   7. Alert Banner     — enabled + trigger_threshold_pct
//   8. Live Simulator   — hypothetical inputs → multiplier preview (uses current state)
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useMemo } from 'react'
import { Save, Loader2, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { riskApi } from '../../lib/api'
import { CriterionConfig } from '../../components/risk/CriterionConfig'
import { cn } from '../../lib/cn'

// ── Local types ───────────────────────────────────────────────────────────────

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

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <h3 className="text-sm font-semibold text-zinc-300 mb-4">{title}</h3>
      {children}
    </div>
  )
}

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
        checked ? 'bg-emerald-500' : 'bg-zinc-700',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
}

function NumInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
  className,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  className?: string
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step ?? 0.05}
      disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      className={cn(
        'rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-sm text-zinc-200 text-right disabled:opacity-40',
        className,
      )}
    />
  )
}

const REGIME_COLORS: Record<VIRegimeKey, string> = {
  DEAD:     'text-slate-400',
  CALM:     'text-blue-400',
  NORMAL:   'text-zinc-300',
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

// ── Page ─────────────────────────────────────────────────────────────────────

export function RiskSettingsPage() {
  const { profileId } = useProfile()

  const [config, setConfig] = useState<RiskConfig>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [dirty,   setDirty]   = useState(false)
  const [saveOk,  setSaveOk]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)

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

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="animate-spin text-zinc-500" size={28} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon="🛡"
        title="Risk Settings"
        subtitle="Configure the dynamic risk engine: criteria, factors and guard rules"
        badge="Phase 3"
        badgeVariant="phase"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={13} />
              Reset
            </button>
            <button
              onClick={save}
              disabled={!dirty || saving}
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-40',
                saveOk
                  ? 'bg-emerald-600 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white',
              )}
            >
              {saving  ? <Loader2 size={13} className="animate-spin" />
               : saveOk ? <Check size={13} />
               :          <Save  size={13} />}
              {saving ? 'Saving…' : saveOk ? 'Saved!' : 'Save'}
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* ─── 1. Criteria ──────────────────────────────────────────────────── */}
      <SectionCard title="1 — Criteria">
        <p className="text-xs text-zinc-500 mb-4">
          Enable or disable each criterion. Weights are normalized automatically by the engine — only enabled criteria contribute.
        </p>
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
      </SectionCard>

      {/* ─── 2. VI Factors ────────────────────────────────────────────────── */}
      <SectionCard title="2 — VI Factors">
        <p className="text-xs text-zinc-500 mb-4">
          Risk multiplier factor per VI regime, configurable separately for Market VI and Pair VI.
        </p>
        {(['market_vi', 'pair_vi'] as const).map(key => (
          <div key={key} className="mb-5 last:mb-0">
            <p className="text-xs font-medium text-zinc-400 mb-2">
              {key === 'market_vi' ? 'Market VI' : 'Pair VI'}
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {VI_REGIMES.map(regime => (
                <div key={regime} className="flex flex-col gap-1">
                  <span className={cn('text-xs font-medium text-center', REGIME_COLORS[regime])}>
                    {regime}
                  </span>
                  <NumInput
                    value={config.criteria[key].factors[regime]}
                    onChange={v => updCrit(key, c => ({ ...c, factors: { ...c.factors, [regime]: v } }))}
                    min={0.1} max={3.0} step={0.05}
                    disabled={!config.criteria[key].enabled}
                    className="w-full text-center"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </SectionCard>

      {/* ─── 3. MA Direction Factors ──────────────────────────────────────── */}
      <SectionCard title="3 — MA Direction Factors">
        <p className="text-xs text-zinc-500 mb-4">
          Factor applied based on whether the trade direction aligns with the MA analysis bias.
        </p>
        <div className="grid grid-cols-3 gap-4">
          {(['aligned', 'neutral', 'opposed'] as const).map(dir => (
            <div key={dir} className="flex flex-col gap-1">
              <span className={cn(
                'text-xs font-medium',
                dir === 'aligned' ? 'text-emerald-400' : dir === 'opposed' ? 'text-red-400' : 'text-zinc-400',
              )}>
                {dir.charAt(0).toUpperCase() + dir.slice(1)}
              </span>
              <NumInput
                value={config.criteria.ma_direction.factors[dir]}
                onChange={v => updCrit('ma_direction', c => ({ ...c, factors: { ...c.factors, [dir]: v } }))}
                min={0.1} max={3.0} step={0.05}
                disabled={!config.criteria.ma_direction.enabled}
                className="w-full text-center"
              />
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ─── 4. WR & Confidence Bounds ────────────────────────────────────── */}
      <SectionCard title="4 — WR &amp; Confidence Bounds">
        <p className="text-xs text-zinc-500 mb-4">
          Linear interpolation: <span className="text-zinc-400">min_factor</span> at 0% WR / confidence 1,{' '}
          <span className="text-zinc-400">max_factor</span> at 100% WR / confidence 10.
        </p>
        <div className="space-y-0">
          {(['strategy_wr', 'confidence'] as const).map(key => (
            <div key={key} className="flex items-center gap-4 py-3 border-b border-zinc-800 last:border-0">
              <span className={cn('flex-1 text-sm', config.criteria[key].enabled ? 'text-zinc-200' : 'text-zinc-500')}>
                {key === 'strategy_wr' ? 'Strategy Win Rate' : 'Confidence (1–10)'}
              </span>
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500">min</label>
                <NumInput
                  value={config.criteria[key].min_factor}
                  onChange={v => updCrit(key, c => ({ ...c, min_factor: v }))}
                  min={0.1} max={2.0}
                  disabled={!config.criteria[key].enabled}
                  className="w-20"
                />
                <label className="text-xs text-zinc-500">max</label>
                <NumInput
                  value={config.criteria[key].max_factor}
                  onChange={v => updCrit(key, c => ({ ...c, max_factor: v }))}
                  min={0.1} max={3.0}
                  disabled={!config.criteria[key].enabled}
                  className="w-20"
                />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ─── 5. Global Cap ────────────────────────────────────────────────── */}
      <SectionCard title="5 — Global Multiplier Cap">
        <p className="text-xs text-zinc-500 mb-4">
          Hard ceiling on the final multiplier regardless of individual criteria results.
        </p>
        <div className="flex items-center gap-4">
          <input
            type="range" min={1.0} max={3.0} step={0.1}
            value={config.global_multiplier_max}
            onChange={e => upd(c => ({ ...c, global_multiplier_max: parseFloat(e.target.value) }))}
            className="flex-1 accent-blue-500"
          />
          <span className="w-14 text-center text-xl font-bold text-zinc-200 tabular-nums">
            ×{config.global_multiplier_max.toFixed(1)}
          </span>
          <NumInput
            value={config.global_multiplier_max}
            onChange={v => upd(c => ({ ...c, global_multiplier_max: clamp(v, 1.0, 3.0) }))}
            min={1.0} max={3.0} step={0.1}
            className="w-20"
          />
        </div>
      </SectionCard>

      {/* ─── 6. Risk Guard ────────────────────────────────────────────────── */}
      <SectionCard title="6 — Risk Guard">
        <div className="space-y-4">
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
                desc:  'Allow the trader to force-open trades that exceed the budget (shows a two-step confirmation). Disable for strict discipline mode.',
              },
              {
                key:   'hard_block_at_zero' as const,
                label: 'Hard block at zero budget',
                desc:  'When ON, even the base risk % is blocked if the concurrent budget is fully exhausted.',
              },
            ] as const
          ).map(({ key, label, desc }) => (
            <div key={key} className="flex items-start gap-3">
              <Toggle
                checked={config.risk_guard[key]}
                onChange={v => upd(c => ({ ...c, risk_guard: { ...c.risk_guard, [key]: v } }))}
              />
              <div>
                <p className="text-sm text-zinc-200">{label}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* ─── 7. Alert Banner ──────────────────────────────────────────────── */}
      <SectionCard title="7 — Dashboard Alert Banner">
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Toggle
              checked={config.alert_banner.enabled}
              onChange={v => upd(c => ({ ...c, alert_banner: { ...c.alert_banner, enabled: v } }))}
            />
            <div>
              <p className="text-sm text-zinc-200">Banner enabled</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Show an amber warning on the dashboard when concurrent risk usage exceeds the threshold below.
              </p>
            </div>
          </div>

          <div className={cn('flex items-center gap-4 pl-12', !config.alert_banner.enabled && 'opacity-40')}>
            <label className="text-xs text-zinc-400 whitespace-nowrap">Trigger at</label>
            <input
              type="range" min={50} max={100} step={5}
              value={config.alert_banner.trigger_threshold_pct}
              disabled={!config.alert_banner.enabled}
              onChange={e => upd(c => ({ ...c, alert_banner: { ...c.alert_banner, trigger_threshold_pct: parseFloat(e.target.value) } }))}
              className="flex-1 accent-amber-500"
            />
            <span className="w-14 text-center text-sm font-bold text-amber-400 tabular-nums">
              {config.alert_banner.trigger_threshold_pct.toFixed(0)}%
            </span>
          </div>
        </div>
      </SectionCard>

      {/* ─── 8. Live Simulator ────────────────────────────────────────────── */}
      <SectionCard title="8 — Live Simulator">
        <p className="text-xs text-zinc-500 mb-5">
          Enter hypothetical inputs and preview the multiplier using{' '}
          <span className="text-zinc-400">current (unsaved) settings</span>. Changes reflect instantly.
        </p>

        <div className="grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-3">
          {/* Market VI */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Market VI Regime</label>
            <select
              value={sim.market_vi}
              onChange={e => setSim(s => ({ ...s, market_vi: e.target.value as VIRegimeKey | '' }))}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="">— No data (neutral)</option>
              {VI_REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Pair VI */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Pair VI Regime</label>
            <select
              value={sim.pair_vi}
              onChange={e => setSim(s => ({ ...s, pair_vi: e.target.value as VIRegimeKey | '' }))}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="">— No data (neutral)</option>
              {VI_REGIMES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* MA Direction */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">MA Direction</label>
            <select
              value={sim.ma_dir}
              onChange={e => setSim(s => ({ ...s, ma_dir: e.target.value as SimInputs['ma_dir'] }))}
              className="w-full rounded bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-200"
            >
              <option value="">— Not set (neutral)</option>
              <option value="aligned">Aligned ↑</option>
              <option value="neutral">Neutral</option>
              <option value="opposed">Opposed ↓</option>
            </select>
          </div>

          {/* Strategy WR */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Strategy WR:{' '}
              <span className="text-zinc-300">{sim.strategy_wr === null ? '—' : `${sim.strategy_wr}%`}</span>
            </label>
            <input
              type="range" min={0} max={100} step={5}
              value={sim.strategy_wr ?? 50}
              onChange={e => setSim(s => ({ ...s, strategy_wr: parseInt(e.target.value) }))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-0.5">
              <span>0%</span>
              <button
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={() => setSim(s => ({ ...s, strategy_wr: null }))}
              >
                clear
              </button>
              <span>100%</span>
            </div>
          </div>

          {/* Confidence */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Confidence:{' '}
              <span className="text-zinc-300">{sim.confidence === null ? '—' : `${sim.confidence}/10`}</span>
            </label>
            <input
              type="range" min={1} max={10} step={1}
              value={sim.confidence ?? 5}
              onChange={e => setSim(s => ({ ...s, confidence: parseInt(e.target.value) }))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-zinc-600 mt-0.5">
              <span>1</span>
              <button
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={() => setSim(s => ({ ...s, confidence: null }))}
              >
                clear
              </button>
              <span>10</span>
            </div>
          </div>

          {/* Base Risk */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Base Risk %</label>
            <NumInput
              value={sim.base_risk}
              onChange={v => setSim(s => ({ ...s, base_risk: v }))}
              min={0.01} max={10} step={0.1}
              className="w-full"
            />
          </div>
        </div>

        {/* Result */}
        <div className="mt-6 flex flex-wrap items-center gap-6 px-5 py-4 rounded-lg bg-zinc-800/60 border border-zinc-700">
          <div className="text-center min-w-[80px]">
            <p className="text-xs text-zinc-500 mb-1">Multiplier</p>
            <p className={cn(
              'text-4xl font-bold tabular-nums',
              simResult.multiplier > 1.02 ? 'text-emerald-400' :
              simResult.multiplier < 0.98 ? 'text-red-400' : 'text-zinc-300',
            )}>
              ×{simResult.multiplier.toFixed(3)}
            </p>
          </div>
          <div className="h-14 w-px bg-zinc-700 hidden sm:block" />
          <div className="text-center min-w-[100px]">
            <p className="text-xs text-zinc-500 mb-1">Adjusted Risk</p>
            <p className="text-4xl font-bold tabular-nums text-zinc-200">
              {simResult.adjusted.toFixed(2)}%
            </p>
          </div>
          <div className="h-14 w-px bg-zinc-700 hidden sm:block" />
          <p className="flex-1 text-xs text-zinc-500 min-w-[160px]">
            Computed from current (unsaved) settings using the same engine as the backend.
            Save first to persist the config, then it will be used for real advisor calls.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}
