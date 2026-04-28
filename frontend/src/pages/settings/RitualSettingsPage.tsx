// ── Ritual Settings Page ────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Loader2, RefreshCw, CheckCircle2,
  Pencil, Save, X, Settings, Layers, Plus,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { ritualApi } from '../../lib/api'
import type { RitualStep, RitualSettings } from '../../types/api'
import { cn } from '../../lib/cn'

// ── Constants ─────────────────────────────────────────────────────────────────
const SESSION_TYPES = [
  {
    type: 'weekly_setup',
    emoji: '📅',
    label: 'Weekly Setup',
    desc: 'Monday — Market Analysis + Full Watchlist (1W/1D/4H/1H/15m) → Pin key pairs',
    est: '~45 min',
  },
  {
    type: 'trade_session',
    emoji: '🎯',
    label: 'Trade Session',
    desc: 'Trading window — VI check + Pinned pairs + WL (1D→15m) → Log outcome',
    est: '~30 min',
  },
  {
    type: 'weekend_review',
    emoji: '📊',
    label: 'Weekend Review',
    desc: 'Sat/Sun — Analytics + Trade Journal + Goals + Learning note',
    est: '~35 min',
  },
] as const

type SessionKey = (typeof SESSION_TYPES)[number]['type']

const AVAILABLE_TFS = ['1W', '1D', '4H', '1H', '15m'] as const

const TF_COLORS: Record<string, string> = {
  '1W': 'text-purple-400 border-purple-700/40 bg-purple-900/20',
  '1D': 'text-blue-400 border-blue-700/40 bg-blue-900/20',
  '4H': 'text-cyan-400 border-cyan-700/40 bg-cyan-900/20',
  '1H': 'text-green-400 border-green-700/40 bg-green-900/20',
  '15m': 'text-amber-400 border-amber-700/40 bg-amber-900/20',
}

function TFBadge({ tf }: { tf: string }) {
  return (
    <span className={cn(
      'text-[10px] px-1.5 py-0.5 rounded border font-medium',
      TF_COLORS[tf] ?? 'text-slate-400 border-slate-700 bg-slate-900/20',
    )}>
      {tf}
    </span>
  )
}

// ── Suggested market context pairs (for config UI) ────────────────────────────
const SUGGESTED_CONTEXT_PAIRS: { symbol: string; label: string; category: string }[] = [
  // Market Structure
  { symbol: 'CRYPTOCAP:BTC.D',    label: 'BTC Dominance',      category: 'Market Structure' },
  { symbol: 'CRYPTOCAP:TOTAL',    label: 'Total Market Cap',   category: 'Market Structure' },
  { symbol: 'CRYPTOCAP:TOTAL2',   label: 'Total (no BTC)',     category: 'Market Structure' },
  { symbol: 'CRYPTOCAP:USDT.D',   label: 'USDT Dominance',     category: 'Market Structure' },
  { symbol: 'CRYPTOCAP:OTHERS.D', label: 'Alts Dominance',     category: 'Market Structure' },
  { symbol: 'CRYPTOCAP:TOTAL3',   label: 'Total (no BTC+ETH)', category: 'Market Structure' },
  // Spot — Binance
  { symbol: 'BINANCE:BTCUSDT',    label: 'BTC/USDT',           category: 'Spot — Binance' },
  { symbol: 'BINANCE:ETHUSDT',    label: 'ETH/USDT',           category: 'Spot — Binance' },
  { symbol: 'BINANCE:ETHBTC',     label: 'ETH/BTC',            category: 'Spot — Binance' },
  { symbol: 'BINANCE:SOLUSDT',    label: 'SOL/USDT',           category: 'Spot — Binance' },
  { symbol: 'BINANCE:BNBUSDT',    label: 'BNB/USDT',           category: 'Spot — Binance' },
  { symbol: 'BINANCE:XRPUSDT',    label: 'XRP/USDT',           category: 'Spot — Binance' },
  // Spot — Kraken
  { symbol: 'KRAKEN:XBTUSD',      label: 'BTC/USD',            category: 'Spot — Kraken' },
  { symbol: 'KRAKEN:ETHUSD',      label: 'ETH/USD',            category: 'Spot — Kraken' },
  { symbol: 'KRAKEN:SOLUSD',      label: 'SOL/USD',            category: 'Spot — Kraken' },
  // Sector
  { symbol: 'CRYPTOCAP:DEFI',     label: 'DeFi Cap',           category: 'Sector' },
  { symbol: 'CRYPTOCAP:NFT',      label: 'NFT Cap',            category: 'Sector' },
]

