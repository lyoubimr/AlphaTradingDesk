// ── Volatility Settings page ────────────────────────────────────────────────
// P2-15 — Settings > Volatility: Market VI engine + Per-Pair + Regime thresholds
//
// Backend:
//   GET  /api/volatility/settings/{profile_id}  → VolatilitySettingsOut
//   PUT  /api/volatility/settings/{profile_id}  → merge-patch (partial fields only)
// ───────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import { Activity, Save, Loader2, RefreshCw, Check, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { volatilityApi } from '../../lib/api'
import { cn } from '../../lib/cn'

// ── Local types for JSONB sub-objects ─────────────────────────────────────

type TFKey = '15m' | '1h' | '4h' | '1d'

interface TFWeights { '15m': number; '1h': number; '4h': number; '1d': number }

interface MarketVICfg {
  tf_weights: { weekday: TFWeights; weekend: TFWeights }
  rolling_window: number
  weekdays_only: boolean
  enabled: boolean
}

// 0=Mon … 6=Sun (Python weekday() convention)
interface TFSchedule {
  enabled: boolean
  hours_start: string   // "00:00"
  hours_end: string     // "23:59"
  days: number[]        // empty = every day
  vi_min: number        // 0.0
  vi_max: number        // 1.0
}

interface PerPairCfg {
  indicators: { rvol: boolean; mfi: boolean; atr: boolean; bb: boolean; ema: boolean }
  retention_days: number
  enabled: boolean
  schedules: Partial<Record<TFKey, TFSchedule>>
}

interface RegimesCfg {
  dead_max: number
  calm_max: number
  normal_max: number
  trending_max: number
  active_max: number
}

// ── Defaults ────────────────────────────────────────────────────────────────

const D_MVI: MarketVICfg = {
  tf_weights: {
    weekday: { '15m': 0.25, '1h': 0.40, '4h': 0.25, '1d': 0.10 },
    weekend: { '15m': 0.75, '1h': 0.25, '4h': 0.00, '1d': 0.00 },
  },
  rolling_window: 20,
  weekdays_only: false,
  enabled: true,
}

const D_TF_SCHEDULE: TFSchedule = {
  enabled: true,
  hours_start: '00:00',
  hours_end: '23:59',
  days: [],
  vi_min: 0.0,
  vi_max: 1.0,
}

const D_PP: PerPairCfg = {
  indicators: { rvol: true, mfi: true, atr: true, bb: true, ema: true },
  retention_days: 30,
  enabled: true,
  schedules: {},
}

const D_REG: RegimesCfg = {
  dead_max: 0.17,
  calm_max: 0.33,
  normal_max: 0.50,
  trending_max: 0.67,
  active_max: 0.83,
}

// ── Hydration helpers ────────────────────────────────────────────────────────

function hydrateMVI(raw: Record<string, unknown>): MarketVICfg {
  const tw = (raw.tf_weights as (typeof D_MVI)['tf_weights'] | undefined) ?? D_MVI.tf_weights
  return {
    tf_weights: {
      weekday: { ...D_MVI.tf_weights.weekday, ...(tw.weekday ?? {}) },
      weekend: { ...D_MVI.tf_weights.weekend, ...(tw.weekend ?? {}) },
    },
    rolling_window: (raw.rolling_window as number | undefined) ?? D_MVI.rolling_window,
    weekdays_only: (raw.weekdays_only as boolean | undefined) ?? D_MVI.weekdays_only,
    enabled: (raw.enabled as boolean | undefined) ?? D_MVI.enabled,
  }
}

function hydratePerPair(raw: Record<string, unknown>): PerPairCfg {
  const ind = (raw.indicators as Partial<PerPairCfg['indicators']> | undefined) ?? {}
  const rawSched = (raw.schedules as Partial<Record<TFKey, Partial<TFSchedule>>> | undefined) ?? {}
  const schedules: PerPairCfg['schedules'] = {}
  for (const tf of ['15m', '1h', '4h', '1d'] as TFKey[]) {
    if (rawSched[tf]) schedules[tf] = { ...D_TF_SCHEDULE, ...rawSched[tf] }
  }
  return {
    indicators: { ...D_PP.indicators, ...ind },
    retention_days: (raw.retention_days as number | undefined) ?? D_PP.retention_days,
    enabled: (raw.enabled as boolean | undefined) ?? D_PP.enabled,
    schedules,
  }
}

