// ── Market Analysis Settings — Indicator Editor ───────────────────────────
//
// Allows editing indicator questions, labels, tooltips, and answer labels
// per module. Also lets you toggle default_enabled and per-profile on/off.
// Supports adding new indicators and deleting existing ones.
//
// Backend:
//   GET    /api/market-analysis/modules
//   GET    /api/market-analysis/modules/{id}/indicators
//   POST   /api/market-analysis/modules/{id}/indicators
//   PATCH  /api/market-analysis/indicators/{id}
//   DELETE /api/market-analysis/indicators/{id}
//   GET    /api/profiles/{id}/indicator-config
//   PUT    /api/profiles/{id}/indicator-config
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Settings2, ChevronDown, ChevronUp, ExternalLink,
  Save, Loader2, CheckCircle2, RefreshCw, Info,
  Eye, EyeOff, Edit3, RotateCcw, Trash2, Plus, X,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { maApi } from '../../lib/api'
import type {
  MAModule, MAIndicator, MAIndicatorConfig, MAIndicatorCreate,
} from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TF_LABELS: Record<string, { label: string; color: string; dot: string }> = {
  htf: { label: 'HTF', color: 'text-brand-400',   dot: 'bg-brand-500' },
  mtf: { label: 'MTF', color: 'text-amber-400',   dot: 'bg-amber-500' },
  ltf: { label: 'LTF', color: 'text-emerald-400', dot: 'bg-emerald-500' },
}

const MODULE_EMOJIS: Record<string, string> = {
  Crypto: '₿', Gold: '🥇', Forex: '💱', Indices: '📊',
}
const moduleEmoji = (name: string) => MODULE_EMOJIS[name] ?? '🧭'

// ─────────────────────────────────────────────────────────────────────────────
// IndicatorRow — expandable with inline edit
// ─────────────────────────────────────────────────────────────────────────────

