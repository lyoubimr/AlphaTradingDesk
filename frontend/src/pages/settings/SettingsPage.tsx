// ── Settings page ──────────────────────────────────────────────────────────
import { User, Database, Bell, Shield, Info } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { ComingSoon } from '../../components/ui/ComingSoon'
import { InfoBubble } from '../../components/ui/InfoBubble'

// ── Section card ──────────────────────────────────────────────────────────
function SettingsSection({
  icon,
  title,
  description,
  children,
  badge,
}: {
  icon: React.ReactNode
  title: string
  description: string
  children?: React.ReactNode
  badge?: string
}) {
  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-surface-700 flex items-center gap-3">
        <span className="text-slate-500 shrink-0">{icon}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-300">{title}</h2>
            {badge && <Badge label={badge} variant="soon" />}
          </div>
          <p className="text-xs text-slate-600 mt-0.5">{description}</p>
        </div>
      </div>
      {children && (
        <div className="px-5 py-4">{children}</div>
      )}
    </div>
  )
}

// ── Setting row ───────────────────────────────────────────────────────────
function SettingRow({ label, value, info }: { label: string; value: string; info?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-surface-700 last:border-none">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500">{label}</span>
        {info && <InfoBubble text={info} />}
      </div>
      <span className="text-xs font-mono text-slate-400">{value}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export function SettingsPage() {
  return (
    <div>
      <PageHeader
        icon="⚙️"
        title="Settings"
        subtitle="Profile, preferences, and system configuration"
        info="All settings are stored in the database and scoped per profile. No local storage or cookies are used."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Profile ─────────────────────────────────────────────────── */}
        <SettingsSection
          icon={<User size={16} />}
          title="Profile"
          description="Your trading identity and capital configuration"
          badge="Coming Soon"
        >
          <SettingRow label="Profile name"     value="Default"   info="Used to namespace all your trades, goals, and analysis sessions." />
          <SettingRow label="Starting capital" value="—"         info="Your initial account balance. Used as baseline for drawdown calculations." />
          <SettingRow label="Current capital"  value="—"         info="Updated automatically after every closed trade." />
          <SettingRow label="Risk per trade"   value="—"         info="Default % of capital risked on each trade. Overridable per-trade." />
          <SettingRow label="Min trades for stats" value="5"     info="Win rate and R:R averages are hidden until this threshold is reached." />
        </SettingsSection>

        {/* ── Risk rules ──────────────────────────────────────────────── */}
        <SettingsSection
          icon={<Shield size={16} />}
          title="Risk Rules"
          description="Guardrails to protect your capital"
          badge="Coming Soon"
        >
          <SettingRow label="Max daily risk %"   value="—"  info="If this daily loss limit is hit, the app will warn you to stop trading." />
          <SettingRow label="Max open trades"    value="—"  info="Maximum concurrent open positions allowed." />
          <SettingRow label="Max drawdown alert" value="—"  info="Trigger a warning when your running drawdown exceeds this threshold." />
        </SettingsSection>

        {/* ── Market Analysis config ───────────────────────────────────── */}
        <SettingsSection
          icon={<Info size={16} />}
          title="Market Analysis"
          description="Indicator visibility and module configuration"
          badge="Coming Soon"
        >
          <SettingRow label="Staleness threshold" value="7 days"   info="Sessions older than this are flagged as stale and shown with a warning." />
          <SettingRow label="Active modules"      value="—"        info="Toggle which market modules appear in your analysis view." />
          <SettingRow label="Per-profile toggles" value="Enabled"  info="Each indicator can be individually enabled/disabled per profile." />
        </SettingsSection>

        {/* ── Notifications ───────────────────────────────────────────── */}
        <SettingsSection
          icon={<Bell size={16} />}
          title="Notifications"
          description="Alerts for risk, goals, and stale analysis"
          badge="Coming Soon"
        >
          <SettingRow label="Stale analysis alert" value="—" info="Notify when a module hasn't been analysed in 7+ days." />
          <SettingRow label="Risk limit alert"     value="—" info="Notify when daily risk budget is consumed." />
          <SettingRow label="Goal milestone alert" value="—" info="Notify when a goal reaches 50%, 75%, 100%." />
        </SettingsSection>

        {/* ── System / API info ────────────────────────────────────────── */}
        <SettingsSection
          icon={<Database size={16} />}
          title="System"
          description="Backend, database, and deployment info"
        >
          <SettingRow label="Backend"    value="FastAPI / Python 3.11" />
          <SettingRow label="Database"   value="PostgreSQL 16" />
          <SettingRow label="ORM"        value="SQLAlchemy 2.0 + Alembic" />
          <SettingRow label="Frontend"   value="React 19 + Vite + Tailwind v4" />
          <SettingRow label="Phase"      value="Phase 1 — Step 8" />
          <SettingRow label="API health" value="/api/health" info="Live health endpoint. Returns status and current environment." />
        </SettingsSection>

      </div>

      <div className="mt-6">
        <ComingSoon
          feature="Settings forms, profile switching, preference persistence"
          phase="Phase 1 — Step 9+"
        />
      </div>
    </div>
  )
}
