// ── Investment Settings Page ── Phase 7C
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Database, Loader2, Save, TrendingUp, RefreshCw, Clock, DollarSign } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { investmentApi } from '../../lib/api'
import type { InvestmentSettingsOut } from '../../types/api'
import { cn } from '../../lib/cn'

// ── Constants ─────────────────────────────────────────────────────────────────

const AVAILABLE_TIMEFRAMES = ['1W', '1D', '4H', '1H', '15m'] as const

const TF_COLORS: Record<string, string> = {
  '1W':  'text-purple-400 border-purple-700/40 bg-purple-900/20',
  '1D':  'text-blue-400 border-blue-700/40 bg-blue-900/20',
  '4H':  'text-cyan-400 border-cyan-700/40 bg-cyan-900/20',
  '1H':  'text-green-400 border-green-700/40 bg-green-900/20',
  '15m': 'text-amber-400 border-amber-700/40 bg-amber-900/20',
}

const FREQUENCY_OPTIONS = ['monthly', 'weekly'] as const

// ── Types ─────────────────────────────────────────────────────────────────────

type Config = Required<{
  recurrent_deposit: Required<NonNullable<InvestmentSettingsOut['config']['recurrent_deposit']>>
  price_tracking:    Required<NonNullable<InvestmentSettingsOut['config']['price_tracking']>>
  watchlist_htf:     Required<NonNullable<InvestmentSettingsOut['config']['watchlist_htf']>>
}>

