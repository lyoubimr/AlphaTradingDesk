// ── ViCorrelation ────────────────────────────────────────────────────────────
// Trade performance vs Pair VI (volatility_snapshots) + Market VI (market_vi_snapshots)
// 6 buckets: Dead / Calm / Normal / Trending / Active / Extreme
import { useState } from 'react'
import type { VIBucket } from '../../../types/api'
import { InfoTip } from './SummaryKPIs'

interface Props {
  pairData: VIBucket[]
  marketData: VIBucket[]
}

const BUCKET_META: Record<string, {
  label: string; range: string; color: string; bg: string; border: string; badge?: string
}> = {
  Dead:     { label: 'Dead',     range: 'VI < 0.17',   color: '#475569', bg: 'bg-slate-900/60',   border: 'border-slate-800/60' },
  Calm:     { label: 'Calm',     range: '0.17 – 0.33', color: '#10b981', bg: 'bg-emerald-950/30', border: 'border-emerald-900/40' },
  Normal:   { label: 'Normal',   range: '0.33 – 0.50', color: '#3b82f6', bg: 'bg-blue-950/30',    border: 'border-blue-900/40' },
  Trending: { label: 'Trending', range: '0.50 – 0.67', color: '#8b5cf6', bg: 'bg-violet-950/30',  border: 'border-violet-900/40', badge: 'Best R:R' },
  Active:   { label: 'Active',   range: '0.67 – 0.83', color: '#f59e0b', bg: 'bg-amber-950/30',   border: 'border-amber-900/40' },
  Extreme:  { label: 'Extreme',  range: 'VI ≥ 0.83',   color: '#ef4444', bg: 'bg-red-950/30',     border: 'border-red-900/40' },
}

const BUCKET_ORDER = ['Dead', 'Calm', 'Normal', 'Trending', 'Active', 'Extreme'] as const

function BucketsGrid({ data }: { data: VIBucket[] }) {
  if (!data || data.length === 0) return (
    <div className="text-slate-600 text-sm py-6 text-center">
      No volatility data — VI snapshots may not overlap with your trades.
    </div>
  )

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
      {BUCKET_ORDER.map(bucket => {
        const d = data.find(b => b.bucket === bucket)
        const meta = BUCKET_META[bucket]
        if (!d) {
          return (
            <div key={bucket} className={`rounded-xl border ${meta.border} ${meta.bg} p-3 opacity-35`}>
              <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: meta.color }}>
                {meta.label}
              </div>
              <div className="text-[9px] mt-0.5" style={{ color: '#475569' }}>{meta.range}</div>
              <div className="mt-3 text-[11px]" style={{ color: '#334155' }}>No trades</div>
            </div>
          )
        }
        const wr = d.wr_pct ?? 0
        const pnl = d.avg_pnl ?? 0
        const pnlColor = pnl >= 0 ? '#10b981' : '#ef4444'
        const wrColor = wr >= 55 ? '#10b981' : wr >= 45 ? '#f59e0b' : '#ef4444'

        return (
          <div key={bucket} className={`rounded-xl border ${meta.border} ${meta.bg} p-3 hover:opacity-90 transition-opacity relative`}>
            {/* Best R:R badge on Trending */}
            {meta.badge && (
              <span
                className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ background: '#2e1065', color: meta.color, border: `1px solid ${meta.color}40` }}
              >
                {meta.badge}
              </span>
            )}
            {/* Header */}
            <div className="flex items-start justify-between gap-0.5 mb-1">
              <span className="text-[10px] font-bold uppercase tracking-widest leading-tight" style={{ color: meta.color }}>
                {meta.label}
              </span>
            </div>
            <div className="text-[8px] mb-2" style={{ color: '#64748b' }}>{meta.range}</div>
            {/* WR — hero */}
            <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: wrColor }}>
              {wr.toFixed(0)}%
            </div>
            <div className="text-[9px] mt-0.5 mb-2" style={{ color: '#64748b' }}>win rate</div>
            {/* Divider */}
            <div className="border-t border-surface-700 my-2" />
            {/* Stats */}
            <div className="flex justify-between text-[10px]">
              <div>
                <div className="font-semibold tabular-nums" style={{ color: pnlColor }}>
                  {pnl >= 0 ? '+$' : '-$'}{Math.abs(pnl).toFixed(0)}
                </div>
                <div style={{ color: '#475569' }} className="text-[8px]">avg PnL</div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums" style={{ color: '#cbd5e1' }}>{d.trades}</div>
                <div style={{ color: '#475569' }} className="text-[8px]">trades</div>
              </div>
            </div>
            {/* VI score bar */}
            {d.avg_vi != null && (
              <div className="mt-2">
                <div className="h-0.5 bg-surface-700 rounded-full overflow-hidden">
                  <div
                    className="h-0.5 rounded-full"
                    style={{ width: `${Math.min(d.avg_vi * 100, 100)}%`, background: meta.color }}
                  />
                </div>
                <div className="text-[8px] mt-0.5 text-right" style={{ color: '#475569' }}>
                  avg {d.avg_vi.toFixed(3)}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ViCorrelation({ pairData, marketData }: Props) {
  const [tab, setTab] = useState<'pair' | 'market'>('pair')

  const hasPair = pairData.length > 0
  const hasMarket = marketData.length > 0

  return (
    <div className="space-y-3">
      {/* Tab switcher */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-surface-950/60 border border-surface-800 rounded-lg p-0.5">
          <button
            onClick={() => setTab('pair')}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
              tab === 'pair' ? 'bg-violet-700 text-white shadow' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            Pair VI
          </button>
          <button
            onClick={() => setTab('market')}
            className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
              tab === 'market' ? 'bg-violet-700 text-white shadow' : 'text-slate-500 hover:text-slate-200'
            }`}
          >
            Market VI
          </button>
        </div>
        <p className="text-[10px] leading-relaxed" style={{ color: '#475569' }}>
          {tab === 'pair'
            ? 'Pair volatility at trade entry (±3h, 1h snapshot)'
            : 'Global market VI regime at trade entry (±3h, 1h snapshot)'}
          <InfoTip text={
            tab === 'pair'
              ? 'VI score of your specific traded pair (volatility_snapshots). Dead<0.17, Calm 0.17-0.33, Normal 0.33-0.50, Trending 0.50-0.67 ← best R:R, Active 0.67-0.83, Extreme≥0.83.'
              : 'Overall market regime from market_vi_snapshots (50 top Binance pairs aggregate). Same 6-regime scale.'
          } />
        </p>
      </div>

      {/* Grid */}
      {tab === 'pair'
        ? (hasPair
            ? <BucketsGrid data={pairData} />
            : <div className="text-slate-600 text-sm py-6 text-center">No pair VI snapshots for this period.</div>
          )
        : (hasMarket
            ? <BucketsGrid data={marketData} />
            : <div className="text-slate-600 text-sm py-6 text-center">No market VI snapshots for this period.</div>
          )
      }
    </div>
  )
}

