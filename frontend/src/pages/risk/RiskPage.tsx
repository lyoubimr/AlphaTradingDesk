// ── Risk Manager page ──────────────────────────────────────────────────────
import { PageHeader } from '../../components/ui/PageHeader'
import { StatCard } from '../../components/ui/StatCard'
import { ComingSoon } from '../../components/ui/ComingSoon'
import { InfoBubble } from '../../components/ui/InfoBubble'

// ── Lot size calculator (UI-only, client-side preview) ────────────────────
function LotCalculatorPreview() {
  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-medium text-slate-300">Lot Size Calculator</h2>
        <InfoBubble
          text="Uses the Fixed Fractional method: Lot = (Capital × Risk%) ÷ |Entry − Stop Loss|. Connect your profile to compute live."
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <CalcField label="Account Capital ($)" placeholder="e.g. 10,000" />
        <CalcField label="Risk %" placeholder="e.g. 1.0" />
        <CalcField label="Entry Price" placeholder="e.g. 65,000" />
        <CalcField label="Stop Loss" placeholder="e.g. 64,500" />
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled
          className="px-4 py-2 text-sm rounded-lg bg-brand-600/20 text-brand-400 border border-brand-700/40 cursor-not-allowed"
        >
          Calculate Lot Size
        </button>
        <div className="text-sm text-slate-600">
          Result: <span className="text-slate-400 font-mono tabular-nums">— lots</span>
        </div>
      </div>

      <p className="text-xs text-slate-700 mt-3">
        ⚠ Calculator will be functional once Profile API is connected (Step 9+)
      </p>
    </div>
  )
}

function CalcField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div>
      <label className="block text-[10px] text-slate-600 uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        type="number"
        placeholder={placeholder}
        disabled
        className="
          w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2
          text-sm text-slate-400 placeholder-slate-700
          cursor-not-allowed
          font-mono tabular-nums
        "
      />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export function RiskPage() {
  return (
    <div>
      <PageHeader
        icon="🛡️"
        title="Risk Manager"
        subtitle="Size your positions, protect your capital"
        badge="Phase 1"
        badgeVariant="phase"
        info="All risk calculations use the Fixed Fractional method. Risk per trade is capped by your profile settings."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Max Risk / Trade"
          value="—"
          sub="% of capital"
          accent="bear"
          info="Maximum percentage of your account you are willing to risk on a single trade. Set in your profile."
        />
        <StatCard
          label="Current Exposure"
          value="—"
          sub="All open positions"
          accent="neutral"
          info="Total risk currently at stake across all open positions."
        />
        <StatCard
          label="Daily Risk Used"
          value="—"
          sub="vs daily limit"
          accent="bear"
          info="How much of your daily risk budget has been consumed today."
        />
        <StatCard
          label="Capital"
          value="—"
          sub="Current balance"
          accent="brand"
          info="Your current account capital. Updated after every trade close."
        />
      </div>

      <LotCalculatorPreview />

      <ComingSoon
        feature="Risk rules engine, daily limit enforcement, multi-position exposure chart"
        phase="Phase 1 — Step 9+"
      />
    </div>
  )
}
