// ── PortfolioPage ── Phase 7 — Unified portfolio for all profile types (contracts + spot)
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, X, TrendingUp, TrendingDown, CheckCircle2, XCircle, Pencil, Trash2, BookOpen, ChevronRight } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { useProfile } from '../../context/ProfileContext'
import { investmentApi, strategiesApi, instrumentsApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type {
  SpotTradeOut, SpotTradeCreate, SpotTradeClose,
  PortfolioOut, DepositOut, DepositCreate, DepositUpdate, Strategy, Instrument,
} from '../../types/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: string | number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── OpenTradeModal ────────────────────────────────────────────────────────────

interface OpenTradeModalProps {
  profileId: number
  onClose: () => void
  onSaved: () => void
}

const EMPTY_TRADE_FORM: SpotTradeCreate = {
  pair: '',
  entry_price: '',
  quantity: '',
  stop_loss: '',
  strategy_id: null,
  instrument_id: null,
  notes: '',
}

function OpenTradeModal({ profileId, onClose, onSaved }: OpenTradeModalProps) {
  const { activeProfile } = useProfile()
  const [form, setForm] = useState<SpotTradeCreate>(EMPTY_TRADE_FORM)
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [instruments, setInstruments] = useState<Instrument[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
      strategiesApi.list(profileId).then(setStrategies).catch(() => {})
      if (activeProfile?.broker_id) {
        instrumentsApi.listByBroker(activeProfile.broker_id)
          .then(all => setInstruments(all.filter(i => !i.symbol.startsWith('PF_'))))
          .catch(() => {})
      }
  }, [profileId, activeProfile?.broker_id])

  const set = (field: keyof SpotTradeCreate, value: string | number | null) =>
    setForm((f) => ({ ...f, [field]: value }))

  const totalCost = form.entry_price && form.quantity
    ? (Number(form.entry_price) * Number(form.quantity)).toFixed(2)
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await investmentApi.createTrade(profileId, {
        pair: form.pair.toUpperCase().trim(),
        entry_price: form.entry_price,
        quantity: form.quantity,
        stop_loss: (form.stop_loss as string) || null,
        strategy_id: form.strategy_id ?? null,
        instrument_id: form.instrument_id ?? null,
        notes: (form.notes as string) || null,
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
          <h2 className="text-sm font-semibold text-slate-100">Open spot position</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors p-1 rounded">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">{error}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Pair *</label>
            <input
              required
              list="spot-pairs-datalist"
              value={form.pair}
              onChange={(e) => {
                const val = e.target.value
                set('pair', val)
                const match = instruments.find(i => i.symbol === val.toUpperCase().trim())
                set('instrument_id', match ? match.id : null)
              }}
              placeholder="XBTUSD, ETHUSD, SOLUSD…"
              className={inputCls}
            />
            <datalist id="spot-pairs-datalist">
              {instruments.map(i => (
                <option key={i.id} value={i.symbol}>{i.display_name}</option>
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Entry price *</label>
              <input
                required
                type="number"
                step="any"
                min="0.000001"
                value={form.entry_price}
                onChange={(e) => set('entry_price', e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Quantity *</label>
              <input
                required
                type="number"
                step="any"
                min="0.000001"
                value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                placeholder="0.00"
                className={inputCls}
              />
            </div>
          </div>

          {totalCost && (
            <div className="rounded-lg bg-surface-700/50 border border-surface-600 px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">Total cost</span>
              <span className="text-sm font-mono font-semibold text-slate-200">{fmt(totalCost)}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Stop loss <span className="text-slate-600">(optional)</span></label>
            <input
              type="number"
              step="any"
              min="0"
              value={form.stop_loss as string}
              onChange={(e) => set('stop_loss', e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Strategy <span className="text-slate-600">(optional)</span></label>
            <select
              value={form.strategy_id ?? ''}
              onChange={(e) => set('strategy_id', e.target.value ? Number(e.target.value) : null)}
              className={cn(inputCls, 'cursor-pointer')}
            >
              <option value="">No strategy</option>
              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji ? `${s.emoji} ` : ''}{s.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Notes <span className="text-slate-600">(optional)</span></label>
            <textarea
              rows={2}
              value={form.notes as string}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Entry rationale, strategy…"
              className={cn(inputCls, 'resize-none')}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-surface-600 bg-surface-700 text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Open position
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── CloseTradeModal ───────────────────────────────────────────────────────────

interface CloseTradeModalProps {
  trade: SpotTradeOut
  profileId: number
  onClose: () => void
  onSaved: () => void
}

function CloseTradeModal({ trade, profileId, onClose, onSaved }: CloseTradeModalProps) {
  const [exitPrice, setExitPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pnl = exitPrice
    ? (Number(exitPrice) - Number(trade.entry_price)) * Number(trade.quantity)
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload: SpotTradeClose = { exit_price: exitPrice }
      await investmentApi.closeTrade(profileId, trade.id, payload)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
          <h2 className="text-sm font-semibold text-slate-100">Close {trade.pair}</h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors p-1 rounded">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">{error}</div>
          )}

          <div className="rounded-lg bg-surface-700/50 border border-surface-600 px-3 py-2 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Entry price</span>
              <span className="font-mono text-slate-300">{fmt(trade.entry_price)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-slate-500">Quantity</span>
              <span className="font-mono text-slate-300">{fmt(trade.quantity, 6)}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Exit price *</label>
            <input
              required
              type="number"
              step="any"
              min="0.000001"
              value={exitPrice}
              onChange={(e) => setExitPrice(e.target.value)}
              placeholder="0.00"
              autoFocus
              className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50"
            />
          </div>

          {pnl != null && (
            <div className={cn(
              'rounded-lg border px-3 py-2 flex items-center justify-between',
              pnl >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30',
            )}>
              <span className="text-xs text-slate-500">Estimated P&L</span>
              <span className={cn('text-sm font-mono font-semibold', pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {pnl >= 0 ? '+' : ''}{fmt(pnl)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-surface-600 bg-surface-700 text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              Close position
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── DepositModal ──────────────────────────────────────────────────────────────

interface DepositFormData {
  amount: string
  deposit_date: string
  label: string
  is_recurrent: boolean
}

const EMPTY_DEPOSIT_FORM: DepositFormData = {
  amount: '',
  deposit_date: todayISO(),
  label: '',
  is_recurrent: false,
}

interface DepositModalProps {
  profileId: number
  existing: DepositOut | null
  onClose: () => void
  onSaved: () => void
}

function DepositModal({ profileId, existing, onClose, onSaved }: DepositModalProps) {
  const isEdit = existing !== null
  const [form, setForm] = useState<DepositFormData>(
    isEdit
      ? {
          amount: existing.amount,
          deposit_date: existing.deposit_date.slice(0, 10),
          label: existing.label ?? '',
          is_recurrent: existing.is_recurrent,
        }
      : EMPTY_DEPOSIT_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof DepositFormData, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (isEdit) {
        const update: DepositUpdate = {
          amount: form.amount,
          deposit_date: form.deposit_date,
          label: form.label || null,
          is_recurrent: form.is_recurrent,
        }
        await investmentApi.updateDeposit(profileId, existing.id, update)
      } else {
        const create: DepositCreate = {
          amount: form.amount,
          deposit_date: form.deposit_date,
          label: form.label || null,
          is_recurrent: form.is_recurrent,
        }
        await investmentApi.createDeposit(profileId, create)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50'
  const isNegative = form.amount !== '' && Number(form.amount) < 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
          <h2 className="text-sm font-semibold text-slate-100">
            {isEdit ? 'Edit entry' : 'Add deposit / withdrawal'}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors p-1 rounded">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">{error}</div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Amount * <span className="text-slate-600">(negative for withdrawal)</span>
            </label>
            <input
              required
              type="number"
              step="any"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="500.00 or -200.00"
              className={cn(inputCls, isNegative ? 'text-red-400' : '')}
            />
            {isNegative && (
              <p className="text-[10px] text-red-400/70 mt-1">Withdrawal — will reduce capital</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Date *</label>
            <input
              required
              type="date"
              value={form.deposit_date}
              onChange={(e) => set('deposit_date', e.target.value)}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Label <span className="text-slate-600">(optional)</span>
            </label>
            <input
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
              placeholder="Monthly contribution, bonus…"
              maxLength={120}
              className={inputCls}
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={form.is_recurrent}
              onChange={(e) => set('is_recurrent', e.target.checked)}
              className="w-4 h-4 rounded border-surface-600 bg-surface-700 accent-brand-500 cursor-pointer"
            />
            <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors">
              Recurrent deposit
            </span>
          </label>

          <div className="flex items-center gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-surface-600 bg-surface-700 text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {isEdit ? 'Save changes' : 'Add entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── TradeRow ──────────────────────────────────────────────────────────────────

interface TradeRowProps {
  trade: SpotTradeOut
  onClose: (t: SpotTradeOut) => void
  onCancel: (t: SpotTradeOut) => void
  cancelling: boolean
}

function TradeRow({ trade, onClose, onCancel, cancelling }: TradeRowProps) {
  const isOpen = trade.status === 'open'
  const pnl = trade.realized_pnl ? Number(trade.realized_pnl) : null

  return (
    <tr className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
      <td className="px-4 py-3 text-xs font-semibold text-slate-200">{trade.pair}</td>
      <td className="px-4 py-3 text-xs font-mono text-slate-400">{fmt(trade.entry_price)}</td>
      <td className="px-4 py-3 text-xs font-mono text-slate-400">{fmt(trade.quantity, 6)}</td>
      <td className="px-4 py-3 text-xs font-mono text-slate-400">{fmt(trade.total_cost)}</td>
      <td className="px-4 py-3 text-xs font-mono text-slate-500">
        {trade.stop_loss ? fmt(trade.stop_loss) : '—'}
      </td>
      <td className="px-4 py-3 text-xs font-mono">
        {isOpen
          ? <span className="text-sky-400 font-mono">{fmtDate(trade.opened_at)}</span>
          : <span className={cn('font-mono', pnl != null && pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {pnl != null ? `${pnl >= 0 ? '+' : ''}${fmt(pnl)}` : '—'}
            </span>
        }
      </td>
      <td className="px-4 py-3 text-xs">
        <span className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-medium border',
          trade.status === 'open'   ? 'text-sky-300 bg-sky-500/15 border-sky-500/30'
          : trade.status === 'closed' ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
          : 'text-slate-500 bg-surface-700 border-surface-600',
        )}>
          {trade.status}
        </span>
      </td>
      {isOpen && (
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onClose(trade)}
              className="text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors flex items-center gap-1"
            >
              <CheckCircle2 size={11} /> Close
            </button>
            <button
              type="button"
              disabled={cancelling}
              onClick={() => onCancel(trade)}
              className="text-[10px] text-slate-500 hover:text-red-400 transition-colors flex items-center gap-1 disabled:opacity-40"
            >
              <XCircle size={11} /> Cancel
            </button>
          </div>
        </td>
      )}
      {!isOpen && (
        <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(trade.closed_at)}</td>
      )}
    </tr>
  )
}

// ── PortfolioPage ─────────────────────────────────────────────────────────────

type PortfolioTab = 'holdings' | 'deposits'

export function PortfolioPage() {
  const { activeProfile } = useProfile()
  const isSpot = activeProfile?.account_type === 'spot'
  const accountType = activeProfile?.account_type ?? 'contracts'
  const [tab, setTab] = useState<PortfolioTab>(
    () => activeProfile?.account_type === 'spot' ? 'holdings' : 'deposits',
  )
  // Reset tab when switching between profile types
  useEffect(() => { setTab(isSpot ? 'holdings' : 'deposits') }, [isSpot])

  const [portfolio,    setPortfolio]    = useState<PortfolioOut | null>(null)
  const [openTrades,   setOpenTrades]   = useState<SpotTradeOut[]>([])
  const [closedTrades, setClosedTrades] = useState<SpotTradeOut[]>([])
  const [deposits,     setDeposits]     = useState<DepositOut[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  // Position modals
  const [showOpen,     setShowOpen]     = useState(false)
  const [closingTrade, setClosingTrade] = useState<SpotTradeOut | null>(null)
  const [cancelling,   setCancelling]   = useState<number | null>(null)

  // Deposit modals
  const [depositModal, setDepositModal] = useState<DepositOut | null | 'new'>(null)
  const [deleting,     setDeleting]     = useState<number | null>(null)

  const profileId = activeProfile?.id ?? null

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    try {
      const [port, deps] = await Promise.all([
        investmentApi.getPortfolio(profileId),
        investmentApi.listDeposits(profileId),
      ])
      setPortfolio(port)
      setDeposits([...deps].sort((a, b) => b.deposit_date.localeCompare(a.deposit_date)))
      if (accountType === 'spot') {
        const [open, closed] = await Promise.all([
          investmentApi.listTrades(profileId, 'open'),
          investmentApi.listTrades(profileId, 'closed'),
        ])
        setOpenTrades(open)
        setClosedTrades(closed)
      } else {
        setOpenTrades([])
        setClosedTrades([])
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [profileId, accountType])

  useEffect(() => { void load() }, [load])

  const handleCancel = async (trade: SpotTradeOut) => {
    if (!profileId) return
    if (!confirm(`Cancel position ${trade.pair}? This cannot be undone.`)) return
    setCancelling(trade.id)
    try {
      await investmentApi.cancelTrade(profileId, trade.id)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to cancel')
    } finally {
      setCancelling(null)
    }
  }

  const handleDeleteDeposit = async (id: number) => {
    if (!profileId) return
    if (!confirm('Delete this entry? This cannot be undone.')) return
    setDeleting(id)
    try {
      await investmentApi.deleteDeposit(profileId, id)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeleting(null)
    }
  }

  if (!activeProfile) {
    return <div className="p-8 text-center text-slate-600 text-sm">No active profile selected.</div>
  }

  const currency = activeProfile.currency ?? ''
  const pnlPositive = portfolio ? Number(portfolio.realized_pnl ?? '0') >= 0 : true

  // Deposit stats
  const totalDeposited  = deposits.filter((d) => Number(d.amount) > 0).reduce((s, d) => s + Number(d.amount), 0)
  const totalWithdrawn  = deposits.filter((d) => Number(d.amount) < 0).reduce((s, d) => s + Number(d.amount), 0)
  const netContribution = totalDeposited + totalWithdrawn

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        icon={isSpot ? '🪙' : '💼'}
        title="Portfolio"
        subtitle={activeProfile.name}
        actions={
          isSpot && tab === 'holdings'
            ? (
              <button
                type="button"
                onClick={() => setShowOpen(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
              >
                <Plus size={15} /> Open position
              </button>
            )
            : tab === 'deposits'
            ? (
              <button
                type="button"
                onClick={() => setDepositModal('new')}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
              >
                <Plus size={15} /> Add entry
              </button>
            )
            : null
        }
      />

      {/* ── Portfolio stats header ── */}
      {portfolio && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Capital"
            value={`${fmt(portfolio.capital_current, 0)} ${currency}`}
            sub={`Start: ${fmt(portfolio.capital_start, 0)}`}
          />
          <StatCard
            label="Total deposited"
            value={`${fmt(portfolio.total_deposited, 0)} ${currency}`}
          />
          <StatCard
            label="Realized P&L"
            value={`${pnlPositive ? '+' : ''}${fmt(portfolio.realized_pnl ?? '0')} ${currency}`}
            accent={pnlPositive ? 'bull' : 'bear'}
          />
          {isSpot && (
            <StatCard
              label="Holdings"
              value={String(portfolio.open_positions_count)}
            />
          )}
        </div>

        {/* Contracts: link to Trade Journal */}
        {!isSpot && (
          <div className="rounded-xl bg-surface-800/50 border border-surface-700 px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BookOpen size={15} className="text-brand-400 shrink-0" />
              <span className="text-sm text-slate-400">Manage and review your trades</span>
            </div>
            <Link to="/trades" className="text-xs text-brand-400 hover:text-brand-300 flex items-center gap-1 shrink-0">
              Trade Journal <ChevronRight size={12} />
            </Link>
          </div>
        )}

        </>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* ── Tab switcher — spot only (contracts goes straight to deposits) ── */}
      {isSpot && (
        <div className="flex border-b border-surface-700">
        {(['holdings', 'deposits'] as PortfolioTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors capitalize',
              tab === t
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-300',
            )}
          >
            {t}
            {t === 'holdings' && openTrades.length > 0 && (
              <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/25">
                {openTrades.length}
              </span>
            )}
          </button>
        ))}
      </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-slate-600" />
        </div>
      )}

      {/* ── Holdings tab — spot only ── */}
      {isSpot && !loading && tab === 'holdings' && (
        <div className="space-y-4">
          {/* Open holdings */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-sky-400" />
                <span className="text-sm font-medium text-slate-200">Holdings</span>
                {openTrades.length > 0 && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/25">
                    {openTrades.length}
                  </span>
                )}
              </div>
            </div>

            {openTrades.length === 0 ? (
              <div className="px-4 py-10 text-center text-xs text-slate-600">
                No open holdings. Click "Open position" to start.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-surface-700/50">
                      {['Pair', 'Entry', 'Qty', 'Cost', 'SL', 'Opened', 'Status', 'Actions'].map((h) => (
                        <th key={h} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.map((t) => (
                      <TradeRow
                        key={t.id}
                        trade={t}
                        onClose={(tr) => setClosingTrade(tr)}
                        onCancel={handleCancel}
                        cancelling={cancelling === t.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Closed trades */}
          {closedTrades.length > 0 && (
            <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-700">
                <TrendingDown size={14} className="text-slate-500" />
                <span className="text-sm font-medium text-slate-200">Closed trades</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-surface-700 text-slate-400 border border-surface-600">
                  {closedTrades.length}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-surface-700/50">
                      {['Pair', 'Entry', 'Qty', 'Cost', 'SL', 'P&L', 'Status', 'Closed'].map((h) => (
                        <th key={h} className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {closedTrades.map((t) => (
                      <TradeRow
                        key={t.id}
                        trade={t}
                        onClose={() => {}}
                        onCancel={() => {}}
                        cancelling={false}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Deposits tab ── */}
      {!loading && tab === 'deposits' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total deposited" value={`${fmt(totalDeposited, 0)} ${currency}`} accent="bull" />
            <StatCard label="Total withdrawn"  value={`${fmt(Math.abs(totalWithdrawn), 0)} ${currency}`} accent="bear" />
            <StatCard
              label="Net contribution"
              value={`${netContribution >= 0 ? '+' : ''}${fmt(netContribution, 0)} ${currency}`}
              accent={netContribution >= 0 ? 'bull' : 'bear'}
            />
          </div>

          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            {deposits.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-slate-600">
                No entries yet. Click "Add entry" to log your first deposit.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-surface-700/50">
                      {['Date', 'Amount', 'Label', 'Type', 'Actions'].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((d) => {
                      const isPos = Number(d.amount) >= 0
                      return (
                        <tr key={d.id} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                          <td className="px-4 py-3 text-xs text-slate-400 font-mono">{fmtDate(d.deposit_date)}</td>
                          <td className="px-4 py-3">
                            <span className={cn('text-sm font-mono font-semibold', isPos ? 'text-emerald-400' : 'text-red-400')}>
                              {isPos ? '+' : ''}{fmt(d.amount)}
                              {currency && <span className="text-[10px] text-slate-600 ml-1">{currency}</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">{d.label ?? <span className="text-slate-600">—</span>}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <span className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-medium border',
                                isPos ? 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30'
                                      : 'text-red-300 bg-red-500/10 border-red-500/30',
                              )}>
                                {isPos ? 'Deposit' : 'Withdrawal'}
                              </span>
                              {d.is_recurrent && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border text-violet-300 bg-violet-500/10 border-violet-500/25">
                                  Recurrent
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDepositModal(d)}
                                className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-400 hover:text-slate-200 transition-colors"
                                title="Edit"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                disabled={deleting === d.id}
                                onClick={() => handleDeleteDeposit(d.id)}
                                className="p-1.5 rounded-lg bg-surface-700 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors disabled:opacity-40"
                                title="Delete"
                              >
                                {deleting === d.id
                                  ? <Loader2 size={12} className="animate-spin" />
                                  : <Trash2 size={12} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {showOpen && (
        <OpenTradeModal
          profileId={activeProfile.id}
          onClose={() => setShowOpen(false)}
          onSaved={() => { setShowOpen(false); void load() }}
        />
      )}
      {closingTrade && (
        <CloseTradeModal
          trade={closingTrade}
          profileId={activeProfile.id}
          onClose={() => setClosingTrade(null)}
          onSaved={() => { setClosingTrade(null); void load() }}
        />
      )}
      {depositModal !== null && (
        <DepositModal
          profileId={activeProfile.id}
          existing={depositModal === 'new' ? null : depositModal}
          onClose={() => setDepositModal(null)}
          onSaved={() => { setDepositModal(null); void load() }}
        />
      )}
    </div>
  )
}
