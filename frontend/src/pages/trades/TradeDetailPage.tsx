// ── Trade Detail Page ─────────────────────────────────────────────────────
// /trades/:id  — View full trade details + manage lifecycle
//
// Actions available by status:
//   pending  → Activate (LIMIT triggered) | Cancel | Edit SL/notes
//   open     → Close all | Partial close TP | Edit SL/notes | Edit confidence
//   partial  → Close all | Partial close remaining TPs | Edit SL/notes
//   closed   → Read-only + P&L + editable close_notes + snapshots
//   cancelled→ Read-only

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle2, X,
  TrendingUp, TrendingDown, Clock, ChevronDown, ChevronUp,
  Trash2, Edit3, Save, SlidersHorizontal, ShieldCheck, ShieldOff,
  ImagePlus, Maximize2,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { tradesApi, strategiesApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useProfile } from '../../context/ProfileContext'
import type { TradeOut, Strategy } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number | string | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  return num.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Return the human-readable instrument name, falling back to the raw pair symbol. */
function displayPair(trade: TradeOut): string {
  return trade.instrument_display_name ?? trade.pair
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  pending:   { label: '⏳ Pending',   cls: 'text-yellow-300 bg-yellow-500/10 border-yellow-500/30' },
  open:      { label: '🟢 Open',      cls: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30' },
  partial:   { label: '🟡 Partial',   cls: 'text-amber-300 bg-amber-500/10 border-amber-500/30' },
  closed:    { label: '✅ Closed',    cls: 'text-slate-400 bg-surface-700 border-surface-600' },
  cancelled: { label: '❌ Cancelled', cls: 'text-slate-600 bg-surface-800 border-surface-700' },
}

// ─────────────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = [
  'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600',
  'text-sm text-slate-200 placeholder-slate-600',
  'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30',
  'transition-colors',
].join(' ')

