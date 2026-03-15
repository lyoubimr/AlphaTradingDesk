// ── New Analysis — 3-step wizard ─────────────────────────────────────────────
//
// Step 1 — Choose module
// Step 2 — Answer indicators (grouped HTF → MTF → LTF)
// Step 3 — Score summary + notes → Save
//
// Backend:
//   GET  /api/market-analysis/modules
//   GET  /api/market-analysis/modules/{id}/indicators
//   GET  /api/profiles/{id}/indicator-config
//   POST /api/market-analysis/sessions
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, CheckCircle2, Save, Loader2,
  TrendingUp, TrendingDown, Minus, ExternalLink, ChevronDown,
  Zap, BarChart2, TrendingUp as TrendIcon,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { maApi } from '../../lib/api'
import type {
  MAModule, MAIndicator,
  MAAnswerIn, MABias, MASessionOut, MATradeConclusion,
} from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type AnswerScore = 0 | 1 | 2

interface DraftAnswer {
  indicator_id: number
  score: AnswerScore
  answer_label: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants / Helpers
// ─────────────────────────────────────────────────────────────────────────────

const TF_META: Record<string, { label: string; color: string; dot: string }> = {
  htf: { label: 'Higher Time Frame (HTF)', color: 'text-brand-400',   dot: 'bg-brand-500' },
  mtf: { label: 'Medium Time Frame (MTF)',  color: 'text-amber-400',   dot: 'bg-amber-500' },
  ltf: { label: 'Lower Time Frame (LTF)',   color: 'text-emerald-400', dot: 'bg-emerald-500' },
}
const TF_ORDER = ['htf', 'mtf', 'ltf']

const MODULE_EMOJIS: Record<string, string> = {
  Crypto: '₿', Gold: '🥇', 'Gold (XAU)': '🥇', Forex: '💱', Indices: '📊',
}
const moduleEmoji = (name: string) => MODULE_EMOJIS[name] ?? '🧭'

const BIAS_CFG: Record<MABias, { text: string; bg: string; border: string; ring: string }> = {
  bullish: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', ring: '#22c55e' },
  bearish: { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/30',     ring: '#ef4444' },
  neutral: { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   ring: '#f59e0b' },
}

function scorePct(
  answers: DraftAnswer[],
  indicators: MAIndicator[],
  tf: string,
  side: 'a' | 'b',
): number | null {
  const targets = side === 'a' ? ['a', 'single'] : ['b']
  const relevant = indicators.filter(
    (i) => i.timeframe_level === tf && targets.includes(i.asset_target),
  )
  if (relevant.length === 0) return null
  const total = relevant.reduce((sum, ind) => {
    const a = answers.find((x) => x.indicator_id === ind.id)
    return sum + (a ? a.score : 0)
  }, 0)
  return Math.round((total / (relevant.length * 2)) * 100)
}

function biasFromPct(pct: number | null): MABias | null {
  if (pct === null) return null
  if (pct > 60) return 'bullish'
  if (pct < 40) return 'bearish'
  return 'neutral'
}

// v2: compute block score (Trend / Momentum / Participation) client-side preview
function blockScorePct(
  answers: DraftAnswer[],
  indicators: MAIndicator[],
  block: 'trend' | 'momentum' | 'participation',
  side: 'a' | 'b',
): number | null {
  const targets = side === 'a' ? ['a', 'single'] : ['b']
  const relevant = indicators.filter(
    (i) => i.score_block === block && targets.includes(i.asset_target),
  )
  if (relevant.length === 0) return null
  const total = relevant.reduce((sum, ind) => {
    const a = answers.find((x) => x.indicator_id === ind.id)
    return sum + (a ? a.score : 0)
  }, 0)
  return Math.round((total / (relevant.length * 2)) * 100)
}

function biasV2(pct: number | null, bullish = 65, bearish = 34): MABias | null {
  if (pct === null) return null
  if (pct >= bullish) return 'bullish'
  if (pct <= bearish) return 'bearish'
  return 'neutral'
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared UI atoms
// ─────────────────────────────────────────────────────────────────────────────

function BiasBadgeLg({ bias }: { bias: MABias | null }) {
  if (!bias) return <span className="text-slate-700 text-xs">—</span>
  const { text, bg, border } = BIAS_CFG[bias]
  const icon = bias === 'bullish'
    ? <TrendingUp  size={12} />
    : bias === 'bearish'
      ? <TrendingDown size={12} />
      : <Minus size={12} />
  const label = bias === 'bullish' ? 'Bullish' : bias === 'bearish' ? 'Bearish' : 'Neutral'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${text} ${bg} ${border}`}>
      {icon}{label}
    </span>
  )
}

function ScoreRing({ pct, bias, size = 64 }: { pct: number | null; bias: MABias | null; size?: number }) {
  const R    = (size - 10) / 2
  const C    = 2 * Math.PI * R
  const strokeColor = bias ? BIAS_CFG[bias].ring : '#1e1e35'
  const dashOffset  = pct !== null ? C - (pct / 100) * C : C
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="#1e1e35" strokeWidth={7} />
        {pct !== null && (
          <circle
            cx={size / 2} cy={size / 2} r={R}
            fill="none" stroke={strokeColor} strokeWidth={7} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {pct !== null ? (
          <>
            <span className={`text-lg font-bold tabular-nums leading-none ${bias ? BIAS_CFG[bias].text : 'text-slate-400'}`}>
              {pct}
            </span>
            <span className="text-[9px] text-slate-600 mt-0.5">/ 100</span>
          </>
        ) : (
          <span className="text-slate-700 text-xs">—</span>
        )}
      </div>
    </div>
  )
}

function ScoreGaugeBar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-slate-700 text-xs">—</span>
  const fill = pct > 60 ? 'bg-emerald-500' : pct < 40 ? 'bg-red-500' : 'bg-amber-400'
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-surface-700 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${fill}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold tabular-nums text-slate-300 w-10 text-right">{pct}%</span>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AnswerButton
// ─────────────────────────────────────────────────────────────────────────────

const ANSWER_STYLES: Record<AnswerScore, { base: string; active: string; dot: string }> = {
  2: {
    base:   'border-surface-600 text-slate-400 hover:border-emerald-500/40 hover:text-emerald-400 hover:bg-emerald-500/5',
    active: 'border-emerald-500/60 bg-emerald-500/12 text-emerald-300 font-semibold shadow-sm shadow-emerald-500/10',
    dot:    'bg-emerald-500',
  },
  1: {
    base:   'border-surface-600 text-slate-400 hover:border-amber-500/40 hover:text-amber-400 hover:bg-amber-500/5',
    active: 'border-amber-500/60 bg-amber-500/12 text-amber-300 font-semibold shadow-sm shadow-amber-500/10',
    dot:    'bg-amber-500',
  },
  0: {
    base:   'border-surface-600 text-slate-400 hover:border-red-500/40 hover:text-red-400 hover:bg-red-500/5',
    active: 'border-red-500/60 bg-red-500/12 text-red-300 font-semibold shadow-sm shadow-red-500/10',
    dot:    'bg-red-500',
  },
}

function AnswerButton({
  score, label, selected, onClick,
}: {
  score: AnswerScore; label: string; selected: boolean; onClick: () => void
}) {
  const { base, active, dot } = ANSWER_STYLES[score]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 py-2.5 px-3 rounded-xl border text-xs transition-all duration-150 ${selected ? active : base}`}
    >
      {selected && (
        <span className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full ${dot}`} />
      )}
      {label}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// IndicatorCard
// ─────────────────────────────────────────────────────────────────────────────

function IndicatorCard({
  indicator, answer, onAnswer,
}: {
  indicator: MAIndicator
  answer: DraftAnswer | undefined
  onAnswer: (a: DraftAnswer) => void
}) {
  const [showTip, setShowTip] = useState(false)
  const isAnswered = !!answer

  return (
    <div className={`rounded-2xl border p-4 transition-all duration-200 ${
      isAnswered
        ? 'border-surface-600 bg-surface-800'
        : 'border-surface-700 bg-surface-800/60'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-mono font-semibold text-slate-600 uppercase tracking-widest bg-surface-700 rounded px-1.5 py-0.5">
              {indicator.tv_timeframe}
            </span>
            {isAnswered && <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />}
          </div>
          <p className="text-sm font-medium text-slate-200 leading-snug">{indicator.question}</p>
          <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{indicator.label}</p>
        </div>

        {/* TradingView link */}
        {indicator.tv_symbol && (
          <a
            href={`https://www.tradingview.com/chart/?symbol=${indicator.tv_symbol}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300
              border border-brand-500/20 rounded-lg px-2 py-1 hover:bg-brand-500/8 transition-colors"
            title={`Open ${indicator.tv_symbol} on TradingView`}
          >
            <ExternalLink size={9} />
            <span className="font-mono">{indicator.tv_symbol}</span>
          </a>
        )}
      </div>

      {/* Guidance toggle */}
      {indicator.tooltip && (
        <button
          type="button"
          onClick={() => setShowTip((v) => !v)}
          className="flex items-center gap-1 text-[10px] text-slate-600 hover:text-slate-400 mb-2.5 transition-colors"
        >
          <ChevronDown size={10} className={`transition-transform duration-200 ${showTip ? 'rotate-180' : ''}`} />
          {showTip ? 'Hide guidance' : 'Show guidance'}
        </button>
      )}
      {showTip && indicator.tooltip && (
        <div className="mb-3 rounded-xl border border-surface-600 bg-surface-700/30 px-3 py-2.5">
          <p className="text-[11px] text-slate-400 leading-relaxed">{indicator.tooltip}</p>
        </div>
      )}

      {/* Answer buttons */}
      <div className="flex gap-2">
        <AnswerButton
          score={2}
          label={indicator.answer_bullish || '🟢 Bullish'}
          selected={answer?.score === 2}
          onClick={() => onAnswer({ indicator_id: indicator.id, score: 2, answer_label: indicator.answer_bullish || 'Bullish' })}
        />
        <AnswerButton
          score={1}
          label={indicator.answer_partial || '🟡 Neutral'}
          selected={answer?.score === 1}
          onClick={() => onAnswer({ indicator_id: indicator.id, score: 1, answer_label: indicator.answer_partial || 'Neutral' })}
        />
        <AnswerButton
          score={0}
          label={indicator.answer_bearish || '🔴 Bearish'}
          selected={answer?.score === 0}
          onClick={() => onAnswer({ indicator_id: indicator.id, score: 0, answer_label: indicator.answer_bearish || 'Bearish' })}
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Wizard step bar
// ─────────────────────────────────────────────────────────────────────────────

function WizardStepBar({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1 as const, label: 'Module', icon: <BarChart2 size={11} /> },
    { n: 2 as const, label: 'Questions', icon: <Zap size={11} /> },
    { n: 3 as const, label: 'Summary', icon: <CheckCircle2 size={11} /> },
  ]
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((s, i) => {
        const done    = current > s.n
        const active  = current === s.n
        return (
          <div key={s.n} className="flex items-center">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 ${
                done   ? 'bg-emerald-500/20 border border-emerald-500/50 text-emerald-400'
                : active ? 'bg-brand-500/20 border border-brand-500/60 text-brand-400'
                : 'bg-surface-700 border border-surface-600 text-slate-600'
              }`}>
                {done ? <CheckCircle2 size={13} className="text-emerald-400" /> : s.icon}
              </div>
              <span className={`text-xs font-medium transition-colors duration-200 ${
                done ? 'text-emerald-400' : active ? 'text-slate-200' : 'text-slate-600'
              }`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-16 h-px mx-3 transition-colors duration-300 ${
                current > s.n ? 'bg-emerald-500/40' : 'bg-surface-700'
              }`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Choose Module
// ─────────────────────────────────────────────────────────────────────────────

function StepChooseModule({
  modules, selectedId, onSelect, onNext,
}: {
  modules: MAModule[]
  selectedId: number | null
  onSelect: (id: number) => void
  onNext: () => void
}) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-400">Choose the market you want to analyze:</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {modules.map((mod) => {
          const selected = selectedId === mod.id
          return (
            <button
              key={mod.id}
              type="button"
              onClick={() => onSelect(mod.id)}
              className={`rounded-2xl border p-5 text-left transition-all duration-200 group ${
                selected
                  ? 'border-brand-500/60 bg-brand-500/8 shadow-lg shadow-brand-500/5'
                  : 'border-surface-700 bg-surface-800 hover:border-surface-600 hover:bg-surface-700/60 hover:-translate-y-0.5'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 transition-colors ${
                  selected ? 'bg-brand-500/15 border border-brand-500/30' : 'bg-surface-700 border border-surface-600'
                }`}>
                  {moduleEmoji(mod.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-200">{mod.name}</p>
                    {selected && <CheckCircle2 size={15} className="text-brand-400 shrink-0" />}
                  </div>
                  {mod.description && (
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{mod.description}</p>
                  )}
                  {mod.is_dual && (
                    <p className="text-[10px] text-slate-600 mt-1.5">
                      Dual: <strong className="text-slate-500">{mod.asset_a}</strong>
                      <span className="text-slate-700 mx-1">+</span>
                      <strong className="text-slate-500">{mod.asset_b}</strong>
                    </p>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          disabled={selectedId === null}
          onClick={onNext}
          className="atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Answer indicators
// ─────────────────────────────────────────────────────────────────────────────

function StepAnswerIndicators({
  module, indicators, answers, onAnswer, onBack, onNext,
}: {
  module: MAModule
  indicators: MAIndicator[]
  answers: DraftAnswer[]
  onAnswer: (a: DraftAnswer) => void
  onBack: () => void
  onNext: () => void
}) {
  const byTf: Record<string, MAIndicator[]> = {}
  for (const ind of indicators) {
    if (!byTf[ind.timeframe_level]) byTf[ind.timeframe_level] = []
    byTf[ind.timeframe_level].push(ind)
  }
  const orderedTfs = TF_ORDER.filter((tf) => byTf[tf]?.length)
  const answered   = indicators.filter((i) => answers.some((a) => a.indicator_id === i.id)).length
  const total      = indicators.length
  const allDone    = answered === total && total > 0
  const pctDone    = total > 0 ? Math.round((answered / total) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Sticky progress bar */}
      <div className="sticky top-0 z-10 -mx-1 px-1 pb-3 pt-1 bg-surface-900/90 backdrop-blur-sm">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
          <span className="flex items-center gap-1.5">
            <span className="font-medium text-slate-400">
              {moduleEmoji(module.name)} {module.name}
            </span>
            <span className="text-slate-700">·</span>
            <span>Questions</span>
          </span>
          <span className={`font-mono font-semibold tabular-nums ${allDone ? 'text-emerald-400' : 'text-slate-400'}`}>
            {answered} / {total}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${allDone ? 'bg-emerald-500' : 'bg-brand-500'}`}
            style={{ width: `${pctDone}%` }}
          />
        </div>
      </div>

      {/* Grouped by timeframe */}
      {orderedTfs.map((tf) => {
        const meta    = TF_META[tf] ?? { label: tf, color: 'text-slate-400', dot: 'bg-surface-500' }
        const indList = byTf[tf]
        const tfDone  = indList.filter((i) => answers.some((a) => a.indicator_id === i.id)).length
        return (
          <div key={tf}>
            <div className="flex items-center gap-2.5 mb-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
              <h3 className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>
                {meta.label}
              </h3>
              <span className="text-[10px] text-slate-700 ml-auto tabular-nums">
                {tfDone}/{indList.length}
              </span>
            </div>
            <div className="space-y-3">
              {indList.map((ind) => (
                <IndicatorCard
                  key={ind.id}
                  indicator={ind}
                  answer={answers.find((a) => a.indicator_id === ind.id)}
                  onAnswer={onAnswer}
                />
              ))}
            </div>
          </div>
        )
      })}

      {/* Footer nav */}
      <div className="flex items-center justify-between pt-4 border-t border-surface-700">
        <button type="button" onClick={onBack} className="atd-btn-ghost">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-3">
          {!allDone && (
            <span className="text-xs text-amber-400">{total - answered} unanswered</span>
          )}
          <button
            type="button"
            disabled={!allDone}
            onClick={onNext}
            className="atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Review Summary <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Summary + Save
// ─────────────────────────────────────────────────────────────────────────────

function StepSummary({
  module, indicators, answers, notes, onNotes, saving, onBack, onSave, savedSession, conclusion, thresholds,
}: {
  module: MAModule
  indicators: MAIndicator[]
  answers: DraftAnswer[]
  notes: string
  onNotes: (v: string) => void
  saving: boolean
  onBack: () => void
  onSave: () => void
  savedSession: MASessionOut | null
  conclusion: MATradeConclusion | null
  thresholds: { bullish: number; bearish: number }
}) {
  const tfs = TF_ORDER.filter((tf) => indicators.some((i) => i.timeframe_level === tf))

  const scores = tfs.map((tf) => ({
    tf,
    pctA:  scorePct(answers, indicators, tf, 'a'),
    pctB:  module.is_dual ? scorePct(answers, indicators, tf, 'b') : null,
  }))

  // v2 block scores
  const blocks = (['trend', 'momentum', 'participation'] as const).map((block) => ({
    block,
    pctA: blockScorePct(answers, indicators, block, 'a'),
    pctB: module.is_dual ? blockScorePct(answers, indicators, block, 'b') : null,
  }))
  const BLOCK_META: Record<string, { label: string; icon: string }> = {
    trend:         { label: 'Trend',         icon: '📈' },
    momentum:      { label: 'Momentum',      icon: '⚡' },
    participation: { label: 'Participation', icon: '🧑‍🤝‍🧑' },
  }

  // Overall dominant bias (v1 HTF avg — for display)
  const allPcts = scores.flatMap((s) => [s.pctA, s.pctB]).filter((p): p is number => p !== null)
  const avgPct  = allPcts.length ? Math.round(allPcts.reduce((s, v) => s + v, 0) / allPcts.length) : null
  const overallBias = biasFromPct(avgPct)

  // v2 composite preview
  const WEIGHTS = { trend: 0.45, momentum: 0.30, participation: 0.25 }
  const blockScoresA = blocks.map((b) => b.pctA).filter((p): p is number => p !== null)
  const validBlocks = blocks.filter((b) => b.pctA !== null)
  const totalWeight = validBlocks.reduce((s, b) => s + WEIGHTS[b.block], 0)
  const compositeA = totalWeight > 0
    ? Math.round(validBlocks.reduce((s, b) => s + b.pctA! * WEIGHTS[b.block], 0) / totalWeight)
    : null
  const compositeBiasA = biasV2(compositeA, thresholds.bullish, thresholds.bearish)

  // conclusion color map
  const conclusionColorMap: Record<string, { bg: string; border: string; text: string }> = {
    green:   { bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', text: 'text-emerald-300' },
    amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   text: 'text-amber-300'   },
    red:     { bg: 'bg-red-500/10',     border: 'border-red-500/25',     text: 'text-red-300'     },
    neutral: { bg: 'bg-surface-700',    border: 'border-surface-600',    text: 'text-slate-400'   },
  }

  // Suppress unused variable warning
  void blockScoresA

  return (
    <div className="space-y-6">
      {/* Score panel */}
      <div className="rounded-2xl border border-surface-700 bg-surface-800 p-5 space-y-5">
        {/* Module title + overall badge */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">{moduleEmoji(module.name)}</span>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">{module.name}</h3>
              <p className="text-[10px] text-slate-600 mt-0.5">Score Summary</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ScoreRing pct={compositeA ?? avgPct} bias={compositeBiasA ?? overallBias} size={58} />
            <BiasBadgeLg bias={compositeBiasA ?? overallBias} />
          </div>
        </div>

        <div className="h-px bg-surface-700" />

        {/* v2 block scores */}
        {blocks.some((b) => b.pctA !== null) && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <TrendIcon size={11} className="text-brand-400" />
              <p className="text-[10px] uppercase tracking-wider font-semibold text-brand-400">
                Decomposed Scores (v2)
              </p>
              {compositeA !== null && (
                <span className={`ml-auto text-[10px] font-mono font-semibold ${
                  compositeBiasA === 'bullish' ? 'text-emerald-400'
                  : compositeBiasA === 'bearish' ? 'text-red-400' : 'text-amber-400'
                }`}>
                  Composite: {compositeA}%
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {blocks.map(({ block, pctA, pctB }) => {
                const meta = BLOCK_META[block]
                const bias = biasV2(pctA, thresholds.bullish, thresholds.bearish)
                const biasB = module.is_dual && pctB !== null ? biasV2(pctB, thresholds.bullish, thresholds.bearish) : null
                const fillA = bias === 'bullish' ? 'bg-emerald-500' : bias === 'bearish' ? 'bg-red-500' : 'bg-amber-400'
                const fillB = biasB === 'bullish' ? 'bg-emerald-500' : biasB === 'bearish' ? 'bg-red-500' : 'bg-amber-400'
                return (
                  <div key={block} className="rounded-xl border border-surface-600 bg-surface-700/30 p-3 space-y-2">
                    <p className="text-[10px] font-semibold text-slate-400">{meta.icon} {meta.label}</p>
                    {pctA !== null ? (
                      <div className="space-y-1">
                        {module.is_dual && <p className="text-[9px] text-slate-600">{module.asset_a ?? 'A'}</p>}
                        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
                          <div className={`h-full rounded-full ${fillA}`} style={{ width: `${pctA}%` }} />
                        </div>
                        <p className={`text-xs font-bold font-mono tabular-nums ${
                          bias === 'bullish' ? 'text-emerald-400' : bias === 'bearish' ? 'text-red-400' : 'text-amber-400'
                        }`}>{pctA}%</p>
                      </div>
                    ) : <p className="text-[10px] text-slate-700">—</p>}
                    {module.is_dual && pctB !== null && (
                      <div className="space-y-1 pt-1 border-t border-surface-600/60">
                        <p className="text-[9px] text-slate-600">{module.asset_b ?? 'B'}</p>
                        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
                          <div className={`h-full rounded-full ${fillB}`} style={{ width: `${pctB}%` }} />
                        </div>
                        <p className={`text-xs font-bold font-mono tabular-nums ${
                          biasB === 'bullish' ? 'text-emerald-400' : biasB === 'bearish' ? 'text-red-400' : 'text-amber-400'
                        }`}>{pctB}%</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="h-px bg-surface-700" />
          </>
        )}

        {/* Per-TF breakdown */}
        <div className="space-y-5">
          {scores.map(({ tf, pctA, pctB }) => {
            const meta    = TF_META[tf] ?? { label: tf, color: 'text-slate-400', dot: 'bg-surface-500' }
            const biasA   = biasFromPct(pctA)
            const biasB   = biasFromPct(pctB)
            return (
              <div key={tf}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                  <p className={`text-[10px] uppercase tracking-wider font-semibold ${meta.color}`}>
                    {meta.label}
                  </p>
                </div>
                <div className={`grid gap-3 ${module.is_dual ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
                  {/* Asset A */}
                  <div className="rounded-xl border border-surface-700 bg-surface-700/30 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-500 font-medium">
                        {module.is_dual ? (module.asset_a ?? 'Asset A') : module.name}
                      </span>
                      <BiasBadgeLg bias={biasA} />
                    </div>
                    <ScoreGaugeBar pct={pctA} />
                  </div>
                  {/* Asset B (dual only) */}
                  {module.is_dual && pctB !== null && (
                    <div className="rounded-xl border border-surface-700 bg-surface-700/30 p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500 font-medium">
                          {module.asset_b ?? 'Asset B'}
                        </span>
                        <BiasBadgeLg bias={biasB} />
                      </div>
                      <ScoreGaugeBar pct={pctB} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex gap-4 pt-1 text-[10px] text-slate-600 border-t border-surface-700/60">
          <span className="pt-2 text-red-400">▌ 0–39 Bearish</span>
          <span className="pt-2 text-amber-400">▌ 40–60 Neutral</span>
          <span className="pt-2 text-emerald-400">▌ 61–100 Bullish</span>
          <span className="pt-2 text-brand-400">
            ⚡ v2 Composite: ≤{thresholds.bearish} / {thresholds.bearish + 1}–{thresholds.bullish - 1} / ≥{thresholds.bullish}
          </span>
        </div>
      </div>

      {/* Trade conclusion — shown after save */}
      {savedSession && conclusion && (() => {
        const { bg, border, text } = conclusionColorMap[conclusion.color] ?? conclusionColorMap.neutral
        return (
          <div className={`rounded-2xl border p-5 space-y-3 ${bg} ${border}`}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{conclusion.emoji}</span>
              <div>
                <p className={`text-sm font-bold ${text}`}>{conclusion.label}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">{conclusion.detail}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px]">
              <span className="text-slate-500">Position size:</span>
              <span className={`font-semibold ${text}`}>{conclusion.size_advice}</span>
              {conclusion.trade_types.length > 0 && (
                <>
                  <span className="text-slate-700">·</span>
                  <span className="text-slate-500">{conclusion.trade_types.join(' · ')}</span>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* Notes */}
      {!savedSession && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">
            Notes <span className="text-slate-700">(optional)</span>
          </label>
          <textarea
            rows={3}
            placeholder="Context, market events, confluences, observations…"
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-surface-700 border border-surface-600 text-sm
              text-slate-200 placeholder-slate-600 leading-relaxed
              focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30
              transition-colors resize-none"
          />
        </div>
      )}

      {/* Footer nav */}
      <div className="flex items-center justify-between pt-4 border-t border-surface-700">
        <button type="button" onClick={onBack} className="atd-btn-ghost" disabled={saving || !!savedSession}>
          <ArrowLeft size={14} /> Back
        </button>
        {savedSession ? (
          <a href="/market-analysis" className="atd-btn-primary">
            <CheckCircle2 size={14} /> Done — Back to Analysis
          </a>
        ) : (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="atd-btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving
              ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
              : <><Save size={14} /> Save Analysis</>}
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// NewAnalysisPage
// ─────────────────────────────────────────────────────────────────────────────

export function NewAnalysisPage() {
  const { activeProfile } = useProfile()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const preselectedId = searchParams.get('module') ? Number(searchParams.get('module')) : null

  const [step,          setStep]          = useState<1 | 2 | 3>(preselectedId ? 2 : 1)
  const [modules,       setModules]       = useState<MAModule[]>([])
  const [selectedId,    setSelectedId]    = useState<number | null>(preselectedId)
  const [indicators,    setIndicators]    = useState<MAIndicator[]>([])
  const [answers,       setAnswers]       = useState<DraftAnswer[]>([])
  const [notes,         setNotes]         = useState('')
  const [loading,       setLoading]       = useState(false)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [savedSession,  setSavedSession]  = useState<MASessionOut | null>(null)
  const [conclusion,    setConclusion]    = useState<MATradeConclusion | null>(null)
  const [thresholds,    setThresholds]    = useState<{ bullish: number; bearish: number }>({ bullish: 65, bearish: 34 })

  // Load modules once
  useEffect(() => {
    maApi.listModules().then(setModules).catch((e: Error) => setError(e.message))
  }, [])

  // Load indicators when module is picked and step transitions to 2
  const loadIndicators = useCallback(async (moduleId: number) => {
    if (!activeProfile) return
    setLoading(true); setError(null)
    try {
      const [inds, cfg, thr] = await Promise.all([
        maApi.listIndicators(moduleId),
        maApi.getIndicatorConfig(activeProfile.id),
        maApi.getThresholds(moduleId),
      ])
      setThresholds(thr)
      const cfgMap: Record<number, boolean> = {}
      for (const c of cfg.configs) cfgMap[c.indicator_id] = c.enabled
      const activeInds = inds.filter((i) =>
        cfgMap[i.id] !== undefined ? cfgMap[i.id] : i.default_enabled,
      )
      setIndicators(activeInds)
      setAnswers([])
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [activeProfile])

  useEffect(() => {
    if (step === 2 && selectedId !== null) {
      loadIndicators(selectedId)
    }
  }, [step, selectedId, loadIndicators])

  const handleAnswer = (a: DraftAnswer) => {
    setAnswers((prev) => [...prev.filter((x) => x.indicator_id !== a.indicator_id), a])
  }

  const handleSave = async () => {
    if (!activeProfile || selectedId === null) return
    setSaving(true); setError(null)
    try {
      const payload: MAAnswerIn[] = answers.map((a) => ({
        indicator_id: a.indicator_id,
        score:        a.score,
        answer_label: a.answer_label,
      }))
      const session = await maApi.createSession({
        profile_id: activeProfile.id,
        module_id:  selectedId,
        answers:    payload,
        notes:      notes.trim() || null,
      })
      setSavedSession(session)
      // Load v2 conclusion if composite score is available
      if (session.score_composite_a != null) {
        try {
          const c = await maApi.getConclusion(session.id)
          setConclusion(c)
        } catch {
          // non-fatal: conclusion widget won't show
        }
      }
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const selectedModule = modules.find((m) => m.id === selectedId) ?? null

  return (
    <div className="max-w-2xl mx-auto">
      <PageHeader
        icon="🧭"
        title="New Analysis"
        subtitle="Complete the indicator checklist to compute your market bias"
        actions={
          <button type="button" className="atd-btn-ghost" onClick={() => navigate('/market-analysis')}>
            <ArrowLeft size={14} /> Back
          </button>
        }
      />

      {!activeProfile && (
        <div className="rounded-2xl bg-surface-800 border border-surface-700 p-12 text-center">
          <BarChart2 size={28} className="mx-auto mb-3 text-slate-700" />
          <p className="text-slate-500 text-sm">Select a profile to run an analysis.</p>
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-400 flex items-center gap-2">
          ⚠️ {error}
        </div>
      )}

      {activeProfile && (
        <>
          <WizardStepBar current={step} />

          {loading && (
            <div className="flex flex-col items-center gap-3 py-16 text-sm text-slate-500">
              <Loader2 size={24} className="animate-spin text-brand-500" />
              Loading indicators…
            </div>
          )}

          {!loading && step === 1 && (
            <StepChooseModule
              modules={modules}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onNext={() => setStep(2)}
            />
          )}

          {!loading && step === 2 && selectedModule && (
            <StepAnswerIndicators
              module={selectedModule}
              indicators={indicators}
              answers={answers}
              onAnswer={handleAnswer}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          )}

          {!loading && step === 3 && selectedModule && (
            <StepSummary
              module={selectedModule}
              indicators={indicators}
              answers={answers}
              notes={notes}
              onNotes={setNotes}
              saving={saving}
              onBack={() => setStep(2)}
              onSave={handleSave}
              savedSession={savedSession}
              conclusion={conclusion}
              thresholds={thresholds}
            />
          )}
        </>
      )}
    </div>
  )
}