function hydrateRegimes(raw: Record<string, unknown>): RegimesCfg {
  return { ...D_REG, ...(raw as Partial<RegimesCfg>) }
}

// ── Constants ────────────────────────────────────────────────────────────────

const TFS: TFKey[] = ['15m', '1h', '4h', '1d']
const pct = (v: number) => Math.round(v * 100)
const tfSum = (w: TFWeights) => TFS.reduce((s, tf) => s + pct(w[tf] ?? 0), 0)

const REGIME_ROWS: { key: keyof RegimesCfg; label: string; cls: string }[] = [
  { key: 'dead_max',     label: 'DEAD max',     cls: 'text-slate-400' },
  { key: 'calm_max',     label: 'CALM max',     cls: 'text-blue-400' },
  { key: 'normal_max',   label: 'NORMAL max',   cls: 'text-emerald-400' },
  { key: 'trending_max', label: 'TRENDING max', cls: 'text-amber-400' },
  { key: 'active_max',   label: 'ACTIVE max',   cls: 'text-orange-400' },
]

// ── Atoms ─────────────────────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-label={label}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0',
        on ? 'bg-brand-500' : 'bg-surface-600',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  )
}

function TFBlock({
  label,
  weights,
  onChange,
}: {
  label: string
  weights: TFWeights
  onChange: (tf: TFKey, v: number) => void
}) {
  const sum = tfSum(weights)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</span>
        <span
          className={cn(
            'text-xs font-mono px-2 py-0.5 rounded-full',
            sum === 100
              ? 'bg-emerald-500/15 text-emerald-400'
              : 'bg-red-500/15 text-red-400',
          )}
        >
          {sum}%
        </span>
      </div>
      {TFS.map(tf => (
        <div key={tf} className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-500 w-8 shrink-0">{tf}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct(weights[tf] ?? 0)}
            onChange={e => onChange(tf, Number(e.target.value))}
            className="flex-1 h-1.5 accent-brand-500 cursor-pointer"
          />
          <span className="text-xs font-mono text-slate-300 w-10 text-right">
            {pct(weights[tf] ?? 0)}%
          </span>
        </div>
      ))}
    </div>
  )
}