function IndicatorRow({
  indicator,
  profileEnabled,
  onToggleProfile,
  onSave,
  onDelete,
  savingId,
}: {
  indicator: MAIndicator
  profileEnabled: boolean
  onToggleProfile: (id: number, enabled: boolean) => void
  onSave: (id: number, patch: Partial<MAIndicator>) => Promise<void>
  onDelete: (id: number) => void
  savingId: number | null
}) {
  const [expanded, setExpanded]     = useState(false)
  const [editing, setEditing]       = useState(false)
  const [saved, setSaved]           = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  // Editable draft
  const [label, setLabel]           = useState(indicator.label)
  const [question, setQuestion]     = useState(indicator.question)
  const [tooltip, setTooltip]       = useState(indicator.tooltip ?? '')
  const [bullish, setBullish]       = useState(indicator.answer_bullish)
  const [partial, setPartial]       = useState(indicator.answer_partial)
  const [bearish, setBearish]       = useState(indicator.answer_bearish)

  const tf   = TF_LABELS[indicator.timeframe_level] ?? { label: indicator.timeframe_level, color: 'text-slate-400', dot: 'bg-surface-500' }
  const isSaving = savingId === indicator.id

  const handleSave = async () => {
    await onSave(indicator.id, {
      label,
      question,
      tooltip: tooltip.trim() || null,
      answer_bullish: bullish,
      answer_partial: partial,
      answer_bearish: bearish,
    })
    setEditing(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const handleReset = () => {
    setLabel(indicator.label)
    setQuestion(indicator.question)
    setTooltip(indicator.tooltip ?? '')
    setBullish(indicator.answer_bullish)
    setPartial(indicator.answer_partial)
    setBearish(indicator.answer_bearish)
    setEditing(false)
  }

  const textareaCls = [
    'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs',
    'text-slate-200 placeholder-slate-600 leading-relaxed resize-none',
    'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20 transition-colors',
  ].join(' ')

  const inputCls = [
    'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600',
    'text-xs text-slate-200 placeholder-slate-600',
    'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20 transition-colors',
  ].join(' ')

  return (
    <div className={`rounded-xl border transition-colors ${
      !profileEnabled ? 'border-surface-700 bg-surface-800/40 opacity-60' : 'border-surface-700 bg-surface-800'
    }`}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Timeframe badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tf.dot}`} />
          <span className={`text-[9px] font-mono font-bold uppercase ${tf.color}`}>{tf.label}</span>
          <span className="text-[9px] font-mono text-slate-700 bg-surface-700 rounded px-1">
            {indicator.tv_timeframe}
          </span>
        </div>

        {/* Label + question preview */}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-200 truncate">{label}</p>
          {!expanded && (
            <p className="text-[10px] text-slate-600 truncate mt-0.5">{question}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {saved && <CheckCircle2 size={12} className="text-emerald-400" />}

          {/* TradingView link */}
          <a
            href={`https://www.tradingview.com/chart/?symbol=${indicator.tv_symbol}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-brand-400 hover:text-brand-300 border border-brand-500/20 rounded px-1.5 py-0.5 flex items-center gap-1"
            title={`Open ${indicator.tv_symbol} on TradingView`}
          >
            <ExternalLink size={9} />
            <span className="font-mono">{indicator.tv_symbol}</span>
          </a>

          {/* Profile toggle */}
          <button
            type="button"
            onClick={() => onToggleProfile(indicator.id, !profileEnabled)}
            title={profileEnabled ? 'Disable for this profile' : 'Enable for this profile'}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
              profileEnabled
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'border-surface-600 bg-surface-700 text-slate-500 hover:text-slate-300'
            }`}
          >
            {profileEnabled ? <Eye size={10} /> : <EyeOff size={10} />}
            {profileEnabled ? 'On' : 'Off'}
          </button>

          {/* Delete */}
          {confirmDel ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onDelete(indicator.id)}
                className="text-[10px] text-red-400 hover:text-red-300 border border-red-500/30 bg-red-500/10 px-2 py-0.5 rounded transition-colors"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmDel(false)}
                className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDel(true)}
              className="text-slate-600 hover:text-red-400 transition-colors"
              title="Delete indicator"
            >
              <Trash2 size={12} />
            </button>
          )}

          {/* Expand */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Expanded detail / edit */}
      {expanded && (
        <div className="border-t border-surface-700 px-4 py-4 space-y-4">
          {/* Edit toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
              <Info size={10} />
              <span className="font-mono text-slate-700">{indicator.key}</span>
              <span>·</span>
              <span className={tf.color}>{tf.label}</span>
              <span>·</span>
              <span>Target: <strong className="text-slate-500">{indicator.asset_target}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    <RotateCcw size={10} /> Reset
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSave}
                    className="flex items-center gap-1.5 text-[10px] bg-brand-600 hover:bg-brand-500 text-white px-3 py-1 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                    Save
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 border border-brand-500/20 px-2 py-0.5 rounded transition-colors"
                >
                  <Edit3 size={10} /> Edit
                </button>
              )}
            </div>
          </div>

          {/* Label */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Label</label>
            {editing ? (
              <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} />
            ) : (
              <p className="text-xs text-slate-300 bg-surface-700/40 rounded px-3 py-2">{label}</p>
            )}
          </div>

          {/* Question */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Question</label>
            {editing ? (
              <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} className={textareaCls} />
            ) : (
              <p className="text-xs text-slate-300 bg-surface-700/40 rounded px-3 py-2 leading-relaxed">{question}</p>
            )}
          </div>

          {/* Tooltip / guidance */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Guidance / Tooltip <span className="text-slate-700">(optional)</span>
            </label>
            {editing ? (
              <textarea rows={4} value={tooltip} onChange={(e) => setTooltip(e.target.value)}
                placeholder="How to read this indicator…"
                className={textareaCls} />
            ) : (
              tooltip ? (
                <p className="text-[11px] text-slate-500 bg-surface-700/40 rounded px-3 py-2 leading-relaxed">{tooltip}</p>
              ) : (
                <p className="text-[10px] text-slate-700 italic">No guidance set.</p>
              )
            )}
          </div>

          {/* Answer labels */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { key: 'bullish', label: '🟢 Bullish answer', val: bullish, set: setBullish, color: 'border-emerald-500/20 bg-emerald-500/5' },
              { key: 'partial', label: '🟡 Neutral answer', val: partial, set: setPartial, color: 'border-amber-500/20 bg-amber-500/5' },
              { key: 'bearish', label: '🔴 Bearish answer', val: bearish, set: setBearish, color: 'border-red-500/20 bg-red-500/5' },
            ].map(({ key, label: alabel, val, set, color }) => (
              <div key={key} className="space-y-1">
                <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{alabel}</label>
                {editing ? (
                  <textarea rows={2} value={val} onChange={(e) => set(e.target.value)}
                    className={`${textareaCls} border ${color}`} />
                ) : (
                  <p className={`text-[10px] text-slate-400 rounded px-2 py-1.5 leading-snug border ${color}`}>{val}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AddIndicatorForm — inline form to create a new indicator inside a module
// ─────────────────────────────────────────────────────────────────────────────

function AddIndicatorForm({
  moduleId,
  onCreated,
  onCancel,
}: {
  moduleId: number
  onCreated: (ind: MAIndicator) => void
  onCancel: () => void
}) {
  const formRef                       = useRef<HTMLDivElement>(null)
  const [label, setLabel]             = useState('')
  const [key, setKey]                 = useState('')
  const [tfLevel, setTfLevel]         = useState<'htf' | 'mtf' | 'ltf'>('htf')
  const [scoreBlock, setScoreBlock]   = useState<'trend' | 'momentum' | 'participation'>('trend')
  const [assetTarget, setAssetTarget] = useState<'a' | 'b' | 'single'>('single')
  const [tvSymbol, setTvSymbol]       = useState('')
  const [tvTimeframe, setTvTimeframe] = useState('1D')
  const [question, setQuestion]       = useState('')
  const [tooltip, setTooltip]         = useState('')
  const [bullish, setBullish]         = useState('🟢 Bullish')
  const [neutral, setNeutral]         = useState('🟡 Neutral')
  const [bearish, setBearish]         = useState('🔴 Bearish')
  const [saving, setSaving]           = useState(false)
  const [err, setErr]                 = useState<string | null>(null)
  const keyTouched                    = useRef(false)
  useEffect(() => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [])
  const autoSlug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

  const handleLabelChange = (v: string) => {
    setLabel(v)
    if (!keyTouched.current) setKey(autoSlug(v))
  }

  const handleSubmit = async () => {
    if (!label.trim() || !key.trim() || !question.trim()) {
      setErr('Label, key, and question are required.')
      return
    }
    setSaving(true); setErr(null)
    try {
      const data: MAIndicatorCreate = {
        key: key.trim(),
        label: label.trim(),
        asset_target: assetTarget,
        tv_symbol: tvSymbol.trim(),
        tv_timeframe: tvTimeframe.trim() || '1D',
        timeframe_level: tfLevel,
        score_block: scoreBlock,
        question: question.trim(),
        tooltip: tooltip.trim() || null,
        answer_bullish: bullish.trim() || '🟢 Bullish',
        answer_partial: neutral.trim() || '🟡 Neutral',
        answer_bearish: bearish.trim() || '🔴 Bearish',
      }
      const ind = await maApi.createIndicator(moduleId, data)
      onCreated(ind)
    } catch (e: unknown) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  const inputCls = 'w-full px-3 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20 transition-colors'
  const selectCls = `${inputCls} cursor-pointer`
  const textareaCls = 'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-200 placeholder-slate-600 leading-relaxed resize-none focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/20 transition-colors'

  return (
    <div ref={formRef} className="rounded-xl border border-brand-500/30 bg-brand-500/5 p-4 space-y-3">
      <p className="text-[10px] font-semibold text-brand-400 uppercase tracking-wider flex items-center gap-1.5">
        <Plus size={10} /> New indicator
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Label *</label>
          <input
            type="text"
            value={label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="e.g. EMA 200 Trend"
            className={inputCls}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Key (slug) *</label>
          <input
            type="text"
            value={key}
            onChange={(e) => { keyTouched.current = true; setKey(e.target.value) }}
            placeholder="e.g. ema_200_trend"
            className={`${inputCls} font-mono`}
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Timeframe</label>
          <select value={tfLevel} onChange={(e) => setTfLevel(e.target.value as 'htf' | 'mtf' | 'ltf')} className={selectCls}>
            <option value="htf">HTF — Higher</option>
            <option value="mtf">MTF — Medium</option>
            <option value="ltf">LTF — Lower</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Score block</label>
          <select value={scoreBlock} onChange={(e) => setScoreBlock(e.target.value as 'trend' | 'momentum' | 'participation')} className={selectCls}>
            <option value="trend">Trend</option>
            <option value="momentum">Momentum</option>
            <option value="participation">Participation</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
            Asset target
          </label>
          <select value={assetTarget} onChange={(e) => setAssetTarget(e.target.value as 'a' | 'b' | 'single')} className={selectCls}>
            <option value="single">Single — ✅ Crypto / Gold / Indices (one asset)</option>
            <option value="a">A — Forex only: 1st asset of a pair (e.g. EUR in EUR/USD)</option>
            <option value="b">B — Forex only: 2nd asset of a pair (e.g. USD in EUR/USD)</option>
          </select>
          <p className="text-[9px] text-slate-600 leading-snug mt-0.5">
            <strong className="text-slate-500">Single</strong> in 99% of cases. A/B is only for Forex modules where you want to score both sides of a pair independently.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">TV Symbol</label>
          <input type="text" value={tvSymbol} onChange={(e) => setTvSymbol(e.target.value)}
            placeholder="e.g. BINANCE:BTCUSDT" className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">TV Timeframe</label>
          <input type="text" value={tvTimeframe} onChange={(e) => setTvTimeframe(e.target.value)}
            placeholder="1D, 4H, 1W…" className={inputCls} />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Question *</label>
        <textarea
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Is price above the 200 EMA on the weekly?"
          className={textareaCls}
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
          Guidance / Tooltip <span className="text-slate-700">(optional)</span>
        </label>
        <textarea
          rows={3}
          value={tooltip}
          onChange={(e) => setTooltip(e.target.value)}
          placeholder="How to read this indicator…"
          className={textareaCls}
        />
      </div>

      {/* Answer labels */}
      <div>
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Answer labels</label>
        <div className="grid grid-cols-3 gap-2 mt-1">
          <div className="space-y-1">
            <label className="text-[9px] text-slate-600">🟢 Bullish</label>
            <input type="text" value={bullish} onChange={(e) => setBullish(e.target.value)}
              className={`${inputCls} border-emerald-500/20 bg-emerald-500/5`} />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] text-slate-600">🟡 Neutral</label>
            <input type="text" value={neutral} onChange={(e) => setNeutral(e.target.value)}
              className={`${inputCls} border-amber-500/20 bg-amber-500/5`} />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] text-slate-600">🔴 Bearish</label>
            <input type="text" value={bearish} onChange={(e) => setBearish(e.target.value)}
              className={`${inputCls} border-red-500/20 bg-red-500/5`} />
          </div>
        </div>
      </div>

      {err && <p className="text-[10px] text-red-400">{err}</p>}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
          Cancel
        </button>
        <button type="button" disabled={saving} onClick={handleSubmit}
          className="flex items-center gap-1.5 text-[10px] bg-brand-600 hover:bg-brand-500 text-white px-3 py-1 rounded-lg transition-colors disabled:opacity-50">
          {saving ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
          Add indicator
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ModuleSection
// ─────────────────────────────────────────────────────────────────────────────

function ModuleSection({
  module, indicators, configs, onToggleProfile, onSave, onDelete, onCreate, savingId,
}: {
  module: MAModule
  indicators: MAIndicator[]
  configs: Record<number, boolean>
  onToggleProfile: (id: number, enabled: boolean) => void
  onSave: (id: number, patch: Partial<MAIndicator>) => Promise<void>
  onDelete: (id: number) => void
  onCreate: (moduleId: number, ind: MAIndicator) => void
  savingId: number | null
}) {
  const [showAdd, setShowAdd] = useState(false)

  const byTf = indicators.reduce<Record<string, MAIndicator[]>>((acc, ind) => {
    acc[ind.timeframe_level] = [...(acc[ind.timeframe_level] ?? []), ind]
    return acc
  }, {})

  const tfOrder = ['htf', 'mtf', 'ltf']
  const enabledCount = indicators.filter((i) => configs[i.id] !== false).length

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
      {/* Module header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
        <span className="text-xl">{moduleEmoji(module.name)}</span>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-slate-200">{module.name}</h2>
          {module.description && (
            <p className="text-[10px] text-slate-600 mt-0.5">{module.description}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs font-mono text-slate-400">{enabledCount}/{indicators.length}</p>
          <p className="text-[9px] text-slate-700">enabled for profile</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd((v) => !v)}
          className={`flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-lg border transition-colors ${
            showAdd
              ? 'border-surface-500 text-slate-400 bg-surface-700 hover:bg-surface-600'
              : 'border-brand-500/30 text-brand-400 bg-brand-500/10 hover:bg-brand-500/15'
          }`}
        >
          {showAdd ? <X size={10} /> : <Plus size={10} />}
          {showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {/* Add indicator form — top so it's immediately visible */}
      {showAdd && (
        <div className="px-4 pt-4">
          <AddIndicatorForm
            moduleId={module.id}
            onCreated={(ind) => {
              onCreate(module.id, ind)
              setShowAdd(false)
            }}
            onCancel={() => setShowAdd(false)}
          />
        </div>
      )}

      {/* Indicators by TF */}
      <div className="p-4 space-y-6">
        {tfOrder.filter((tf) => byTf[tf]?.length).map((tf) => {
          const meta = TF_LABELS[tf] ?? { label: tf, color: 'text-slate-400', dot: 'bg-surface-500' }
          return (
            <div key={tf}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                <h3 className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color}`}>
                  {meta.label === 'HTF' ? 'Higher Time Frame (HTF)' : meta.label === 'MTF' ? 'Medium Time Frame (MTF)' : 'Lower Time Frame (LTF)'}
                </h3>
                <span className="text-[9px] text-slate-700 ml-auto">
                  {byTf[tf].length} indicator{byTf[tf].length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-2">
                {byTf[tf].map((ind) => (
                  <IndicatorRow
                    key={ind.id}
                    indicator={ind}
                    profileEnabled={configs[ind.id] !== false}
                    onToggleProfile={onToggleProfile}
                    onSave={onSave}
                    onDelete={onDelete}
                    savingId={savingId}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MarketAnalysisSettingsPage
// ─────────────────────────────────────────────────────────────────────────────

export function MarketAnalysisSettingsPage() {
  const { activeProfile } = useProfile()

  const [modules,    setModules]    = useState<MAModule[]>([])
  const [indicators, setIndicators] = useState<Record<number, MAIndicator[]>>({})
  // configs: indicatorId → enabled (for active profile)
  const [configs,    setConfigs]    = useState<Record<number, boolean>>({})
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [savingId,   setSavingId]   = useState<number | null>(null)
  const [configSaving, setConfigSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const mods = await maApi.listModules()
      setModules(mods)

      // Load indicators for each module
      const indMap: Record<number, MAIndicator[]> = {}
      await Promise.all(
        mods.map(async (m) => {
          indMap[m.id] = await maApi.listIndicators(m.id)
        })
      )
      setIndicators(indMap)

      // Load per-profile config if profile is active
      if (activeProfile) {
        const cfg = await maApi.getIndicatorConfig(activeProfile.id)
        const map: Record<number, boolean> = {}
        for (const c of cfg.configs) map[c.indicator_id] = c.enabled
        setConfigs(map)
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeProfile])

  useEffect(() => { void load() }, [load])

  // Toggle a single indicator for the active profile
  const handleToggleProfile = useCallback(async (indicatorId: number, enabled: boolean) => {
    if (!activeProfile) return
    setConfigs((prev) => ({ ...prev, [indicatorId]: enabled }))

    setConfigSaving(true)
    try {
      // Build full config list
      const allIds = Object.values(indicators).flat().map((i) => i.id)
      const newConfigs: MAIndicatorConfig[] = allIds.map((id) => ({
        indicator_id: id,
        enabled: id === indicatorId ? enabled : (configs[id] ?? true),
      }))
      const result = await maApi.saveIndicatorConfig(activeProfile.id, newConfigs)
      const map: Record<number, boolean> = {}
      for (const c of result.configs) map[c.indicator_id] = c.enabled
      setConfigs(map)
    } catch (e: unknown) {
      setError((e as Error).message)
      // Revert
      setConfigs((prev) => ({ ...prev, [indicatorId]: !enabled }))
    } finally {
      setConfigSaving(false)
    }
  }, [activeProfile, configs, indicators])

  // Patch indicator text fields
  const handleSaveIndicator = useCallback(async (indicatorId: number, patch: Partial<MAIndicator>) => {
    setSavingId(indicatorId)
    try {
      const updated = await maApi.patchIndicator(indicatorId, patch)
      // Update local state
      setIndicators((prev) => {
        const next = { ...prev }
        for (const [modId, inds] of Object.entries(next)) {
          next[Number(modId)] = inds.map((i) => i.id === indicatorId ? updated : i)
        }
        return next
      })
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSavingId(null)
    }
  }, [])

  const handleDeleteIndicator = useCallback(async (indicatorId: number) => {
    try {
      await maApi.deleteIndicator(indicatorId)
      setIndicators((prev) => {
        const next = { ...prev }
        for (const [modId, inds] of Object.entries(next)) {
          next[Number(modId)] = inds.filter((i) => i.id !== indicatorId)
        }
        return next
      })
      setConfigs((prev) => {
        const next = { ...prev }
        delete next[indicatorId]
        return next
      })
    } catch (e: unknown) {
      setError((e as Error).message)
    }
  }, [])

  const handleCreateIndicator = useCallback((moduleId: number, indicator: MAIndicator) => {
    setIndicators((prev) => ({
      ...prev,
      [moduleId]: [...(prev[moduleId] ?? []), indicator],
    }))
  }, [])

  const allIndicators = Object.values(indicators).flat()
  const totalEnabled  = allIndicators.filter((i) => configs[i.id] !== false).length

  return (
    <div>
      <PageHeader
        icon="⚙️"
        title="Market Analysis — Indicators"
        subtitle="Manage indicators per module: edit questions, guidance, answer labels, add or delete indicators."
        info="Structural fields (key, timeframe, score block, TV symbol) can only be set at creation. Text fields (label, question, guidance, answers) are editable anytime. Deleting an indicator removes it from all sessions and profile configs."
        actions={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="atd-btn-ghost"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      {/* Info banner */}
      <div className="mb-6 rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-3 flex items-start gap-3">
        <Settings2 size={14} className="text-brand-400 mt-0.5 shrink-0" />
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-slate-300">How indicators work</p>
          <ul className="text-[11px] text-slate-500 space-y-1 list-disc pl-4">
            <li><strong className="text-slate-400">Edit</strong> — expand a row to edit its label, question, guidance and answer labels. These changes survive restarts and deploys.</li>
            <li><strong className="text-slate-400">Add</strong> — click the <span className="text-brand-400">Add</span> button on a module to create a new indicator. Structural fields (key, timeframe, score block) are fixed after creation.</li>
            <li><strong className="text-slate-400">Delete</strong> — removes the indicator permanently, including all past session answers for it.</li>
            <li><strong className="text-slate-400">Default enabled</strong> — global default applied to all new profiles.</li>
            <li><strong className="text-slate-400">Profile On/Off</strong> — per-profile override, affects only <span className="text-brand-400">{activeProfile?.name ?? '(no profile selected)'}</span>.</li>
          </ul>
        </div>
      </div>

      {/* KPI */}
      {!loading && allIndicators.length > 0 && (
        <div className="mb-6 flex items-center gap-6 text-xs text-slate-500">
          <span>{allIndicators.length} total indicators</span>
          <span className="text-emerald-400">{totalEnabled} enabled for this profile</span>
          {configSaving && (
            <span className="flex items-center gap-1 text-slate-600">
              <Loader2 size={10} className="animate-spin" /> Saving…
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="text-slate-600 animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">
          {modules.map((mod) => (
            <ModuleSection
              key={mod.id}
              module={mod}
              indicators={indicators[mod.id] ?? []}
              configs={configs}
              onToggleProfile={handleToggleProfile}
              onSave={handleSaveIndicator}
              onDelete={handleDeleteIndicator}
              onCreate={handleCreateIndicator}
              savingId={savingId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
