// ── Session review — notes, before/after captures, one-click verdict ─────────
//
// Answers and scores of a saved analysis stay immutable; this panel only adds
// what you need to judge the analysis later: captures, notes, a verdict, and
// the measured result of the trades taken under it.

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Columns2, Loader2, Save, Trash2, Upload, X, XCircle, MinusCircle } from 'lucide-react'
import { maApi } from '../../lib/api'
import type { MAEvaluation, MALinkedTrades, MASessionOut, MAShot } from '../../types/api'
import { fmtElapsed, fmtShotTime } from './shotFormat'

type Kind = 'before' | 'after'

const CAPTION_PRESETS = ['BTC', 'BTC.D', 'TOTAL2', 'USDT.D', 'Other']

const VERDICTS: { value: MAEvaluation; label: string; hint: string; icon: typeof CheckCircle2; tone: string }[] = [
  { value: 'correct', label: 'True',    hint: 'My read was right',                 icon: CheckCircle2, tone: 'border-green-600/50 bg-green-900/20 text-green-300' },
  { value: 'wrong',   label: 'False',   hint: 'My read was wrong',                 icon: XCircle,      tone: 'border-red-600/50 bg-red-900/20 text-red-300' },
  { value: 'neutral', label: 'Neutral', hint: "Market didn't move enough to tell", icon: MinusCircle,  tone: 'border-slate-500/50 bg-slate-700/30 text-slate-300' },
]

