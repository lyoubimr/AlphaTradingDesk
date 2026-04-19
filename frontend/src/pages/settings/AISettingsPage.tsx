// ── AISettingsPage ────────────────────────────────────────────────────────────
// Dedicated settings page for AI analytics providers (/settings/ai)
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useProfile } from '../../context/ProfileContext'
import { analyticsApi } from '../../lib/api'
import { AISettingsPanel } from '../analytics/components/AISettingsPanel'
import type { AnalyticsSettingsOut, AIKeysStatusOut } from '../../types/api'

export function AISettingsPage() {
  const { activeProfileId: profileId } = useProfile()
  const [settings, setSettings] = useState<AnalyticsSettingsOut | null>(null)
  const [aiKeys, setAiKeys] = useState<AIKeysStatusOut | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profileId) return
    setLoading(true)
    setError(null)
    Promise.all([
      analyticsApi.getSettings(profileId),
      analyticsApi.getAIKeysStatus(profileId),
    ])
      .then(([s, k]) => { setSettings(s); setAiKeys(k) })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load AI settings'))
      .finally(() => setLoading(false))
  }, [profileId])

  if (!profileId) return (
    <div className="p-8 text-slate-500 text-sm">No active profile selected.</div>
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Sparkles size={20} className="text-violet-400 shrink-0" />
          <div>
            <h1 className="text-xl font-bold text-slate-100">AI Settings</h1>
            <p className="text-sm text-slate-500">Configure AI providers and API keys for analytics insights.</p>
          </div>
        </div>

        {loading && (
          <div className="text-slate-500 text-sm py-8 text-center">Loading…</div>
        )}

        {error && (
          <div className="text-red-400 text-sm bg-red-950/20 border border-red-900/30 rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        {settings && aiKeys && (
          <div className="bg-surface-900 border border-surface-800 rounded-2xl p-5">
            <AISettingsPanel
              profileId={profileId}
              settings={settings}
              aiKeys={aiKeys}
              onSettingsChange={setSettings}
            />
          </div>
        )}
      </div>
    </div>
  )
}
