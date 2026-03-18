// Global Market (Crypto) widget — VI score + Market Analysis summary.
// VI: polls /api/volatility/market/aggregated every 60s.
// MA: fetches staleness + last sessions on mount (refreshed manually).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BarChart3, ChevronRight, ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { maApi, volatilityApi } from '../../lib/api'
import { RegimeBadge } from '../volatility/RegimeBadge'
import type {
  AggregatedMarketVIOut,
  MABias,
  MAModule,
  MASessionListItem,
  MAStalenessItem,
} from '../../types/api'

// ── VI score helpers ──────────────────────────────────────────────────────

const scoreHex = (score: number): string => {
  if (score <= 15) return '#71717a'
  if (score <= 30) return '#38bdf8'
  if (score <= 50) return '#34d399'
  if (score <= 65) return '#818cf8'  // indigo-400 — TRENDING
  if (score <= 80) return '#fb923c'
  return '#f87171'
}

type Trend = 'up' | 'down' | 'flat'
const trendIcon  = (t: Trend) => t === 'up' ? '↑' : t === 'down' ? '↓' : '→'
const trendColor = (t: Trend) => t === 'up' ? 'text-orange-400' : t === 'down' ? 'text-sky-400' : 'text-slate-500'

// ── MA helpers ────────────────────────────────────────────────────────────

