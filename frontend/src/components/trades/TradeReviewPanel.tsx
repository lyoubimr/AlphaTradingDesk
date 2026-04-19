// ── TradeReviewPanel ──────────────────────────────────────────────────────
// Merged post-trade review widget: outcome selector, per-strategy compliance,
// tag badges (with emojis), notes, close screenshots.
//
// Auto-saves outcome+tags on change (debounced 800ms, ref-stable to avoid
// flickering caused by parent inline function references).
// "Save Review" button persists close_notes + review in one action.

import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, CheckCircle2, Save } from 'lucide-react'
import { tradesApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { TradeOut, ReviewOutcome } from '../../types/api'
import { EXECUTION_TAGS, PSYCHOLOGY_TAGS, MARKET_TAGS } from './reviewTagDefs'
import type { TagDef } from './reviewTagDefs'

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
  strategies: StrategyRef[]
  onUpdated: (updated: TradeOut) => void
  // ── Notes (close_notes column) ─────────────────────────────────────────
  closeNotes: string
  onCloseNotesChange: (v: string) => void
  onCloseNotesSave: () => Promise<void>
  savingCloseNotes: boolean
  // ── Close screenshots rendered by parent ──────────────────────────────
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
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(
    existing?.reviewed_at ? new Date(existing.reviewed_at) : null,
  )

  // Dirty = review fields differ from last-persisted values
  const savedOutcome = useRef<ReviewOutcome | null>(existing?.outcome ?? null)
  const savedTags    = useRef<string[]>(existing?.tags ?? [])
  const savedNotes   = useRef<string>(trade.close_notes ?? '')
  const isDirty =
    outcome !== savedOutcome.current ||
    JSON.stringify([...tags].sort()) !== JSON.stringify([...savedTags.current].sort()) ||
    closeNotes !== savedNotes.current

  const initialised = useRef(false)
  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Stable save fn — ref pattern prevents parent re-render flickering ──
  const triggerSave = useCallback(
    (nextOutcome: ReviewOutcome | null, nextTags: string[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        setSaving(true)
        try {
          const updated = await tradesApi.saveReview(trade.id, {
            outcome: nextOutcome,
            tags: nextTags,
            note: null,
          })
          onUpdated(updated)
          savedOutcome.current = nextOutcome
          savedTags.current = nextTags
          setSavedAt(new Date())
        } catch { /* silent — explicit Save button as fallback */ }
        finally { setSaving(false) }
      }, 800)
    },
    [trade.id, onUpdated],
  )
  // Keep the ref always fresh without making it a dep in the data-change effect
  const triggerSaveRef = useRef(triggerSave)
  useEffect(() => { triggerSaveRef.current = triggerSave }, [triggerSave])

  useEffect(() => {
    if (!initialised.current) { initialised.current = true; return }
    if (isClosed) triggerSaveRef.current(outcome, tags)
  }, [outcome, tags, isClosed])

  function handleTagToggle(tag: TagDef) {
    setTags((prev) => {
      if (tag.mode === 'tri-state') {
        const hasGood = prev.includes(tag.key)
        const hasBad  = tag.badKey ? prev.includes(tag.badKey) : false
        const without = prev.filter((t) => t !== tag.key && t !== (tag.badKey ?? '__never__'))
        if (!hasGood && !hasBad) return [...without, tag.key]  // null → good
        if (hasGood) return [...without, tag.badKey!]          // good → bad
        return without                                          // bad → null
      }
      // flag: simple toggle
      return prev.includes(tag.key) ? prev.filter((t) => t !== tag.key) : [...prev, tag.key]
    })
  }

  // Per-strategy compliance: 2 states — respected (default) / broken
  // Only `strategy_broken_<id>` is stored; absent = respected
  type StrategyCompliance = 'respected' | 'broken'
  function getStrategyState(sid: number): StrategyCompliance {
    if (tags.includes(`strategy_broken_${sid}`)) return 'broken'
    return 'respected'
  }
  function cycleStrategyState(sid: number) {
    const current = getStrategyState(sid)
    setTags((prev) => {
      const without = prev.filter(
        (t) => t !== `strategy_respected_${sid}` && t !== `strategy_broken_${sid}`,
      )
      if (current === 'respected') return [...without, `strategy_broken_${sid}`]
      return without // broken → respected (implicit)
    })
  }

  async function handleSaveAll() {
    setSaving(true)
    try {
      const [updated] = await Promise.all([
        tradesApi.saveReview(trade.id, { outcome, tags, note: null }),
        onCloseNotesSave(),
      ])
      onUpdated(updated)
      savedOutcome.current = outcome
      savedTags.current = tags
      savedNotes.current = closeNotes
      setSavedAt(new Date())
    } catch { /* silent */ }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">

      {/* ── Section header ─────────────────────────────────────────────── */}
      {(() => {
        const reviewTags = (existing?.tags ?? []).filter((t) => !t.startsWith('strategy_broken_'))
        const isReviewed = Boolean(
          existing?.outcome &&
          (trade.close_notes ?? '').trim() &&
          (trade.close_screenshot_urls ?? []).length > 0 &&
          reviewTags.length > 0
        )
        return (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">📋</span>
              <p className="text-xs font-semibold text-slate-300 tracking-wide">Post-Trade Review</p>
              {isReviewed && (
                <span
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-medium text-emerald-400"
                  title="Review complète : outcome + notes + screenshot + tags"
                >
                  📋 reviewed
                </span>
              )}
            </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 size={11} className="animate-spin text-slate-500" />}
          {!saving && savedAt && !isDirty && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400/60">
              <CheckCircle2 size={10} /> Saved
            </span>
          )}
          <SaveButton
            dirty={isDirty}
            busy={saving || savingCloseNotes}
            onClick={() => void handleSaveAll()}
          />
        </div>
      </div>
        )
      })()}

      {/* ── Outcome (closed/runner only) ──────────────────────────────── */}
      {isClosed ? (
        <div className="space-y-2">
          <CatLabel>🏆 Outcome</CatLabel>
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
      ) : (
        <p className="text-[10px] text-slate-600 italic">🏆 Outcome disponible après clôture.</p>
      )}

      {/* ── Strategy compliance — toujours visible ────────────────────── */}
      <div className="space-y-2">
        <CatLabel>📊 Strategy respected</CatLabel>
        {strategies.length === 0 ? (
          <p className="text-[10px] text-slate-600 italic">Aucune stratégie assignée à ce trade.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {strategies.map((s) => {
              const state = getStrategyState(s.id)
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => cycleStrategyState(s.id)}
                  title={
                    state === 'respected'
                      ? 'Respectée ✓ — cliquer pour marquer comme non respectée'
                      : 'Non respectée ✗ — cliquer pour marquer comme respectée'
                  }
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-150',
                    state === 'respected'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
                      : 'border-red-500/50 bg-red-500/10 text-red-400',
                  )}
                >
                  <span>{s.emoji ?? '📌'}</span>
                  <span>{s.name}</span>
                  <span className={cn(
                    'ml-1 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold border',
                    state === 'respected'
                      ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300'
                      : 'border-red-500/50 bg-red-500/20 text-red-300',
                  )}>
                    {state === 'respected' ? '✓' : '✗'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Tags — toujours visibles (FOMO/Rule broken s'appliquent à tout moment) */}
      <div className="space-y-4">
        <TagSection title="⚙️ Execution"  tags={EXECUTION_TAGS}  active={tags} onToggle={handleTagToggle} />
        <TagSection title="🧠 Psychology" tags={PSYCHOLOGY_TAGS} active={tags} onToggle={handleTagToggle} />
        <TagSection title="🌍 Market"     tags={MARKET_TAGS}     active={tags} onToggle={handleTagToggle} />
      </div>

      {/* ── Divider ──────────────────────────────────────────────────── */}
      <div className="border-t border-surface-700/50" />

      {/* ── Notes (close_notes — the one and only post-trade note) ──────── */}
      <div className="space-y-1.5">
        <CatLabel>📝 Notes</CatLabel>
        <textarea
          value={closeNotes}
          onChange={(e) => onCloseNotesChange(e.target.value)}
          rows={4}
          placeholder="What happened? Key lesson, would you take it again…"
          className="w-full rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2 text-xs text-slate-300 placeholder-slate-600 resize-none focus:border-brand-500/60 focus:outline-none focus:ring-1 focus:ring-brand-500/20 transition-colors"
        />
      </div>

      {/* ── Close screenshots ────────────────────────────────────────── */}
      <div className="space-y-2">
        <CatLabel>📸 Screenshots</CatLabel>
        {renderCloseScreenshots()}
      </div>



    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Compact inline save button — lights up amber when dirty, muted when clean */
function SaveButton({ dirty, busy, onClick }: { dirty: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || !dirty}
      className={cn(
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all duration-200',
        dirty && !busy
          ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 hover:border-amber-500/80 shadow-sm shadow-amber-500/20'
          : 'border-surface-600 bg-surface-800 text-slate-600 cursor-default',
      )}
    >
      {busy
        ? <Loader2 size={11} className="animate-spin" />
        : <Save size={11} className={dirty ? 'text-amber-400' : 'text-slate-600'} />
      }
      Save
    </button>
  )
}
function CatLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-slate-400 tracking-wide">{children}</p>
  )
}

interface TagSectionProps {
  title: string
  tags: TagDef[]
  active: string[]
  onToggle: (tag: TagDef) => void
}

function TagSection({ title, tags, active, onToggle }: TagSectionProps) {
  const triStateTags = tags.filter((t) => t.mode === 'tri-state')
  const flagTags     = tags.filter((t) => t.mode !== 'tri-state')

  function getTriState(tag: TagDef): 'null' | 'good' | 'bad' {
    if (active.includes(tag.key)) return 'good'
    if (tag.badKey && active.includes(tag.badKey)) return 'bad'
    return 'null'
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-slate-400 tracking-wide">{title}</p>

      {/* Tri-state: null ? → good ✓ → bad ✗ → null */}
      {triStateTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {triStateTags.map((tag) => {
            const state = getTriState(tag)
            return (
              <button
                key={tag.key}
                type="button"
                onClick={() => onToggle(tag)}
                title={
                  state === 'null' ? (tag.nullDesc ?? `${tag.label} — non évalué`) :
                  state === 'good' ? (tag.goodDesc ?? `${tag.label} ✓`) :
                                     (tag.badDesc  ?? `${tag.label} ✗`)
                }
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-150',
                  state === 'good' ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400' :
                  state === 'bad'  ? 'border-red-500/50 bg-red-500/10 text-red-400' :
                                     'border-surface-600 bg-surface-800/60 text-slate-500 hover:border-surface-500 hover:text-slate-400',
                )}
              >
                <span>{tag.emoji}</span>
                <span>{tag.label}</span>
                <span className={cn(
                  'ml-1 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold border',
                  state === 'good' ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' :
                  state === 'bad'  ? 'border-red-500/50 bg-red-500/20 text-red-300' :
                                     'border-surface-600 bg-surface-700 text-slate-600',
                )}>
                  {state === 'good' ? '✓' : state === 'bad' ? '✗' : '?'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Flag badges: event-based (click to activate) */}
      {flagTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flagTags.map((tag) => {
            const isActive = active.includes(tag.key)
            return (
              <button
                key={tag.key}
                type="button"
                onClick={() => onToggle(tag)}
                title={tag.description}
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
      )}
    </div>
  )
}
