// ── AutomationSettingsPage ───────────────────────────────────────────────────
// Settings > Automation — wraps AutomationSettings with PageHeader + profile guard
// Route: /settings/automation
// ────────────────────────────────────────────────────────────────────────────

import { Zap, AlertTriangle } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { AutomationSettings } from '../../components/automation/AutomationSettings'
import { useProfile } from '../../context/ProfileContext'
import { cn } from '../../lib/cn'

export function AutomationSettingsPage() {
  const { activeProfileId, activeProfile } = useProfile()
  const isCFD = activeProfile?.market_type === 'CFD'

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <PageHeader
        title="Automation Settings"
        subtitle="Kraken Futures execution — API keys, engine configuration and connection test"
        icon="⚡"
      />

      {/* Profile context badge */}
      {activeProfile && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-slate-500">Profile:</span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-700 border border-surface-600 text-xs font-medium text-slate-300">
            {activeProfile.name}
          </span>
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide',
            isCFD
              ? 'bg-amber-500/15 border border-amber-500/30 text-amber-400'
              : 'bg-brand-500/15 border border-brand-500/30 text-brand-400',
          )}>
            {activeProfile.market_type}
          </span>
        </div>
      )}

      {!activeProfileId ? (
        <div className="rounded-xl bg-surface-800 border border-surface-700 px-5 py-8 flex flex-col items-center gap-2 text-center">
          <Zap size={20} className="text-slate-600" />
          <p className="text-sm font-medium text-slate-400">No profile selected</p>
          <p className="text-xs text-slate-600">Select a profile in the topbar to configure automation.</p>
        </div>
      ) : isCFD ? (
        <div className="rounded-xl bg-amber-900/10 border border-amber-700/30 px-5 py-6 flex flex-col items-center gap-3 text-center">
          <AlertTriangle size={20} className="text-amber-400" />
          <div>
            <p className="text-sm font-semibold text-amber-300">CFD profile — Automation not available</p>
            <p className="text-xs text-amber-400/70 mt-1">
              Automation is only supported for <strong>Crypto (Kraken Futures)</strong> profiles.
              CFD execution is not yet integrated.
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-surface-800 border border-surface-700 px-5 py-5">
          <AutomationSettings profileId={activeProfileId} />
        </div>
      )}
    </div>
  )
}