function SaveBar({
  saving,
  saved,
  error,
  disabled,
  onSave,
}: {
  saving: boolean
  saved: boolean
  error: string | null
  disabled?: boolean
  onSave: () => void
}) {
  return (
    <div className="flex items-center justify-between pt-5 border-t border-surface-700 mt-6">
      <div className="text-xs">
        {error && (
          <span className="text-red-400 flex items-center gap-1.5">
            <AlertTriangle size={12} /> {error}
          </span>
        )}
        {saved && !error && (
          <span className="text-emerald-400 flex items-center gap-1.5">
            <Check size={12} /> Saved
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || disabled}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-xs font-medium text-white transition-colors"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        Save
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'market-vi' | 'per-pair' | 'schedules' | 'regimes'

export function VolatilitySettingsPage() {
  const { activeProfileId: profileId } = useProfile()
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [tab,     setTab]     = useState<Tab>('market-vi')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const [mvi, setMVI] = useState<MarketVICfg>(D_MVI)
  const [pp,  setPP]  = useState<PerPairCfg>(D_PP)
  const [reg, setReg] = useState<RegimesCfg>(D_REG)

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setLoadErr(null)
    try {
      const s = await volatilityApi.getSettings(profileId)
      setMVI(hydrateMVI(s.market_vi))
      setPP(hydratePerPair(s.per_pair))
      setReg(hydrateRegimes(s.regimes as Record<string, unknown>))
    } catch {
      setLoadErr('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!profileId) return
    setSaving(true)
    setSaveErr(null)
    setSaved(false)
    try {
      // Each tab saves only its own section (merge-patch)
      // per-pair and schedules both patch per_pair (schedules embedded in it)
      const patch =
        tab === 'market-vi'  ? { market_vi: mvi }
        : tab === 'regimes'  ? { regimes: reg }
        : { per_pair: pp }   // per-pair AND schedules
      await volatilityApi.updateSettings(profileId, patch)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setSaveErr('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const setTFW = (mode: 'weekday' | 'weekend', tf: TFKey, v: number) =>
    setMVI(p => ({
      ...p,
      tf_weights: { ...p.tf_weights, [mode]: { ...p.tf_weights[mode], [tf]: v / 100 } },
    }))

  const wdOk = tfSum(mvi.tf_weights.weekday) === 100
  const weOk = mvi.weekdays_only || tfSum(mvi.tf_weights.weekend) === 100

  const { dead_max, calm_max, normal_max, trending_max, active_max } = reg
  const regOk =
    dead_max < calm_max &&
    calm_max < normal_max &&
    normal_max < trending_max &&
    trending_max < active_max &&
    active_max < 1.0

  const canSave =
    tab === 'market-vi' ? wdOk && weOk
    : tab === 'regimes'  ? regOk
    : true

  // ── Schedule helpers ────────────────────────────────────────────────────
  const getSched = (tf: TFKey): TFSchedule => pp.schedules[tf] ?? D_TF_SCHEDULE
  const setSched = (tf: TFKey, patch: Partial<TFSchedule>) =>
    setPP(p => ({ ...p, schedules: { ...p.schedules, [tf]: { ...getSched(tf), ...patch } } }))
  const toggleDay = (tf: TFKey, d: number) => {
    const cur = getSched(tf).days
    setSched(tf, { days: cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d].sort() })
  }
  const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading settings…
      </div>
    )
  }

  if (loadErr) {
    return <div className="text-center py-24 text-red-400">{loadErr}</div>
  }

  return (
    <div>
      <PageHeader
        icon="⚡"
        title="Volatility Settings"
        subtitle="Configure the Market VI engine and per-pair analysis"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-400 transition-colors"
          >
            <RefreshCw size={12} /> Reload
          </button>
        }
      />

      {/* Source badge */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-xs text-slate-500">Source</span>
        <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-indigo-600/15 text-indigo-400 border border-indigo-600/30 px-2.5 py-1 rounded-full">
          <Activity size={11} /> Kraken Futures
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-800 border border-surface-700 p-1 rounded-lg w-fit mb-6">
        {(['market-vi', 'per-pair', 'schedules', 'regimes'] as Tab[]).map(id => (
          <button
            key={id}
            type="button"
            onClick={() => { setTab(id); setSaved(false); setSaveErr(null) }}
            className={cn(
              'px-4 py-1.5 rounded-md text-xs font-medium transition-all',
              tab === id
                ? 'bg-surface-600 text-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            {id === 'market-vi' ? 'Market VI'
              : id === 'per-pair' ? 'Per-Pair'
              : id === 'schedules' ? 'Schedules'
              : 'Regimes'}
          </button>
        ))}
      </div>

      {/* ── Market VI ──────────────────────────────────────────────────────── */}
      {tab === 'market-vi' && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 p-6 max-w-2xl">
          <div className="space-y-6">

            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Market VI engine</span>
              <Toggle
                on={mvi.enabled}
                onChange={v => setMVI(p => ({ ...p, enabled: v }))}
                label="Enable Market VI"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-slate-300">Rolling window</span>
                <p className="text-xs text-slate-600 mt-0.5">Percentile lookback (candles)</p>
              </div>
              <select
                value={mvi.rolling_window}
                onChange={e => setMVI(p => ({ ...p, rolling_window: Number(e.target.value) }))}
                className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500/60"
              >
                {[20, 30, 60, 90].map(v => (
                  <option key={v} value={v}>{v} candles</option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-slate-300">Weekdays only</span>
                <p className="text-xs text-slate-600 mt-0.5">Skip weekend engine runs entirely</p>
              </div>
              <Toggle
                on={mvi.weekdays_only}
                onChange={v => setMVI(p => ({ ...p, weekdays_only: v }))}
                label="Weekdays only"
              />
            </div>

            <hr className="border-surface-700" />

            <TFBlock
              label="TF weights — Weekday"
              weights={mvi.tf_weights.weekday}
              onChange={(tf, v) => setTFW('weekday', tf, v)}
            />

            {!mvi.weekdays_only && (
              <TFBlock
                label="TF weights — Weekend"
                weights={mvi.tf_weights.weekend}
                onChange={(tf, v) => setTFW('weekend', tf, v)}
              />
            )}

            {!wdOk && (
              <p className="text-xs text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={12} /> Weekday weights must sum to 100%
              </p>
            )}
            {!mvi.weekdays_only && !weOk && (
              <p className="text-xs text-amber-400 flex items-center gap-1.5">
                <AlertTriangle size={12} /> Weekend weights must sum to 100%
              </p>
            )}

          </div>
          <SaveBar
            saving={saving}
            saved={saved}
            error={saveErr}
            disabled={!canSave}
            onSave={() => void save()}
          />
        </div>
      )}

      {/* ── Per-Pair ───────────────────────────────────────────────────────── */}
      {tab === 'per-pair' && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 p-6 max-w-2xl">
          <div className="space-y-6">

            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Per-pair analysis engine</span>
              <Toggle
                on={pp.enabled}
                onChange={v => setPP(p => ({ ...p, enabled: v }))}
                label="Enable per-pair"
              />
            </div>

            <hr className="border-surface-700" />

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                Indicators
              </p>
              <div className="space-y-3">
                {(['rvol', 'mfi', 'atr', 'bb', 'ema'] as const).map(ind => (
                  <div key={ind} className="flex items-center justify-between">
                    <span className="text-sm text-slate-300 font-mono uppercase">{ind}</span>
                    <Toggle
                      on={pp.indicators[ind]}
                      onChange={v => setPP(p => ({ ...p, indicators: { ...p.indicators, [ind]: v } }))}
                      label={`Toggle ${ind}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <hr className="border-surface-700" />

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-slate-300">Snapshot retention</span>
                <p className="text-xs text-slate-600 mt-0.5">Days to keep per-pair snapshots in DB</p>
              </div>
              <select
                value={pp.retention_days}
                onChange={e => setPP(p => ({ ...p, retention_days: Number(e.target.value) }))}
                className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500/60"
              >
                {[7, 14, 30, 60, 90].map(v => (
                  <option key={v} value={v}>{v} days</option>
                ))}
              </select>
            </div>

          </div>
          <SaveBar
            saving={saving}
            saved={saved}
            error={saveErr}
            onSave={() => void save()}
          />
        </div>
      )}

      {/* ── Schedules ──────────────────────────────────────────────────────── */}
      {tab === 'schedules' && (
        <div className="space-y-4 max-w-2xl">
          <p className="text-xs text-slate-500">
            Par timeframe : plage horaire d'exécution, jours actifs, et filtre VI.
            Laissez <span className="font-mono text-slate-400">days</span> vide = tous les jours.
            VI filter s'applique au score courant <em>avant</em> de lancer le calcul.
          </p>

          {TFS.map(tf => {
            const s = getSched(tf)
            return (
              <div key={tf} className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
                {/* Header */}
                <div className="px-5 py-3 border-b border-surface-700 flex items-center justify-between">
                  <span className="text-sm font-mono font-bold text-slate-200 uppercase">{tf}</span>
                  <Toggle on={s.enabled} onChange={v => setSched(tf, { enabled: v })} label={`Enable ${tf} schedule`} />
                </div>

                <div className={cn('px-5 py-4 space-y-4 transition-opacity', !s.enabled && 'opacity-40 pointer-events-none')}>

                  {/* Hours */}
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400 w-24 shrink-0">Plage horaire</span>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="time"
                        value={s.hours_start}
                        onChange={e => setSched(tf, { hours_start: e.target.value })}
                        className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500/60"
                      />
                      <span className="text-xs text-slate-500">→</span>
                      <input
                        type="time"
                        value={s.hours_end}
                        onChange={e => setSched(tf, { hours_end: e.target.value })}
                        className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-500/60"
                      />
                    </div>
                  </div>

                  {/* Days */}
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400 w-24 shrink-0">Jours actifs</span>
                    <div className="flex gap-1.5">
                      {DAY_LABELS.map((d, i) => {
                        const active = s.days.length === 0 || s.days.includes(i)
                        const selected = s.days.includes(i)
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => toggleDay(tf, i)}
                            title={s.days.length === 0 ? 'Tous les jours (cliquer pour exclure)' : ''}
                            className={cn(
                              'w-8 h-7 rounded text-[11px] font-medium transition-all border',
                              selected || s.days.length === 0
                                ? 'bg-brand-600/20 border-brand-600/40 text-brand-400'
                                : 'bg-surface-700 border-surface-600 text-slate-600 hover:border-surface-500',
                              s.days.length === 0 && 'ring-1 ring-brand-600/20',
                            )}
                          >
                            {d}
                          </button>
                        )
                      })}
                      {s.days.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setSched(tf, { days: [] })}
                          className="text-[10px] text-slate-600 hover:text-slate-400 ml-1"
                        >
                          reset
                        </button>
                      )}
                    </div>
                  </div>

                  {/* VI filter */}
                  <div className="flex items-start gap-4">
                    <span className="text-xs text-slate-400 w-24 shrink-0 pt-1">Filtre VI</span>
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-500 w-6">min</span>
                        <input
                          type="range" min={0} max={100} step={5}
                          value={Math.round(s.vi_min * 100)}
                          onChange={e => setSched(tf, { vi_min: Number(e.target.value) / 100 })}
                          className="flex-1 h-1.5 accent-brand-500 cursor-pointer"
                        />
                        <span className="text-xs font-mono text-slate-300 w-10 text-right">{Math.round(s.vi_min * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] text-slate-500 w-6">max</span>
                        <input
                          type="range" min={0} max={100} step={5}
                          value={Math.round(s.vi_max * 100)}
                          onChange={e => setSched(tf, { vi_max: Number(e.target.value) / 100 })}
                          className="flex-1 h-1.5 accent-brand-500 cursor-pointer"
                        />
                        <span className="text-xs font-mono text-slate-300 w-10 text-right">{Math.round(s.vi_max * 100)}%</span>
                      </div>
                      {s.vi_min >= s.vi_max && (
                        <p className="text-[11px] text-amber-400 flex items-center gap-1">
                          <AlertTriangle size={11} /> VI min doit être &lt; VI max
                        </p>
                      )}
                    </div>
                  </div>

                </div>
              </div>
            )
          })}

          <SaveBar saving={saving} saved={saved} error={saveErr} onSave={() => void save()} />
        </div>
      )}

      {/* ── Regimes ────────────────────────────────────────────────────────── */}
      {tab === 'regimes' && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 p-6 max-w-2xl">
          <p className="text-xs text-slate-500 mb-5">
            Percentile thresholds (0–100%) defining regime boundaries. Must be strictly increasing.
            Scores above{' '}
            <span className="font-mono text-slate-400">{Math.round(active_max * 100)}%</span>
            {' '}→{' '}
            <span className="text-red-400 font-semibold">EXTREME</span>.
          </p>

          {/* Colour band preview */}
          <div className="flex h-2.5 rounded-full overflow-hidden mb-6 border border-surface-700">
            <div className="bg-slate-600"   style={{ width: `${dead_max * 100}%` }} />
            <div className="bg-blue-600"    style={{ width: `${(calm_max - dead_max) * 100}%` }} />
            <div className="bg-emerald-600" style={{ width: `${(normal_max - calm_max) * 100}%` }} />
            <div className="bg-amber-500"   style={{ width: `${(trending_max - normal_max) * 100}%` }} />
            <div className="bg-orange-500"  style={{ width: `${(active_max - trending_max) * 100}%` }} />
            <div className="flex-1 bg-red-600" />
          </div>

          <div className="space-y-5">
            {REGIME_ROWS.map(({ key, label, cls }) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={cn('text-xs font-semibold', cls)}>{label}</span>
                  <span className="text-xs font-mono text-slate-300">
                    {(reg[key] * 100).toFixed(0)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={99}
                  step={1}
                  value={Math.round(reg[key] * 100)}
                  onChange={e => setReg(p => ({ ...p, [key]: Number(e.target.value) / 100 }))}
                  className="w-full h-1.5 accent-brand-500 cursor-pointer"
                />
              </div>
            ))}
          </div>

          {!regOk && (
            <p className="text-xs text-amber-400 flex items-center gap-1.5 mt-4">
              <AlertTriangle size={12} /> Thresholds must be strictly increasing and all below 100%
            </p>
          )}

          <SaveBar
            saving={saving}
            saved={saved}
            error={saveErr}
            disabled={!regOk}
            onSave={() => void save()}
          />
        </div>
      )}
    </div>
  )
}