function ScoreBadge({
  label, score, bias,
}: {
  label: string
  score: string | null
  bias: MABias | null
}) {
  if (score === null) return null
  const val = Math.round(parseFloat(score))
  const ringCls = bias === 'bullish'
    ? 'border-emerald-500 text-emerald-300'
    : bias === 'bearish'
      ? 'border-red-500 text-red-300'
      : 'border-amber-400 text-amber-300'
  const bgCls = bias === 'bullish'
    ? 'bg-emerald-900/30'
    : bias === 'bearish'
      ? 'bg-red-900/30'
      : 'bg-amber-900/20'
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center text-[11px] font-bold tabular-nums ${ringCls} ${bgCls}`}>
        {val}
      </div>
      <span className="text-[9px] text-slate-600 uppercase tracking-wide font-medium">{label}</span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export function MarketVIWidget({ profileId }: { profileId: number }) {
  // VI state
  const [viData, setViData]   = useState<AggregatedMarketVIOut | null>(null)
  const [trend, setTrend]     = useState<Trend>('flat')
  const [viLoading, setVL]    = useState(true)
  const [viError, setVE]      = useState(false)
  const prevScore             = useRef<number | null>(null)

  // MA state
  const [staleness, setStaleness] = useState<MAStalenessItem[]>([])
  const [sessions,  setSessions]  = useState<MASessionListItem[]>([])
  const [modules,   setModules]   = useState<MAModule[]>([])
  const [maLoading, setML]        = useState(false)
  const [maError,   setME]        = useState(false)

  // Poll VI every 60s
  useEffect(() => {
    let cancelled = false
    const poll = () => {
      volatilityApi.getAggregatedMarketVI()
        .then((d) => {
          if (cancelled) return
          setVE(false); setVL(false); setViData(d)
          if (prevScore.current !== null) {
            const diff = d.vi_score - prevScore.current
            setTrend(diff > 0.5 ? 'up' : diff < -0.5 ? 'down' : 'flat')
          }
          prevScore.current = d.vi_score
        })
        .catch(() => { if (!cancelled) { setVL(false); setVE(true) } })
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Load MA data (refetch on profileId change or manual refresh)
  const loadMA = useCallback(async () => {
    setML(true); setME(false)
    try {
      const [stale, sess, mods] = await Promise.all([
        maApi.getStaleness(profileId),
        maApi.listSessions(undefined, 10),
        maApi.listModules(),
      ])
      setStaleness(stale); setSessions(sess); setModules(mods)
    } catch {
      setME(true)
    } finally {
      setML(false)
    }
  }, [profileId])

  useEffect(() => { void loadMA() }, [loadMA])

  // Last session per module
  const lastByMod = useMemo(() => {
    const map: Record<number, MASessionListItem> = {}
    for (const s of [...sessions].reverse()) map[s.module_id] = s
    return map
  }, [sessions])

  // ── Skeleton ────────────────────────────────────────────────────────────
  if (viLoading) {
    return (
      <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 animate-pulse">
        <div className="h-4 w-40 bg-surface-700 rounded mb-4" />
        <div className="h-20 bg-surface-700 rounded mb-3" />
        <div className="h-16 bg-surface-700 rounded" />
      </div>
    )
  }

  // ── VI error fallback ────────────────────────────────────────────────────
  if (viError || !viData) {
    return (
      <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-slate-200">🌍 Global Market (Crypto)</h2>
        <p className="text-xs text-slate-600">Could not load data — retrying…</p>
      </div>
    )
  }

  // VI display values — backend vi_score is on 0.0–1.0 scale
  const score = viData.vi_score * 100
  const color = scoreHex(score)
  const pct   = Math.min(Math.max(score, 0), 100)
  const topComponents = [...viData.tf_components]
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    .slice(0, 4)

  const staleCount = staleness.filter(s => s.is_stale).length

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 p-5 flex flex-col gap-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">🌍</span>
          <h2 className="text-sm font-semibold text-slate-200">Global Market (Crypto)</h2>
          {viData.is_weekend && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-700/30">
              Weekend
            </span>
          )}
        </div>
        <Link
          to="/volatility/market"
          className="flex items-center gap-1 text-[11px] text-slate-600 hover:text-brand-400 transition-colors"
        >
          VI details <ExternalLink size={10} />
        </Link>
      </div>

      {/* ── VI score + trend ────────────────────────────────────────────── */}
      <div className="flex items-center gap-5">
        <div className="relative w-16 h-16 shrink-0">
          <svg viewBox="0 0 64 64" className="w-full h-full -rotate-90">
            <circle cx="32" cy="32" r="26"
              fill="none" stroke="#1e293b" strokeWidth="6" />
            <circle cx="32" cy="32" r="26"
              fill="none"
              stroke={color}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${(pct / 100) * 163.4} 163.4`}
              style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
            />
          </svg>
          <span
            className="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums"
            style={{ color }}
          >
            {Math.round(score)}
          </span>
        </div>

        <div className="flex flex-col gap-2 min-w-0">
          <RegimeBadge regime={viData.regime} size="md" showEmoji />
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`text-lg leading-none ${trendColor(trend)}`}>
              {trendIcon(trend)}
            </span>
            <span>
              {trend === 'flat' ? 'Stable since last check'
                : trend === 'up' ? 'Rising volatility'
                : 'Falling volatility'}
            </span>
          </div>
        </div>
      </div>

      {/* ── TF breakdown ────────────────────────────────────────────────── */}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-slate-700 font-medium">Per timeframe</p>
        {topComponents.map((c) => (
          <div key={c.tf} className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-slate-500 w-6 shrink-0">{c.tf}</span>
            <div className="flex-1 h-1.5 rounded-full bg-surface-700 overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(c.vi_score * 100, 100)}%`,
                  backgroundColor: scoreHex(c.vi_score * 100),
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums font-mono text-slate-600 w-8 text-right shrink-0">
              {(c.vi_score * 100).toFixed(0)}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-slate-700 text-right -mt-2">
        Updated {new Date(viData.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className="border-t border-surface-700" />

      {/* ── Market Analysis section ──────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={13} className="text-purple-400" />
            <span className="text-xs font-semibold text-slate-200">Market Analysis</span>
            {!maLoading && staleCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-700/40">
                {staleCount} stale
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadMA()}
              className="text-slate-600 hover:text-slate-400 transition-colors"
            >
              <RefreshCw size={11} />
            </button>
            <Link
              to="/market-analysis"
              className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-0.5"
            >
              Full view <ChevronRight size={10} />
            </Link>
          </div>
        </div>

        {maLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 size={14} className="text-slate-600 animate-spin" />
          </div>
        ) : maError ? (
          <p className="text-xs text-red-400">Could not load analysis data.</p>
        ) : staleness.length === 0 ? (
          <p className="text-xs text-slate-600 text-center py-3">No modules configured.</p>
        ) : (
          <div className="space-y-2">
            {staleness.map((s) => {
              const mod  = modules.find(m => m.id === s.module_id)
              const sess = lastByMod[s.module_id]
              const age  = s.last_analyzed_at === null
                ? 'Never'
                : s.days_old === 0 ? 'Today'
                : s.days_old === 1 ? '1d ago'
                : `${s.days_old}d ago`
              const isDual = mod?.is_dual ?? false
              return (
                <div
                  key={s.module_id}
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 border ${
                    s.is_stale || !s.last_analyzed_at
                      ? 'border-amber-700/30 bg-amber-900/10'
                      : 'border-surface-600 bg-surface-700/30'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-200 truncate">{s.module_name}</span>
                      {isDual && mod && (
                        <span className="text-[9px] text-slate-600 shrink-0">{mod.asset_a}/{mod.asset_b}</span>
                      )}
                    </div>
                    <span className={`text-[9px] font-mono ${s.is_stale ? 'text-amber-400/70' : 'text-slate-600'}`}>
                      {age}
                    </span>
                  </div>

                  {sess ? (
                    <div className="flex items-center gap-3 shrink-0">
                      <ScoreBadge label="HTF" score={sess.score_htf_a} bias={sess.bias_htf_a} />
                      <ScoreBadge label="MTF" score={sess.score_mtf_a} bias={sess.bias_mtf_a} />
                      <ScoreBadge label="LTF" score={sess.score_ltf_a} bias={sess.bias_ltf_a} />
                    </div>
                  ) : (
                    <Link
                      to="/market-analysis/new"
                      className="text-[10px] text-amber-400/80 flex items-center gap-1 shrink-0"
                    >
                      <AlertTriangle size={10} />
                      Run analysis
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
