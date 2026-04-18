// ── TradeReviewPanel ──────────────────────────────────────────────────────
// Merged post-trade review widget: outcome selector, per-strategy compliance,
// tag badges (with emojis), review note, close notes, close screenshots.
//
// Saves review (outcome/tags/note) with 800ms auto-save debounce + explicit
// "Save Review" button that also persists close_notes in one action.

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, CheckCircle2, Save } from 'lucide-react'
import { tradesApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { TradeOut, ReviewOutcome } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Static tag definitions — with emojis
// ─────────────────────────────────────────────────────────────────────────────

interface TagDef {
  key: string
  emoji: string
  label: string
  positive: boolean
}

// strategy_respected is handled separately via per-strategy compliance section
const EXECUTION_TAGS: TagDef[] = [
  { key: 'good_entry',  emoji: '✅', label: 'Good entry',   positive: true  },
  { key: 'good_sl',     emoji: '🛡️', label: 'Good SL',     positive: true  },
  { key: 'early_exit',  emoji: '⏩', label: 'Early exit',   positive: false },
  { key: 'late_exit',   emoji: '⏰', label: 'Late exit',    positive: false },
  { key: 'sl_be_early', emoji: '⚡', label: 'BE too early', positive: false },
]

const PSYCHOLOGY_TAGS: TagDef[] = [
  { key: 'fomo',        emoji: '😱', label: 'FOMO',          positive: false },
  { key: 'revenge',     emoji: '😤', label: 'Revenge trade', positive: false },
  { key: 'rule_broken', emoji: '🚫', label: 'Rule broken',   positive: false },
]

const MARKET_TAGS: TagDef[] = [
  { key: 'weekend_scam', emoji: '🎰', label: 'Weekend scam', positive: false },
  { key: 'news_impact',  emoji: '📰', label: 'News impact',  positive: false },
]

// ─────────────────────────────────────────────────────────────────────────────
// Outcome selector
// ─────────────────────────────────────────────────────────────────────────────

interface OutcomeDef {
  key: ReviewOutcome
  emoji: string
  label: string
  color: string
  border: string
  text: string
  glow: string
}

const OUTCOMES: OutcomeDef[] = [
  { key: 'poor',            emoji: '💀', label: 'Poor execution',  color: 'bg-red-500/20',     border: 'border-red-500/60',     text: 'text-red-400',     glow: 'shadow-red-500/20' },
  { key: 'could_do_better', emoji: '🤔', label: 'Could do better', color: 'bg-amber-500/20',   border: 'border-amber-500/60',   text: 'text-amber-400',   glow: 'shadow-amber-500/20' },
  { key: 'well_executed',   emoji: '👍', label: 'Well executed',   color: 'bg-green-500/20',   border: 'border-green-500/60',   text: 'text-green-400',   glow: 'shadow-green-500/20' },
  { key: 'excellent',       emoji: '🎯', label: 'Excellent',       color: 'bg-emerald-500/20', border: 'border-emerald-500/60', text: 'text-emerald-400', glow: 'shadow-emerald-500/20' },
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

export interface StrategyRef {
  id: number
  name: string
  emoji: string | null
}

interface Props {
  trade: TradeOut
  strategies: StrategyRef[]                // strategies linked to this trade (resolved)
  onUpdated: (updated: TradeOut) => void
  // ── Merged close notes ─────────────────────────────────────────────────
  closeNotes: string
  onCloseNotesChange: (v: string) => void
  onCloseNotesSave: () => Promise<void>
  savingCloseNotes: boolean
  // ── Close screenshots rendered by parent (SnapshotGallery) ────────────
  renderCloseScreenshots: () => React.ReactNode
}

export function TradeReviewPanel({
  trade,
  strategies,
  onUpdated,
  closeNotes,
  onCloseNotesChange,
  onCloseNotesSave,
  savingCloseNotes,
  renderCloseScreenshots,
}: Props) {
  const existing = trade.post_trade_review
  const isClosed = trade.status === 'closed' || trade.status === 'runner'

  const suggested = suggestOutcome(
    trade.realized_pnl ?? null,
    String(trade.risk_amount),
  )

  const [outcome, setOutcome] = useState<ReviewOutcome | null>(
    existing?.outcome ?? (isClosed ? (suggested ?? null) : null),
  )
  const [tags, setTags] = useState<string[]>(existing?.tags ?? [])
  const [note, setNote] = useState<string>(existing?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(
    existing?.reviewed_at ? new Date(existing.reviewed_at) : null,
  )

  const initialised = useRef(false)
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
          // Silently ignore — user can retry via explicit save button
        } finally {
          setSaving(false)
        }
      }, 800)
    },
    [trade.id, onUpdated],
  )

  useEffect(() => {
    if (!initialised.current) { initialised.current = true; return }
    if (isClosed) triggerSave(outcome, tags, note)
  }, [outcome, tags, note, triggerSave, isClosed])

  function toggleTag(key: string) {
    setTags((prev) => prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key])
  }

  // Tag key for per-strategy compliance: strategy_respected_<id>
  function strategyTagKey(sid: number) { return `strategy_respected_${sid}` }
  // Backward compat: also check legacy generic tag
  function isStrategyRespected(sid: number) {
    return tags.includes(strategyTagKey(sid))
  }
  function toggleStrategyRespected(sid: number) {
    const key = strategyTagKey(sid)
    setTags((prev) => prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key])
  }

  async function handleSaveAll() {
    setSaving(true)
    try {
      const [updated] = await Promise.all([
        tradesApi.saveReview(trade.id, { outcome, tags, note: note || null }),
        onCloseNotesSave(),
      ])
      onUpdated(updated)
      setSavedAt(new Date())
    } catch {
      // ignore — user can see the auto-save fallback
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">

      {/* ── Section header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📋</span>
          <p className="text-xs font-semibold text-slate-300 tracking-wide">Post-Trade Review</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 size={11} className="animate-spin text-slate-500" />}
          {!saving && savedAt && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400/70">
              <CheckCircle2 size={10} /> Saved
            </span>
          )}
          {!saving && !savedAt && isClosed && (
            <span className="text-[9px] text-slate-600 italic">auto-saves on change</span>
          )}
        </div>
      </div>

      {isClosed ? (
        <>
          {/* ── Outcome selector ──────────────────────────────────────── */}
          <div className="space-y-2">
            <SectionLabel>🏆 Outcome</SectionLabel>
            <div className="grid grid-cols-4 gap-1.5">
              {OUTCOMES.map((o) => {
                const active = outcome === o.key
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => setOutcome(active ? null : o.key)}
                    className={cn(
                      'relative flex flex-col items-center justify-center gap-1 rounded-xl border py-3 px-1 text-center transition-all duration-200',
                      active
                        ? `${o.color} ${o.border} ${o.text} shadow-lg ${o.glow}`
                        : 'border-surface-700 bg-surface-800/60 text-slate-500 hover:border-surface-600 hover:bg-surface-800 hover:text-slate-400',
                    )}
                  >
                    <span className="text-xl leading-none">{o.emoji}</span>
                    <span className="text-[9px] font-semibold leading-tight tracking-wide">{o.label}</span>
                    {o.key === suggested && !active && (
                      <span className="absolute -top-1.5 right-1 text-[7px] text-brand-400/70 font-medium">
                        suggested
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Strategy compliance ───────────────────────────────────── */}
          {strategies.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>📊 Strategy compliance</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {strategies.map((s) => {
                  const respected = isStrategyRespected(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStrategyRespected(s.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-150',
                        respected
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                          : 'border-surface-600 bg-surface-800/60 text-slate-500 hover:border-surface-500 hover:text-slate-400',
                      )}
                    >
                      <span>{s.emoji ?? '📌'}</span>
                      <span>{s.name}</span>
                      <span className={cn(
                        'ml-1 rounded-full px-1.5 py-0 text-[9px] font-bold border',
                        respected
                          ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                          : 'border-surface-600 bg-surface-700 text-slate-600',
                      )}>
                        {respected ? '✓' : '✗'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Execution tags ────────────────────────────────────────── */}
          <div className="space-y-3">
            <TagSection title="⚙️ Execution" tags={EXECUTION_TAGS} active={tags} onToggle={toggleTag} />
            <TagSection title="🧠 Psychology" tags={PSYCHOLOGY_TAGS} active={tags} onToggle={toggleTag} />
            <TagSection title="🌍 Market"    tags={MARKET_TAGS}     active={tags} onToggle={toggleTag} />
          </div>

          {/* ── Review note ───────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <SectionLabel>✏️ Review note</SectionLabel>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Key lesson, what would you change, would you take it again…"
              className="w-full rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2 text-xs text-slate-300 placeholder-slate-600 resize-none focus:border-brand-500/60 focus:outline-none focus:ring-1 focus:ring-brand-500/20 transition-colors"
            />
          </div>
        </>
      ) : (
        <p className="text-[11px] text-slate-600 italic">Review available after closing the trade.</p>
      )}

      {/* ── Divider ──────────────────────────────────────────────────── */}
      <div className="border-t border-surface-700/50" />

      {/* ── Close notes ──────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <SectionLabel>📝 Close notes</SectionLabel>
        <textarea
          value={closeNotes}
          onChange={(e) => onCloseNotesChange(e.target.value)}
          rows={4}
          placeholder="What happened? Key lessons? Would you take this again?"
          className="w-full rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2 text-xs text-slate-300 placeholder-slate-600 resize-none focus:border-brand-500/60 focus:outline-none focus:ring-1 focus:ring-brand-500/20 transition-colors"
        />
      </div>

      {/* ── Close screenshots (rendered by parent) ────────────────────── */}
      <div className="space-y-2">
        <SectionLabel>📸 Close screenshots</SectionLabel>
        {renderCloseScreenshots()}
      </div>

      {/* ── Save button ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => void handleSaveAll()}
        disabled={saving || savingCloseNotes}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-brand-600/25 border border-brand-500/40 text-sm font-semibold text-brand-300 hover:bg-brand-600/35 hover:border-brand-500/60 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {(saving || savingCloseNotes)
          ? <Loader2 size={14} className="animate-spin" />
          : <Save size={14} />
        }
        Save Review
      </button>

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{children}</p>
  )
}

interface TagSectionProps {
  title: string
  tags: TagDef[]
  active: string[]
  onToggle: (key: string) => void
}

function TagSection({ title, tags, active, onToggle }: TagSectionProps) {
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] uppercase tracking-widest text-slate-600 font-semibold">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => {
          const isActive = active.includes(tag.key)
          return (
            <button
              key={tag.key}
              type="button"
              onClick={() => onToggle(tag.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all duration-150',
                isActive
                  ? tag.positive
                    ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/10'
                    : 'border-red-500/60 bg-red-500/15 text-red-300 shadow-sm shadow-red-500/10'
                  : 'border-surface-600 bg-surface-800/60 text-slate-500 hover:border-surface-500 hover:text-slate-400',
              )}
            >
              <span className="leading-none">{tag.emoji}</span>
              <span>{tag.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