// ── Before / After comparison (captions with the same name line up) ──────────
export function CompareModal({ before, after, analyzedAt, initial, onClose }: {
  before: MAShot[]
  after: MAShot[]
  analyzedAt?: string | null
  initial?: { kind: Kind; index: number }
  onClose: () => void
}) {
  const matchIn = (list: MAShot[], caption: string | null) =>
    caption ? list.findIndex((s) => s.caption === caption) : -1

  const [idx, setIdx] = useState(() => {
    const start = initial ?? { kind: 'before' as Kind, index: 0 }
    if (start.kind === 'before') {
      const m = matchIn(after, before[start.index]?.caption ?? null)
      return { b: start.index, a: m >= 0 ? m : 0 }
    }
    const m = matchIn(before, after[start.index]?.caption ?? null)
    return { b: m >= 0 ? m : 0, a: start.index }
  })

  const pickBefore = (i: number) => {
    const m = matchIn(after, before[i]?.caption ?? null)
    setIdx((p) => ({ b: i, a: m >= 0 ? m : p.a }))
  }
  const pickAfter = (i: number) => {
    const m = matchIn(before, after[i]?.caption ?? null)
    setIdx((p) => ({ a: i, b: m >= 0 ? m : p.b }))
  }

  const side = (label: string, list: MAShot[], i: number, pick: (n: number) => void, extra?: string) => {
    const shot = list[i]
    return (
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">{label}</span>
            {shot?.caption && <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-300">{shot.caption}</span>}
            {shot?.at && <span className="text-[10px] text-slate-500">{fmtShotTime(shot.at)}</span>}
            {extra && <span className="text-[10px] text-amber-400">{extra}</span>}
          </div>
          {list.length > 1 && (
            <div className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
              <button type="button" disabled={i === 0} onClick={() => pick(i - 1)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30">‹</button>
              {i + 1}/{list.length}
              <button type="button" disabled={i === list.length - 1} onClick={() => pick(i + 1)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-30">›</button>
            </div>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center p-4 min-h-0">
          {shot
            ? <img src={shot.url} alt={label} className="max-w-full max-h-full object-contain rounded-lg" />
            : <span className="text-slate-600 text-xs italic">No capture</span>}
        </div>
      </div>
    )
  }

  const beforeAt = before[idx.b]?.at ?? analyzedAt
  const elapsed = fmtElapsed(beforeAt, after[idx.a]?.at)

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
        {side('📸 Before (analysis)', before, idx.b, pickBefore)}
        {side('📸 After (later)', after, idx.a, pickAfter, elapsed)}
      </div>
    </div>
  )
}

// ── One capture zone (file picker, drag & drop, Ctrl+V while hovered) ────────
function ShotZone({ title, hint, shots, busy, onAdd, onCaption, onDelete, onOpen }: {
  title: string
  hint: string
  shots: MAShot[]
  busy: boolean
  onAdd: (files: File[], caption: string | null) => void
  onCaption: (url: string, caption: string | null) => void
  onDelete: (url: string) => void
  onOpen: (index: number) => void
}) {
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [nextCaption, setNextCaption] = useState<string | null>(null)

  useEffect(() => {
    if (!hovered) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((i) => i.type.startsWith('image/'))
        .map((i) => i.getAsFile())
        .filter((f): f is File => f !== null)
        .map((f) => new File([f], `paste-${Date.now()}.png`, { type: f.type }))
      if (files.length > 0) onAdd(files, nextCaption)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [hovered, onAdd, nextCaption])

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault(); setDragging(false)
        const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
        if (files.length > 0) onAdd(files, nextCaption)
      }}
      className={`rounded-xl border p-3 space-y-2 transition-colors ${
        dragging ? 'border-brand-500/60 bg-brand-500/5' : 'border-surface-600 bg-surface-800/40'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-300">
            {title} <span className="text-slate-600 font-normal">{shots.length > 0 ? `· ${shots.length}` : ''}</span>
          </p>
          <p className="text-[10px] text-slate-600">{hint}</p>
        </div>
        <label className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-brand-500/30 text-brand-400 bg-brand-500/10 hover:bg-brand-500/15 cursor-pointer">
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
          Add
          <input
            type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0) onAdd(files, nextCaption)
              e.target.value = ''
            }}
          />
        </label>
      </div>

      {/* Caption applied to the next captures you add */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[9px] uppercase tracking-wider text-slate-600 mr-0.5">next:</span>
        {CAPTION_PRESETS.map((c) => (
          <button
            key={c} type="button" onClick={() => setNextCaption(nextCaption === c ? null : c)}
            className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
              nextCaption === c
                ? 'border-brand-500/60 bg-brand-500/20 text-brand-300'
                : 'border-surface-600 text-slate-500 hover:text-slate-300'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {shots.length === 0 ? (
        <p className="text-[11px] text-slate-600 italic py-3 text-center">
          Drop images here, or hover and press Ctrl+V to paste — as many as you need
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shots.map((shot, i) => (
            <div key={shot.url} className="space-y-1">
              <div className="relative group aspect-video rounded-lg overflow-hidden border border-surface-600 bg-black/30">
                <img
                  src={shot.url} alt={`${title} ${i + 1}`} loading="lazy"
                  onClick={() => onOpen(i)}
                  className="w-full h-full object-cover cursor-zoom-in"
                />
                <button
                  type="button" onClick={() => onDelete(shot.url)} title="Remove"
                  className="absolute top-1 right-1 p-1 rounded bg-black/60 text-slate-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={11} />
                </button>
              </div>
              <input
                defaultValue={shot.caption ?? ''}
                placeholder="caption (e.g. BTC.D 1H)"
                maxLength={40}
                onBlur={(e) => {
                  const v = e.target.value.trim() || null
                  if (v !== shot.caption) onCaption(shot.url, v)
                }}
                className="w-full px-1.5 py-0.5 rounded bg-surface-900 border border-surface-700 text-[10px] text-slate-300 placeholder-slate-700 focus:outline-none focus:border-brand-500/60"
              />
              {shot.at && <p className="text-[9px] text-slate-700">{fmtShotTime(shot.at)}</p>}
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

  const addFiles = useCallback(async (kind: Kind, files: File[], caption: string | null) => {
    setBusy(kind); setError(null)
    try {
      let latest: MASessionOut | null = null
      for (const f of files) latest = await maApi.uploadSessionScreenshot(session.id, kind, f, caption)
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
          shots={before} busy={busy === 'before'}
          onAdd={(f, c) => void addFiles('before', f, c)}
          onCaption={(u, c) => void run(() => maApi.setSessionScreenshotCaption(session.id, 'before', u, c))}
          onDelete={(u) => void run(() => maApi.deleteSessionScreenshot(session.id, 'before', u))}
          onOpen={(i) => setCompare({ kind: 'before', index: i })}
        />
        <ShotZone
          title="After" hint="Same charts later — what actually happened"
          shots={after} busy={busy === 'after'}
          onAdd={(f, c) => void addFiles('after', f, c)}
          onCaption={(u, c) => void run(() => maApi.setSessionScreenshotCaption(session.id, 'after', u, c))}
          onDelete={(u) => void run(() => maApi.deleteSessionScreenshot(session.id, 'after', u))}
          onOpen={(i) => setCompare({ kind: 'after', index: i })}
        />
      </div>
      {(before.length > 0 || after.length > 0) && (
        <button
          type="button" onClick={() => setCompare({ kind: before.length > 0 ? 'before' : 'after', index: 0 })}
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
        <CompareModal
          before={before} after={after} analyzedAt={session.analyzed_at}
          initial={compare} onClose={() => setCompare(null)}
        />
      )}
    </div>
  )
}
