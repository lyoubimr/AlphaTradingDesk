// ── TradeReviewPanel ──────────────────────────────────────────────────────
// Post-trade review widget for TradeDetailPage.
//
// Shows:
//   1. Outcome selector (4 buttons, auto-pre-selected from R multiple)
//   2. Badge grid in 3 categories (Execution / Psychology / Market)
//   3. Optional free-text note
//
// Auto-saves on any change (debounced 800ms).
// Accepts custom tags from profile review_tags_settings (future: todo 7).

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { tradesApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { TradeOut, PostTradeReview, ReviewOutcome } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Static tag definitions
// ─────────────────────────────────────────────────────────────────────────────

interface TagDef {
  key: string
  label: string
  positive: boolean // true = green badge (good), false = red/amber badge (bad)
}

const EXECUTION_TAGS: TagDef[] = [
  { key: 'strategy_respected', label: 'Strategy respected', positive: true },
  { key: 'good_entry',         label: 'Good entry',         positive: true },
  { key: 'good_sl',            label: 'Good SL',            positive: true },
  { key: 'early_exit',         label: 'Early exit',         positive: false },
  { key: 'late_exit',          label: 'Late exit',          positive: false },
  { key: 'sl_be_early',        label: 'BE too early',       positive: false },
]

const PSYCHOLOGY_TAGS: TagDef[] = [
  { key: 'fomo',         label: 'FOMO',          positive: false },
  { key: 'revenge',      label: 'Revenge trade', positive: false },
  { key: 'rule_broken',  label: 'Rule broken',   positive: false },
]

const MARKET_TAGS: TagDef[] = [
  { key: 'weekend_scam', label: 'Weekend scam', positive: false },
  { key: 'news_impact',  label: 'News impact',  positive: false },
]

// ─────────────────────────────────────────────────────────────────────────────
// Outcome selector
// ─────────────────────────────────────────────────────────────────────────────

interface OutcomeDef {
  key: ReviewOutcome
  emoji: string
  label: string
  color: string       // tailwind active bg
  border: string      // tailwind active border
  text: string        // tailwind active text
}

const OUTCOMES: OutcomeDef[] = [
  { key: 'poor',            emoji: '😤', label: 'Poor execution',  color: 'bg-red-500/20',     border: 'border-red-500/50',     text: 'text-red-400' },
  { key: 'could_do_better', emoji: '🤔', label: 'Could do better', color: 'bg-amber-500/20',   border: 'border-amber-500/50',   text: 'text-amber-400' },
  { key: 'well_executed',   emoji: '👍', label: 'Well executed',   color: 'bg-green-500/20',   border: 'border-green-500/50',   text: 'text-green-400' },
  { key: 'excellent',       emoji: '🎯', label: 'Excellent',       color: 'bg-emerald-500/20', border: 'border-emerald-500/50', text: 'text-emerald-400' },
]

/** Suggest an outcome from R multiple (realized_pnl / risk_amount). */
function suggestOutcome(
  realizedPnl: string | null,
  riskAmount: string | null,
): ReviewOutcome | null {
  if (realizedPnl == null || riskAmount == null) return null
  const pnl = parseFloat(realizedPnl)
  const risk = parseFloat(riskAmount)
  if (isNaN(pnl) || isNaN(risk) || risk === 0) return null
  const r = pnl / risk
  if (r > 1) return 'excellent'
  if (r > 0) return 'well_executed'
  if (r > -0.8) return 'could_do_better'
  return 'poor'
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  trade: TradeOut
  onUpdated: (updated: TradeOut) => void
}

export function TradeReviewPanel({ trade, onUpdated }: Props) {
  const existing = trade.post_trade_review

  const suggested = suggestOutcome(
    trade.realized_pnl ?? null,
    String(trade.risk_amount),
  )

  const [outcome, setOutcome] = useState<ReviewOutcome | null>(
    existing?.outcome ?? suggested ?? null,
  )
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [note, setNote] = useState<string>(existing?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(
    existing?.reviewed_at ? new Date(existing.reviewed_at) : null,
  )

  // Keep a "dirty" flag so we only send when something changed
  const initialised = useRef(false)

  // Debounced auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const triggerSave = useCallback(
    (nextOutcome: ReviewOutcome | null, nextTags: string[], nextNote: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        setSaving(true)
        try {
          const updated = await tradesApi.saveReview(trade.id, {
            outcome: nextOutcome,
            tags: nextTags,
            note: nextNote || null,
          })
          onUpdated(updated)
          setSavedAt(new Date())
        } catch {
          // Silently ignore — user can retry
        } finally {
          setSaving(false)
        }
      }, 800)
    },
    [trade.id, onUpdated],
  )

  // Skip auto-save on first render (we don't want to write on mount if unchanged)
  useEffect(() => {
    if (!initialised.current) {
      initialised.current = true
      return
    }
    triggerSave(outcome, tags, note)
  }, [outcome, tags, note, triggerSave])

  function toggleTag(key: string) {
    setTags((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key],
    )
  }

  return (
    <div className="space-y-4">
      {/* Header + saved indicator */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
          📋 Trade review
        </p>
        <div className="flex items-center gap-1.5">
          {saving && <Loader2 size={10} className="animate-spin text-slate-500" />}
          {!saving && savedAt && (
            <span className="flex items-center gap-1 text-[9px] text-emerald-400/70">
              <CheckCircle2 size={9} /> Saved
            </span>
          )}
          {!saving && !savedAt && (
            <span className="text-[9px] text-slate-600 italic">auto-saves on change</span>
          )}
        </div>
      </div>

      {/* ── Outcome selector ─────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold">Outcome</p>
        <div className="grid grid-cols-2 gap-1.5">
          {OUTCOMES.map((o) => {
            const active = outcome === o.key
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setOutcome(active ? null : o.key)}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 rounded-lg border py-2 px-1 text-center transition-all',
                  active
                    ? `${o.color} ${o.border} ${o.text}`
                    : 'border-surface-700 bg-surface-800 text-slate-500 hover:border-surface-600 hover:text-slate-400',
                )}
              >
                <span className="text-base leading-none">{o.emoji}</span>
                <span className="text-[9px] font-medium leading-tight">{o.label}</span>
                {o.key === suggested && !active && (
                  <span className="text-[8px] text-slate-600 italic">suggested</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Tag badges ───────────────────────────────────────────────────── */}
      <div className="space-y-2.5">
        <TagSection title="Execution" tags={EXECUTION_TAGS} active={tags} onToggle={toggleTag} />
        <TagSection title="Psychology" tags={PSYCHOLOGY_TAGS} active={tags} onToggle={toggleTag} />
        <TagSection title="Market" tags={MARKET_TAGS} active={tags} onToggle={toggleTag} />
      </div>

      {/* ── Free-text note ───────────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold">Note</p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Key lesson, what would you change, would you take it again…"
          className="w-full rounded-lg border border-surface-700 bg-surface-900 px-3 py-2 text-xs text-slate-300 placeholder-slate-600 resize-none focus:border-brand-500/60 focus:outline-none focus:ring-1 focus:ring-brand-500/30 transition-colors"
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TagSection helper
// ─────────────────────────────────────────────────────────────────────────────

interface TagSectionProps {
  title: string
  tags: TagDef[]
  active: string[]
  onToggle: (key: string) => void
}

function TagSection({ title, tags, active, onToggle }: TagSectionProps) {
  return (
    <div className="space-y-1">
      <p className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const isActive = active.includes(tag.key)
          return (
            <button
              key={tag.key}
              type="button"
              onClick={() => onToggle(tag.key)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-all',
                isActive
                  ? tag.positive
                    ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400'
                    : 'border-red-500/50 bg-red-500/15 text-red-400'
                  : 'border-surface-700 bg-surface-800 text-slate-500 hover:border-surface-600 hover:text-slate-400',
              )}
            >
              {tag.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