// ── Types ─────────────────────────────────────────────────────────────────────
type StepEditDraft = {
  label: string
  est_minutes: number | null
  is_mandatory: boolean
  timeframes: string[]
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function RitualSettingsPage() {
  const { activeProfileId: profileId } = useProfile()

  type Tab = 'templates' | 'config'
  const [activeTab, setActiveTab] = useState<Tab>('templates')

  // Data state
  const [stepsMap, setStepsMap] = useState<Record<string, RitualStep[]>>({})
  const [loading, setLoading]   = useState(true)
  const [settings, setSettings] = useState<RitualSettings | null>(null)
  const [topNLocal, setTopNLocal] = useState<Record<string, number>>({})

  // Action state
  const [savingTopN, setSavingTopN]   = useState(false)
  const [resetting, setResetting]     = useState<string | null>(null)
  const [resetDone, setResetDone]     = useState<string | null>(null)

  // Inline step edit state
  const [editDrafts, setEditDrafts]   = useState<Record<number, StepEditDraft | null>>({})
  const [savingStep, setSavingStep]   = useState<number | null>(null)

  // Cascade scoring — smart_filter
  const DEFAULT_WEIGHTS: Record<string, number> = { '1W': 4.0, '1D': 3.0, '4H': 2.0, '1H': 1.0, '15m': 0.5 }
  const [weights, setWeights]                 = useState<Record<string, number>>(DEFAULT_WEIGHTS)
  const [trendBonus, setTrendBonus]           = useState(1.2)
  const [emaBonusThreshold, setEmaBonusThreshold] = useState(70)
  const [emaBonusFactor, setEmaBonusFactor]   = useState(1.1)
  const [savingWeights, setSavingWeights]     = useState(false)
  const [weightsSaved, setWeightsSaved]       = useState(false)

  // Market context pairs
  const [marketPairs, setMarketPairs]     = useState<string[]>([])
  const [savingPairs, setSavingPairs]     = useState(false)
  const [pairsSaved, setPairsSaved]       = useState(false)
  const [customSymbol, setCustomSymbol]   = useState('')

  // ── Load all ────────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    try {
      const [settingsData, ...stepsArrays] = await Promise.all([
        ritualApi.getSettings(profileId),
        ...SESSION_TYPES.map(t => ritualApi.getSteps(profileId, t.type)),
      ])
      setSettings(settingsData)
      const map: Record<string, RitualStep[]> = {}
      SESSION_TYPES.forEach((t, i) => { map[t.type] = stepsArrays[i] })
      setStepsMap(map)
      const tnMap = ((settingsData.config?.top_n) as Record<string, number>) ?? {}
      setTopNLocal(tnMap)
      const sf = (settingsData.config?.smart_filter as Record<string, unknown>) ?? {}
      setWeights((sf.weights as Record<string, number>) ?? DEFAULT_WEIGHTS)
      setTrendBonus((sf.trend_bonus as number) ?? 1.2)
      setEmaBonusThreshold((sf.ema_bonus_threshold as number) ?? 70)
      setEmaBonusFactor((sf.ema_bonus_factor as number) ?? 1.1)
      setMarketPairs((settingsData.config?.market_analysis_pairs as string[]) ?? [])
    } finally {
      setLoading(false)
    }
  }, [profileId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadAll() }, [loadAll])

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleReset = async (sessionType: string) => {
    if (!profileId) return
    setResetting(sessionType)
    try {
      const newSteps = await ritualApi.resetSteps(profileId, sessionType)
      setStepsMap(prev => ({ ...prev, [sessionType]: newSteps }))
      setEditDrafts({})
      setResetDone(sessionType)
      setTimeout(() => setResetDone(null), 2500)
    } finally {
      setResetting(null)
    }
  }

  const updateTopN = async (type: string, value: number) => {
    if (!profileId) return
    const newTopN = { ...topNLocal, [type]: value }
    setTopNLocal(newTopN)
    setSavingTopN(true)
    try {
      const cfg = settings?.config ?? {}
      const updated = await ritualApi.updateSettings(profileId, { ...cfg, top_n: newTopN })
      setSettings(updated)
    } finally {
      setSavingTopN(false)
    }
  }

  const saveWeights = async () => {
    if (!profileId) return
    setSavingWeights(true)
    try {
      const cfg = settings?.config ?? {}
      const sf = (cfg.smart_filter as Record<string, unknown>) ?? {}
      const updated = await ritualApi.updateSettings(profileId, {
        ...cfg,
        smart_filter: {
          ...sf,
          weights,
          trend_bonus: trendBonus,
          ema_bonus_threshold: emaBonusThreshold,
          ema_bonus_factor: emaBonusFactor,
        },
      })
      setSettings(updated)
      setWeightsSaved(true)
      setTimeout(() => setWeightsSaved(false), 2000)
    } finally {
      setSavingWeights(false)
    }
  }

  const saveMarketPairs = async (pairs: string[]) => {
    if (!profileId) return
    setSavingPairs(true)
    try {
      const cfg = settings?.config ?? {}
      const updated = await ritualApi.updateSettings(profileId, { ...cfg, market_analysis_pairs: pairs })
      setSettings(updated)
      setPairsSaved(true)
      setTimeout(() => setPairsSaved(false), 1500)
    } finally {
      setSavingPairs(false)
    }
  }

  const toggleMarketPair = (symbol: string) => {
    const next = marketPairs.includes(symbol)
      ? marketPairs.filter(s => s !== symbol)
      : [...marketPairs, symbol]
    setMarketPairs(next)
    void saveMarketPairs(next)
  }

  const addCustomPair = () => {
    const s = customSymbol.trim().toUpperCase()
    if (!s || marketPairs.includes(s)) return
    setCustomSymbol('')
    const next = [...marketPairs, s]
    setMarketPairs(next)
    void saveMarketPairs(next)
  }

  const startEdit = (step: RitualStep) => {
    setEditDrafts(prev => ({
      ...prev,
      [step.id]: {
        label: step.label,
        est_minutes: step.est_minutes,
        is_mandatory: step.is_mandatory,
        timeframes: (step.config?.timeframes as string[]) ?? [],
      },
    }))
  }

  const cancelEdit = (stepId: number) => {
    setEditDrafts(prev => { const n = { ...prev }; delete n[stepId]; return n })
  }

  const saveStep = async (step: RitualStep, sessionType: string) => {
    if (!profileId) return
    const draft = editDrafts[step.id]
    if (!draft) return
    setSavingStep(step.id)
    try {
      const payload: Partial<RitualStep> = {
        label: draft.label,
        est_minutes: draft.est_minutes,
        is_mandatory: draft.is_mandatory,
      }
      if (step.step_type === 'smart_wl') {
        payload.config = { ...step.config, timeframes: draft.timeframes }
      }
      const updated = await ritualApi.updateStep(profileId, step.id, payload)
      setStepsMap(prev => ({
        ...prev,
        [sessionType]: (prev[sessionType] ?? []).map(s => s.id === step.id ? updated : s),
      }))
      cancelEdit(step.id)
    } finally {
      setSavingStep(null)
    }
  }

  // ── Guard ────────────────────────────────────────────────────────────────────
  if (!profileId) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-slate-500">No profile selected.</p>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

      {/* Back link + header */}
      <div className="flex items-start gap-3">
        <Link to="/settings" className="mt-1 text-slate-500 hover:text-slate-300 transition-colors shrink-0">
          <ArrowLeft size={16} />
        </Link>
        <PageHeader
          icon="🗓️"
          title="Ritual Settings"
          subtitle="Configure session step templates and Smart Watchlist algorithm."
        />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-surface-800 border border-surface-700 rounded-xl p-1 w-fit">
        {([
          ['templates', Layers,   'Step Templates'],
          ['config',   Settings,  'Configuration'],
        ] as const).map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all',
              activeTab === tab
                ? 'bg-surface-700 text-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Loading ── */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-slate-500">
          <Loader2 size={14} className="animate-spin" />
          <span className="text-sm">Loading settings…</span>
        </div>
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════════════════────
              TAB: STEP TEMPLATES
          ══════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'templates' && (
            <div className="space-y-4">
              {/* Intro card */}
              <div className="rounded-xl border border-surface-700 bg-surface-800/30 px-5 py-4">
                <p className="text-sm text-slate-400 leading-relaxed">
                  Each session type has a <strong className="text-slate-300">step template</strong> — the ordered sequence of tasks performed during that session.
                  Hover any step and click <span className="inline-flex items-center gap-0.5 text-brand-400"><Pencil size={10} /> (pencil)</span> to edit it.
                  Use <span className="text-amber-400 font-medium">Reset defaults</span> to restore the original template for a session type.
                </p>
              </div>

              {/* One card per session type */}
              {SESSION_TYPES.map(st => {
                const steps    = (stepsMap[st.type as SessionKey] ?? []).slice().sort((a, b) => a.position - b.position)
                const isDone   = resetDone === st.type
                const totalMin = steps.reduce((acc, step) => acc + (step.est_minutes ?? 0), 0)

                return (
                  <div key={st.type} className="rounded-xl border border-surface-700 bg-surface-800/40 overflow-hidden">
                    {/* Session header */}
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-800/60 border-b border-surface-700">
                      <span className="text-2xl shrink-0">{st.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-slate-200">{st.label}</h3>
                          <span className="text-[10px] text-slate-500 bg-surface-700 rounded px-1.5 py-0.5">
                            {steps.length} steps
                          </span>
                          {totalMin > 0 && (
                            <span className="text-[10px] text-slate-500 bg-surface-700 rounded px-1.5 py-0.5">
                              ~{totalMin}m
                            </span>
                          )}
                          <span className="hidden sm:inline text-[10px] text-brand-500">({st.est})</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{st.desc}</p>
                      </div>
                      <button
                        onClick={() => handleReset(st.type)}
                        disabled={resetting !== null}
                        className={cn(
                          'shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-colors disabled:opacity-50',
                          isDone
                            ? 'border-green-700/40 text-green-400 bg-green-900/10'
                            : 'border-surface-600 text-slate-500 hover:border-amber-700/40 hover:text-amber-400',
                        )}
                      >
                        {resetting === st.type
                          ? <Loader2 size={10} className="animate-spin" />
                          : isDone ? <CheckCircle2 size={10} /> : <RefreshCw size={10} />}
                        {isDone ? 'Reset done' : 'Reset defaults'}
                      </button>
                    </div>

                    {/* Step list */}
                    <div className="divide-y divide-surface-700/40">
                      {steps.length === 0 ? (
                        <div className="px-4 py-5 text-sm text-slate-500 italic text-center">
                          No steps — click "Reset defaults" to generate this template.
                        </div>
                      ) : steps.map(step => {
                        const draft     = editDrafts[step.id]
                        const isEditing = draft != null
                        const isSaving  = savingStep === step.id
                        const tfs       = (step.config?.timeframes as string[]) ?? []

                        if (isEditing) {
                          return (
                            <div key={step.id} className="px-4 py-4 bg-brand-900/5 border-l-4 border-brand-600/30 space-y-3">
                              {/* Label */}
                              <div>
                                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Step label</label>
                                <input
                                  type="text"
                                  value={draft.label}
                                  onChange={e => setEditDrafts(prev => ({ ...prev, [step.id]: { ...draft, label: e.target.value } }))}
                                  className="mt-1 w-full bg-surface-800 border border-surface-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-brand-500"
                                />
                              </div>

                              <div className="flex items-center gap-4 flex-wrap">
                                {/* Duration */}
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-slate-500">Duration (min):</label>
                                  <input
                                    type="number" min={0} max={120}
                                    value={draft.est_minutes ?? ''}
                                    onChange={e => setEditDrafts(prev => ({
                                      ...prev,
                                      [step.id]: { ...draft, est_minutes: e.target.value ? Number(e.target.value) : null },
                                    }))}
                                    className="w-16 bg-surface-800 border border-surface-600 rounded-lg px-2 py-1 text-sm text-slate-200 focus:outline-none focus:border-brand-500"
                                  />
                                </div>

                                {/* Mandatory toggle */}
                                <button
                                  onClick={() => setEditDrafts(prev => ({
                                    ...prev,
                                    [step.id]: { ...draft, is_mandatory: !draft.is_mandatory },
                                  }))}
                                  className={cn(
                                    'text-xs px-3 py-1 rounded-lg border transition-colors',
                                    draft.is_mandatory
                                      ? 'border-brand-700/40 text-brand-400 bg-brand-900/30'
                                      : 'border-surface-600 text-slate-500 bg-surface-700/30',
                                  )}
                                >
                                  {draft.is_mandatory ? '✓ Required' : 'Optional'}
                                </button>
                              </div>

                              {/* TF selector — only for smart_wl step */}
                              {step.step_type === 'smart_wl' && (
                                <div>
                                  <label className="text-[10px] text-slate-500 uppercase tracking-wider">Timeframes for watchlist</label>
                                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                    {AVAILABLE_TFS.map(tf => (
                                      <button
                                        key={tf}
                                        onClick={() => setEditDrafts(prev => {
                                          const cur = prev[step.id]!
                                          const next = cur.timeframes.includes(tf)
                                            ? cur.timeframes.filter(t => t !== tf)
                                            : [...cur.timeframes, tf]
                                          return { ...prev, [step.id]: { ...cur, timeframes: next } }
                                        })}
                                        className={cn(
                                          'text-xs px-2 py-0.5 rounded border transition-all',
                                          draft.timeframes.includes(tf)
                                            ? TF_COLORS[tf]
                                            : 'border-surface-600 text-slate-600 hover:border-slate-500',
                                        )}
                                      >
                                        {tf}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Save / Cancel */}
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => saveStep(step, st.type)}
                                  disabled={isSaving}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-700/30 border border-brand-600/40 text-brand-400 text-xs font-medium hover:bg-brand-700/40 transition-colors disabled:opacity-50"
                                >
                                  {isSaving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                                  Save
                                </button>
                                <button
                                  onClick={() => cancelEdit(step.id)}
                                  disabled={isSaving}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-600 text-slate-500 text-xs hover:text-slate-300 transition-colors"
                                >
                                  <X size={11} />
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )
                        }

                        // ── Normal row ──────────────────────────────────────────
                        return (
                          <div
                            key={step.id}
                            className="flex items-center gap-3 px-4 py-3 group hover:bg-surface-700/20 transition-colors"
                          >
                            <span className="text-[11px] text-slate-600 w-5 text-right shrink-0 font-mono">
                              {step.position}.
                            </span>
                            <span className="text-base shrink-0">{step.emoji}</span>
                            <span className="text-sm text-slate-200 flex-1">{step.label}</span>

                            {tfs.length > 0 && (
                              <div className="flex gap-1 shrink-0 flex-wrap">
                                {tfs.map(tf => <TFBadge key={tf} tf={tf} />)}
                              </div>
                            )}

                            <span className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded shrink-0',
                              step.is_mandatory
                                ? 'text-brand-400 bg-brand-900/30'
                                : 'text-slate-600 bg-surface-700/40',
                            )}>
                              {step.is_mandatory ? 'required' : 'optional'}
                            </span>

                            {step.est_minutes != null && (
                              <span className="text-xs text-slate-600 shrink-0">{step.est_minutes}m</span>
                            )}

                            <button
                              onClick={() => startEdit(step)}
                              className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-brand-400 p-1 rounded"
                              title="Edit this step"
                            >
                              <Pencil size={13} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              TAB: CONFIGURATION
          ══════════════════════════════════════════════════════════════════════ */}
          {activeTab === 'config' && (
            <div className="space-y-4">

              {/* ── Market Context Pairs ─────────────────────────────────────── */}
              <div className="rounded-xl border border-surface-700 bg-surface-800/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-700 bg-surface-800/60 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-200">Market Context Pairs</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Always pinned at the top of the Smart WL, regardless of scoring. Use for macro structure.
                    </p>
                  </div>
                  <div className="shrink-0 w-4 h-4 flex items-center justify-center">
                    {savingPairs && <Loader2 size={12} className="animate-spin text-slate-500" />}
                    {!savingPairs && pairsSaved && <CheckCircle2 size={12} className="text-green-400" />}
                  </div>
                </div>
                <div className="px-4 py-4 space-y-4">

                  {/* Active pills */}
                  {marketPairs.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Active ({marketPairs.length})</p>
                      <div className="flex flex-wrap gap-2">
                        {marketPairs.map(sym => (
                          <span
                            key={sym}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-900/30 border border-brand-700/40 text-xs text-brand-300 font-mono"
                          >
                            {sym}
                            <button
                              onClick={() => toggleMarketPair(sym)}
                              className="text-brand-600 hover:text-red-400 transition-colors"
                              title="Remove"
                            >
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggested pairs grouped by category */}
                  {(Object.entries(
                    SUGGESTED_CONTEXT_PAIRS.reduce<Record<string, typeof SUGGESTED_CONTEXT_PAIRS>>(
                      (acc, p) => { ;(acc[p.category] ??= []).push(p); return acc },
                      {},
                    ),
                  ) as [string, typeof SUGGESTED_CONTEXT_PAIRS][]).map(([cat, pairs]) => (
                    <div key={cat}>
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">{cat}</p>
                      <div className="flex flex-wrap gap-2">
                        {pairs.map(p => {
                          const active = marketPairs.includes(p.symbol)
                          return (
                            <button
                              key={p.symbol}
                              onClick={() => toggleMarketPair(p.symbol)}
                              title={p.symbol}
                              className={cn(
                                'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-all',
                                active
                                  ? 'border-brand-700/60 bg-brand-900/30 text-brand-300'
                                  : 'border-surface-600 bg-surface-700/20 text-slate-500 hover:border-slate-500 hover:text-slate-300',
                              )}
                            >
                              {active && <CheckCircle2 size={10} className="text-brand-400" />}
                              <span className="font-medium">{p.label}</span>
                              <span className="ml-0.5 text-[10px] opacity-50 font-mono">{p.symbol.split(':')[1]}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}

                  {/* Custom symbol input */}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Custom symbol</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="e.g. BINANCE:DOGEUSDT"
                        value={customSymbol}
                        onChange={e => setCustomSymbol(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addCustomPair()}
                        className="flex-1 max-w-xs bg-surface-800 border border-surface-600 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500 font-mono"
                      />
                      <button
                        onClick={addCustomPair}
                        disabled={!customSymbol.trim() || marketPairs.includes(customSymbol.trim().toUpperCase())}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-700/40 text-brand-400 bg-brand-900/20 text-xs hover:bg-brand-900/30 transition-colors disabled:opacity-40"
                      >
                        <Plus size={11} />
                        Add
                      </button>
                    </div>
                  </div>

                </div>
              </div>

              {/* Top N per session */}
              <div className="rounded-xl border border-surface-700 bg-surface-800/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-700 bg-surface-800/60">
                  <h3 className="text-sm font-semibold text-slate-200">Smart Watchlist — Top N</h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Maximum pairs included per timeframe section in the generated watchlist file.
                    Pinned pairs are always included on top of this limit.
                  </p>
                </div>
                <div className="px-4 py-4 space-y-3">
                  {SESSION_TYPES.map(st => (
                    <div key={st.type} className="flex items-center gap-3">
                      <span className="text-base shrink-0">{st.emoji}</span>
                      <span className="text-sm text-slate-400 w-32 shrink-0">{st.label}</span>
                      <input
                        type="range" min={5} max={50} step={5}
                        value={topNLocal[st.type] ?? 20}
                        onChange={e => updateTopN(st.type, Number(e.target.value))}
                        className="flex-1 accent-brand-500 max-w-[200px]"
                        disabled={savingTopN}
                      />
                      <span className="text-sm text-slate-300 w-8 text-right shrink-0">
                        {topNLocal[st.type] ?? 20}
                      </span>
                      <span className="text-xs text-slate-600 shrink-0">pairs</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cascade scoring — full smart_filter config */}
              <div className="rounded-xl border border-surface-700 bg-surface-800/40 overflow-hidden">
                <div className="px-4 py-3 border-b border-surface-700 bg-surface-800/60">
                  <h3 className="text-sm font-semibold text-slate-200">Cascade Scoring — Smart Filter</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Controls how pairs are ranked in the Smart Watchlist.<br />
                    <span className="font-mono text-[10px] text-slate-400">
                      score(pair) = Σ(TF_weight × vi_score × trend_bonus × ema_bonus)
                    </span>
                  </p>
                </div>
                <div className="px-4 py-4 space-y-5">

                  {/* TF weights */}
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">TF Weights</p>
                    {AVAILABLE_TFS.map(tf => (
                      <div key={tf} className="flex items-center gap-3">
                        <TFBadge tf={tf} />
                        <input
                          type="range" min={0.1} max={5.0} step={0.1}
                          value={weights[tf] ?? 1.0}
                          onChange={e => setWeights(prev => ({ ...prev, [tf]: Number(e.target.value) }))}
                          className="flex-1 accent-brand-500 max-w-[200px]"
                        />
                        <span className="text-sm font-mono text-slate-300 w-8 text-right shrink-0">
                          {(weights[tf] ?? 1.0).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Bonuses */}
                  <div className="space-y-3 pt-1 border-t border-surface-700/60">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 pt-2">Bonuses</p>

                    {/* trend_bonus */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-40 shrink-0">
                        Trend bonus
                        <span className="ml-1 text-[10px] text-slate-600">(breakout_up / trend_up)</span>
                      </span>
                      <input
                        type="range" min={1.0} max={2.0} step={0.05}
                        value={trendBonus}
                        onChange={e => setTrendBonus(Number(e.target.value))}
                        className="flex-1 accent-brand-500 max-w-[200px]"
                      />
                      <span className="text-sm font-mono text-slate-300 w-10 text-right shrink-0">
                        ×{trendBonus.toFixed(2)}
                      </span>
                    </div>

                    {/* ema_bonus_threshold */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-40 shrink-0">
                        EMA bonus threshold
                        <span className="ml-1 text-[10px] text-slate-600">(ema_score ≥ N)</span>
                      </span>
                      <input
                        type="range" min={40} max={95} step={5}
                        value={emaBonusThreshold}
                        onChange={e => setEmaBonusThreshold(Number(e.target.value))}
                        className="flex-1 accent-brand-500 max-w-[200px]"
                      />
                      <span className="text-sm font-mono text-slate-300 w-10 text-right shrink-0">
                        {emaBonusThreshold}
                      </span>
                    </div>

                    {/* ema_bonus_factor */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-40 shrink-0">
                        EMA bonus factor
                        <span className="ml-1 text-[10px] text-slate-600">(multiplier when ≥ threshold)</span>
                      </span>
                      <input
                        type="range" min={1.0} max={2.0} step={0.05}
                        value={emaBonusFactor}
                        onChange={e => setEmaBonusFactor(Number(e.target.value))}
                        className="flex-1 accent-brand-500 max-w-[200px]"
                      />
                      <span className="text-sm font-mono text-slate-300 w-10 text-right shrink-0">
                        ×{emaBonusFactor.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="pt-1">
                    <button
                      onClick={saveWeights}
                      disabled={savingWeights}
                      className={cn(
                        'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm border transition-colors disabled:opacity-50',
                        weightsSaved
                          ? 'border-green-700/40 text-green-400 bg-green-900/10'
                          : 'border-brand-700/40 text-brand-400 bg-brand-900/20 hover:bg-brand-900/30',
                      )}
                    >
                      {savingWeights
                        ? <Loader2 size={12} className="animate-spin" />
                        : weightsSaved ? <CheckCircle2 size={12} /> : <Save size={12} />}
                      {weightsSaved ? 'Saved' : 'Save scoring config'}
                    </button>
                  </div>
                </div>
              </div>

            </div>
          )}
        </>
      )}
    </div>
  )
}
