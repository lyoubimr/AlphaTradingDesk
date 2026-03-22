// ── Volatility Settings page ────────────────────────────────────────────────
// P2-15 — Settings > Volatility: Market VI engine + Per-Pair + Regime thresholds
//
// Backend:
//   GET  /api/volatility/settings/{profile_id}  → VolatilitySettingsOut
//   PUT  /api/volatility/settings/{profile_id}  → merge-patch (partial fields only)
// ───────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import { Activity, Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { SaveBar } from '../../components/ui/SaveBar'
import { useSaveState } from '../../hooks/useSaveState'
import { Tooltip } from '../../components/ui/Tooltip'
import { useProfile } from '../../context/ProfileContext'
import { volatilityApi } from '../../lib/api'
import { cn } from '../../lib/cn'

// ── Local types for JSONB sub-objects ─────────────────────────────────────

// TFKey couvre tous les TF utilisés dans l'app (Market VI + Schedules)
type TFKey    = '15m' | '1h' | '4h' | '1d' | '1w'
// MVITFKey = subset utilisé pour les poids Market VI (pas de 1w)
type MVITFKey = '15m' | '1h' | '4h' | '1d'

interface TFWeights { '15m': number; '1h': number; '4h': number; '1d': number }

interface MarketVICfg {
  tf_weights: { weekday: TFWeights; weekend: TFWeights }
  rolling_window: number
  weekdays_only: boolean
  enabled: boolean
  active_hours_start: string  // HH:MM UTC
  active_hours_end: string    // HH:MM UTC
  pairs_count: number         // number of Binance Futures pairs used for Market VI (10–100)
  weights: Record<string, number>  // anchor weights as fractions 0.0–1.0; e.g. {"BTCUSDT": 0.30}
  retention_days: number       // market_vi_snapshots retention in days
  indicator_weights: { rvol: number; mfi: number; atr: number; bb_width: number }
}

// 0=Mon … 6=Sun (Python weekday() convention)
interface TFSchedule {
  enabled: boolean
  days: number[]                     // empty = all days
  vi_min: number                     // 0.0 — minimum VI score filter before compute
  vi_max: number                     // 1.0 — maximum VI score filter before compute
  execution_hours: number[]          // weekday UTC hours (empty = all)
  weekend_execution_hours: number[]  // weekend UTC hours (empty = all)
  execution_interval_minutes?: number // sub-hour: 15 (default) or 30 — 15m TF only
  regime_filter: string[]            // empty = all regimes allowed
}

interface PerPairCfg {
  indicators: { rvol: boolean; mfi: boolean; atr: boolean; bb: boolean; ema: boolean }
  indicator_weights: { rvol: number; mfi: number; atr: number; bb_width: number }
  retention_days: number
  enabled: boolean
  schedules: Partial<Record<TFKey, TFSchedule>>
  ema_ref_periods: Partial<Record<TFKey, number>>
  ema_retest_tolerance: Partial<Record<TFKey, number>>
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
  active_hours_start: '00:00',
  active_hours_end: '23:59',
  pairs_count: 50,
  weights: {},
  retention_days: 90,
  indicator_weights: { rvol: 0.35, mfi: 0.10, atr: 0.35, bb_width: 0.20 },
}

// Pairs eligible for anchor weight in the Market VI engine
const MVI_ANCHOR_PAIRS = ['BTCUSDT', 'ETHUSDT'] as const

const D_TF_SCHEDULE: TFSchedule = {
  enabled: true,
  days: [],
  vi_min: 0.0,
  vi_max: 1.0,
  execution_hours: [],          // weekday hours (empty = all)
  weekend_execution_hours: [],  // weekend hours (empty = all)
  regime_filter: [],
}

const D_PP: PerPairCfg = {
  indicators: { rvol: true, mfi: true, atr: true, bb: true, ema: true },
  indicator_weights: { rvol: 0.35, mfi: 0.10, atr: 0.35, bb_width: 0.20 },
  retention_days: 30,
  enabled: true,
  schedules: {},
  ema_ref_periods: { '15m': 55, '1h': 99, '4h': 200, '1d': 99, '1w': 55 },
  ema_retest_tolerance: { '15m': 0.005, '1h': 0.010, '4h': 0.015, '1d': 0.020, '1w': 0.030 },
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
    active_hours_start: (raw.active_hours_start as string | undefined) ?? D_MVI.active_hours_start,
    active_hours_end: (raw.active_hours_end as string | undefined) ?? D_MVI.active_hours_end,
    pairs_count: (raw.pairs_count as number | undefined) ?? D_MVI.pairs_count,
    weights: (raw.weights as Record<string, number> | undefined) ?? D_MVI.weights,
    retention_days: (raw.retention_days as number | undefined) ?? D_MVI.retention_days,
    indicator_weights: { ...D_MVI.indicator_weights, ...((raw.indicator_weights as Partial<typeof D_MVI['indicator_weights']> | undefined) ?? {}) },
  }
}