function InfoRow({ label, value, accent }: {
  label: string
  value: React.ReactNode
  accent?: 'green' | 'red' | 'amber' | 'brand' | null
}) {
  const cls = {
    green: 'text-emerald-300',
    red:   'text-red-400',
    amber: 'text-amber-300',
    brand: 'text-brand-300',
  }
  return (
    <div className="flex items-center justify-between py-2 border-b border-surface-700/50 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={cn('text-xs font-mono font-medium', accent ? cls[accent] : 'text-slate-200')}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 p-5 space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">{title}</p>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SnapshotGallery — upload + display trade screenshots (entry or close)
// ─────────────────────────────────────────────────────────────────────────────

function SnapshotGallery({
  tradeId,
  urls,
  kind,
  onUpdated,
  readOnly = false,
}: {
  tradeId: number
  urls: string[] | null
  kind: 'entry' | 'close'
  onUpdated: (updated: TradeOut) => void
  readOnly?: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting]   = useState<string | null>(null)
  const [err, setErr]             = useState<string | null>(null)
  const [lightbox, setLightbox]   = useState<string | null>(null)

  const list = urls ?? []

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr(null)
    try {
      const updated = kind === 'entry'
        ? await tradesApi.uploadEntrySnapshot(tradeId, file)
        : await tradesApi.uploadCloseSnapshot(tradeId, file)
      onUpdated(updated)
    } catch (ex: unknown) {
      setErr((ex as Error).message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async (url: string) => {
    setDeleting(url); setErr(null)
    try {
      const updated = kind === 'entry'
        ? await tradesApi.deleteEntrySnapshot(tradeId, url)
        : await tradesApi.deleteCloseSnapshot(tradeId, url)
      onUpdated(updated)
    } catch (ex: unknown) {
      setErr((ex as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-2">
      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox} alt="snapshot"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-slate-400 hover:text-white bg-black/50 rounded-full p-2"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="flex flex-wrap gap-2">
        {list.map((url) => (
          <div key={url} className="relative group w-24 h-24 rounded-lg overflow-hidden border border-surface-600 bg-surface-700 shrink-0">
            <img
              src={url} alt="snapshot"
              className="w-full h-full object-cover cursor-pointer"
              onClick={() => setLightbox(url)}
            />
            {/* View button */}
            <button
              type="button"
              onClick={() => setLightbox(url)}
              className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 bg-black/60 text-white rounded p-0.5 transition-opacity"
            >
              <Maximize2 size={11} />
            </button>
            {/* Delete button */}
            {!readOnly && (
              <button
                type="button"
                onClick={() => void handleDelete(url)}
                disabled={deleting === url}
                className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-600/80 text-white rounded p-0.5 transition-opacity disabled:opacity-40"
              >
                {deleting === url ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
              </button>
            )}
          </div>
        ))}

        {/* Upload button */}
        {!readOnly && (
          <label className={cn(
            'flex flex-col items-center justify-center gap-1 w-24 h-24 rounded-lg border-2 border-dashed cursor-pointer shrink-0 transition-colors',
            uploading
              ? 'border-brand-500/40 bg-brand-500/5 cursor-wait'
              : 'border-surface-600 hover:border-brand-500/50 hover:bg-brand-500/5',
          )}>
            {uploading
              ? <Loader2 size={18} className="text-brand-400 animate-spin" />
              : <ImagePlus size={18} className="text-slate-500" />}
            <span className="text-[9px] text-slate-600 text-center leading-tight">
              {uploading ? 'Uploading…' : 'Add\nscreenshot'}
            </span>
            <input
              type="file" accept="image/*" className="hidden"
              onChange={(e) => void handleUpload(e)}
              disabled={uploading}
            />
          </label>
        )}
      </div>

      {list.length === 0 && readOnly && (
        <p className="text-xs text-slate-600 italic">No screenshots.</p>
      )}

      {err && (
        <p className="text-[11px] text-red-400 flex items-center gap-1">
          <AlertTriangle size={11} /> {err}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit Trade modal (SL, confidence, notes, timeframe)
// ─────────────────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1']

function EditTradeModal({ trade, onClose, onSuccess }: {
  trade: TradeOut
  onClose: () => void
  onSuccess: (updated: TradeOut) => void
}) {
  const [sl, setSl]           = useState(trade.stop_loss?.toString() ?? '')
  const [tf, setTf]           = useState(trade.analyzed_timeframe ?? '')
  const [conf, setConf]       = useState(trade.confidence_score?.toString() ?? '')
  // Pending-only amend
  const [entryAmend, setEntryAmend] = useState(trade.entry_price?.toString() ?? '')
  const [tpAmend, setTpAmend]       = useState<{ price: string; pct: string }[]>(
    trade.positions.map((p) => ({ price: p.take_profit_price, pct: String(p.lot_percentage) }))
  )
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState<string | null>(null)

  const isPending = trade.status === 'pending'
  const isLong    = trade.direction === 'LONG'

  // Use amended entry if set, otherwise original
  const effectiveEntry = entryAmend !== '' && !isNaN(Number(entryAmend)) ? Number(entryAmend) : parseFloat(trade.entry_price)
  const slNum     = sl !== '' && !isNaN(Number(sl)) ? Number(sl) : null
  const slDist    = slNum != null ? Math.abs(effectiveEntry - slNum) : null
  const slPct     = slDist != null && effectiveEntry > 0 ? (slDist / effectiveEntry * 100) : null
  const slWrong   = slNum != null && ((isLong && slNum >= effectiveEntry) || (!isLong && slNum <= effectiveEntry))

  const riskOrig    = parseFloat(trade.risk_amount)
  // Use initial_stop_loss so unit calculation is correct after BE move
  const slDistOrig  = Math.abs(parseFloat(trade.entry_price) - parseFloat(trade.initial_stop_loss ?? trade.stop_loss))
  const units       = slDistOrig > 0 ? riskOrig / slDistOrig : 0
  const newRisk     = slDist != null && slDist > 0 && !isPending ? units * slDist : null
  const riskChanged = newRisk != null && Math.abs(newRisk - riskOrig) > 0.001

  const tpTotal  = tpAmend.reduce((s, t) => s + (Number(t.pct) || 0), 0)
  const tpValid  = tpTotal === 100

  const handleSave = async () => {
    if (slWrong) { setErr(`SL must be ${isLong ? 'below' : 'above'} entry (${fmt(effectiveEntry, 4)})`); return }
    if (isPending && !tpValid) { setErr(`TP allocations must sum to 100% (currently ${tpTotal}%)`); return }
    setSaving(true); setErr(null)
    try {
      const payload: Parameters<typeof tradesApi.update>[1] = {
        stop_loss:          sl || undefined,
        analyzed_timeframe: tf || undefined,
        confidence_score:   conf !== '' ? parseInt(conf) : undefined,
      }
      // Pending-only: amend entry + positions
      if (isPending) {
        if (entryAmend && entryAmend !== trade.entry_price?.toString()) {
          payload.entry_price = entryAmend
        }
        payload.amend_positions = tpAmend
          .filter((t) => t.price !== '')
          .map((t, i) => ({
            position_number: i + 1,
            take_profit_price: t.price,
            lot_percentage: Number(t.pct),
          }))
      }
      const updated = await tradesApi.update(trade.id, payload)
      onSuccess(updated)
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-slate-200">Edit — {displayPair(trade)}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* ── Pending-only: Amend entry ──────────────────────────────── */}
        {isPending && (
          <div className="rounded-lg bg-yellow-500/5 border border-yellow-500/20 p-3 space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-yellow-400/70 font-semibold flex items-center gap-1.5">
              ⏳ Amend LIMIT order — only available before trigger
            </p>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Entry price (LIMIT target)</label>
              <div className="flex">
                <input type="number" step="any" min="0"
                  value={entryAmend} onChange={(e) => setEntryAmend(e.target.value)}
                  className={cn(inputCls, 'rounded-r-none border-r-0')}
                  placeholder={fmt(trade.entry_price, 4)}
                />
                <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">
                  {trade.pair?.split('/')[1] ?? 'USD'}
                </span>
              </div>
              <p className="text-[10px] text-slate-600">
                Changing entry recalculates risk_amount and lot sizes at save time.
              </p>
            </div>

            {/* TP rows */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-400">Take-profit targets</label>
                <span className={cn('text-[10px] font-mono font-semibold', tpValid ? 'text-emerald-400' : 'text-amber-400')}>
                  {tpTotal}% {tpValid ? '✓' : '≠ 100'}
                </span>
              </div>
              {tpAmend.map((tp, i) => (
                <div key={i} className="grid grid-cols-[auto_1fr_4rem] items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-mono w-8">TP{i + 1}</span>
                  <input type="number" step="any" min="0"
                    value={tp.price} onChange={(e) => setTpAmend((prev) => prev.map((x, j) => j === i ? { ...x, price: e.target.value } : x))}
                    className={cn(inputCls, 'text-xs py-1.5')}
                    placeholder="price"
                  />
                  <div className="flex items-center">
                    <input type="number" step="1" min="1" max="100"
                      value={tp.pct} onChange={(e) => setTpAmend((prev) => prev.map((x, j) => j === i ? { ...x, pct: e.target.value } : x))}
                      className={cn(inputCls, 'text-xs py-1.5 rounded-r-none border-r-0 w-full')}
                    />
                    <span className="shrink-0 px-1.5 py-1.5 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Stop Loss ──────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 flex items-center gap-1">
            Stop Loss
            <span className={cn('ml-1 text-[10px] px-1.5 py-0.5 rounded border font-semibold',
              'text-red-400 bg-red-500/10 border-red-500/30'
            )}>
              {isLong ? 'below entry' : 'above entry'}
            </span>
          </label>
          <div className="flex">
            <input
              autoFocus={!isPending} type="number" step="any" min="0"
              value={sl} onChange={(e) => setSl(e.target.value)}
              className={cn(inputCls, 'rounded-r-none border-r-0', slWrong && 'border-red-500/60')}
              placeholder={fmt(trade.stop_loss, 4)}
            />
            <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">
              {trade.pair?.split('/')[1] ?? 'USD'}
            </span>
          </div>
          {slWrong && (
            <p className="text-[10px] text-red-400 flex items-center gap-1">
              <AlertTriangle size={10} /> SL must be {isLong ? 'below' : 'above'} entry {fmt(effectiveEntry, 4)}
            </p>
          )}
          {slDist != null && !slWrong && slPct != null && (
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-slate-600">
                Distance: <span className="font-mono text-slate-400">{fmt(slDist, 4)} ({slPct.toFixed(2)}%)</span>
              </span>
              {riskChanged && newRisk != null && (
                <span className={cn('font-mono font-semibold', newRisk > riskOrig ? 'text-amber-400' : 'text-emerald-400')}>
                  Risk → {fmt(newRisk)} {newRisk > riskOrig ? '⬆' : '⬇'}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Timeframe ──────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Analysed timeframe</label>
          <div className="flex flex-wrap gap-1.5">
            {TIMEFRAMES.map((t) => (
              <button key={t} type="button"
                onClick={() => setTf(t)}
                className={cn(
                  'px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors',
                  tf === t
                    ? 'bg-brand-600/25 border-brand-500/50 text-brand-300'
                    : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200',
                )}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* ── Confidence ─────────────────────────────────────────────── */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 flex items-center justify-between">
            <span>Confidence score</span>
            <span className={cn('font-mono font-bold text-sm',
              conf === '' ? 'text-slate-600' :
              parseInt(conf) >= 7 ? 'text-emerald-400' :
              parseInt(conf) >= 5 ? 'text-amber-400' : 'text-red-400'
            )}>
              {conf !== '' ? `${conf}/10` : '—'}
            </span>
          </label>
          <input
            type="range" min="0" max="10" step="1"
            value={conf !== '' ? conf : 5}
            onChange={(e) => setConf(e.target.value)}
            className="w-full accent-brand-500"
          />
          <div className="flex justify-between text-[9px] text-slate-600">
            <span>0 — No conviction</span>
            <span>10 — Max conviction</span>
          </div>
        </div>

        {err && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertTriangle size={11} />{err}</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-surface-600 text-sm text-slate-400 hover:text-slate-200 hover:bg-surface-700 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={saving || slWrong}
            className="flex-1 py-2 rounded-lg bg-brand-600/20 border border-brand-500/50 text-sm text-brand-300 font-medium hover:bg-brand-600/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Close-all modal (with close notes + screenshot upload)
// ─────────────────────────────────────────────────────────────────────────────

function CloseAllModal({ trade, onClose, onSuccess }: {
  trade: TradeOut
  onClose: () => void
  onSuccess: (updated: TradeOut) => void
}) {
  const [exitPrice, setExitPrice]       = useState('')
  const [closeNotes, setCloseNotes]     = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [saving, setSaving]             = useState(false)
  const [uploadStep, setUploadStep]     = useState(false)
  const [err, setErr]                   = useState<string | null>(null)

  const handleClose = async () => {
    if (!exitPrice || isNaN(Number(exitPrice))) { setErr('Exit price required'); return }
    setSaving(true); setErr(null)
    try {
      // 1. Close the trade (with notes)
      let updated = await tradesApi.close(trade.id, {
        exit_price: exitPrice,
        close_notes: closeNotes || null,
      })
      // 2. Upload any pending snapshots one by one
      if (pendingFiles.length > 0) {
        setUploadStep(true)
        for (const f of pendingFiles) {
          updated = await tradesApi.uploadCloseSnapshot(updated.id, f)
        }
      }
      onSuccess(updated)
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
      setUploadStep(false)
    }
  }

  const addFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setPendingFiles((prev) => [...prev, ...files])
    e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Close trade — {displayPair(trade)}</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* Summary */}
        <div className="space-y-1">
          <p className="text-xs text-slate-500">This will close ALL open positions at the exit price.</p>
          <div className="rounded-lg bg-surface-700/60 px-3 py-2 text-xs text-slate-400 space-y-0.5">
            <div className="flex justify-between">
              <span>Entry</span>
              <span className="font-mono">{fmt(trade.entry_price)}</span>
            </div>
            <div className="flex justify-between">
              <span>Stop loss</span>
              <span className="font-mono text-red-400">{fmt(trade.stop_loss, 4)}</span>
            </div>
            <div className="flex justify-between">
              <span>Initial risk</span>
              <span className="font-mono text-red-400">−{fmt(trade.risk_amount)}</span>
            </div>
            {trade.current_risk != null && (
              <div className="flex justify-between">
                <span>Current risk</span>
                <span className={cn(
                  'font-mono font-semibold',
                  parseFloat(trade.current_risk) === 0 ? 'text-emerald-400'
                  : parseFloat(trade.current_risk) < parseFloat(trade.risk_amount) ? 'text-amber-400'
                  : 'text-red-400',
                )}>
                  {parseFloat(trade.current_risk) === 0 ? '0,00 ✓ at BE' : `−${fmt(trade.current_risk)}`}
                </span>
              </div>
            )}
            {trade.booked_pnl != null && parseFloat(trade.booked_pnl) !== 0 && (
              <div className="flex justify-between border-t border-surface-600/60 pt-0.5 mt-0.5">
                <span>Booked P&L</span>
                <span className={cn('font-mono font-semibold', parseFloat(trade.booked_pnl) >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {parseFloat(trade.booked_pnl) >= 0 ? '+' : ''}{fmt(trade.booked_pnl)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Exit price */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Exit price *</label>
          <div className="flex">
            <input
              autoFocus type="number" step="any" min="0"
              value={exitPrice} onChange={(e) => setExitPrice(e.target.value)}
              placeholder="0.00"
              className={cn(inputCls, 'rounded-r-none border-r-0')}
            />
            <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">
              {trade.pair?.split('/')[1] ?? 'USD'}
            </span>
          </div>
        </div>

        {/* Quick P&L preview */}
        {exitPrice && !isNaN(Number(exitPrice)) && (() => {
          const entry   = parseFloat(trade.entry_price)
          const exit_   = Number(exitPrice)
          const risk    = parseFloat(trade.risk_amount)
          const refSl   = parseFloat(trade.initial_stop_loss ?? trade.stop_loss)
          const dist    = Math.abs(entry - refSl)
          if (dist === 0) return null
          const totalUnits = risk / dist
          const openPositions = trade.positions.filter((p) => p.status === 'open')
          const openPct = openPositions.reduce((s, p) => s + parseFloat(p.lot_percentage), 0)
          const remainingUnits = totalUnits * (openPct / 100)
          const diff  = trade.direction === 'LONG' ? exit_ - entry : entry - exit_
          const pnl   = remainingUnits * diff
          const booked = trade.booked_pnl ? parseFloat(trade.booked_pnl) : 0
          const totalEstPnl = pnl + booked
          const isPos = totalEstPnl >= 0
          return (
            <div className="space-y-1">
              {booked !== 0 && (
                <div className="rounded-lg px-3 py-1.5 text-xs flex items-center justify-between bg-surface-700/60 border border-surface-600">
                  <span className="text-slate-500">Remaining ({openPct.toFixed(0)}% of position)</span>
                  <span className={cn('font-mono font-semibold', pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
                  </span>
                </div>
              )}
              <div className={cn(
                'rounded-lg px-3 py-2 text-xs flex items-center justify-between',
                isPos ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30',
              )}>
                <span className="text-slate-400">{booked !== 0 ? 'Total Est. P&L (incl. booked)' : 'Est. P&L'}</span>
                <span className={cn('font-mono font-bold', isPos ? 'text-emerald-300' : 'text-red-400')}>
                  {isPos ? '+' : ''}{totalEstPnl.toFixed(2)}
                </span>
              </div>
            </div>
          )
        })()}

        {/* Close notes */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
            Post-trade notes
            <span className="text-[10px] text-slate-600">(optional — editable later)</span>
          </label>
          <textarea
            value={closeNotes}
            onChange={(e) => setCloseNotes(e.target.value)}
            rows={3}
            className={cn(inputCls, 'resize-none text-xs')}
            placeholder="What happened? Key lessons? Would you take this again?"
          />
        </div>

        {/* Close screenshots */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
            Closing screenshots
            <span className="text-[10px] text-slate-600">(optional — can upload after close too)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((f, i) => (
              <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-surface-600 bg-surface-700">
                <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute top-0.5 right-0.5 bg-red-600/80 text-white rounded p-0.5"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <label className={cn(
              'flex flex-col items-center justify-center gap-1 w-20 h-20 rounded-lg border-2 border-dashed cursor-pointer shrink-0 transition-colors',
              'border-surface-600 hover:border-brand-500/50 hover:bg-brand-500/5',
            )}>
              <ImagePlus size={16} className="text-slate-500" />
              <span className="text-[9px] text-slate-600 text-center leading-tight">Add</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={addFiles} />
            </label>
          </div>
        </div>

        {err && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertTriangle size={11} />{err}</p>}
        {uploadStep && (
          <p className="text-[11px] text-brand-400 flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> Uploading screenshots…
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-surface-600 text-sm text-slate-400 hover:text-slate-200 hover:bg-surface-700 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={() => void handleClose()} disabled={saving || !exitPrice}
            className="flex-1 py-2 rounded-lg bg-emerald-600/20 border border-emerald-500/50 text-sm text-emerald-300 font-medium hover:bg-emerald-600/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Confirm close
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Partial-close modal (per TP)
// ─────────────────────────────────────────────────────────────────────────────

function PartialCloseModal({ trade, positionNumber, onClose, onSuccess }: {
  trade: TradeOut
  positionNumber: number
  onClose: () => void
  onSuccess: (updated: TradeOut) => void
}) {
  const pos = trade.positions.find((p) => p.position_number === positionNumber)

  const [exitPrice, setExitPrice]   = useState(pos?.take_profit_price ?? '')
  const [moveToBe, setMoveToBe]     = useState(false)
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState<string | null>(null)

  const handleClose = async () => {
    if (!exitPrice || isNaN(Number(exitPrice))) { setErr('Exit price required'); return }
    setSaving(true); setErr(null)
    try {
      const updated = await tradesApi.partialClose(trade.id, {
        position_number: positionNumber,
        exit_price: exitPrice,
        move_to_be: moveToBe,
      })
      onSuccess(updated)
    } catch (e: unknown) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-200">
            Close TP#{positionNumber} — {displayPair(trade)}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {pos && (
          <div className="rounded-lg bg-surface-700/60 px-3 py-2 text-xs text-slate-400 space-y-0.5">
            <div className="flex justify-between">
              <span>TP target</span>
              <span className="font-mono text-emerald-400">{fmt(pos.take_profit_price)}</span>
            </div>
            <div className="flex justify-between">
              <span>Allocation</span>
              <span className="font-mono">{pos.lot_percentage}%</span>
            </div>
            {(() => {
              const entry  = parseFloat(trade.entry_price)
              const refSl  = parseFloat(trade.initial_stop_loss ?? trade.stop_loss)
              const dist   = Math.abs(entry - refSl)
              if (dist === 0) return null
              const totalUnits = parseFloat(trade.risk_amount) / dist
              const posUnits   = totalUnits * (parseFloat(pos.lot_percentage) / 100)
              return (
                <div className="flex justify-between">
                  <span>Quantity</span>
                  <span className="font-mono text-slate-300">{posUnits.toFixed(6)}</span>
                </div>
              )
            })()}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Actual exit price *</label>
          <div className="flex">
            <input
              autoFocus type="number" step="any" min="0"
              value={exitPrice} onChange={(e) => setExitPrice(e.target.value)}
              placeholder="0.00"
              className={cn(inputCls, 'rounded-r-none border-r-0')}
            />
            <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">
              {trade.pair?.split('/')[1] ?? 'USD'}
            </span>
          </div>
        </div>

        {/* P&L preview for this TP slice */}
        {exitPrice && !isNaN(Number(exitPrice)) && pos && (() => {
          const entry    = parseFloat(trade.entry_price)
          const exit_    = Number(exitPrice)
          const refSl    = parseFloat(trade.initial_stop_loss ?? trade.stop_loss)
          const dist     = Math.abs(entry - refSl)
          if (dist === 0) return null
          const totalUnits = parseFloat(trade.risk_amount) / dist
          const posUnits   = totalUnits * (parseFloat(pos.lot_percentage) / 100)
          const diff       = trade.direction === 'LONG' ? exit_ - entry : entry - exit_
          const pnl        = posUnits * diff
          const isPos      = pnl >= 0
          return (
            <div className={cn(
              'rounded-lg px-3 py-2 text-xs flex items-center justify-between',
              isPos ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30',
            )}>
              <span className="text-slate-400">Est. P&L (TP{positionNumber})</span>
              <span className={cn('font-mono font-bold', isPos ? 'text-emerald-300' : 'text-red-400')}>
                {isPos ? '+' : ''}{pnl.toFixed(2)}
              </span>
            </div>
          )
        })()}

        {/* Move SL to breakeven */}
        <label className="flex items-center gap-2.5 cursor-pointer group">
          <div onClick={() => setMoveToBe((v) => !v)}
            className={cn(
              'w-8 h-4.5 rounded-full border transition-colors flex items-center',
              moveToBe ? 'bg-brand-600/40 border-brand-500/60' : 'bg-surface-700 border-surface-600',
            )}>
            <span className={cn(
              'w-3.5 h-3.5 rounded-full bg-slate-400 transition-transform ml-0.5',
              moveToBe ? 'translate-x-3.5 bg-brand-400' : '',
            )} />
          </div>
          <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
            Move SL to breakeven after this TP
          </span>
        </label>

        {err && <p className="text-[11px] text-red-400 flex items-center gap-1"><AlertTriangle size={11} />{err}</p>}

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="flex-1 py-2 rounded-lg border border-surface-600 text-sm text-slate-400 hover:text-slate-200 hover:bg-surface-700 transition-colors">
            Cancel
          </button>
          <button type="button" onClick={() => void handleClose()} disabled={saving || !exitPrice}
            className="flex-1 py-2 rounded-lg bg-brand-600/20 border border-brand-500/50 text-sm text-brand-300 font-medium hover:bg-brand-600/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Book TP#{positionNumber}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function TradeDetailPage() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { activeProfile } = useProfile()

  const [trade, setTrade]           = useState<TradeOut | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  // Strategies (global + profile) — loaded once profile is known
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const strategyMap = useMemo(() => new Map(strategies.map((s) => [s.id, s])), [strategies])

  // Modal state
  const [showCloseAll, setShowCloseAll]         = useState(false)
  const [showEditTrade, setShowEditTrade]        = useState(false)
  const [partialTpId, setPartialTpId]           = useState<number | null>(null)

  // Entry notes editing (setup rationale — editable on open trades)
  const [editingNotes, setEditingNotes]         = useState(false)
  const [notesValue, setNotesValue]             = useState('')
  const [savingNotes, setSavingNotes]           = useState(false)

  // Close notes editing (post-trade review — always editable, including closed)
  const [editingCloseNotes, setEditingCloseNotes] = useState(false)
  const [closeNotesValue, setCloseNotesValue]     = useState('')
  const [savingCloseNotes, setSavingCloseNotes]   = useState(false)

  // Action states
  const [activating, setActivating]             = useState(false)
  const [cancelling, setCancelling]             = useState(false)
  const [deleting, setDeleting]                 = useState(false)
  const [movingBe, setMovingBe]                 = useState(false)
  const [confirmBe, setConfirmBe]               = useState(false)
  const [actionError, setActionError]           = useState<string | null>(null)

  // Expanded sections
  const [showPositions, setShowPositions]       = useState(true)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError(null)
    try {
      const t = await tradesApi.get(Number(id))
      setTrade(t)
      setNotesValue(t.notes ?? '')
      setCloseNotesValue(t.close_notes ?? '')
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void load() }, [load])

  // Load strategies to resolve names for strategy_ids on this trade
  useEffect(() => {
    if (!activeProfile) { setStrategies([]); return }
    strategiesApi.list(activeProfile.id).then(setStrategies).catch(() => setStrategies([]))
  }, [activeProfile])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleActivate() {
    if (!trade) return
    setActivating(true); setActionError(null)
    try {
      const updated = await tradesApi.activate(trade.id)
      setTrade(updated)
    } catch (e: unknown) {
      setActionError((e as Error).message)
    } finally {
      setActivating(false)
    }
  }

  async function handleCancel() {
    if (!trade) return
    setCancelling(true); setActionError(null)
    try {
      const updated = await tradesApi.cancel(trade.id)
      setTrade(updated)
    } catch (e: unknown) {
      setActionError((e as Error).message)
    } finally {
      setCancelling(false)
    }
  }

  async function handleDelete() {
    if (!trade) return
    setDeleting(true); setActionError(null)
    try {
      await tradesApi.delete(trade.id)
      navigate('/trades')
    } catch (e: unknown) {
      setActionError((e as Error).message)
      setDeleting(false)
    }
  }

  async function handleBreakeven() {
    if (!trade) return
    setMovingBe(true); setConfirmBe(false); setActionError(null)
    try {
      const updated = await tradesApi.breakeven(trade.id)
      setTrade(updated)
    } catch (e: unknown) {
      setActionError((e as Error).message)
    } finally {
      setMovingBe(false)
    }
  }

  async function handleSaveNotes() {
    if (!trade) return
    setSavingNotes(true); setActionError(null)
    try {
      const updated = await tradesApi.update(trade.id, { notes: notesValue })
      setTrade(updated)
      setEditingNotes(false)
    } catch (e: unknown) {
      setActionError(`Failed to save notes: ${(e as Error).message}`)
    } finally {
      setSavingNotes(false)
    }
  }

  async function handleSaveCloseNotes() {
    if (!trade) return
    setSavingCloseNotes(true); setActionError(null)
    try {
      const updated = await tradesApi.update(trade.id, { close_notes: closeNotesValue })
      setTrade(updated)
      setEditingCloseNotes(false)
    } catch (e: unknown) {
      setActionError(`Failed to save close notes: ${(e as Error).message}`)
    } finally {
      setSavingCloseNotes(false)
    }
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const pnlNum    = trade?.realized_pnl ? parseFloat(trade.realized_pnl) : null
  const riskNum   = trade ? parseFloat(trade.risk_amount) : null
  const entryNum  = trade ? parseFloat(trade.entry_price) : null
  const slNum     = trade ? parseFloat(trade.stop_loss) : null
  const slDist    = entryNum != null && slNum != null ? Math.abs(entryNum - slNum) : null
  const slPct     = entryNum != null && slDist != null ? (slDist / entryNum) * 100 : null
  const isActive  = trade?.status === 'open' || trade?.status === 'partial'
  const isPending = trade?.status === 'pending'
  const isClosed  = trade?.status === 'closed'
  const isCancelled = trade?.status === 'cancelled'
  const isReadOnly = isCancelled  // closed trades allow close_notes/screenshots
  const isAtBe    = trade != null && Math.abs(parseFloat(trade.stop_loss) - parseFloat(trade.entry_price)) < 0.000001

  // Realised R multiple
  const realisedR = pnlNum != null && riskNum != null && riskNum > 0
    ? pnlNum / riskNum : null

  // ── Guards ─────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center gap-2 py-16 text-slate-500 text-sm">
      <Loader2 size={16} className="animate-spin" /> Loading trade…
    </div>
  )

  if (error || !trade) return (
    <div className="py-16 text-center">
      <AlertTriangle size={24} className="text-amber-400 mx-auto mb-3" />
      <p className="text-sm text-slate-300 font-medium mb-1">Trade not found</p>
      <p className="text-xs text-slate-500 mb-4">{error}</p>
      <button type="button" onClick={() => navigate('/trades')}
        className="atd-btn-ghost text-xs">
        ← Back to trades
      </button>
    </div>
  )

  const statusInfo = STATUS_MAP[trade.status] ?? { label: trade.status, cls: 'text-slate-500 bg-surface-700 border-surface-600' }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Modals */}
      {showCloseAll && (
        <CloseAllModal
          trade={trade}
          onClose={() => setShowCloseAll(false)}
          onSuccess={(updated) => { setTrade(updated); setShowCloseAll(false); setCloseNotesValue(updated.close_notes ?? '') }}
        />
      )}
      {showEditTrade && (
        <EditTradeModal
          trade={trade}
          onClose={() => setShowEditTrade(false)}
          onSuccess={(updated) => { setTrade(updated); setShowEditTrade(false) }}
        />
      )}
      {partialTpId !== null && (
        <PartialCloseModal
          trade={trade}
          positionNumber={partialTpId}
          onClose={() => setPartialTpId(null)}
          onSuccess={(updated) => { setTrade(updated); setPartialTpId(null) }}
        />
      )}

      <PageHeader
        icon={trade.direction === 'LONG' ? '📈' : '📉'}
        title={displayPair(trade)}
        subtitle={`#${trade.id} · ${trade.direction} · ${fmtDate(trade.entry_date ?? trade.created_at)}`}
        actions={
          <button type="button" onClick={() => navigate('/trades')} className="atd-btn-ghost">
            <ArrowLeft size={14} /> Back
          </button>
        }
      />

      <div className="max-w-2xl space-y-4 mt-2">

        {/* ── Status + action bar ─────────────────────────────────────── */}
        <div className="bg-surface-800 rounded-xl border border-surface-700 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={cn('px-2.5 py-1 rounded-lg border text-xs font-semibold', statusInfo.cls)}>
                {statusInfo.label}
              </span>
              <span className="text-xs text-slate-500">
                {trade.order_type === 'LIMIT' && <span className="text-yellow-400/70 font-mono mr-1">LIMIT</span>}
                {trade.direction === 'LONG'
                  ? <TrendingUp size={12} className="inline text-emerald-400 mr-0.5" />
                  : <TrendingDown size={12} className="inline text-red-400 mr-0.5" />
                }
                {trade.direction}
              </span>
              {trade.session_tag && (
                <span className="text-xs text-slate-600 flex items-center gap-1">
                  <Clock size={10} /> {trade.session_tag}
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* PENDING actions */}
              {isPending && (
                <>
                  <button type="button" onClick={() => void handleActivate()} disabled={activating}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-xs text-emerald-300 font-medium hover:bg-emerald-600/30 transition-colors disabled:opacity-40">
                    {activating ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                    Activate
                  </button>
                  <button type="button" onClick={() => void handleCancel()} disabled={cancelling}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-400 hover:text-red-400 hover:border-red-500/40 transition-colors disabled:opacity-40">
                    {cancelling ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                    Cancel order
                  </button>
                </>
              )}

              {/* OPEN / PARTIAL actions */}
              {isActive && (
                <>
                  <button type="button" onClick={() => setShowCloseAll(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-xs text-emerald-300 font-medium hover:bg-emerald-600/30 transition-colors">
                    <CheckCircle2 size={11} />
                    Close all
                  </button>

                  {!isAtBe && !confirmBe && (
                    <button type="button" onClick={() => setConfirmBe(true)} disabled={movingBe}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 font-medium hover:bg-amber-500/20 transition-colors disabled:opacity-40"
                      title="Move stop-loss to entry price — risk becomes 0">
                      <ShieldCheck size={11} />
                      Move to BE
                    </button>
                  )}
                  {isAtBe && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-400/70 font-medium">
                      <ShieldCheck size={10} />
                      At BE — risk 0
                    </span>
                  )}
                </>
              )}

              {/* Edit — available for pending / open / partial */}
              {!isReadOnly && !isClosed && (
                <button type="button" onClick={() => setShowEditTrade(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-400 hover:text-brand-300 hover:border-brand-500/40 transition-colors"
                  title="Edit stop-loss, timeframe, confidence">
                  <SlidersHorizontal size={11} />
                  Edit
                </button>
              )}

              {/* Delete (all statuses — dangerous) */}
              <button type="button" onClick={() => void handleDelete()} disabled={deleting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-600 hover:text-red-400 hover:border-red-500/30 transition-colors disabled:opacity-40"
                title="Permanently delete this trade">
                {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
              </button>
            </div>
          </div>

          {/* ── Inline BE confirm ──────────────────────────────────────── */}
          {confirmBe && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-amber-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-amber-300">Move SL to breakeven?</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    SL → <span className="font-mono text-slate-300">{fmt(trade.entry_price, 4)}</span>
                    &nbsp;· current risk becomes <span className="font-mono text-emerald-400">0</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setConfirmBe(false)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-surface-600 text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-700 transition-colors">
                  <ShieldOff size={10} />
                  Cancel
                </button>
                <button type="button" onClick={() => void handleBreakeven()} disabled={movingBe}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-xs text-amber-300 font-semibold hover:bg-amber-500/30 transition-colors disabled:opacity-40">
                  {movingBe ? <Loader2 size={10} className="animate-spin" /> : <ShieldCheck size={10} />}
                  Confirm
                </button>
              </div>
            </div>
          )}

          {/* ── Action error banner ─────────────────────────────────────── */}
          {actionError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-red-400 flex items-center gap-1.5">
                <AlertTriangle size={11} /> {actionError}
              </span>
              <button type="button" onClick={() => setActionError(null)} className="text-slate-600 hover:text-slate-400">
                <X size={11} />
              </button>
            </div>
          )}
        </div>

        {/* ── P&L banner (closed trades) ───────────────────────────────── */}
        {isClosed && pnlNum !== null && (
          <div className={cn(
            'rounded-xl border p-4 flex items-center justify-between gap-4',
            pnlNum >= 0
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : 'bg-red-500/10 border-red-500/30',
          )}>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-0.5">
                Realised P&L
              </p>
              <p className={cn('text-2xl font-mono font-bold', pnlNum >= 0 ? 'text-emerald-300' : 'text-red-400')}>
                {pnlNum >= 0 ? '+' : ''}{fmt(pnlNum)}
              </p>
            </div>
            {realisedR !== null && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-0.5">R multiple</p>
                <p className={cn('text-xl font-mono font-bold', realisedR >= 0 ? 'text-emerald-300' : 'text-red-400')}>
                  {realisedR >= 0 ? '+' : ''}{realisedR.toFixed(2)}R
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  1R = {fmt(riskNum)} — risk staked
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Trade details ────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <Section title="📍 Prices">
            <InfoRow label="Entry price"     value={fmt(trade.entry_price, 4)} />
            <InfoRow label="Stop loss"       value={fmt(trade.stop_loss, 4)}   accent="red" />
            {slDist != null && <InfoRow label="SL distance" value={`${fmt(slDist, 4)} (${fmt(slPct, 2)}%)`} />}
            <InfoRow label="Direction"
              value={trade.direction}
              accent={trade.direction === 'LONG' ? 'green' : 'red'} />
          </Section>

          <Section title="⚠️ Risk">
            <InfoRow label="Initial risk"     value={`${fmt(trade.risk_amount)}`} accent="red" />
            {trade.current_risk != null && (
              <InfoRow
                label="Current risk"
                value={`${fmt(trade.current_risk)}`}
                accent={parseFloat(trade.current_risk) === 0 ? 'green' : 'amber'}
              />
            )}
            {isAtBe && (
              <InfoRow label="BE status" value={<span className="flex items-center gap-1"><ShieldCheck size={10} /> At breakeven</span>} accent="green" />
            )}
            <InfoRow label="Order type"      value={trade.order_type} />
            <InfoRow label="Asset class"     value={trade.asset_class} />
            {trade.analyzed_timeframe && (
              <InfoRow label="Timeframe"     value={trade.analyzed_timeframe} />
            )}
            {trade.confidence_score != null && (
              <InfoRow label="Confidence"    value={`${trade.confidence_score}/10`} />
            )}
          </Section>
        </div>

        {/* ── TP Positions ─────────────────────────────────────────────── */}
        <div className="bg-surface-800 rounded-xl border border-surface-700 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowPositions((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-3.5 border-b border-surface-700/50 hover:bg-surface-700/20 transition-colors"
          >
            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              Take-Profit Positions ({trade.positions.length})
            </span>
            {showPositions ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
          </button>

          {showPositions && (
            <div className="divide-y divide-surface-700/50">
              {trade.positions.map((pos) => {
                const posNum    = pos.position_number
                const tpNum     = parseFloat(pos.take_profit_price)
                const entryP    = parseFloat(trade.entry_price)
                const slP       = parseFloat(trade.initial_stop_loss ?? trade.stop_loss)
                const slDistP   = Math.abs(entryP - slP)
                const tpDistP   = Math.abs(tpNum - entryP)
                const rr        = slDistP > 0 ? tpDistP / slDistP : null
                const isOpen    = pos.status === 'open'
                const isHit     = pos.status === 'closed' || pos.status === 'partial'
                const canClose  = isActive && isOpen
                const lotPct    = parseFloat(pos.lot_percentage)
                const totalUnits = slDistP > 0 ? parseFloat(trade.risk_amount) / slDistP : 0
                const posUnits  = totalUnits * (lotPct / 100)

                return (
                  <div key={pos.id} className={cn('px-5 py-3', isHit && 'opacity-60')}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn(
                          'shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border',
                          isHit ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                          : isOpen ? 'bg-brand-500/20 border-brand-500/40 text-brand-300'
                          : 'bg-surface-700 border-surface-600 text-slate-500',
                        )}>
                          {posNum}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-mono font-medium text-slate-200">{fmt(pos.take_profit_price, 4)}</p>
                          <p className="text-[10px] text-slate-500">
                            {lotPct}% · {rr != null ? `${rr.toFixed(2)}R` : '—'}
                            {isHit && pos.exit_price && (
                              <span className="text-emerald-400 ml-1.5">✓ {fmt(pos.exit_price, 4)}</span>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {pos.realized_pnl != null && (
                          <span className={cn(
                            'text-xs font-mono font-bold',
                            parseFloat(pos.realized_pnl) > 0 ? 'text-emerald-400'
                            : parseFloat(pos.realized_pnl) < 0 ? 'text-red-400'
                            : 'text-amber-400/80',
                          )}>
                            {parseFloat(pos.realized_pnl) > 0 ? '+' : ''}{fmt(pos.realized_pnl)}
                            {parseFloat(pos.realized_pnl) === 0 && <span className="ml-1 text-[9px] opacity-60">(BE)</span>}
                          </span>
                        )}
                        {canClose && (
                          <button
                            type="button"
                            onClick={() => setPartialTpId(pos.position_number)}
                            className="px-2.5 py-1 rounded-lg bg-brand-600/15 border border-brand-500/30 text-[10px] text-brand-400 hover:bg-brand-600/25 transition-colors font-medium"
                          >
                            Book TP{posNum}
                          </button>
                        )}
                      </div>
                    </div>
                    {totalUnits > 0 && (
                      <div className="ml-9 mt-1 flex items-center gap-3 text-[10px] text-slate-600">
                        <span>Qty: <span className={cn('font-mono', isOpen ? 'text-slate-400' : 'text-slate-500')}>{posUnits.toFixed(6)}</span></span>
                        <span className="text-slate-700">·</span>
                        <span>Alloc: <span className={cn('font-mono', isOpen ? 'text-slate-400' : 'text-slate-500')}>{lotPct}%</span></span>
                        {slDistP === 0 && <span className="text-amber-500/70">⚠ initial SL = entry — qty unavailable</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Entry notes + screenshots ────────────────────────────────── */}
        <div className="bg-surface-800 rounded-xl border border-surface-700 p-5 space-y-3">
          {/* Notes header */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">📝 Entry notes</p>
            {!isClosed && !isReadOnly && !editingNotes && (
              <button type="button" onClick={() => setEditingNotes(true)}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-brand-400 transition-colors">
                <Edit3 size={10} /> Edit
              </button>
            )}
          </div>
          {editingNotes ? (
            <div className="space-y-2">
              <textarea
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                rows={4}
                className={cn(inputCls, 'resize-none text-xs')}
                placeholder="Setup rationale, confluences, market context…"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setEditingNotes(false); setNotesValue(trade.notes ?? '') }}
                  className="flex-1 py-1.5 rounded-lg border border-surface-600 text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-700 transition-colors">
                  Discard
                </button>
                <button type="button" onClick={() => void handleSaveNotes()} disabled={savingNotes}
                  className="flex-1 py-1.5 rounded-lg bg-brand-600/20 border border-brand-500/40 text-xs text-brand-300 font-medium hover:bg-brand-600/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
                  {savingNotes ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
              {trade.notes || <span className="text-slate-600 italic">No entry notes.</span>}
            </p>
          )}

          {/* Entry screenshots */}
          <div className="space-y-1.5 pt-1 border-t border-surface-700/40">
            <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">📸 Entry screenshots</p>
            <SnapshotGallery
              tradeId={trade.id}
              urls={trade.entry_screenshot_urls}
              kind="entry"
              onUpdated={setTrade}
              readOnly={isReadOnly}
            />
          </div>
        </div>

        {/* ── Close notes + screenshots (always editable — post-trade review) */}
        <div className="bg-surface-800 rounded-xl border border-surface-700 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              🔍 Post-trade review
            </p>
            {!editingCloseNotes && !isReadOnly && (
              <button type="button" onClick={() => setEditingCloseNotes(true)}
                className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-brand-400 transition-colors">
                <Edit3 size={10} /> Edit
              </button>
            )}
            {isClosed && !editingCloseNotes && (
              <span className="text-[9px] text-emerald-400/60">always editable</span>
            )}
          </div>

          {editingCloseNotes ? (
            <div className="space-y-2">
              <textarea
                value={closeNotesValue}
                onChange={(e) => setCloseNotesValue(e.target.value)}
                rows={4}
                className={cn(inputCls, 'resize-none text-xs')}
                placeholder="What happened? Key lessons? Would you take this again?"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => { setEditingCloseNotes(false); setCloseNotesValue(trade.close_notes ?? '') }}
                  className="flex-1 py-1.5 rounded-lg border border-surface-600 text-xs text-slate-400 hover:text-slate-200 hover:bg-surface-700 transition-colors">
                  Discard
                </button>
                <button type="button" onClick={() => void handleSaveCloseNotes()} disabled={savingCloseNotes}
                  className="flex-1 py-1.5 rounded-lg bg-brand-600/20 border border-brand-500/40 text-xs text-brand-300 font-medium hover:bg-brand-600/30 transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
                  {savingCloseNotes ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-wrap">
              {trade.close_notes || (
                <span className="text-slate-600 italic">
                  {isClosed ? 'No post-trade notes. Click edit to add.' : 'Will be available after closing the trade.'}
                </span>
              )}
            </p>
          )}

          {/* Close screenshots */}
          <div className="space-y-1.5 pt-1 border-t border-surface-700/40">
            <p className="text-[10px] uppercase tracking-wider text-slate-600 font-semibold">📸 Close screenshots</p>
            <SnapshotGallery
              tradeId={trade.id}
              urls={trade.close_screenshot_urls}
              kind="close"
              onUpdated={(updated) => { setTrade(updated); setCloseNotesValue(updated.close_notes ?? '') }}
              readOnly={isReadOnly}
            />
          </div>
        </div>

        {/* ── Metadata ────────────────────────────────────────────────── */}
        <Section title="🗓 Metadata">
          <InfoRow label="Created"     value={fmtDate(trade.created_at)} />
          <InfoRow label="Updated"     value={fmtDate(trade.updated_at)} />
          {trade.closed_at && <InfoRow label="Closed" value={fmtDate(trade.closed_at)} />}
          {trade.session_tag && <InfoRow label="Session" value={trade.session_tag} />}
          {trade.strategy_ids && trade.strategy_ids.length > 0 && (
              <InfoRow
                label="Strategies"
                value={
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {trade.strategy_ids.map((sid) => {
                      const s = strategyMap.get(sid)
                      return (
                        <span key={sid}
                          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded
                            bg-brand-600/15 border border-brand-500/30 text-[10px] font-medium text-brand-300 whitespace-nowrap">
                          {s?.emoji && <span>{s.emoji}</span>}
                          {s?.name ?? `#${sid}`}
                        </span>
                      )
                    })}
                  </div>
                }
              />
            )}
        </Section>

      </div>
    </div>
  )
}
