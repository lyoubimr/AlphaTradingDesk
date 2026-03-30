// ── AutomationSettings ───────────────────────────────────────────────────────
// Profile-level Kraken Execution settings form:
//   • Enable automation toggle  ← shown FIRST
//   • API Key + Secret (write-only, password inputs, never pre-filled)
//   • PNL status interval (minutes, min 60)
//   • Background jobs info (read-only)
//   • Test connection button
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, XCircle, KeyRound, Activity, Info, Clock } from 'lucide-react'
import { automationApi } from '../../lib/api'
import { useApi } from '../../hooks/useApi'
import { cn } from '../../lib/cn'
import { InfoBubble } from '../ui/InfoBubble'
import type { AutomationSettingsUpdateIn, ConnectionTestOut } from '../../types/api'

interface Props {
  profileId: number
}

// ── Background jobs metadata (read-only informational) ──────────────────────
const BACKGROUND_JOBS = [
  {
    name: 'Poll pending orders',
    interval: 'Every 30 s',
    description: 'Detects LIMIT entry fills on Kraken Futures and transitions trade to open.',
  },
  {
    name: 'Sync open positions',
    interval: 'Every 60 s',
    description: 'Detects SL/TP fills and closes positions in the journal automatically.',
  },
  {
    name: 'PnL status',
    interval: 'Configurable (see below)',
    description: 'Sends unrealized PnL summary via Telegram for each open automated trade.',
    dynamic: true,
  },
]