function hydratePerPair(raw: Record<string, unknown>): PerPairCfg {
  const ind = (raw.indicators as Partial<PerPairCfg['indicators']> | undefined) ?? {}
  const rawSched = (raw.schedules as Partial<Record<TFKey, Partial<TFSchedule>>> | undefined) ?? {}
  const schedules: PerPairCfg['schedules'] = {}
  for (const tf of ['15m', '1h', '4h', '1d', '1w'] as TFKey[]) {
    if (rawSched[tf]) schedules[tf] = { ...D_TF_SCHEDULE, ...rawSched[tf] }
  }
  return {
    indicators: { ...D_PP.indicators, ...ind },
    indicator_weights: { ...D_PP.indicator_weights, ...((raw.indicator_weights as Partial<typeof D_PP['indicator_weights']> | undefined) ?? {}) },
    retention_days: (raw.retention_days as number | undefined) ?? D_PP.retention_days,
    enabled: (raw.enabled as boolean | undefined) ?? D_PP.enabled,
    schedules,
    ema_ref_periods: { ...D_PP.ema_ref_periods, ...((raw.ema_ref_periods as Partial<Record<TFKey, number>> | undefined) ?? {}) },
    ema_retest_tolerance: { ...D_PP.ema_retest_tolerance, ...((raw.ema_retest_tolerance as Partial<Record<TFKey, number>> | undefined) ?? {}) },
  }
}

function hydrateRegimes(raw: Record<string, unknown>): RegimesCfg {
  return { ...D_REG, ...(raw as Partial<RegimesCfg>) }
}

// ── Constants ────────────────────────────────────────────────────────────────

// TFS = the 4 TFs for Market VI weights (MVITFKey[])
const TFS: MVITFKey[] = ['15m', '1h', '4h', '1d']
// SCHED_TFS = all TFs for the Schedules tab (includes 1w)
const SCHED_TFS: TFKey[] = ['15m', '1h', '4h', '1d', '1w']

// UTC offset for local display of hours (e.g. +2 for UTC+2)
const LOCAL_OFFSET_H = -new Date().getTimezoneOffset() / 60

// Beat fire times in UTC per TF — mirrors celery_app.py beat_schedule.
// Used to warn the user if their execution_hours filter would block the natural beat.
const TF_BEAT_UTC: Partial<Record<TFKey, number[]>> = {
  '4h': [0, 4, 8, 12, 16, 20],
  '1d': [0],
  '1w': [1], // Mon 01:00 UTC
}

// Returns a short human-readable "fires at …" label in local time for a given TF.
function getBeatLocalLabel(tf: TFKey): string {
  const toLocal = (h: number) => (h + LOCAL_OFFSET_H + 24) % 24
  const fmtH    = (h: number) => String(toLocal(h)).padStart(2, '0')
  if (tf === '15m') return 'every 15 min'
  if (tf === '1h')  return 'every :00'
  if (tf === '4h')  return '6×/day'
  if (tf === '1d')  return `daily ${fmtH(0)}:00 local`
  // 1w: Mon 01:00 UTC — may shift to adjacent day depending on timezone
  const localHRaw = 1 + LOCAL_OFFSET_H
  const dayShift  = localHRaw >= 24 ? 1 : localHRaw < 0 ? -1 : 0
  const dayNames  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return `${dayNames[((dayShift) % 7 + 7) % 7]} ${fmtH(1)}:00 local`
}

