// ── SpotPage ── Phase 7B — Spot positions (open + closed) + portfolio summary
import { useEffect, useState, useCallback } from 'react'
import { Loader2, Plus, X, TrendingUp, TrendingDown, CheckCircle2, XCircle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { useProfile } from '../../context/ProfileContext'
import { investmentApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { SpotTradeOut, SpotTradeCreate, SpotTradeClose, PortfolioOut } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// OpenTradeModal
// ─────────────────────────────────────────────────────────────────────────────

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
  notes: '',
}

function OpenTradeModal({ profileId, onClose, onSaved }: OpenTradeModalProps) {
  const [form, setForm] = useState<SpotTradeCreate>(EMPTY_TRADE_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (field: keyof SpotTradeCreate, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const totalCost = form.entry_price && form.quantity
    ? (Number(form.entry_price) * Number(form.quantity)).toFixed(2)
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const payload: SpotTradeCreate = {
        pair: form.pair.toUpperCase().trim(),
        entry_price: form.entry_price,
        quantity: form.quantity,
        stop_loss: form.stop_loss || null,
        notes: form.notes || null,
      }
      await investmentApi.createTrade(profileId, payload)
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
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Pair *</label>
            <input
              required
              value={form.pair}
              onChange={(e) => set('pair', e.target.value)}
              placeholder="BTC, ETH, SOL…"
              className={inputCls}
            />
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

// ─────────────────────────────────────────────────────────────────────────────
// CloseTradeModal
// ─────────────────────────────────────────────────────────────────────────────

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
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
              {error}
            </div>
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

// ─────────────────────────────────────────────────────────────────────────────
// TradeRow
// ─────────────────────────────────────────────────────────────────────────────

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
        {isOpen ? (
          <span className="text-sky-400 font-mono">{fmtDate(trade.created_at)}</span>
        ) : (
          <span className={cn('font-mono', pnl != null && pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {pnl != null ? `${pnl >= 0 ? '+' : ''}${fmt(pnl)}` : '—'}
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-xs">
        <span className={cn(
          'px-1.5 py-0.5 rounded text-[10px] font-medium border',
          trade.status === 'open' ? 'text-sky-300 bg-sky-500/15 border-sky-500/30'
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

// ─────────────────────────────────────────────────────────────────────────────
// SpotPage
// ─────────────────────────────────────────────────────────────────────────────

export function SpotPage() {
  const { activeProfile } = useProfile()
  const [portfolio, setPortfolio] = useState<PortfolioOut | null>(null)
  const [openTrades, setOpenTrades]   = useState<SpotTradeOut[]>([])
  const [closedTrades, setClosedTrades] = useState<SpotTradeOut[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [showOpen, setShowOpen] = useState(false)
  const [closingTrade, setClosingTrade] = useState<SpotTradeOut | null>(null)
  const [cancelling, setCancelling]     = useState<number | null>(null)

  const profileId = activeProfile?.id ?? null

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    try {
      const [port, open, closed] = await Promise.all([
        investmentApi.getPortfolio(profileId),
        investmentApi.listTrades(profileId, 'open'),
        investmentApi.listTrades(profileId, 'closed'),
      ])
      setPortfolio(port)
      setOpenTrades(open)
      setClosedTrades(closed)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [profileId])

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

  if (!activeProfile) {
    return (
      <div className="p-8 text-center text-slate-600 text-sm">No active profile selected.</div>
    )
  }

  if (activeProfile.account_type !== 'spot') {
    return (
      <div className="p-8 text-center text-slate-600 text-sm">
        This section is only available for Spot profiles.
      </div>
    )
  }

  const currency = activeProfile.currency ?? ''
  const pnlPositive = portfolio ? Number(portfolio.realized_pnl) >= 0 : true

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        icon="🪙"
        title="Spot Positions"
        subtitle={activeProfile.name}
        actions={
          <button
            type="button"
            onClick={() => setShowOpen(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
          >
            <Plus size={15} /> Open position
          </button>
        }
      />

      {/* Portfolio summary */}
      {portfolio && (
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
            value={`${pnlPositive ? '+' : ''}${fmt(portfolio.realized_pnl)} ${currency}`}
            accent={pnlPositive ? 'bull' : 'bear'}
          />
          <StatCard
            label="Open positions"
            value={String(portfolio.open_positions_count)}
          />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-slate-600" />
        </div>
      )}

      {/* Open positions */}
      {!loading && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} className="text-sky-400" />
              <span className="text-sm font-medium text-slate-200">Open positions</span>
              {openTrades.length > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/25">
                  {openTrades.length}
                </span>
              )}
            </div>
          </div>

          {openTrades.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-slate-600">
              No open positions. Click "Open position" to start.
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
      )}

      {/* Closed positions */}
      {!loading && closedTrades.length > 0 && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-surface-700">
            <TrendingDown size={14} className="text-slate-500" />
            <span className="text-sm font-medium text-slate-200">Closed positions</span>
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

      {/* Modals */}
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
    </div>
  )
}