export function AutomationSettings({ profileId }: Props) {
  const { data: settings, loading, error: loadError, refetch } = useApi(
    () => automationApi.getSettings(profileId),
    [profileId],
  )

  // Local form state — only for mutable fields
  const [enabled,     setEnabled]     = useState(false)
  const [pnlInterval, setPnlInterval] = useState(60)
  const [apiKey,      setApiKey]      = useState('')
  const [apiSecret,   setApiSecret]   = useState('')

  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestOut | null>(null)

  // PNL interval validation — must be >= 60 AND a multiple of 60 (Celery beat cycle)
  const pnlIntervalError =
    pnlInterval < 60
      ? 'Minimum 60 min (Celery beat cycle)'
      : pnlInterval % 60 !== 0
        ? 'Must be a multiple of 60 (e.g. 60, 120, 180…)'
        : null

  // Sync when server data arrives
  useEffect(() => {
    if (!settings) return
    setEnabled(settings.config.enabled)
    setPnlInterval(settings.config.pnl_status_interval_minutes)
  }, [settings])

  async function handleSave() {
    if (pnlIntervalError) return
    setSaving(true)
    setSaveMsg(null)
    try {
      const patch: AutomationSettingsUpdateIn = {
        enabled,
        pnl_status_interval_minutes: pnlInterval,
      }
      if (apiKey.trim())    patch.kraken_api_key    = apiKey.trim()
      if (apiSecret.trim()) patch.kraken_api_secret = apiSecret.trim()
      await automationApi.updateSettings(profileId, patch)
      setApiKey('')
      setApiSecret('')
      setSaveMsg({ ok: true, text: 'Settings saved.' })
      refetch()
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTestConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await automationApi.testConnection(profileId)
      setTestResult(result)
    } catch (err) {
      setTestResult({ connected: false, demo: false, base_url: '', error: err instanceof Error ? err.message : 'Test failed' })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
        <Loader2 size={14} className="animate-spin" />
        Loading…
      </div>
    )
  }

  if (loadError) {
    return <p className="text-xs text-red-400 py-2">{loadError}</p>
  }

  return (
    <div className="space-y-6">

      {/* ── Engine toggle — shown FIRST ───────────────────────────────────── */}
      <section className="rounded-xl bg-surface-700/50 border border-surface-600 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-200">Enable Automation</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Allow this profile to send orders to Kraken Futures.
              All background jobs only run for enabled profiles.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={cn(
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
              'transition-colors duration-200 focus:outline-none',
              enabled ? 'bg-brand-500' : 'bg-surface-500',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow',
                'transition-transform duration-200',
                enabled ? 'translate-x-5' : 'translate-x-0',
              )}
            />
          </button>
        </div>
        {enabled && (
          <p className="mt-2 text-[11px] text-emerald-400 flex items-center gap-1">
            <CheckCircle2 size={11} /> Automation active — orders will be routed to Kraken Futures
          </p>
        )}
      </section>

      {/* ── API Credentials ───────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={13} className="text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            API Credentials
          </h3>
          {settings?.has_api_keys && (
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5 flex items-center gap-1">
              <CheckCircle2 size={9} /> Keys stored
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-600 mb-3">
          Kraken Futures API key + secret — stored encrypted (Fernet) in DB. Write-only, never returned by the API.
          Leave blank to keep existing keys.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">API Key</label>
            <input
              type="password"
              autoComplete="new-password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.has_api_keys ? '(stored — enter to replace)' : 'Paste API key…'}
              className="w-full rounded-lg bg-surface-700 border border-surface-600 px-3 py-2
                text-xs text-slate-300 placeholder:text-slate-600
                focus:outline-none focus:border-brand-500/60 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">API Secret</label>
            <input
              type="password"
              autoComplete="new-password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder={settings?.has_api_keys ? '(stored — enter to replace)' : 'Paste API secret…'}
              className="w-full rounded-lg bg-surface-700 border border-surface-600 px-3 py-2
                text-xs text-slate-300 placeholder:text-slate-600
                focus:outline-none focus:border-brand-500/60 transition-colors"
            />
          </div>
        </div>
      </section>

      {/* ── Engine config ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={13} className="text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Engine Config
          </h3>
        </div>

        {/* PNL Status interval */}
        <div className={cn('flex items-start justify-between gap-4 py-3 border-b border-surface-700', pnlIntervalError && 'pb-1')}>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-slate-300">PnL status interval</p>
              <InfoBubble text="How often (minutes) to send a PnL summary via Telegram for each open automated trade. Must be 60 min or a multiple of 60 (e.g. 120, 180…) — constrained by the Celery beat cycle." />
            </div>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Multiples of <span className="text-slate-400 font-mono">60</span>: 60, 120, 180…
            </p>
            {pnlIntervalError && (
              <p className="text-[11px] text-red-400 mt-0.5 flex items-center gap-1">
                <XCircle size={10} /> {pnlIntervalError}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <input
              type="number"
              min={60}
              max={1440}
              step={60}
              value={pnlInterval}
              onChange={(e) => setPnlInterval(Number(e.target.value))}
              className={cn(
                'w-20 rounded-lg bg-surface-700 border px-2 py-1.5',
                'text-right text-xs text-slate-300',
                'focus:outline-none focus:border-brand-500/60 transition-colors',
                pnlIntervalError ? 'border-red-500/60' : 'border-surface-600',
              )}
            />
            <span className="text-[11px] text-slate-600">min</span>
          </div>
        </div>
      </section>

      {/* ── Background jobs info ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Clock size={13} className="text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Background Jobs
          </h3>
          <InfoBubble text="These Celery tasks run on the backend server automatically. Their intervals are system-wide — not configurable per profile (except PnL interval above)." />
        </div>
        <div className="rounded-lg border border-surface-700 overflow-hidden">
          {BACKGROUND_JOBS.map((job, idx) => (
            <div
              key={job.name}
              className={cn(
                'flex items-start justify-between gap-3 px-3 py-2.5',
                idx < BACKGROUND_JOBS.length - 1 && 'border-b border-surface-700/60',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs font-medium text-slate-300">{job.name}</p>
                  <InfoBubble text={job.description} />
                </div>
                <p className="text-[10px] text-slate-600 mt-0.5">{job.description}</p>
              </div>
              <span className={cn(
                'text-[10px] font-mono shrink-0 px-2 py-0.5 rounded-full border',
                job.dynamic
                  ? 'bg-brand-500/10 border-brand-500/30 text-brand-400'
                  : 'bg-surface-700 border-surface-600 text-slate-400',
              )}>
                {job.dynamic ? `${pnlInterval} min` : job.interval}
              </span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-600 mt-2 flex items-center gap-1">
          <Info size={10} /> Jobs run only when automation is enabled for the profile.
        </p>
      </section>

      {/* ── Test connection ───────────────────────────────────────────────── */}
      <section className="rounded-lg bg-surface-700 border border-surface-600 p-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-slate-400">
            Test Kraken Futures connection with stored keys.
          </p>
          <button
            type="button"
            onClick={handleTestConnection}
            disabled={testing || !settings?.has_api_keys}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-600 border border-surface-500
              text-xs text-slate-300 hover:bg-surface-500 transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {testing ? <Loader2 size={11} className="animate-spin" /> : null}
            Test connection
          </button>
        </div>

        {testResult && (
          <div className={cn(
            'mt-2 flex items-start gap-2 text-xs rounded-lg p-2',
            testResult.connected
              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border border-red-500/30 text-red-300',
          )}>
            {testResult.connected
              ? <CheckCircle2 size={13} className="shrink-0 mt-0.5" />
              : <XCircle     size={13} className="shrink-0 mt-0.5" />
            }
            <span>
              {testResult.connected
                ? `Connected${testResult.demo ? ' (demo)' : ''} — ${testResult.base_url}`
                : (testResult.error ?? 'Connection failed')
              }
            </span>
          </div>
        )}
      </section>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !!pnlIntervalError}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600
            text-xs font-semibold text-white transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save settings
        </button>

        {saveMsg && (
          <span className={cn('text-xs flex items-center gap-1', saveMsg.ok ? 'text-emerald-400' : 'text-red-400')}>
            {saveMsg.ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
            {saveMsg.text}
          </span>
        )}
      </div>

    </div>
  )
}

