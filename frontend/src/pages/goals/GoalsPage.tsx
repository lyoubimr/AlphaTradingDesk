// ── Goals page ─────────────────────────────────────────────────────────────
import { Target, TrendingUp, Calendar } from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { ComingSoon } from '../../components/ui/ComingSoon'
import { Badge } from '../../components/ui/Badge'

// ── Goal progress card ────────────────────────────────────────────────────
interface GoalCardProps {
  icon: string
  title: string
  description: string
  targetLabel: string
  progress: number   // 0–100
  deadline?: string
  status: 'active' | 'paused' | 'completed'
}

function GoalCard({ icon, title, description, targetLabel, progress, deadline, status }: GoalCardProps) {
  const statusBadge = {
    active:    { label: 'Active',    variant: 'bull'     as const },
    paused:    { label: 'Paused',    variant: 'neutral'  as const },
    completed: { label: 'Completed', variant: 'default'  as const },
  }[status]

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
            <p className="text-xs text-slate-600 mt-0.5">{description}</p>
          </div>
        </div>
        <Badge label={statusBadge.label} variant={statusBadge.variant} />
      </div>

      <div>
        <div className="flex justify-between text-xs text-slate-600 mb-1">
          <span>{targetLabel}</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {deadline && (
        <div className="flex items-center gap-1.5 text-xs text-slate-700">
          <Calendar size={11} />
          <span>Deadline: {deadline}</span>
        </div>
      )}
    </div>
  )
}

// ── Sample goals ──────────────────────────────────────────────────────────
const SAMPLE_GOALS = [
  {
    icon: '💰',
    title: 'Monthly P&L Target',
    description: 'Achieve +$1,000 profit this month',
    targetLabel: '$340 of $1,000',
    progress: 34,
    deadline: '2026-03-31',
    status: 'active' as const,
  },
  {
    icon: '🎯',
    title: 'Win Rate 55%',
    description: 'Maintain 55%+ win rate over 20 trades',
    targetLabel: '12 of 20 trades tracked',
    progress: 60,
    deadline: '2026-04-30',
    status: 'active' as const,
  },
  {
    icon: '📉',
    title: 'Drawdown Control',
    description: 'Keep monthly drawdown below 5%',
    targetLabel: '2.1% drawdown so far',
    progress: 58,
    deadline: '2026-03-31',
    status: 'active' as const,
  },
]

// ── Page ──────────────────────────────────────────────────────────────────
export function GoalsPage() {
  return (
    <div>
      <PageHeader
        icon="🎯"
        title="Goals"
        subtitle="Track your performance targets and trading milestones"
        badge="Phase 1"
        badgeVariant="phase"
        info="Goals are linked to your profile. Progress is computed from closed trade data and updated automatically."
        actions={
          <button type="button" disabled className="atd-btn-primary opacity-50 cursor-not-allowed">
            <Target size={14} /> New Goal
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard
          label="Active Goals"
          value="—"
          sub="In progress"
          accent="brand"
          info="Goals with status 'active' linked to your current profile."
        />
        <StatCard
          label="Completed"
          value="—"
          sub="All time"
          accent="bull"
          info="Total goals marked as completed."
        />
        <StatCard
          label="Avg Progress"
          value="—"
          sub="Across all active"
          accent="neutral"
          info="Average completion percentage across your active goals."
        />
      </div>

      {/* ── Placeholder goal cards ─────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-2">
        <TrendingUp size={14} className="text-slate-600" />
        <h2 className="text-sm font-medium text-slate-500">Sample Goals</h2>
        <Badge label="Placeholder data" variant="neutral" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {SAMPLE_GOALS.map((g) => (
          <GoalCard key={g.title} {...g} />
        ))}
      </div>

      <ComingSoon
        feature="Goal creation form, auto-progress from trades, milestone badges"
        phase="Phase 1 — Step 9+"
      />
    </div>
  )
}