// Per-TF presets: human-readable frequency labels + market sessions
function getTFPresets(tf: TFKey): Array<{ label: string; hoursUtc: number[] }> {
  const sessions = [
    { label: 'Asia',   hoursUtc: [0,1,2,3,4,5,6,7,8] },
    { label: 'Europe', hoursUtc: [7,8,9,10,11,12,13,14,15,16] },
    { label: 'US',     hoursUtc: [13,14,15,16,17,18,19,20,21,22] },
  ]
  if (tf === '15m') return [
    { label: 'Every 2h',  hoursUtc: [0,2,4,6,8,10,12,14,16,18,20,22] },
    { label: 'Every 4h',  hoursUtc: [0,4,8,12,16,20] },
    { label: 'Every 6h',  hoursUtc: [0,6,12,18] },
    { label: 'Every 8h',  hoursUtc: [0,8,16] },
    { label: 'Every 12h', hoursUtc: [0,12] },
    ...sessions,
  ]
  if (tf === '1h') return [
    { label: 'Every 2h',  hoursUtc: [0,2,4,6,8,10,12,14,16,18,20,22] },
    { label: 'Every 4h',  hoursUtc: [0,4,8,12,16,20] },
    { label: 'Every 6h',  hoursUtc: [0,6,12,18] },
    { label: 'Every 8h',  hoursUtc: [0,8,16] },
    { label: 'Every 12h', hoursUtc: [0,12] },
    { label: 'Once/day',  hoursUtc: [0] },
    ...sessions,
  ]
  if (tf === '4h') return [
    { label: 'Every 8h',  hoursUtc: [0,8,16] },
    { label: 'Every 12h', hoursUtc: [0,12] },
    { label: 'Once/day',  hoursUtc: [0] },
    ...sessions,
  ]
  if (tf === '1d') return [
    { label: 'Every day', hoursUtc: [] },
    ...sessions,
  ]
  return []
}
const pct = (v: number) => Math.round(v * 100)
const tfSum = (w: TFWeights) => TFS.reduce((s, tf) => s + pct(w[tf] ?? 0), 0)

const REGIME_ROWS: { key: keyof RegimesCfg; label: string; cls: string }[] = [
  { key: 'dead_max',     label: 'DEAD max',     cls: 'text-slate-400' },
  { key: 'calm_max',     label: 'CALM max',     cls: 'text-blue-400' },
  { key: 'normal_max',   label: 'NORMAL max',   cls: 'text-emerald-400' },
  { key: 'trending_max', label: 'TRENDING max', cls: 'text-indigo-400' },
  { key: 'active_max',   label: 'ACTIVE max',   cls: 'text-amber-400' },
]

const SCHED_REGIME_KEYS = ['DEAD', 'CALM', 'NORMAL', 'TRENDING', 'ACTIVE', 'EXTREME'] as const
const SCHED_REGIME_COLOR: Record<string, string> = {
  DEAD: '#a1a1aa', CALM: '#38bdf8', NORMAL: '#34d399',
  TRENDING: '#eab308', ACTIVE: '#f97316', EXTREME: '#ef4444',
}
const SCHED_REGIME_EMOJI: Record<string, string> = {
  DEAD: '⬜', CALM: '💧', NORMAL: '✅', TRENDING: '📈', ACTIVE: '⚡', EXTREME: '�',
}

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

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'market-vi' | 'per-pair' | 'schedules' | 'regimes'

