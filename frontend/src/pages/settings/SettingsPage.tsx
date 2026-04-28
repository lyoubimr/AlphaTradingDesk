// ── Settings page ──────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { User, Database, Bell, Shield, Info, Palette, BarChart2, Activity, CheckCircle2, XCircle, Loader2, RefreshCw, Zap, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../../components/ui/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { ComingSoon } from '../../components/ui/ComingSoon'
import { InfoBubble } from '../../components/ui/InfoBubble'
import { useTheme, THEMES, type ThemeId } from '../../context/ThemeContext'
import { cn } from '../../lib/cn'

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

// ── System health check ───────────────────────────────────────────────────
type ServiceStatus = { status: 'ok' | 'error'; detail?: string; latency_ms?: number }
type HealthData = { status: 'ok' | 'degraded'; version?: string; services: Record<string, ServiceStatus> }

const SERVICE_LABELS: Record<string, string> = {
  postgres: 'PostgreSQL',
  redis:    'Redis',
  celery:   'Celery worker',
  binance:  'Binance API',
  kraken:   'Kraken API',
}

function SystemHealthSection() {
  const [data, setData]       = useState<HealthData | null>(null)
  const [loading, setLoading] = useState(false)
  const [lastCheck, setLastCheck] = useState<Date | null>(null)

  const check = () => {
    setLoading(true)
    fetch('/api/system/status')
      .then(r => r.json())
      .then((d: HealthData) => { setData(d); setLastCheck(new Date()) })
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }

  // Auto-check on mount
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { check() }, [])

  return (
    <SettingsSection
      icon={<Activity size={16} />}
      title="System Health"
      description="Live status of all backend services and external APIs"
    >
      <div className="space-y-1.5">
        {/* Status header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            {loading && <Loader2 size={13} className="text-slate-500 animate-spin" />}
            {!loading && data && (
              <span className={cn(
                'text-xs font-semibold px-2 py-0.5 rounded-full',
                data.status === 'ok'
                  ? 'bg-bull-dim/40 text-bull border border-bull/20'
                  : 'bg-bear-dim/40 text-bear border border-bear/20',
              )}>
                {data.status === 'ok' ? '✓ All systems operational' : '⚠ Degraded'}
              </span>
            )}
            {!loading && data?.version && (
              <span className="text-[10px] font-mono text-slate-600 bg-surface-700 px-1.5 py-0.5 rounded">
                {data.version}
              </span>
            )}
            {!loading && !data && (
              <span className="text-xs text-slate-600">No data</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastCheck && (
              <span className="text-[10px] text-slate-600">
                {lastCheck.toLocaleTimeString()}
              </span>
            )}
            <button
              type="button"
              onClick={check}
              disabled={loading}
              className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-surface-700 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* Services list */}
        {data && Object.entries(data.services).map(([key, svc]) => (
          <div key={key} className="flex items-center justify-between py-1.5 border-b border-surface-700/60 last:border-none">
            <div className="flex items-center gap-2">
              {svc.status === 'ok'
                ? <CheckCircle2 size={13} className="text-bull shrink-0" />
                : <XCircle     size={13} className="text-bear shrink-0" />
              }
              <span className="text-xs text-slate-300">{SERVICE_LABELS[key] ?? key}</span>
              {svc.detail && (
                <span className="text-[10px] text-slate-600 truncate max-w-[180px]" title={svc.detail}>
                  {svc.detail}
                </span>
              )}
            </div>
            {svc.latency_ms != null && (
              <span className={cn(
                'text-[10px] font-mono tabular-nums',
                svc.latency_ms < 50  ? 'text-bull' :
                svc.latency_ms < 200 ? 'text-neutral-amber' : 'text-bear',
              )}>
                {svc.latency_ms}ms
              </span>
            )}
          </div>
        ))}

        {!data && !loading && (
          <p className="text-xs text-slate-600 py-2">Could not reach backend. Is it running?</p>
        )}
      </div>
    </SettingsSection>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { theme, setTheme } = useTheme()

  return (
    <div>
      <PageHeader
        icon="⚙️"
        title="Settings"
        subtitle="Profile, preferences, and system configuration"
        info="All settings are stored in the database and scoped per profile. No local storage or cookies are used."
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Appearance / Themes ─────────────────────────────────────── */}
        <SettingsSection
          icon={<Palette size={16} />}
          title="Appearance"
          description="Choose a colour theme for the app — persisted locally"
        >
          <div className="space-y-2 pt-1">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id as ThemeId)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all text-left',
                  theme === t.id
                    ? 'border-brand-500/50 bg-brand-600/10'
                    : 'border-surface-600/50 bg-surface-700/40 hover:border-surface-500',
                )}
              >
                {/* Colour swatch */}
                <span
                  className={cn(
                    'w-5 h-5 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-surface-800 transition-all',
                    theme === t.id ? 'ring-white/40' : 'ring-transparent',
                  )}
                  style={{ backgroundColor: t.swatch }}
                />
                <span className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-slate-200 block">
                    {t.emoji} {t.label}
                  </span>
                  <span className="text-[10px] text-slate-500 leading-snug block truncate">
                    {t.description}
                  </span>
                </span>
                {theme === t.id && (
                  <span className="text-[10px] font-semibold text-brand-400 bg-brand-600/15 border border-brand-600/30 px-2 py-0.5 rounded-full shrink-0">
                    Active
                  </span>
                )}
              </button>
            ))}
          </div>
        </SettingsSection>
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
        >
          <SettingRow label="Staleness threshold" value="7 days"   info="Sessions older than this are flagged as stale and shown with a warning." />
          <SettingRow label="Active modules"      value="2 active" info="Crypto and Gold modules are active. Forex/Indices coming post-Phase 1." />
          <SettingRow label="Per-profile toggles" value="Enabled"  info="Each indicator can be individually enabled/disabled per profile." />
          <div className="pt-2">
            <Link
              to="/settings/market-analysis"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Open Indicator Editor →
            </Link>
          </div>
        </SettingsSection>

        {/* ── Strategies ───────────────────────────────────────────────── */}
        <SettingsSection
          icon={<BarChart2 size={16} />}
          title="Strategies"
          description="Define trading strategies and track their win rate automatically"
        >
          <SettingRow label="WR threshold"   value="min_trades_for_stats"  info="Win rate is shown as N/A until a strategy has enough trades." />
          <SettingRow label="BE filter"      value="min_pnl_pct_for_stats" info="Scratch/break-even trades (abs PnL% below threshold) are excluded from WR stats." />
          <SettingRow label="Image support"  value="URL (upload Phase 2+)" info="Paste any image URL — TradingView screenshot, Imgur, etc." />
          <div className="pt-2">
            <Link
              to="/settings/strategies"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Open Strategies Manager →
            </Link>
          </div>
        </SettingsSection>

        {/* ── Goals config ─────────────────────────────────────────────── */}
        <SettingsSection
          icon={<Info size={16} />}
          title="Goals"
          description="Global P&L targets and discipline limits across all trading styles"
        >
          <SettingRow label="Goal types"       value="outcome · process"          info="Outcome: % gain target + loss circuit-breaker. Process: avg R-multiple + optional max trades per period." />
          <SettingRow label="Scope"            value="Global (all styles)"        info="Goals apply to all trades of the profile, regardless of trading style." />
          <SettingRow label="Dashboard cards"  value="Configurable per goal"      info="Each goal can opt in/out of the dashboard progress card via show_on_dashboard." />
          <div className="pt-2">
            <Link
              to="/settings/goals"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Open Goals Manager →
            </Link>
          </div>
        </SettingsSection>

        {/* ── Volatility ───────────────────────────────────────────────── */}
        <SettingsSection
          icon={<Activity size={16} />}
          title="Volatility"
          description="Market VI engine, per-pair indicators, and regime thresholds"
        >
          <SettingRow label="Source"          value="Kraken Futures"           info="All volatility data is sourced from Kraken Perpetual Futures via the ccxt adapter." />
          <SettingRow label="Timeframes"       value="15m · 1h · 4h · 1d"       info="Each timeframe is computed independently then aggregated with configurable weights." />
          <SettingRow label="Indicators"       value="RVOL · MFI · ATR · BB · EMA" info="Per-pair composite VI is built from 5 indicators. Each can be toggled globally." />
          <SettingRow label="Regime bands"     value="6 regimes"                info="DEAD → CALM → NORMAL → TRENDING → ACTIVE → EXTREME. Thresholds are user-configurable." />
          <div className="pt-2">
            <Link
              to="/settings/volatility"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Open Volatility Settings →
            </Link>
          </div>
        </SettingsSection>

        {/* ── Notifications ───────────────────────────────────────────── */}
        <SettingsSection
          icon={<Bell size={16} />}
          title="Notifications"
          description="Telegram alerts for volatility regimes, watchlist events and trade execution"
        >
          <SettingRow label="Bots"              value="Configurable"  info="Add one or more Telegram bots. Each can be targeted by a specific alert type." />
          <SettingRow label="Market VI alerts"  value="Toggle + regimes" info="Notify when aggregate VI enters a configured regime. Cooldown-based deduplication." />
          <SettingRow label="Watchlist alerts"  value="Per-TF"        info="Alert per timeframe when a new watchlist is generated. VI minimum threshold configurable." />
          <SettingRow label="Execution alerts"  value="10 events"     info="Notifies on Kraken order events: limit placed/filled, TP1/2/3, SL hit, breakeven, PnL status." />
          <div className="pt-2">
            <Link
              to="/settings/notifications"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Open Notification Settings →
            </Link>
          </div>
        </SettingsSection>

        {/* ── Ritual ──────────────────────────────────────────────────── */}
        <SettingsSection
          icon={<BookOpen size={16} />}
          title="Ritual"
          description="Session step templates, Smart Watchlist configuration, and cascade scoring weights"
        >
          <SettingRow label="Session types"    value="4 templates"      info="Weekly Setup, Trade Session, Weekend Review, Daily Prep — each with its own ordered step list." />
          <SettingRow label="Smart Watchlist"  value="Cascade scoring"  info="Per-timeframe pair ranking using VI score, trend bonus, and EMA alignment. Top N configurable per session type." />
          <div className="pt-2">
            <Link
              to="/settings/ritual"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Open Ritual Settings →
            </Link>
          </div>
        </SettingsSection>

        {/* ── Automation ───────────────────────────────────────────────── */}        <SettingsSection
          icon={<Zap size={16} />}
          title="Automation"
          description="Kraken Futures execution — API keys, engine config and connection test"
        >
          <SettingRow label="API keys"        value="Encrypted (Fernet)" info="API key + secret stored encrypted in DB. Write-only — never returned by the API." />
          <SettingRow label="Engine"          value="Enable / disable"   info="Toggle automation per profile. Disabled profile cannot send any orders." />
          <SettingRow label="PNL status"      value="Periodic (Telegram)" info="Send a PNL summary at a configurable interval." />
          <SettingRow label="Leverage cap"    value="Override (optional)" info="Cap the leverage sent to Kraken Futures. Leave blank to use account default." />
          <div className="pt-2">
            <Link
              to="/settings/automation"
              className="inline-flex items-center gap-1.5 text-xs text-brand-400 hover:text-brand-300 transition-colors underline underline-offset-2"
            >
              Open Automation Settings →
            </Link>
          </div>
        </SettingsSection>

        {/* ── System Health ────────────────────────────────────────────── */}
        <SystemHealthSection />

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
          <SettingRow label="API health" value="/api/health" info="Live health endpoint. Returns status and current environment." />
        </SettingsSection>

      </div>

      <div className="mt-6">
        <ComingSoon
          feature="Settings forms, profile switching, preference persistence"
          phase="Coming soon"
        />
      </div>
    </div>
  )
}