const DEFAULT_CONFIG: Config = {
  recurrent_deposit: {
    enabled:      false,
    amount:       0,
    currency:     'USDT',
    frequency:    'monthly',
    day_of_month: 1,
    next_due:     null,
  },
  price_tracking: {
    refresh_frequency_hours: 12,
    last_fetched_at:         null,
  },
  watchlist_htf: {
    timeframes: ['1W', '1D', '4H'],
    top_n:      10,
  },
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function InvestmentSettingsPage() {
  const { activeProfile } = useProfile()
  const profileId = activeProfile?.id ?? null

  const [config,   setConfig]  = useState<Config>(DEFAULT_CONFIG)
  const [loading,  setLoading] = useState(false)
  const [saving,   setSaving]  = useState(false)
  const [error,    setError]   = useState<string | null>(null)
  const [saved,    setSaved]   = useState(false)
  const [syncing,  setSyncing] = useState(false)
  const [syncDone, setSyncDone] = useState<number | null>(null)

  type DepositKey  = keyof Config['recurrent_deposit']
  type TrackingKey = keyof Config['price_tracking']
  type HtfKey      = keyof Config['watchlist_htf']

  const setDeposit = <K extends DepositKey>(key: K, value: Config['recurrent_deposit'][K]) =>
    setConfig((c) => ({ ...c, recurrent_deposit: { ...c.recurrent_deposit, [key]: value } }))

  const setTracking = <K extends TrackingKey>(key: K, value: Config['price_tracking'][K]) =>
    setConfig((c) => ({ ...c, price_tracking: { ...c.price_tracking, [key]: value } }))

  const setHtf = <K extends HtfKey>(key: K, value: Config['watchlist_htf'][K]) =>
    setConfig((c) => ({ ...c, watchlist_htf: { ...c.watchlist_htf, [key]: value } }))

  const toggleTimeframe = (tf: string) => {
    const current = config.watchlist_htf.timeframes
    const updated = current.includes(tf)
      ? current.filter((t) => t !== tf)
      : [...current, tf]
    setHtf('timeframes', updated)
  }

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    try {
      const settings = await investmentApi.getSettings(profileId)
      setConfig({
        recurrent_deposit: { ...DEFAULT_CONFIG.recurrent_deposit, ...(settings.config.recurrent_deposit ?? {}) },
        price_tracking:    { ...DEFAULT_CONFIG.price_tracking,    ...(settings.config.price_tracking    ?? {}) },
        watchlist_htf:     { ...DEFAULT_CONFIG.watchlist_htf,     ...(settings.config.watchlist_htf     ?? {}) },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => { void load() }, [load])

  const handleSyncInstruments = async () => {
    setSyncing(true)
    setSyncDone(null)
    setError(null)
    try {
      const result = await investmentApi.syncSpotInstruments()
      setSyncDone(result.synced)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const handleSave = async () => {
    if (!profileId) return
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await investmentApi.updateSettings(profileId, config)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-brand-500/50'

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Back link */}
      <Link to="/settings" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
        <ArrowLeft size={13} /> Back to Settings
      </Link>

      <PageHeader icon="💹" title="Investment Settings" subtitle={activeProfile?.name ?? 'Spot profile'} />

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={20} className="animate-spin text-slate-600" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-400">{error}</div>
      )}

      {!loading && (
        <div className="space-y-5">

          {/* ── Recurrent deposit ── */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
              <DollarSign size={16} className="text-slate-500 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-300">Recurrent deposit</h2>
                <p className="text-xs text-slate-600 mt-0.5">Remind yourself to contribute regularly to your portfolio</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={config.recurrent_deposit.enabled}
                  onChange={(e) => setDeposit('enabled', e.target.checked)}
                  className="w-4 h-4 rounded border-surface-600 bg-surface-700 accent-brand-500 cursor-pointer"
                />
                <span className="text-sm text-slate-300 group-hover:text-slate-100 transition-colors">
                  Enable recurrent deposit reminder
                </span>
              </label>

              {config.recurrent_deposit.enabled && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">Amount</label>
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={config.recurrent_deposit.amount}
                        onChange={(e) => setDeposit('amount', Number(e.target.value))}
                        className={cn(inputCls, 'w-full')}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">Currency</label>
                      <input
                        value={config.recurrent_deposit.currency}
                        onChange={(e) => setDeposit('currency', e.target.value)}
                        maxLength={10}
                        className={cn(inputCls, 'w-full')}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1.5">Frequency</label>
                      <select
                        value={config.recurrent_deposit.frequency}
                        onChange={(e) => setDeposit('frequency', e.target.value)}
                        className={cn(inputCls, 'w-full')}
                      >
                        {FREQUENCY_OPTIONS.map((f) => (
                          <option key={f} value={f}>
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                    {config.recurrent_deposit.frequency === 'monthly' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1.5">Day of month</label>
                        <input
                          type="number"
                          min="1"
                          max="28"
                          value={config.recurrent_deposit.day_of_month}
                          onChange={(e) => setDeposit('day_of_month', Number(e.target.value))}
                          className={cn(inputCls, 'w-full')}
                        />
                      </div>
                    )}
                  </div>

                  {config.recurrent_deposit.next_due && (
                    <div className="text-xs text-slate-500">
                      Next due: <span className="text-brand-400">{config.recurrent_deposit.next_due}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Price tracking ── */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
              <RefreshCw size={16} className="text-slate-500 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-300">Price tracking</h2>
                <p className="text-xs text-slate-600 mt-0.5">Polling frequency for open position prices</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-end gap-6">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">Refresh interval (hours)</label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={config.price_tracking.refresh_frequency_hours}
                    onChange={(e) => setTracking('refresh_frequency_hours', Number(e.target.value))}
                    className={cn(inputCls, 'w-32')}
                  />
                </div>
                {config.price_tracking.last_fetched_at && (
                  <div className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
                    <Clock size={11} />
                    Last fetched: {new Date(config.price_tracking.last_fetched_at).toLocaleString()}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Watchlist HTF ── */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
              <TrendingUp size={16} className="text-slate-500 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-300">Watchlist HTF</h2>
                <p className="text-xs text-slate-600 mt-0.5">Higher timeframe scan config for spot ritual sessions</p>
              </div>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2">Active timeframes</label>
                <div className="flex flex-wrap gap-2">
                  {AVAILABLE_TIMEFRAMES.map((tf) => {
                    const active = config.watchlist_htf.timeframes.includes(tf)
                    return (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => toggleTimeframe(tf)}
                        className={cn(
                          'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                          active
                            ? TF_COLORS[tf]
                            : 'text-slate-600 border-surface-600 bg-surface-700 hover:border-slate-500',
                        )}
                      >
                        {tf}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Top N pairs per timeframe</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={config.watchlist_htf.top_n}
                  onChange={(e) => setHtf('top_n', Number(e.target.value))}
                  className={cn(inputCls, 'w-24')}
                />
              </div>
            </div>
          </div>

          {/* ── Spot instruments catalog ── */}
          <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
              <Database size={16} className="text-slate-500 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-300">Spot instruments catalog</h2>
                <p className="text-xs text-slate-600 mt-0.5">Sync Kraken USD/USDT pairs for autocomplete in the trade form</p>
              </div>
            </div>
            <div className="px-5 py-4 flex items-center gap-4">
              <button
                type="button"
                onClick={() => void handleSyncInstruments()}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 border border-surface-600 text-slate-300 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {syncing
                  ? <Loader2 size={13} className="animate-spin" />
                  : <RefreshCw size={13} />}
                {syncing ? 'Syncing…' : 'Sync catalog'}
              </button>
              {syncDone !== null && (
                <span className="text-xs text-emerald-400">✓ {syncDone} pairs synced</span>
              )}
            </div>
          </div>

          {/* ── Save ── */}
          <div className="flex items-center justify-end gap-3">
            {saved && <span className="text-xs text-emerald-400">✓ Saved</span>}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Save settings
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
