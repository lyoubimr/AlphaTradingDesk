// ── /settings/profiles ────────────────────────────────────────────────────
// Full CRUD for trading profiles.
// Uses ProfileContext (refetch after mutations) + brokersApi for the form.

import { useState, useEffect, useRef } from 'react'
import type React from 'react'
import {
  Plus, Edit2, Trash2, TrendingUp, CheckCircle2,
  AlertCircle, X, Save, Loader2, Info,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { profilesApi, brokersApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { Profile, ProfileCreate, ProfileUpdate, Broker } from '../../types/api'

// ── Market type colours ───────────────────────────────────────────────────
const MARKET_COLORS: Record<string, string> = {
  Crypto: 'text-brand-400 bg-brand-600/15 border-brand-600/30',
  CFD:    'text-amber-400 bg-amber-500/10  border-amber-500/30',
}

// ── Profile name suggestions ──────────────────────────────────────────────
// Inspirational trading profile name presets.
// Islamic / Arabic flavour with motivational intent.
const NAME_SUGGESTIONS: Record<'Crypto' | 'CFD', string[]> = {
  Crypto: [
    '🌙 Hilal Crypto',
    '🕌 Sabr Scalp',
    '⚡ Barq Futures',
    '🌊 Mawj Alts',
    '🦅 Hurriya BTC',
    '🔥 Naar Momentum',
    '💎 Zahra Portfolio',
    '🌟 Nour Swing',
    '🏔️ Jabal HODLer',
    '🌍 Ard Diversified',
  ],
  CFD: [
    '🌙 Qamar CFD',
    '⚖️ Mizan Risk',
    '🏆 Fawz Gold',
    '🌺 Ward Forex',
    '🦁 Asad Indices',
    '🌊 Bahr Scalp',
    '💡 Nur Swing',
    '🌟 Najm Day Trade',
    '🏅 Majd Funded',
    '⚡ Ra\'d Breakout',
  ],
}

// ── Tooltip ───────────────────────────────────────────────────────────────
function Tooltip({ text }: { text: string }) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  return (
    <span
      ref={ref}
      className="relative inline-flex items-center ml-1 cursor-help"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <Info size={11} className="text-slate-500 hover:text-slate-300 transition-colors" />
      {visible && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
          w-56 px-3 py-2 rounded-lg bg-surface-700 border border-surface-600
          text-[11px] text-slate-300 leading-snug shadow-xl pointer-events-none whitespace-normal">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-surface-600" />
        </span>
      )}
    </span>
  )
}

