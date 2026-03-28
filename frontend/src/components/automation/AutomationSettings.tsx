// ── AutomationSettings ───────────────────────────────────────────────────────
// Profile-level Kraken Execution settings form:
//   • API Key + Secret (write-only, password inputs, never pre-filled)
//   • Enable automation toggle
//   • PNL status interval (minutes)
//   • Max leverage override (optional)
//   • Test connection button
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, XCircle, KeyRound, Activity } from 'lucide-react'
import { automationApi } from '../../lib/api'
import { useApi } from '../../hooks/useApi'
import { cn } from '../../lib/cn'
import type { AutomationSettingsUpdateIn, ConnectionTestOut } from '../../types/api'

interface Props {
  profileId: number
}

export function AutomationSettings({ profileId }: Props) {
  const { data: settings, loading, error: loadError, refetch } = useApi(
    () => automationApi.getSettings(profileId),
    [profileId],
  )

  // Local form state — only for mutable fields
  const [enabled,       setEnabled]       = useState(false)
  const [pnlInterval,   setPnlInterval]   = useState(60)
  const [maxLeverage,   setMaxLeverage]   = useState<string>('')   // '' = null
  const [apiKey,        setApiKey]        = useState('')
  const [apiSecret,     setApiSecret]     = useState('')

  const [saving,  setSaving]  = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [testing,     setTesting]     = useState(false)
  const [testResult,  setTestResult]  = useState<ConnectionTestOut | null>(null)

  // Sync when server data arrives
  useEffect(() => {
    if (!settings) return
    setEnabled(settings.config.enabled)
    setPnlInterval(settings.config.pnl_status_interval_minutes)
    setMaxLeverage(settings.config.max_leverage_override != null
      ? String(settings.config.max_leverage_override)
      : '')
  }, [settings])

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const patch: AutomationSettingsUpdateIn = {
        enabled,
        pnl_status_interval_minutes: pnlInterval,
        max_leverage_override: maxLeverage !== '' ? Number(maxLeverage) : null,
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

      {/* ── API Credentials ───────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <KeyRound size={13} className="text-slate-500" />
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            API Credentials
          </h3>
          {settings?.has_api_keys && (
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded px-1.5 py-0.5">
              Keys stored
            </span>
          )}
        </div>
        <p className="text-[11px] text-slate-600 mb-3">
          Kraken Futures API key + secret (write-only — never returned by the API).
          Leave blank to keep current keys.
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
            Engine
          </h3>
        </div>

        {/* Enable toggle */}
        <div className="flex items-center justify-between py-2.5 border-b border-surface-700">
          <div>
            <p className="text-xs font-medium text-slate-300">Enable automation</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Allow this profile to send orders to Kraken Futures.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={cn(
              'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
              'transition-colors duration-200 focus:outline-none',
              enabled ? 'bg-brand-500' : 'bg-surface-600',
            )}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow',
                'transition-transform duration-200',
                enabled ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </div>

        {/* PNL Status interval */}
        <div className="flex items-center justify-between py-2.5 border-b border-surface-700">
          <div>
            <p className="text-xs font-medium text-slate-300">PNL status interval</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              How often (minutes) to send a PNL summary via Telegram.
            </p>
          </div>
          <input
            type="number"
            min={5}
            max={1440}
            value={pnlInterval}
            onChange={(e) => setPnlInterval(Number(e.target.value))}
            className="w-20 rounded-lg bg-surface-700 border border-surface-600 px-2 py-1
              text-right text-xs text-slate-300
              focus:outline-none focus:border-brand-500/60 transition-colors"
          />
        </div>

        {/* Max leverage override */}
        <div className="flex items-center justify-between py-2.5">
          <div>
            <p className="text-xs font-medium text-slate-300">Max leverage override</p>
            <p className="text-[11px] text-slate-600 mt-0.5">
              Caps leverage sent to Kraken. Leave blank to use account default.
            </p>
          </div>
          <input
            type="number"
            min={1}
            max={50}
            step={0.5}
            value={maxLeverage}
            onChange={(e) => setMaxLeverage(e.target.value)}
            placeholder="—"
            className="w-20 rounded-lg bg-surface-700 border border-surface-600 px-2 py-1
              text-right text-xs text-slate-300 placeholder:text-slate-600
              focus:outline-none focus:border-brand-500/60 transition-colors"
          />
        </div>
      </section>

      {/* ── Test connection ───────────────────────────────────────────────── */}
      <section className="rounded-lg bg-surface-700 border border-surface-600 p-3">
        <div className="flex items-center justify-between">
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
            {testing
              ? <Loader2 size={11} className="animate-spin" />
              : null
            }
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
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-500 hover:bg-brand-600
            text-xs font-semibold text-white transition-colors disabled:opacity-50"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Save
        </button>

        {saveMsg && (
          <span className={cn('text-xs', saveMsg.ok ? 'text-emerald-400' : 'text-red-400')}>
            {saveMsg.text}
          </span>
        )}
      </div>

    </div>
  )
}
