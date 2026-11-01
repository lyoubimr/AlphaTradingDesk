// ── Session review — notes, before/after captures, one-click verdict ─────────
//
// Answers and scores of a saved analysis stay immutable; this panel only adds
// what you need to judge the analysis later: captures, notes, a verdict, and
// the measured result of the trades taken under it.

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Columns2, Loader2, Save, Trash2, Upload, X, XCircle, MinusCircle } from 'lucide-react'
import { maApi } from '../../lib/api'
import type { MAEvaluation, MALinkedTrades, MASessionOut } from '../../types/api'

type Kind = 'before' | 'after'

const VERDICTS: { value: MAEvaluation; label: string; hint: string; icon: typeof CheckCircle2; tone: string }[] = [
  { value: 'correct', label: 'True',    hint: 'My read was right',                 icon: CheckCircle2, tone: 'border-green-600/50 bg-green-900/20 text-green-300' },
  { value: 'wrong',   label: 'False',   hint: 'My read was wrong',                 icon: XCircle,      tone: 'border-red-600/50 bg-red-900/20 text-red-300' },
  { value: 'neutral', label: 'Neutral', hint: "Market didn't move enough to tell", icon: MinusCircle,  tone: 'border-slate-500/50 bg-slate-700/30 text-slate-300' },
]

// ── Before / After comparison ────────────────────────────────────────────────
function CompareModal({ before, after, initial, onClose }: {
  before: string[]
  after: string[]
  initial: { kind: Kind; index: number }
  onClose: () => void
}) {
  const [bi, setBi] = useState(initial.kind === 'before' ? initial.index : 0)
  const [ai, setAi] = useState(initial.kind === 'after' ? initial.index : 0)

  const side = (label: string, urls: string[], idx: number, set: (n: number) => void) => (
    <div className="flex flex-col flex-1 min-w-0">
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</span>
        {urls.length > 1 && (
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <button type="button" disabled={idx === 0} onClick={() => set(idx - 1)}
              className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30">‹</button>
            {idx + 1}/{urls.length}
            <button type="button" disabled={idx === urls.length - 1} onClick={() => set(idx + 1)}
              className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30">›</button>
          </div>
        )}
      </div>
      <div className="flex-1 flex items-center justify-center p-4 min-h-0">
        {urls[idx]
          ? <img src={urls[idx]} alt={label} className="max-w-full max-h-full object-contain rounded-lg" />
          : <span className="text-slate-600 text-xs italic">No capture</span>}
      </div>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-[70] flex flex-col bg-black/95 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2 text-slate-300">
          <Columns2 size={15} />
          <span className="text-xs font-semibold uppercase tracking-wider">Before / After</span>
        </div>
        <button type="button" onClick={onClose}
          className="text-slate-400 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-1.5">
          <X size={16} />
        </button>
      </div>
      <div className="flex flex-1 min-h-0 divide-x divide-white/10">
        {side('📸 Before (analysis)', before, bi, setBi)}
        {side('📸 After (later)', after, ai, setAi)}
      </div>
    </div>
  )
}

