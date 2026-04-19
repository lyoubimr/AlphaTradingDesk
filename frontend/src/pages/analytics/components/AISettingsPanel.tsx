// ── AISettingsPanel ───────────────────────────────────────────────────────
// AI provider selector, API key inputs, model picker, refresh config
import { useState, useEffect } from 'react'
import { Check, Eye, EyeOff, KeyRound, X } from 'lucide-react'
import { analyticsApi } from '../../../lib/api'
import type { AnalyticsSettingsOut, AIKeysStatusOut } from '../../../types/api'

interface Props {
  profileId: number
  settings: AnalyticsSettingsOut
  aiKeys: AIKeysStatusOut
  onSettingsChange: (s: AnalyticsSettingsOut) => void
}

const PROVIDERS = ['openai', 'anthropic', 'perplexity'] as const
type Provider = (typeof PROVIDERS)[number]

const PROVIDER_LABELS: Record<Provider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  perplexity: 'Perplexity',
}
const PROVIDER_MODELS: Record<Provider, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
  anthropic: ['claude-3-haiku-20240307', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
  perplexity: ['sonar', 'sonar-pro'],
}
const REFRESH_OPTIONS = [
  { value: 'per_trade', label: 'After each trade' },
  { value: 'daily', label: 'Daily' },
  { value: 'manual', label: 'Manual only' },
]

export function AISettingsPanel({ profileId, settings, aiKeys, onSettingsChange }: Props) {
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [local, setLocal] = useState(settings)
  const [keys, setKeys] = useState<Record<Provider, string>>({ openai: '', anthropic: '', perplexity: '' })
  const [showKey, setShowKey] = useState<Record<Provider, boolean>>({ openai: false, anthropic: false, perplexity: false })
  const [keysSaving, setKeysSaving] = useState(false)
  const [keysOk, setKeysOk] = useState(false)

  useEffect(() => { setLocal(settings) }, [settings])

  const patchLocal = (patch: Partial<typeof local['config']>) =>
    setLocal(prev => ({ ...prev, config: { ...prev.config, ...patch } }))

  const saveSettings = async () => {
    setSaving(true)
    try {
      const updated = await analyticsApi.updateSettings(profileId, local.config)
      onSettingsChange(updated)
      setSavedOk(true)
      setTimeout(() => setSavedOk(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const saveKeys = async () => {
    setKeysSaving(true)
    try {
      await analyticsApi.updateAIKeys(profileId, {
        openai_key: keys.openai || undefined,
        anthropic_key: keys.anthropic || undefined,
        perplexity_key: keys.perplexity || undefined,
      })
      setKeys({ openai: '', anthropic: '', perplexity: '' })
      setKeysOk(true)
      setTimeout(() => setKeysOk(false), 2000)
    } finally {
      setKeysSaving(false)
    }
  }

  const hasKeyChange = Object.values(keys).some(k => k !== '')

  return (
    <div className="space-y-5">
      {/* Enable + Provider + Model + Refresh */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Enable toggle */}
        <div className="flex items-center justify-between bg-surface-800 rounded-lg px-4 py-3 border border-surface-700">
          <span className="text-sm text-slate-300">Enable AI insights</span>
          <button
            onClick={() => patchLocal({ ai_enabled: !local.config.ai_enabled })}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${local.config.ai_enabled ? 'bg-violet-600' : 'bg-surface-700'}`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${local.config.ai_enabled ? 'translate-x-4' : 'translate-x-0.5'}`}
            />
          </button>
        </div>

        {/* Provider selector */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Provider</label>
          <select
            value={local.config.ai_provider ?? 'openai'}
            onChange={e => patchLocal({ ai_provider: e.target.value as Provider, ai_model: PROVIDER_MODELS[e.target.value as Provider][0] })}
            className="w-full bg-surface-800 border border-surface-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
          </select>
        </div>

        {/* Model selector */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Model</label>
          <select
            value={local.config.ai_model ?? ''}
            onChange={e => patchLocal({ ai_model: e.target.value })}
            className="w-full bg-surface-800 border border-surface-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {PROVIDER_MODELS[(local.config.ai_provider ?? 'openai') as Provider].map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        {/* Refresh frequency */}
        <div className="space-y-1">
          <label className="text-xs text-slate-500">Refresh frequency</label>
          <select
            value={local.config.ai_refresh ?? 'daily'}
            onChange={e => patchLocal({ ai_refresh: e.target.value as 'per_trade' | 'daily' | 'manual' })}
            className="w-full bg-surface-800 border border-surface-700 rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-violet-500"
          >
            {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <button
        onClick={saveSettings}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 text-xs rounded-md bg-violet-700 hover:bg-violet-600 disabled:opacity-50 text-white transition-colors"
      >
        {savedOk ? <Check size={12} /> : null}
        {saving ? 'Saving…' : savedOk ? 'Saved!' : 'Save settings'}
      </button>

      {/* API Keys */}
      <div className="border-t border-surface-800 pt-4 space-y-3">
        <div className="flex items-center gap-2 text-xs text-slate-400 uppercase tracking-wider mb-1">
          <KeyRound size={12} />
          API Keys
        </div>
        {PROVIDERS.map(p => {
          const hasKey = aiKeys[`${p}_configured` as keyof AIKeysStatusOut] as boolean
          return (
            <div key={p} className="space-y-1">
              <div className="flex items-center gap-2">
                <label className="text-xs text-slate-500 w-24 shrink-0">{PROVIDER_LABELS[p]}</label>
                {hasKey && (
                  <span className="text-xs text-emerald-500 flex items-center gap-1">
                    <Check size={10} /> configured
                  </span>
                )}
              </div>
              <div className="relative">
                <input
                  type={showKey[p] ? 'text' : 'password'}
                  value={keys[p]}
                  onChange={e => setKeys(prev => ({ ...prev, [p]: e.target.value }))}
                  placeholder={hasKey ? '••••••• (leave blank to keep current)' : `${PROVIDER_LABELS[p]} API key`}
                  className="w-full bg-surface-800 border border-surface-700 rounded-md px-3 py-2 pr-16 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-violet-500"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowKey(prev => ({ ...prev, [p]: !prev[p] }))}
                    className="text-slate-500 hover:text-slate-300 p-1"
                  >
                    {showKey[p] ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  {keys[p] && (
                    <button
                      type="button"
                      onClick={() => setKeys(prev => ({ ...prev, [p]: '' }))}
                      className="text-slate-500 hover:text-slate-300 p-1"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {hasKeyChange && (
          <button
            onClick={saveKeys}
            disabled={keysSaving}
            className="flex items-center gap-2 px-4 py-2 text-xs rounded-md bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white transition-colors"
          >
            {keysOk ? <Check size={12} /> : <KeyRound size={12} />}
            {keysSaving ? 'Saving keys…' : keysOk ? 'Keys saved!' : 'Save API keys'}
          </button>
        )}
      </div>
    </div>
  )
}