// ── Profile Card ──────────────────────────────────────────────────────────
interface ProfileCardProps {
  profile: Profile
  isActive: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

function ProfileCard({ profile, isActive, onSelect, onEdit, onDelete }: ProfileCardProps) {
  const capital = Number(profile.capital_current).toLocaleString('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
  const capitalStart = Number(profile.capital_start).toLocaleString('en-US', {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
  const pnl = Number(profile.capital_current) - Number(profile.capital_start)
  const pnlPct = ((pnl / Number(profile.capital_start)) * 100).toFixed(1)
  const pnlPositive = pnl >= 0

  return (
    <div
      className={cn(
        'relative rounded-xl border p-4 transition-all cursor-pointer group',
        isActive
          ? 'bg-brand-600/10 border-brand-600/40 shadow-lg shadow-brand-900/20'
          : 'bg-surface-800 border-surface-700 hover:border-surface-600',
      )}
      onClick={onSelect}
    >
      {/* Active badge */}
      {isActive && (
        <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] font-semibold text-brand-300 bg-brand-600/20 border border-brand-600/30 px-2 py-0.5 rounded-full">
          <CheckCircle2 size={10} />
          Selected
        </span>
      )}

      {/* Header */}
      <div className="flex items-start gap-3 pr-20">
        <div className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold select-none',
          isActive ? 'bg-brand-600/30 text-brand-300' : 'bg-surface-700 text-slate-400',
        )}>
          {/* Use Array.from to handle emoji names correctly (multi-byte chars) */}
          {(() => {
            const first = Array.from(profile.name)[0] ?? '?'
            // If it's a plain ASCII letter, uppercase it; otherwise render as-is (emoji)
            return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : first
          })()}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-100 truncate">
              {profile.name}
            </h3>
            <span className={cn(
              'px-1.5 py-0.5 rounded text-[9px] font-semibold border',
              MARKET_COLORS[profile.market_type] ?? 'text-slate-400 bg-surface-700 border-surface-600',
            )}>
              {profile.market_type}
            </span>
          </div>
          {profile.description && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{profile.description}</p>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Capital" value={`${capital}${profile.currency ? ` ${profile.currency}` : ''}`} />
        <Stat label="Start" value={`${capitalStart}${profile.currency ? ` ${profile.currency}` : ''}`} />
        <Stat
          label="P&L"
          value={`${pnlPositive ? '+' : ''}${pnlPct}%`}
          valueClass={pnlPositive ? 'text-green-400' : 'text-red-400'}
        />
        <Stat label="Risk/trade" value={`${profile.risk_percentage_default}%`} />
        <Stat label="Max conc." value={`${profile.max_concurrent_risk_pct}%`} />
        <StatBE profile={profile} />
      </div>

      {/* Actions — shown on hover */}
      <div className="
        absolute bottom-3 right-3 flex items-center gap-1.5
        opacity-0 group-hover:opacity-100 transition-opacity
      ">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-slate-400 hover:text-slate-200 transition-colors"
          title="Edit profile"
        >
          <Edit2 size={13} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-1.5 rounded-lg bg-surface-700 hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors"
          title="Delete profile"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

function Stat({
  label, value, valueClass = 'text-slate-200',
}: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-600 uppercase tracking-wider">{label}</p>
      <p className={cn('text-xs font-mono font-medium mt-0.5', valueClass)}>{value}</p>
    </div>
  )
}

// BE filter stat — shows R-multiple + example $ amount on a second line
function StatBE({ profile }: { profile: Profile }) {
  const r = parseFloat(profile.min_pnl_pct_for_stats)
  // Example: capital × risk_pct% × R threshold
  const riskAmt = parseFloat(profile.capital_current) * (parseFloat(profile.risk_percentage_default) / 100)
  const amount  = riskAmt * r
  const currency = profile.currency ?? 'USD'
  const fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return (
    <div>
      <p className="text-[10px] text-slate-600 uppercase tracking-wider">BE filter</p>
      <p className="text-xs font-mono font-medium mt-0.5 text-slate-400">{r.toFixed(2)}R</p>
      <p className="text-[10px] font-mono text-slate-600 leading-none mt-0.5">±{fmt.format(amount)} {currency}</p>
    </div>
  )
}

interface ProfileFormData {
  name: string
  market_type: 'CFD' | 'Crypto'
  broker_id: string
  currency: string
  capital_start: string
  risk_percentage_default: string
  max_concurrent_risk_pct: string
  min_pnl_pct_for_stats: string
  description: string
}

const EMPTY_FORM: ProfileFormData = {
  name: '',
  market_type: 'Crypto',
  broker_id: '',
  currency: '',
  capital_start: '',
  risk_percentage_default: '2.0',
  max_concurrent_risk_pct: '2.0',
  min_pnl_pct_for_stats: '0.1',
  description: '',
}

function profileToForm(p: Profile): ProfileFormData {
  return {
    name: p.name,
    market_type: p.market_type,
    broker_id: p.broker_id ? String(p.broker_id) : '',
    currency: p.currency ?? '',
    capital_start: p.capital_start,
    risk_percentage_default: p.risk_percentage_default,
    max_concurrent_risk_pct: p.max_concurrent_risk_pct,
    min_pnl_pct_for_stats: p.min_pnl_pct_for_stats,
    description: p.description ?? '',
  }
}

interface ProfileModalProps {
  profile: Profile | null   // null = create mode
  brokers: Broker[]
  onClose: () => void
  onSaved: () => void
}

function ProfileModal({ profile, brokers, onClose, onSaved }: ProfileModalProps) {
  const isEdit = profile !== null
  const [form, setForm] = useState<ProfileFormData>(
    isEdit ? profileToForm(profile) : EMPTY_FORM,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  // Brokers filtered to match the selected market type
  const compatibleBrokers = brokers.filter((b) => b.market_type === form.market_type)

  const set = (field: keyof ProfileFormData, value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  // When market_type changes: reset broker if incompatible + clear currency
  const setMarketType = (mt: 'CFD' | 'Crypto') => {
    setForm((f) => {
      const currentBroker = brokers.find((b) => String(b.id) === f.broker_id)
      const brokerCompatible = currentBroker?.market_type === mt
      return {
        ...f,
        market_type: mt,
        broker_id: brokerCompatible ? f.broker_id : '',
        currency:   brokerCompatible ? f.currency : '',
      }
    })
  }

  // When broker changes: auto-fill currency from broker's default_currency
  const setBroker = (brokerId: string) => {
    const broker = brokers.find((b) => String(b.id) === brokerId)
    setForm((f) => ({
      ...f,
      broker_id: brokerId,
      currency: brokerId && broker ? broker.default_currency : f.currency,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (isEdit) {
        const update: ProfileUpdate = {
          name: form.name,
          market_type: form.market_type,
          broker_id: form.broker_id ? parseInt(form.broker_id) : null,
          currency: form.currency || null,
          capital_start: form.capital_start,
          risk_percentage_default: form.risk_percentage_default,
          max_concurrent_risk_pct: form.max_concurrent_risk_pct,
          min_pnl_pct_for_stats: form.min_pnl_pct_for_stats,
          description: form.description || null,
        }
        await profilesApi.update(profile.id, update)
      } else {
        const create: ProfileCreate = {
          name: form.name,
          market_type: form.market_type,
          broker_id: form.broker_id ? parseInt(form.broker_id) : null,
          currency: form.currency || null,
          capital_start: form.capital_start,
          risk_percentage_default: form.risk_percentage_default,
          max_concurrent_risk_pct: form.max_concurrent_risk_pct,
          min_pnl_pct_for_stats: form.min_pnl_pct_for_stats,
          description: form.description || null,
        }
        await profilesApi.create(create)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
          <h2 className="text-sm font-semibold text-slate-100">
            {isEdit ? 'Edit profile' : 'New profile'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Name */}
          <Field label="Profile name *">
            <input
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Crypto Scalping, CFD Swing"
              className={inputCls}
            />
            {/* Name suggestions — only shown in create mode */}
            {!isEdit && (
              <div className="mt-2">
                <p className="text-[10px] text-slate-600 mb-1.5 uppercase tracking-wider">Quick pick ✨</p>
                <div className="flex flex-wrap gap-1.5">
                  {NAME_SUGGESTIONS[form.market_type].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => set('name', suggestion)}
                      className={cn(
                        'text-[11px] px-2 py-1 rounded-lg border transition-colors',
                        form.name === suggestion
                          ? 'bg-brand-600/20 border-brand-600/40 text-brand-300'
                          : 'bg-surface-700/60 border-surface-600/60 text-slate-500 hover:text-slate-300 hover:border-surface-500',
                      )}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Field>

          {/* Market type */}
          <Field label="Market type *">
            <div className="grid grid-cols-2 gap-2">
              {(['Crypto', 'CFD'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setMarketType(t)}
                  className={cn(
                    'py-2 rounded-lg border text-sm font-medium transition-colors',
                    form.market_type === t
                      ? t === 'Crypto'
                        ? 'bg-brand-600/20 border-brand-600/50 text-brand-300'
                        : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                      : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </Field>

          {/* Broker + currency */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Broker">
              <select
                value={form.broker_id}
                onChange={(e) => setBroker(e.target.value)}
                className={inputCls}
              >
                <option value="">— None —</option>
                {compatibleBrokers.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </Field>
            <Field label={<>Currency <Tooltip text="Auto-filled from broker's default currency. You can override it." /></>}>
              <input
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                placeholder="USD, EUR…"
                maxLength={10}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Capital */}
          <Field label="Starting capital *">
            <input
              required
              type="number"
              step="0.01"
              min="0.01"
              value={form.capital_start}
              onChange={(e) => set('capital_start', e.target.value)}
              placeholder="10000"
              className={inputCls}
            />
          </Field>

          {/* Risk */}
          <div className="grid grid-cols-2 gap-3">
            <Field label={<>Risk % per trade <Tooltip text="Percentage of your current capital risked on each individual trade. e.g. 2% on $10 000 = $200 risk per trade." /></>}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="10"
                value={form.risk_percentage_default}
                onChange={(e) => set('risk_percentage_default', e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label={<>Max concurrent risk % <Tooltip text="Maximum total risk across ALL open trades at the same time. e.g. 6% means you can have at most 3 trades × 2% open simultaneously." /></>}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={form.max_concurrent_risk_pct}
                onChange={(e) => set('max_concurrent_risk_pct', e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>

          {/* Break-even filter */}
          <Field label={<>Break-even filter (R) <Tooltip text="Trades closing within ±NR of your initial risk are treated as break-even and excluded from Win Rate stats. Expressed in R-multiples: 0.20R means the trade returned less than 20% of your risk amount (win or loss). Example: risked $12 → filtered if |P&L| < $2.40. Recommended: 0.15–0.25R." /></>}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={form.min_pnl_pct_for_stats}
                onChange={(e) => set('min_pnl_pct_for_stats', e.target.value)}
                className={inputCls}
                placeholder="0.20"
              />
              <span className="text-xs text-slate-500 shrink-0">R</span>

            </div>
            <p className="text-[10px] text-slate-600 mt-1">
              e.g. 0.20R → trade #44 closed at −0.13R (risked $12.75, lost $1.69) is excluded. Trade #41 at −0.50R is still counted as loss.
            </p>
          </Field>

          {/* Description */}
          <Field label="Description">
            <input
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional short description"
              className={inputCls}
            />
          </Field>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="atd-btn-ghost">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="atd-btn-primary"
            >
              {saving
                ? <Loader2 size={14} className="animate-spin" />
                : <Save size={14} />
              }
              {isEdit ? 'Save changes' : 'Create profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Delete confirm modal ──────────────────────────────────────────────────

function DeleteModal({
  profile, onClose, onDeleted,
}: { profile: Profile; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await profilesApi.delete(profile.id)
      onDeleted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-surface-800 rounded-2xl border border-surface-700 shadow-2xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-red-500/15 flex items-center justify-center">
            <Trash2 size={16} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Delete profile</h3>
            <p className="text-xs text-slate-500 mt-0.5">This action cannot be undone</p>
          </div>
        </div>
        <p className="text-sm text-slate-300 mb-4">
          Are you sure you want to delete <strong className="text-slate-100">{profile.name}</strong>?
          All associated trades and data will be preserved but the profile will be archived.
        </p>
        {error && (
          <p className="text-xs text-red-400 mb-3">{error}</p>
        )}
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="atd-btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40"
          >
            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Field wrapper ─────────────────────────────────────────────────────────

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-center text-xs font-medium text-slate-400 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

const inputCls = `
  w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600
  text-sm text-slate-200 placeholder-slate-600
  focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30
  transition-colors
`

// ── Main page ─────────────────────────────────────────────────────────────

export function ProfilesPage() {
  const { profiles, activeProfileId, setActiveProfileId, loading, error, refetch } = useProfile()

  const [brokers, setBrokers]         = useState<Broker[]>([])
  const [modalMode, setModalMode]     = useState<'create' | 'edit' | null>(null)
  const [editTarget, setEditTarget]   = useState<Profile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)

  // Fetch brokers once for the form dropdown
  useEffect(() => {
    brokersApi.list().then(setBrokers).catch(() => setBrokers([]))
  }, [])

  const openCreate = () => { setEditTarget(null); setModalMode('create') }
  const openEdit   = (p: Profile) => { setEditTarget(p); setModalMode('edit') }
  const closeModal = () => { setModalMode(null); setEditTarget(null) }
  const onSaved    = () => { closeModal(); refetch() }
  const onDeleted  = () => { setDeleteTarget(null); refetch() }

  return (
    <>
      <PageHeader
        icon="👤"
        title="Profiles"
        subtitle="Manage your trading profiles — each profile has its own capital, risk settings, and trade history."
        actions={
          <button type="button" onClick={openCreate} className="atd-btn-primary">
            <Plus size={14} />
            New profile
          </button>
        }
      />

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
          <Loader2 size={16} className="animate-spin" />
          Loading profiles…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          <AlertCircle size={16} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && profiles.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center mb-4">
            <TrendingUp size={22} className="text-slate-600" />
          </div>
          <h3 className="text-sm font-semibold text-slate-300 mb-1">No profiles yet</h3>
          <p className="text-xs text-slate-600 mb-5 max-w-xs">
            Create your first trading profile to start tracking trades, goals and market analysis.
          </p>
          <button type="button" onClick={openCreate} className="atd-btn-primary">
            <Plus size={14} />
            Create first profile
          </button>
        </div>
      )}

      {/* Profile grid */}
      {!loading && profiles.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-2">
          {profiles.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              isActive={p.id === activeProfileId}
              onSelect={() => setActiveProfileId(p.id)}
              onEdit={() => openEdit(p)}
              onDelete={() => setDeleteTarget(p)}
            />
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {modalMode !== null && (
        <ProfileModal
          profile={editTarget}
          brokers={brokers}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <DeleteModal
          profile={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={onDeleted}
        />
      )}
    </>
  )
}