// ── One capture zone (file picker, drag & drop, Ctrl+V while hovered) ────────
function ShotZone({ title, hint, urls, busy, onAdd, onDelete, onOpen }: {
  title: string
  hint: string
  urls: string[]
  busy: boolean
  onAdd: (files: File[]) => void
  onDelete: (url: string) => void
  onOpen: (index: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!hovered) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null)
        .map((f) => new File([f], `paste-${Date.now()}.png`, { type: f.type }))
      if (files.length > 0) onAdd(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [hovered, onAdd])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragging(false)
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
        if (files.length > 0) onAdd(files)
      }}
      className={`rounded-xl border p-3 space-y-2 transition-colors ${
        dragging ? 'border-brand-500/60 bg-brand-500/5' : 'border-surface-600 bg-surface-800/40'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-300">{title}</p>
          <p className="text-[10px] text-slate-600">{hint}</p>
        </div>
        <label className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-brand-500/30 text-brand-400 bg-brand-500/10 hover:bg-brand-500/15 cursor-pointer">
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
          Add
          <input
            type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) onAdd(files)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {urls.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic py-3 text-center">
          Drop images here, or hover and press Ctrl+V to paste
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {urls.map((url, i) => (
            <div key={url} className="relative group aspect-video rounded-lg overflow-hidden border border-surface-600 bg-black/30">
              <img
                src={url} alt={`${title} ${i + 1}`} loading="lazy"
                onClick={() => onOpen(i)}
                className="w-full h-full object-cover cursor-zoom-in"
              />
              <button
                type="button" onClick={() => onDelete(url)} title="Remove"
                className="absolute top-1 right-1 p-1 rounded bg-black/60 text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Panel ────────────────────────────────────────────────────────────────────
export function SessionReview({ session, onChange }: {
  session: MASessionOut
  onChange: (s: MASessionOut) => void
}) {
  const [notes, setNotes] = useState(session.notes ?? '')
  const [afterNotes, setAfterNotes] = useState(session.after_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<Kind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [compare, setCompare] = useState<{ kind: Kind; index: number } | null>(null)
  const [linked, setLinked] = useState<MALinkedTrades | null>(null)

  useEffect(() => {
    let cancelled = false
    maApi.getLinkedTrades(session.id)
      .then((l) => { if (!cancelled) setLinked(l) })
      .catch(() => { if (!cancelled) setLinked(null) })
    return () => { cancelled = true }
  }, [session.id])

  const dirty = notes !== (session.notes ?? '') || afterNotes !== (session.after_notes ?? '')

  const run = useCallback(async (fn: () => Promise<MASessionOut>) => {
    setError(null)
    try { onChange(await fn()) } catch (e: unknown) { setError((e as Error).message) }
  }, [onChange])

  const setVerdict = (v: MAEvaluation) =>
    run(() => maApi.updateSession(session.id, { evaluation: session.evaluation === v ? null : v }))

  const saveNotes = async () => {
    setSaving(true)
    await run(() => maApi.updateSession(session.id, { notes, after_notes: afterNotes }))
    setSaving(false)
  }

  const addFiles = useCallback(async (kind: Kind, files: File[]) => {
    setBusy(kind); setError(null)
    try {
      let latest: MASessionOut | null = null
      for (const f of files) latest = await maApi.uploadSessionScreenshot(session.id, kind, f)
      if (latest) onChange(latest)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }, [session.id, onChange])

  const before = session.screenshots_before ?? []
  const after = session.screenshots_after ?? []
  const pnl = linked ? Number(linked.total_pnl) : 0

  return (
    <div className="mt-6 rounded-2xl border border-surface-700 bg-surface-800 p-5 space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Review this analysis</h3>
        <p className="text-[11px] text-slate-600">
          Answers stay locked. Add captures and notes, then give a quick verdict.
        </p>
      </div>

      {error && <p className="text-xs text-red-400">⚠️ {error}</p>}

      {/* Verdict — one click */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-slate-400">Was my read right?</p>
        <div className="flex gap-2 flex-wrap">
          {VERDICTS.map(({ value, label, hint, icon: Icon, tone }) => {
            const active = session.evaluation === value
            return (
              <button
                key={value} type="button" title={hint} onClick={() => void setVerdict(value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  active ? tone : 'border-surface-600 text-slate-500 hover:text-slate-300 hover:border-slate-500'
                }`}
              >
                <Icon size={13} /> {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Captures */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ShotZone
          title="Before" hint="Charts at analysis time (S/R 4H + 1H drawn)"
          urls={before} busy={busy === 'before'}
          onAdd={(f) => void addFiles('before', f)}
          onDelete={(u) => void run(() => maApi.deleteSessionScreenshot(session.id, 'before', u))}
          onOpen={(i) => setCompare({ kind: 'before', index: i })}
        />
        <ShotZone
          title="After" hint="Same charts later — what actually happened"
          urls={after} busy={busy === 'after'}
          onAdd={(f) => void addFiles('after', f)}
          onDelete={(u) => void run(() => maApi.deleteSessionScreenshot(session.id, 'after', u))}
          onOpen={(i) => setCompare({ kind: 'after', index: i })}
        />
      </div>
      {before.length > 0 && after.length > 0 && (
        <button
          type="button" onClick={() => setCompare({ kind: 'before', index: 0 })}
          className="flex items-center gap-1.5 text-[11px] text-brand-400 hover:text-brand-300"
        >
          <Columns2 size={12} /> Compare before / after
        </button>
      )}

      {/* Notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-400">Analysis notes</span>
          <textarea
            rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="What I saw, levels, confluences…"
            className="w-full px-3 py-2 rounded-xl bg-surface-700 border border-surface-600 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-brand-500/60"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-medium text-slate-400">What happened</span>
          <textarea
            rows={4} value={afterNotes} onChange={(e) => setAfterNotes(e.target.value)}
            placeholder="Outcome, what I missed, lesson…"
            className="w-full px-3 py-2 rounded-xl bg-surface-700 border border-surface-600 text-xs text-slate-200 placeholder-slate-600 resize-none focus:outline-none focus:border-brand-500/60"
          />
        </label>
      </div>
      {dirty && (
        <button
          type="button" disabled={saving} onClick={() => void saveNotes()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand-500/30 text-brand-400 bg-brand-500/10 hover:bg-brand-500/15 text-xs disabled:opacity-50"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Save notes
        </button>
      )}

      {/* Measured result */}
      <div className="rounded-xl border border-surface-700 bg-surface-900/40 px-3 py-2.5 text-xs">
        <p className="text-slate-400 font-medium mb-1">Trades taken under this analysis</p>
        {linked === null ? (
          <p className="text-slate-600">Loading…</p>
        ) : linked.count === 0 ? (
          <p className="text-slate-600">No trade linked yet.</p>
        ) : (
          <div className="space-y-1.5">
            <p className="text-slate-300">
              {linked.count} trade{linked.count > 1 ? 's' : ''} · {linked.wins}/{linked.closed} won ·{' '}
              <span className={pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
              </span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {linked.trades.map((t) => {
                const p = t.realized_pnl === null ? null : Number(t.realized_pnl)
                return (
                  <a
                    key={t.id} href={`/trades/${t.id}`} target="_blank" rel="noreferrer"
                    className="px-2 py-0.5 rounded border border-surface-600 text-[10px] text-slate-400 hover:text-slate-200"
                  >
                    {t.pair} {t.direction}
                    {p !== null && (
                      <span className={p >= 0 ? 'text-green-400' : 'text-red-400'}> {p >= 0 ? '+' : ''}{p.toFixed(2)}</span>
                    )}
                  </a>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {compare && (
        <CompareModal before={before} after={after} initial={compare} onClose={() => setCompare(null)} />
      )}
    </div>
  )
}
