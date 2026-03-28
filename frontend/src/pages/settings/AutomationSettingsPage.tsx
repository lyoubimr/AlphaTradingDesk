// ── AutomationSettingsPage ───────────────────────────────────────────────────
// Settings > Automation — wraps AutomationSettings with PageHeader + profile guard
// Route: /settings/automation
// ────────────────────────────────────────────────────────────────────────────

import { Zap } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { AutomationSettings } from '../../components/automation/AutomationSettings'
import { useProfile } from '../../context/ProfileContext'

export function AutomationSettingsPage() {
  const { activeProfileId } = useProfile()

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Automation Settings"
        subtitle="Kraken Futures execution — API keys, engine configuration and connection test"
        icon={<Zap size={18} />}
      />

      {!activeProfileId ? (
        <p className="text-xs text-slate-500">Select a profile to configure automation.</p>
      ) : (
        <div className="rounded-xl bg-surface-800 border border-surface-700 px-5 py-5">
          <AutomationSettings profileId={activeProfileId} />
        </div>
      )}
    </div>
  )
}