export function VolatilitySettingsPage() {
  const { activeProfileId: profileId } = useProfile()
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [tab,     setTab]     = useState<Tab>('market-vi')
  const { saving, saved, saveErr, wrapSave, reset: resetSave } = useSaveState()

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
    await wrapSave(async () => {
      const patch =
        tab === 'market-vi'  ? { market_vi: mvi }
        : tab === 'regimes'  ? { regimes: reg }
        : tab === 'schedules' ? { per_pair: pp, market_vi: mvi }
        : { per_pair: pp }
      await volatilityApi.updateSettings(profileId, patch)
    })
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

  // Toggle an active day (0=Mon … 6=Sun)
  const toggleDay = (tf: TFKey, d: number) => {
    const cur = getSched(tf).days
    setSched(tf, { days: cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d].sort() })
  }

  // Toggle a weekday execution hour (0–23) — empty = all hours
  const toggleExecHour = (tf: TFKey, h: number) => {
    const cur = getSched(tf).execution_hours
    setSched(tf, {
      execution_hours: cur.includes(h)
        ? cur.filter(x => x !== h)
        : [...cur, h].sort((a, b) => a - b),
    })
  }

  // Toggle a weekend execution hour (0–23) — empty = all hours
  const toggleExecHourWeekend = (tf: TFKey, h: number) => {
    const cur = getSched(tf).weekend_execution_hours
    setSched(tf, {
      weekend_execution_hours: cur.includes(h)
        ? cur.filter(x => x !== h)
        : [...cur, h].sort((a, b) => a - b),
    })
  }

  // Toggle a regime filter — empty = all regimes allowed
  const toggleSchedRegime = (tf: TFKey, r: string) => {
    const cur = getSched(tf).regime_filter
    setSched(tf, {
      regime_filter: cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r],
    })
  }

  const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

  // Weekday / Weekend tab state per TF — tracks which half of exec hours is visible
  const [execTab, setExecTab] = useState<Partial<Record<TFKey, 'wd' | 'we'>>>({})
  const getExecTab = (tf: TFKey) => execTab[tf] ?? 'wd'

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
            onClick={() => { setTab(id); resetSave() }}
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
                <span className="text-sm text-slate-300">Binance pairs count</span>
                <p className="text-xs text-slate-600 mt-0.5">Number of Binance Futures pairs used to compute Market VI (by 24h volume rank)</p>
              </div>
              <select
                value={mvi.pairs_count}
                onChange={e => setMVI(p => ({ ...p, pairs_count: Number(e.target.value) }))}
                className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500/60"
              >
                {[10, 20, 30, 50, 75, 100].map(v => (
                  <option key={v} value={v}>{v} pairs</option>
                ))}
              </select>
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
                <span className="text-sm text-slate-300">History retention</span>
                <p className="text-xs text-slate-600 mt-0.5">Market VI snapshots retention</p>
              </div>
              <select
                value={mvi.retention_days}
                onChange={e => setMVI(p => ({ ...p, retention_days: Number(e.target.value) }))}
                className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500/60"
              >
                {[30, 60, 90, 180, 365].map(v => (
                  <option key={v} value={v}>{v} days</option>
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

            {/* Anchor pair weights */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Anchor pair weights
              </p>
              <p className="text-xs text-slate-600 mt-0.5 mb-3">
                Fixed weight for BTC &amp; ETH. The remaining percentage is shared equally
                among all other selected pairs. Set to 0 to use equal weights.
              </p>
              <div className="space-y-2">
                {MVI_ANCHOR_PAIRS.map(sym => {
                  const pct = Math.round((mvi.weights[sym] ?? 0) * 100)
                  return (
                    <div key={sym} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300 font-mono">{sym}</span>
                      <div className="flex items-center gap-2">
                        {pct === 0 && (
                          <span className="text-xs text-slate-600 tabular-nums">
                            = ~{(100 / mvi.pairs_count).toFixed(1)}% equal
                          </span>
                        )}
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={pct}
                          onChange={e => {
                            const v = Math.max(0, Math.min(99, Number(e.target.value)))
                            setMVI(p => ({
                              ...p,
                              weights: v === 0
                                ? Object.fromEntries(Object.entries(p.weights).filter(([k]) => k !== sym))
                                : { ...p.weights, [sym]: v / 100 },
                            }))
                          }}
                          className="w-16 bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-brand-500/60"
                        />
                        <span className="text-xs text-slate-500">%</span>
                      </div>
                    </div>
                  )
                })}
                {/* Remaining weight row */}
                {(() => {
                  const anchoredTotal = Object.values(mvi.weights).reduce((a, v) => a + v, 0)
                  const remaining = Math.max(0, 1 - anchoredTotal)
                  const configuredCount = Object.keys(mvi.weights).filter(k => (mvi.weights[k] ?? 0) > 0).length
                  const othersCount = Math.max(0, mvi.pairs_count - configuredCount)
                  const perPair = othersCount > 0 ? remaining / othersCount : 0
                  return (
                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1.5 border-t border-surface-700/60 mt-1">
                      <span>Other {othersCount} pair{othersCount !== 1 ? 's' : ''}</span>
                      <span className="tabular-nums">
                        {(perPair * 100).toFixed(1)}% each · {(remaining * 100).toFixed(0)}% total
                      </span>
                    </div>
                  )
                })()}
                {Object.values(mvi.weights).reduce((a, v) => a + v, 0) > 1.0 && (
                  <p className="text-xs text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle size={12} /> Anchor weights exceed 100% — engine will normalise
                  </p>
                )}
                {Object.keys(mvi.weights).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMVI(p => ({ ...p, weights: {} }))}
                    className="text-xs text-slate-500 hover:text-slate-300 underline mt-1"
                  >
                    Reset to equal weights
                  </button>
                )}
              </div>
            </div>

            <hr className="border-surface-700" />

            {/* Indicator weights */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Indicator Weights
              </p>
              <p className="text-xs text-slate-600 mt-0.5 mb-3">
                Relative weight of each indicator in the VI score. Weights are renormalized automatically when indicators are disabled.
              </p>
              <div className="space-y-2">
                {([
                  { key: 'rvol',     label: 'RVOL' },
                  { key: 'mfi',      label: 'MFI'  },
                  { key: 'atr',      label: 'ATR'  },
                  { key: 'bb_width', label: 'BB'   },
                ] as { key: keyof typeof D_MVI['indicator_weights']; label: string }[]).map(({ key, label }) => {
                  const pct = Math.round((mvi.indicator_weights[key] ?? D_MVI.indicator_weights[key]) * 100)
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300 font-mono">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min={0} max={100} step={5} value={pct}
                          onChange={e => {
                            const v = Math.min(100, Math.max(0, Number(e.target.value))) / 100
                            setMVI(p => ({ ...p, indicator_weights: { ...p.indicator_weights, [key]: v } }))
                          }}
                          className="w-16 bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-brand-500/60"
                        />
                        <span className="text-xs text-slate-500">%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {Math.round(Object.values(mvi.indicator_weights).reduce((a, v) => a + v, 0) * 100) !== 100 && (
                <p className="text-xs text-amber-400 mt-2">
                  Total: {Math.round(Object.values(mvi.indicator_weights).reduce((a, v) => a + v, 0) * 100)}% — weights will be renormalized automatically.
                </p>
              )}
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
            saveErr={saveErr}
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

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                Indicator Weights
              </p>
              <p className="text-xs text-slate-600 mt-0.5 mb-3">
                Relative weight of each indicator in the VI score. Weights are renormalized automatically when indicators are disabled.
              </p>
              <div className="space-y-2">
                {([
                  { key: 'rvol',     label: 'RVOL'  },
                  { key: 'mfi',      label: 'MFI'   },
                  { key: 'atr',      label: 'ATR'   },
                  { key: 'bb_width', label: 'BB'    },
                ] as { key: keyof typeof D_PP['indicator_weights']; label: string }[]).map(({ key, label }) => {
                  const pct = Math.round((pp.indicator_weights[key] ?? D_PP.indicator_weights[key]) * 100)
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300 font-mono">{label}</span>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" min={0} max={100} step={5} value={pct}
                          onChange={e => {
                            const v = Math.min(100, Math.max(0, Number(e.target.value))) / 100
                            setPP(p => ({ ...p, indicator_weights: { ...p.indicator_weights, [key]: v } }))
                          }}
                          className="w-16 bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-2 py-1.5 text-right focus:outline-none focus:border-brand-500/60"
                        />
                        <span className="text-xs text-slate-500">%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {Math.round(Object.values(pp.indicator_weights).reduce((a, v) => a + v, 0) * 100) !== 100 && (
                <p className="text-xs text-amber-400 mt-2">
                  Total: {Math.round(Object.values(pp.indicator_weights).reduce((a, v) => a + v, 0) * 100)}% — weights will be renormalized automatically.
                </p>
              )}
            </div>

            <hr className="border-surface-700" />

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                EMA Reference per TF
                <Tooltip
                  text="Reference EMA used per timeframe to detect breakout and retest signals (price crosses above/below this EMA). Configure each TF independently. Does not affect the VI score computation."
                  maxWidth={280}
                />
              </p>
              <p className="text-xs text-slate-600 mt-0.5 mb-3">
                Used for per-pair breakout / retest signal detection only — not for Market VI computation.
              </p>
              <div className="space-y-2">
                {(['15m', '1h', '4h', '1d', '1w'] as TFKey[]).map(tf => (
                  <div key={tf} className="flex items-center justify-between">
                    <span className="text-sm text-slate-300 font-mono">{tf}</span>
                    <select
                      value={pp.ema_ref_periods[tf] ?? D_PP.ema_ref_periods[tf]}
                      onChange={e => setPP(p => ({ ...p, ema_ref_periods: { ...p.ema_ref_periods, [tf]: Number(e.target.value) } }))}
                      className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500/60"
                    >
                      {[10, 21, 55, 99, 200].map(v => (
                        <option key={v} value={v}>EMA {v}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <hr className="border-surface-700" />

            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                EMA Retest Tolerance per TF
                <Tooltip
                  text="Maximum % distance from the reference EMA to classify a candle close as a retest (retest_up / retest_down signal). Higher timeframes need wider tolerance — a 1W candle can close 3% from the EMA and still be a valid retest visually."
                  maxWidth={300}
                />
              </p>
              <p className="text-xs text-slate-600 mt-0.5 mb-3">
                Increase for higher TFs to match what you see on the chart.
              </p>
              <div className="space-y-2">
                {(['15m', '1h', '4h', '1d', '1w'] as TFKey[]).map(tf => {
                  const frac = pp.ema_retest_tolerance[tf] ?? D_PP.ema_retest_tolerance[tf] ?? 0.005
                  return (
                    <div key={tf} className="flex items-center justify-between">
                      <span className="text-sm text-slate-300 font-mono">{tf}</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0.1}
                          max={10}
                          step={0.1}
                          value={Math.round(frac * 1000) / 10}
                          onChange={e => setPP(p => ({ ...p, ema_retest_tolerance: { ...p.ema_retest_tolerance, [tf]: Number(e.target.value) / 100 } }))}
                          className="w-20 bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 text-right focus:outline-none focus:border-brand-500/60"
                        />
                        <span className="text-xs text-slate-500">%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <hr className="border-surface-700" />

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm text-slate-300">Snapshot retention</span>
                <p className="text-xs text-slate-600 mt-0.5">Days to keep per-pair &amp; watchlist snapshots in DB</p>
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
            saveErr={saveErr}
            onSave={() => void save()}
          />
        </div>
      )}

      {/* ── Schedules ──────────────────────────────────────────────────────── */}
      {tab === 'schedules' && (
        <div className="space-y-4 max-w-2xl">
          {/* Description */}
          <p className="text-xs text-slate-500">
            Per timeframe: weekday and weekend execution hours, active days, regime, and VI filter.
            Leave <span className="font-mono text-slate-400">exec hours</span> or{' '}
            <span className="font-mono text-slate-400">days</span> empty for no restriction.
            Weekday and weekend hours are independent. Hours shown in local time, stored as UTC.
            The VI and regime filters apply to the current score <em>before</em> launching the computation.
          </p>

          {/* ── Market VI global schedule ───────────────────────────────── */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-surface-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-bold text-slate-200 uppercase">Market VI</span>
                <span className="text-[10px] text-slate-600 bg-surface-700 px-1.5 py-0.5 rounded">global</span>
              </div>
              <Toggle on={mvi.enabled} onChange={v => setMVI(p => ({ ...p, enabled: v }))} label="Enable Market VI" />
            </div>
            <div className={cn('px-5 py-4 space-y-4 transition-opacity', !mvi.enabled && 'opacity-40 pointer-events-none')}>
              {/* Beat schedule — read-only, code-controlled */}
              <div className="flex items-start gap-4">
                <span className="text-xs text-slate-400 w-28 shrink-0 pt-0.5">Freq (beat)</span>
                <div className="flex-1 space-y-1">
                  {([
                    { tf: '15m', label: 'every 15 min' },
                    { tf: '1h',  label: 'every 1 h' },
                    { tf: '4h',  label: 'every 4 h' },
                    { tf: '1d',  label: 'daily  00:00 UTC' },
                    { tf: '1w',  label: 'weekly Mon 01:00 UTC' },
                  ] as const).map(({ tf, label }) => (
                    <div key={tf} className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-slate-400 w-8">{tf}</span>
                      <span className="text-[11px] text-slate-600">{label}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-700 pt-0.5">
                    Aggregated score recalculated after each TF — fastest: 15 min.
                    Frequency is code-controlled (celery_app.py).
                  </p>
                </div>
              </div>
              {/* Weekdays only */}
              <div className="flex items-center gap-4">
                <span className="text-xs text-slate-400 w-28 shrink-0">Weekdays only</span>
                <Toggle
                  on={mvi.weekdays_only}
                  onChange={v => setMVI(p => ({ ...p, weekdays_only: v }))}
                  label="Skip weekends"
                />
                {mvi.weekdays_only && (
                  <span className="text-[10px] text-amber-400/80">Sat &amp; Sun skipped</span>
                )}
              </div>
            </div>
          </div>

          {/* ── Per-pair TF cards ───────────────────────────────────────── */}
          {SCHED_TFS.map(tf => {
            const s = getSched(tf)
            const onWeTab  = getExecTab(tf) === 'we'
            const curHours = onWeTab ? s.weekend_execution_hours : s.execution_hours
            return (
              <div key={tf} className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
                {/* TF label + enable toggle */}
                <div className="px-5 py-3 border-b border-surface-700 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-mono font-bold text-slate-200 uppercase">{tf}</span>
                    <span className="text-[10px] text-slate-600 tracking-wide">{getBeatLocalLabel(tf)}</span>
                  </div>
                  <Toggle on={s.enabled} onChange={v => setSched(tf, { enabled: v })} label={`Enable ${tf}`} />
                </div>

                <div className={cn('px-5 py-4 space-y-4 transition-opacity', !s.enabled && 'opacity-40 pointer-events-none')}>

                  {/* ── Execution hours ─────────────────────────────────────────────────── */}
                  <div className="flex items-start gap-4">
                    <span className="text-xs text-slate-400 w-28 shrink-0 pt-2">Exec hours</span>
                    <div className="flex-1 space-y-2">

                      {/* Sub-hour interval — 15m only */}
                      {tf === '15m' && (
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500 tracking-wide shrink-0">Sub-interval</span>
                          <div className="flex gap-px bg-surface-700 p-0.5 rounded-lg">
                            {([15, 30] as const).map(min => {
                              const active = (s.execution_interval_minutes ?? 15) === min
                              return (
                                <button
                                  key={min}
                                  type="button"
                                  onClick={() => setSched(tf, { execution_interval_minutes: min === 15 ? undefined : min })}
                                  className={cn(
                                    'px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
                                    active
                                      ? 'bg-brand-600/25 text-brand-300 shadow-sm'
                                      : 'text-slate-600 hover:text-slate-400',
                                  )}
                                >
                                  {min}min
                                </button>
                              )
                            })}
                          </div>
                          <span className="text-[10px] text-slate-600">
                            {!s.execution_interval_minutes || s.execution_interval_minutes === 15
                              ? 'every candle'
                              : `once every ${s.execution_interval_minutes}min`}
                          </span>
                        </div>
                      )}

                      {/* Tab pills: Weekday / Weekend */}
                      <div className="flex gap-px bg-surface-700 p-0.5 rounded-lg w-fit">
                        {(['wd', 'we'] as const).map(t => {
                          const tabHours = t === 'wd' ? s.execution_hours : s.weekend_execution_hours
                          const isActive = getExecTab(tf) === t
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setExecTab(p => ({ ...p, [tf]: t }))}
                              className={cn(
                                'flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-all',
                                isActive
                                  ? t === 'wd'
                                    ? 'bg-brand-600/25 text-brand-300 shadow-sm'
                                    : 'bg-violet-600/25 text-violet-300 shadow-sm'
                                  : 'text-slate-600 hover:text-slate-400',
                              )}
                            >
                              {t === 'wd' ? 'Mo–Fr' : 'Sa–Su'}
                              {tabHours.length > 0 && (
                                <span className="text-[9px] opacity-60">{tabHours.length}h</span>
                              )}
                            </button>
                          )
                        })}
                      </div>

                      {/* 24-button hour grid — local time display, UTC stored */}
                      <div className="flex flex-wrap gap-1">
                        {Array.from({ length: 24 }, (_, localH) => {
                          const utcH = (localH - LOCAL_OFFSET_H + 24) % 24
                          const sel  = curHours.length === 0 || curHours.includes(utcH)
                          return (
                            <button
                              key={localH}
                              type="button"
                              onClick={() => onWeTab ? toggleExecHourWeekend(tf, utcH) : toggleExecHour(tf, utcH)}
                              title={curHours.length === 0
                                ? `${localH}:00 — all hours active`
                                : `${localH}:00 local · UTC ${String(utcH).padStart(2, '0')}:00`}
                              className={cn(
                                'w-7 h-6 rounded text-[10px] font-mono border transition-all',
                                sel
                                  ? onWeTab
                                    ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                                    : 'bg-brand-600/20 border-brand-500/40 text-brand-300'
                                  : 'bg-surface-700 border-surface-600 text-slate-600 hover:border-surface-500',
                                curHours.length === 0 && 'opacity-30',
                              )}
                            >
                              {localH}
                            </button>
                          )
                        })}
                      </div>

                      {/* Presets + reset + copy */}
                      <div className="flex flex-wrap gap-1">
                        {getTFPresets(tf).map(p => (
                          <button
                            key={p.label}
                            type="button"
                            onClick={() => onWeTab
                              ? setSched(tf, { weekend_execution_hours: p.hoursUtc })
                              : setSched(tf, { execution_hours: p.hoursUtc })
                            }
                            className={cn(
                              'text-[10px] border px-2 py-0.5 rounded transition-colors',
                              onWeTab
                                ? 'text-slate-500 hover:text-violet-400 border-surface-600 hover:border-violet-600/40'
                                : 'text-slate-500 hover:text-brand-400 border-surface-600 hover:border-brand-600/40',
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                        {curHours.length > 0 && (
                          <button
                            type="button"
                            onClick={() => onWeTab
                              ? setSched(tf, { weekend_execution_hours: [] })
                              : setSched(tf, { execution_hours: [] })
                            }
                            className="text-[10px] text-slate-600 hover:text-slate-400 border border-surface-700 px-2 py-0.5 rounded"
                          >
                            All hours
                          </button>
                        )}
                        {onWeTab && (
                          <button
                            type="button"
                            onClick={() => setSched(tf, { weekend_execution_hours: [...s.execution_hours] })}
                            className="text-[10px] text-slate-500 hover:text-slate-300 border border-surface-600 hover:border-surface-500 px-2 py-0.5 rounded"
                          >
                            ← Same as Mo–Fr
                          </button>
                        )}
                      </div>

                      {/* Status hint — shows beat label or blocked warning */}
                      {(() => {
                        const beatHours = TF_BEAT_UTC[tf]
                        const beatBlocked = beatHours != null
                          && curHours.length > 0
                          && !beatHours.some(h => curHours.includes(h))
                        if (beatBlocked) {
                          return (
                            <p className="text-[10px] text-amber-500/80 flex items-center gap-1">
                              ⚠ Beat fires {getBeatLocalLabel(tf)} — not in your filter
                            </p>
                          )
                        }
                        return (
                          <p className="text-[10px] text-slate-700">
                            {curHours.length === 0
                              ? `All hours · fires ${getBeatLocalLabel(tf)}`
                              : `${curHours.length} UTC hour${curHours.length > 1 ? 's' : ''} selected`}
                          </p>
                        )
                      })()}

                    </div>
                  </div>

                  {/* ── Active days ── */}
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-slate-400 w-28 shrink-0">Active days</span>
                    <div className="flex gap-1.5">
                      {DAY_LABELS.map((d, i) => {
                        const selected = s.days.includes(i)
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => toggleDay(tf, i)}
                            title={s.days.length === 0 ? 'All days (click to exclude)' : ''}
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

                  {/* ── Regime filter — skip compute if regime not in selected list ── */}
                  <div className="flex items-start gap-4">
                    <span className="text-xs text-slate-400 w-28 shrink-0 pt-0.5">Regime filter</span>
                    <div className="flex-1 space-y-1.5">
                      <div className="flex flex-wrap gap-1">
                        {SCHED_REGIME_KEYS.map(r => {
                          const sel = s.regime_filter.includes(r)
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => toggleSchedRegime(tf, r)}
                              className={cn(
                                'px-2 py-0.5 rounded text-[10px] font-mono border transition-all',
                                sel
                                  ? 'bg-surface-700 border-surface-600 text-slate-100'
                                  : 'bg-surface-800 border-surface-700 text-slate-600 hover:border-surface-500',
                              )}
                              style={sel ? { color: SCHED_REGIME_COLOR[r] } : {}}
                            >
                              {SCHED_REGIME_EMOJI[r]} {r}
                            </button>
                          )
                        })}
                        {s.regime_filter.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSched(tf, { regime_filter: [] })}
                            className="text-[10px] text-slate-600 hover:text-slate-400 border border-surface-700 px-1.5 py-0.5 rounded"
                          >
                            reset (all)
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-700">
                        {s.regime_filter.length === 0
                          ? 'All regimes — no restriction'
                          : `Only runs when regime is: ${s.regime_filter.join(', ')}`}
                      </p>
                    </div>
                  </div>

                  {/* ── VI filter — skip compute if current score is out of range ── */}
                  <div className="flex items-start gap-4">
                    <span className="text-xs text-slate-400 w-28 shrink-0 pt-1">VI filter</span>
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

          <SaveBar saving={saving} saved={saved} saveErr={saveErr} onSave={() => void save()} />
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
            <div className="bg-indigo-500"  style={{ width: `${(trending_max - normal_max) * 100}%` }} />
            <div className="bg-amber-400"   style={{ width: `${(active_max - trending_max) * 100}%` }} />
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
            saveErr={saveErr}
            disabled={!regOk}
            onSave={() => void save()}
          />
        </div>
      )}
    </div>
  )
}
