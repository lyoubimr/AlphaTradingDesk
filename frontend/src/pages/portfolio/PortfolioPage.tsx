// ── PortfolioPage ── Phase 7 — Capital & deposits overview (all profile types)
import { useEffect, useState, useCallback } from 'react'
import { Loader2, Plus, X, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { useProfile } from '../../context/ProfileContext'
import { investmentApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type {
  PortfolioOut, DepositOut, DepositCreate, DepositUpdate,
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

// ── PortfolioPage ─────────────────────────────────────────────────────────────

export function PortfolioPage() {
  const { activeProfile } = useProfile()
  const isSpot = activeProfile?.account_type === 'spot'

  const [portfolio,    setPortfolio]    = useState<PortfolioOut | null>(null)
  const [deposits,     setDeposits]     = useState<DepositOut[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
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
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => { void load() }, [load])

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
  const totalDeposited  = deposits.filter((d) => Number(d.amount) > 0).reduce((s, d) => s + Number(d.amount), 0)
  const totalWithdrawn  = deposits.filter((d) => Number(d.amount) < 0).reduce((s, d) => s + Number(d.amount), 0)
  const netContribution = totalDeposited + totalWithdrawn
  const capitalGrowth    = portfolio ? Number(portfolio.capital_current) - Number(portfolio.capital_start) : 0
  const capitalGrowthPct = portfolio && Number(portfolio.capital_start) !== 0
    ? (capitalGrowth / Number(portfolio.capital_start)) * 100
    : 0
  const growthPos = capitalGrowth >= 0

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        icon={isSpot ? '🪙' : '💼'}
        title="Portfolio"
        subtitle={activeProfile.name}
        actions={
          <button
            type="button"
            onClick={() => setDepositModal('new')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors"
          >
            <Plus size={15} /> Add entry
          </button>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* ── Hero Capital Card ──────────────────────────────────────────────── */}
      {portfolio && (
        <div className="relative rounded-2xl border border-surface-700 bg-gradient-to-br from-surface-800 to-surface-700/60 px-6 py-6 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-brand-600/8 to-transparent pointer-events-none" />
          <div className="relative flex items-start justify-between gap-6 flex-wrap">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Current Capital</p>
              <p className="text-4xl font-bold text-slate-100 tabular-nums leading-none">
                {fmt(portfolio.capital_current, 0)}
                {currency && <span className="text-2xl text-slate-500 ml-2 font-normal">{currency}</span>}
              </p>
              <p className="text-xs text-slate-500 mt-2">
                Started at{' '}
                <span className="text-slate-400 font-medium">
                  {fmt(portfolio.capital_start, 0)}{currency ? ` ${currency}` : ''}
                </span>
              </p>
            </div>

            {Number(portfolio.capital_start) > 0 && (
              <div className={cn(
                'flex flex-col items-end gap-1 px-5 py-3 rounded-xl border shrink-0',
                growthPos
                  ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/25 text-red-400',
              )}>
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60">Growth</span>
                <span className="text-xl font-bold tabular-nums leading-none">
                  {growthPos ? '+' : ''}{fmt(capitalGrowth, 0)}{currency ? ` ${currency}` : ''}
                </span>
                <span className="text-sm font-semibold">
                  {growthPos ? '+' : ''}{capitalGrowthPct.toFixed(2)}%
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Stat Cards ─────────────────────────────────────────────────────── */}
      {portfolio && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <StatCard
            label="Realized P&L"
            value={
              <span className={pnlPositive ? 'text-emerald-400' : 'text-red-400'}>
                {pnlPositive ? '+' : ''}{fmt(portfolio.realized_pnl ?? '0')}
                {currency && <span className="text-sm text-slate-500 ml-1 font-normal">{currency}</span>}
              </span>
            }
            accent={pnlPositive ? 'bull' : 'bear'}
          />
          <StatCard
            label="Total deposited"
            value={`${fmt(portfolio.total_deposited, 0)}${currency ? ` ${currency}` : ''}`}
          />
          <StatCard
            label="Open positions"
            value={String(portfolio.open_positions_count)}
            sub={isSpot ? 'Holdings in spot account' : 'Active trades in Trade Journal'}
          />
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-slate-600" />
        </div>
      )}

      {/* ── Deposit History ────────────────────────────────────────────────── */}
      {!loading && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Deposit History</h2>
              {deposits.length > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">
                  Net:{' '}
                  <span className={cn('font-medium', netContribution >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {netContribution >= 0 ? '+' : ''}{fmt(netContribution, 0)}{currency ? ` ${currency}` : ''}
                  </span>
                  {totalWithdrawn < 0 && (
                    <span className="ml-2 text-slate-600">
                      ({fmt(totalDeposited, 0)} in · {fmt(Math.abs(totalWithdrawn), 0)} out)
                    </span>
                  )}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setDepositModal('new')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-600 bg-surface-700 text-slate-300 hover:text-white text-xs font-medium transition-colors"
            >
              <Plus size={12} /> Add entry
            </button>
          </div>

          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            {deposits.length === 0 ? (
              <div className="px-4 py-14 text-center">
                <p className="text-sm text-slate-500">No deposits or withdrawals logged yet.</p>
                <button
                  type="button"
                  onClick={() => setDepositModal('new')}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600/20 border border-brand-500/30 text-brand-400 hover:text-brand-300 text-xs font-medium transition-colors"
                >
                  <Plus size={12} /> Log first deposit
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-surface-700/50">
                      {['Date', 'Amount', 'Label', 'Type', ''].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((d) => {
                      const isPos = Number(d.amount) >= 0
                      return (
                        <tr key={d.id} className="border-b border-surface-700/50 hover:bg-surface-700/30 transition-colors">
                          <td className="px-4 py-3 text-xs text-slate-400 font-mono whitespace-nowrap">{fmtDate(d.deposit_date)}</td>
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
