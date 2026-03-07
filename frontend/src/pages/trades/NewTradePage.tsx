// ── /trades/new — v7 ─────────────────────────────────────────────────────
// Fixed Fractional · multi-TP presets · SL validation · Strategy dropdown
// Crypto: practical margin ↔ leverage (bidirectional) + liquidation price
// CFD: notional margin + margin level % + margin call warning
//
// ── Crypto margin/leverage logic ─────────────────────────────────────────
// Practical margin proposal: 2 × risk_amount
//   → always affordable (risk_amount ≤ capital × risk%), well above SL
//   → avoids the "safe margin > capital" problem of the MMR formula
//
// Derived leverage: notional / margin
//   notional = lot_size × entry_price
//   leverage = notional / margin  (capped at instrument max_leverage)
//
// Bidirectional binding:
//   • User edits MARGIN  → leverage auto-recalculated
//   • User moves LEVERAGE slider → margin auto-recalculated
//   • Recalculation is "soft" — values update but neither field is locked
//
// Liq. price (isolated): entry × (1 − 1/leverage + MMR)  [LONG]
//                         entry × (1 + 1/leverage − MMR)  [SHORT]
// Warning shown when liq price crosses SL.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Loader2,
  AlertTriangle, ChevronDown, ChevronUp, Search, X, Info, Clock, Plus,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { instrumentsApi, tradesApi, strategiesApi, statsApi } from '../../lib/api'
import { useRiskCalc } from '../../hooks/useRiskCalc'
import type { RiskCalcResult } from '../../hooks/useRiskCalc'
import { cn } from '../../lib/cn'
import type { Instrument, Profile, Strategy, WinRateStats } from '../../types/api'

// ─────────────────────────────────────────────────────────────────────────────
// Shared styles
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = [
  'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600',
  'text-sm text-slate-200 placeholder-slate-600',
  'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30',
  'transition-colors',
].join(' ')

// ─────────────────────────────────────────────────────────────────────────────
// Atoms
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label, hint, hintClassName, error, children,
}: {
  label: React.ReactNode
  hint?: string
  hintClassName?: string
  error?: string | null
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-1.5">
        {label}
      </label>
      {children}
      {error
        ? <p className="text-[10px] text-amber-400 mt-1 flex items-center gap-1">
            <AlertTriangle size={10} />{error}
          </p>
        : hint
          ? <p className={cn('text-[10px] mt-1', hintClassName ?? 'text-slate-500')}>{hint}</p>
          : null
      }
    </div>
  )
}

function Tip({ text }: { text: string }) {
  const [v, setV] = useState(false)
  return (
    <span className="relative inline-flex items-center ml-0.5 cursor-help"
      onMouseEnter={() => setV(true)} onMouseLeave={() => setV(false)}>
      <Info size={11} className="text-slate-500 hover:text-slate-300 transition-colors" />
      {v && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
          w-64 px-3 py-2 rounded-lg bg-surface-700 border border-surface-600
          text-[11px] text-slate-300 leading-snug shadow-xl pointer-events-none whitespace-normal">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-surface-600" />
        </span>
      )}
    </span>
  )
}

function Section({ icon, title, children }: {
  icon?: string; title: string; children: React.ReactNode
}) {
  return (
    <div className="bg-surface-800 rounded-xl border border-surface-700 p-5 space-y-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
        {icon && <span>{icon}</span>}
        {title}
      </h3>
      {children}
    </div>
  )
}

function CalcPill({ label, value, sub, color = 'default' }: {
  label: string; value: string; sub?: string
  color?: 'default' | 'green' | 'amber' | 'red' | 'blue'
}) {
  const cls = {
    default: 'bg-surface-700/60 border-surface-600   text-slate-200',
    green:   'bg-emerald-500/10  border-emerald-500/30 text-emerald-300',
    amber:   'bg-amber-500/10    border-amber-500/30   text-amber-300',
    red:     'bg-red-500/10      border-red-500/30     text-red-300',
    blue:    'bg-brand-500/10    border-brand-500/30   text-brand-300',
  }
  return (
    <div className={cn('flex flex-col px-3 py-2.5 rounded-lg border', cls[color])}>
      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium">{label}</span>
      <span className="text-sm font-mono font-bold mt-0.5 leading-tight">{value}</span>
      {sub && <span className="text-[10px] text-slate-500 mt-0.5">{sub}</span>}
    </div>
  )
}

// ── Price input with currency suffix ─────────────────────────────────────────

function PriceInput({
  value, onChange, placeholder, className, ccy, required,
}: {
  value: string; onChange: (v: string) => void
  placeholder?: string; className?: string; ccy?: string; required?: boolean
}) {
  return (
    <div className="flex">
      <input
        required={required}
        type="number" step="any" min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '0.00'}
        className={cn(inputCls, ccy ? 'rounded-r-none border-r-0' : '', className)}
      />
      {ccy && (
        <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600
          bg-surface-700/60 text-xs text-slate-500 font-medium whitespace-nowrap">
          {ccy}
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions
// ─────────────────────────────────────────────────────────────────────────────

const SESSIONS = [
  { label: 'Asian',    emoji: '🌏', hours: '00–08 UTC' },
  { label: 'London',   emoji: '🇬🇧', hours: '07–16 UTC' },
  { label: 'New York', emoji: '🗽', hours: '13–22 UTC' },
  { label: 'Overlap',  emoji: '⚡', hours: '13–17 UTC' },
] as const
type SessionLabel = typeof SESSIONS[number]['label']

function detectSession(): SessionLabel {
  // Use local hour so traders see the session that matches their clock,
  // regardless of where the server is located.
  // Session times expressed as LOCAL equivalents of UTC ranges are
  // approximated by converting UTC boundaries to the browser's timezone.
  const nowUtcH = new Date().getUTCHours()
  if (nowUtcH >= 13 && nowUtcH < 17) return 'Overlap'
  if (nowUtcH >= 13 && nowUtcH < 22) return 'New York'
  if (nowUtcH >= 7  && nowUtcH < 16) return 'London'
  return 'Asian'
}

/** Display-only local time string for the session hint. */
function localTimeStr(): string {
  return new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** IANA timezone abbreviation (e.g. "CET", "EST", "JST"). */
function tzLabel(): string {
  try {
    return Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value ?? 'local'
  } catch { return 'local' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Instrument picker
// ─────────────────────────────────────────────────────────────────────────────

const CLASS_COLORS: Record<string, string> = {
  Crypto:      'text-brand-400 bg-brand-600/15',
  Forex:       'text-emerald-400 bg-emerald-500/10',
  Commodities: 'text-amber-400 bg-amber-500/10',
  Indices:     'text-purple-400 bg-purple-500/10',
}

function InstrumentPicker({
  instruments, value, onChange,
}: {
  instruments: Instrument[]; value: Instrument | null; onChange: (i: Instrument | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref               = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return instruments.slice(0, 40)
    const q = query.toLowerCase()
    return instruments
      .filter((i) => i.symbol.toLowerCase().includes(q) || i.display_name.toLowerCase().includes(q))
      .slice(0, 40)
  }, [instruments, query])

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cn(inputCls, 'flex items-center justify-between gap-2 cursor-pointer text-left', !value && 'text-slate-600')}>
        {value ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold', CLASS_COLORS[value.asset_class] ?? 'text-slate-400 bg-surface-700')}>
              {value.asset_class}
            </span>
            <span className="font-medium text-slate-100 truncate">{value.display_name}</span>
            <span className="text-slate-500 text-xs shrink-0">{value.symbol}</span>
          </span>
        ) : (
          <span className="flex items-center gap-2 text-slate-500">
            <Search size={13} /> Search instrument…
          </span>
        )}
        <ChevronDown size={13} className="shrink-0 text-slate-500" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50
          bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-surface-700">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-700">
              <Search size={13} className="text-slate-500 shrink-0" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="BTC, ETH, EUR/USD, XAU…"
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
              {query && <button type="button" onClick={() => setQuery('')}><X size={12} className="text-slate-500 hover:text-slate-300" /></button>}
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0
              ? <p className="px-4 py-3 text-xs text-slate-500">No instruments found</p>
              : filtered.map((i) => (
                <button key={i.id} type="button"
                  onClick={() => { onChange(i); setOpen(false); setQuery('') }}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-700 transition-colors text-left">
                  <span className={cn('shrink-0 px-1.5 py-0.5 rounded text-[9px] font-semibold', CLASS_COLORS[i.asset_class] ?? 'text-slate-400 bg-surface-700')}>
                    {i.asset_class}
                  </span>
                  <span className="text-xs font-medium text-slate-200 flex-1 truncate">{i.display_name}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{i.symbol}</span>
                  {i.max_leverage && <span className="text-[10px] text-slate-600 shrink-0">×{i.max_leverage}</span>}
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TP Preset scenarios
// ─────────────────────────────────────────────────────────────────────────────

interface TpPreset { label: string; emoji: string; pcts: (n: number) => number[] }

function evenly(n: number): number[] {
  const base = Math.floor(100 / n)
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - base * (n - 1) : base))
}

const TP_PRESETS: TpPreset[] = [
  { label: 'Smart Scale', emoji: '🎯',
    pcts: (n) => ({ 1: [100], 2: [55, 45], 3: [35, 45, 20], 4: [25, 35, 25, 15] }[n] ?? evenly(n)) },
  { label: 'Profit Max', emoji: '💎',
    pcts: (n) => ({ 1: [100], 2: [45, 55], 3: [30, 55, 15], 4: [20, 35, 30, 15] }[n] ?? evenly(n)) },
  { label: 'Balanced', emoji: '⚖️',
    pcts: (n) => ({ 1: [100], 2: [60, 40], 3: [45, 35, 20], 4: [30, 30, 25, 15] }[n] ?? evenly(n)) },
  { label: 'Aggressive', emoji: '🚀',
    pcts: (n) => ({ 1: [100], 2: [40, 60], 3: [25, 50, 25], 4: [20, 30, 30, 20] }[n] ?? evenly(n)) },
  { label: 'Conservative', emoji: '🛡️',
    pcts: (n) => ({ 1: [100], 2: [70, 30], 3: [60, 30, 10], 4: [50, 25, 15, 10] }[n] ?? evenly(n)) },
]

// ─────────────────────────────────────────────────────────────────────────────
// Setup tags (DIFFERENT from strategies — tags = chart patterns, strategy = method)
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TAGS = [
  '📐 Structure', '🔁 Retest',    '📊 Divergence', '🧲 Magnet',
  '📰 News',      '🕯️ Engulfing', '📍 FVG',        '🎯 OB',
  '📈 Breakout',  '📉 Breakdown', '🔄 Range',       '🌊 Trend',
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

interface TpRow { price: string; pct: string }

// ─────────────────────────────────────────────────────────────────────────────
// Strategy dropdown with inline "New strategy" create
// ─────────────────────────────────────────────────────────────────────────────

function StrategySelect({
  strategies, loading, value, onChange, profileId, onCreated,
}: {
  strategies: Strategy[]; loading: boolean; value: number | null
  onChange: (id: number | null) => void; profileId: number
  onCreated: (s: Strategy) => void
}) {
  const [open, setOpen]       = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving]   = useState(false)
  const ref                   = useRef<HTMLDivElement>(null)
  const selected              = strategies.find((s) => s.id === value) ?? null

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCreating(false) }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const s = await strategiesApi.create(profileId, { name: newName.trim() })
      onCreated(s)
      onChange(s.id)
      setNewName('')
      setCreating(false)
      setOpen(false)
    } finally { setSaving(false) }
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cn(inputCls, 'flex items-center justify-between gap-2 cursor-pointer text-left')}>
        <span className={cn('flex-1 text-sm truncate', selected ? 'text-slate-200' : 'text-slate-500')}>
          {loading ? 'Loading…'
            : selected
              ? <span className="flex items-center gap-1.5">
                  {selected.emoji && <span>{selected.emoji}</span>}
                  {selected.name}
                  {selected.trades_count >= selected.min_trades_for_stats && (
                    <span className="text-[10px] text-emerald-400 font-mono">
                      {((selected.win_count / selected.trades_count) * 100).toFixed(0)}% WR
                    </span>
                  )}
                </span>
              : 'None (optional)'}
        </span>
        {selected && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null) }}
            className="shrink-0 text-slate-500 hover:text-slate-300">
            <X size={12} />
          </button>
        )}
        <ChevronDown size={13} className="shrink-0 text-slate-500" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50
          bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            <button type="button" onClick={() => { onChange(null); setOpen(false) }}
              className={cn('w-full text-left px-4 py-2.5 text-xs text-slate-500 hover:bg-surface-700 transition-colors',
                value === null && 'bg-surface-700/50')}>
              — None
            </button>
            {strategies.map((s) => (
              <button key={s.id} type="button" onClick={() => { onChange(s.id); setOpen(false) }}
                className={cn('w-full flex items-center gap-2 px-4 py-2.5 hover:bg-surface-700 transition-colors text-left',
                  value === s.id && 'bg-brand-600/15')}>
                {s.emoji && <span className="text-sm">{s.emoji}</span>}
                <span className="flex-1 text-xs font-medium text-slate-200 truncate">{s.name}</span>
                {s.trades_count >= s.min_trades_for_stats
                  ? <span className="text-[10px] text-emerald-400 font-mono shrink-0">
                      {((s.win_count / s.trades_count) * 100).toFixed(0)}% WR
                    </span>
                  : <span className="text-[10px] text-slate-600 shrink-0">{s.trades_count}t</span>
                }
              </button>
            ))}
          </div>
          <div className="border-t border-surface-700 p-2">
            {creating ? (
              <div className="flex gap-1.5">
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void handleCreate() }
                    if (e.key === 'Escape') setCreating(false)
                  }}
                  placeholder="Strategy name…"
                  className="flex-1 px-2 py-1.5 rounded-lg bg-surface-700 border border-surface-600
                    text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-brand-500/60" />
                <button type="button" onClick={() => void handleCreate()}
                  disabled={saving || !newName.trim()}
                  className="px-2.5 py-1.5 rounded-lg bg-brand-600/20 border border-brand-500/50 text-brand-300 text-xs font-medium disabled:opacity-40">
                  {saving ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
                </button>
                <button type="button" onClick={() => setCreating(false)} className="px-1.5 text-slate-500 hover:text-slate-300">
                  <X size={12} />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setCreating(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-500 hover:text-brand-300 hover:bg-brand-600/10 transition-colors">
                <Plus size={11} /> New strategy…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Expectancy panel
// ─────────────────────────────────────────────────────────────────────────────
//
// Formula (per-trade expectancy expressed in R-multiples):
//   E(R) = WR × AvgWinR  −  LR × AvgLossR
//   AvgWinR  = totalProfit / riskAmt   ← "how many R you win on a win"
//   AvgLossR = 1.0                     ← you always lose exactly 1R on a loss
//
// Win-rate source priority (4 levels):
//   1. Selected strategy  — strategy.win_count / trades_count  (if ≥ min_trades_for_stats)
//   2. Active profile     — profile.win_count / trades_count   (if ≥ 5 closed trades)
//   3. Global             — mean(wr) across all profiles with data (computed in front)
//   4. Fallback           — 60% (industry standard)
//
// Level 3 (global) is computed here from the WinRateStats fetched from /api/stats/winrate.

const DEFAULT_WIN_RATE = 0.6        // 60% fallback
const MIN_PROFILE_TRADES = 5        // mirrors backend MIN_PROFILE_TRADES

interface ExpectancyPanelProps {
  calc: RiskCalcResult
  totalProfit: number | null
  pctValid: boolean
  selectedStrategy: Strategy | null
  activeProfile: Profile
  globalWrStats: WinRateStats | null  // from /api/stats/winrate, null = not loaded yet
  ccy: string
}

// ── Expectancy formula ────────────────────────────────────────────────────
//
//   E(R) = WR × (totalProfit / riskAmt)  −  (1 − WR) × 1
//
// Example: risk=10, totalProfit=20, WR=60%
//   AvgWinR  = 20/10 = 2R
//   E(R)     = 0.6×2R − 0.4×1R = 1.2 − 0.4 = +0.8R   ✓

function ExpectancyPanel({ calc, totalProfit, pctValid, selectedStrategy, activeProfile, globalWrStats, ccy }: ExpectancyPanelProps) {
  // ⚠️ All hooks BEFORE early returns (rules of hooks)
  // Level 3: global = mean of all profiles that have data
  const globalWr: number | null = useMemo(() => {
    if (!globalWrStats) return null
    const withData = globalWrStats.profiles.filter(
      (p) => p.has_data && p.win_rate_pct != null
    )
    if (withData.length === 0) return null
    const sum = withData.reduce((s, p) => s + (p.win_rate_pct ?? 0), 0)
    return sum / withData.length / 100   // convert % to ratio
  }, [globalWrStats])

  if (!calc.valid || calc.risk_amount == null || calc.risk_amount <= 0) return null
  if (totalProfit == null || !pctValid) return null

  const riskAmt  = calc.risk_amount
  const avgWinR  = totalProfit / riskAmt
  const avgLossR = 1.0

  // ── Win-rate priority ─────────────────────────────────────────────────
  // Level 1: selected strategy (if enough trades)
  const hasStratStats = selectedStrategy != null
    && selectedStrategy.trades_count >= selectedStrategy.min_trades_for_stats
    && selectedStrategy.trades_count > 0

  // Level 2: active profile (from profiles.win_count / trades_count)
  const profileTrades = activeProfile.trades_count
  const profileWins   = activeProfile.win_count
  const hasProfileStats = profileTrades >= MIN_PROFILE_TRADES

  // Level 3: global win rate — computed from globalWrStats prop (passed from parent)
  // ⚠️ useMemo was moved to top of function body (before early returns) to satisfy rules-of-hooks
  const hasGlobalStats = globalWr != null

  // Pick the best available source
  type WrSource = 'strategy' | 'profile' | 'global' | 'fallback'
  const wrSource: WrSource = hasStratStats ? 'strategy'
    : hasProfileStats ? 'profile'
    : hasGlobalStats  ? 'global'
    : 'fallback'

  const winRate: number = wrSource === 'strategy'
    ? selectedStrategy!.win_count / selectedStrategy!.trades_count
    : wrSource === 'profile'
      ? profileWins / profileTrades
      : wrSource === 'global'
        ? globalWr!
        : DEFAULT_WIN_RATE

  const winRateSourceLabel: string = wrSource === 'strategy'
    ? `${selectedStrategy!.name} (${selectedStrategy!.trades_count} trades)`
    : wrSource === 'profile'
      ? `${activeProfile.name} profile (${profileTrades} trades)`
      : wrSource === 'global'
        ? `Global average (${globalWrStats!.profiles.filter((p) => p.has_data).length} profiles)`
        : `Default 60% — no trade history yet`

  const lossRate = 1 - winRate

  // ── Expectancy ────────────────────────────────────────────────────────
  const expectancyR   = winRate * avgWinR - lossRate * avgLossR
  const expectancyEur = expectancyR * riskAmt

  // ── Grade ─────────────────────────────────────────────────────────────
  const grade = expectancyR < 0
    ? { label: 'Negative',   emoji: '🔴', bg: 'bg-red-500/10',     border: 'border-red-500/30',     text: 'text-red-300',     sub: 'Expected value is negative — review setup.' }
    : expectancyR < 0.5
      ? { label: 'Marginal', emoji: '🟡', bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-300',   sub: 'Borderline. Improve R:R or confidence before taking.' }
      : expectancyR < 1
        ? { label: 'Good',     emoji: '🟢', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', sub: 'Solid positive expectancy. Good setup.' }
        : { label: 'Excellent', emoji: '💎', bg: 'bg-brand-500/10',   border: 'border-brand-500/30',   text: 'text-brand-300',   sub: 'Exceptional edge. High-conviction setup.' }

  // Badge color per WR source level
  const wrBadgeCls = wrSource === 'strategy' ? 'text-emerald-400'
    : wrSource === 'profile'  ? 'text-brand-300'
    : wrSource === 'global'   ? 'text-amber-300'
    : 'text-slate-400'

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', grade.bg, grade.border)}>

      {/* ── Header: grade + E(R) primary ─────────────────────────────── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">{grade.emoji}</span>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Trade expectancy</p>
            <p className={cn('text-sm font-bold leading-tight', grade.text)}>{grade.label}</p>
          </div>
        </div>
        <div className="text-right">
          <p className={cn('text-2xl font-mono font-bold leading-tight', grade.text)}>
            {expectancyR >= 0 ? '+' : ''}{expectancyR.toFixed(2)}R
          </p>
          <p className="text-[10px] text-slate-400 leading-tight font-mono">
            {expectancyEur >= 0 ? '+' : ''}{fmt(expectancyEur)} {ccy} / trade
          </p>
          <p className="text-[9px] text-slate-600 leading-tight mt-0.5">
            1R = {fmt(riskAmt)} {ccy} risked
          </p>
        </div>
      </div>

      {/* ── Formula breakdown ─────────────────────────────────────────── */}
      <div className="rounded-lg bg-surface-800/70 px-3 py-2.5 space-y-1.5 border border-surface-700/50">
        {/* What is "R" — brief explainer */}
        <div className="flex items-start gap-1.5 pb-1.5 border-b border-surface-700/40">
          <span className="text-amber-400 text-[10px] font-bold leading-tight mt-px">R</span>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            <span className="text-amber-400 font-semibold">1R = {fmt(riskAmt)} {ccy}</span> — your exact risk on this trade.
            {' '}R is universal: +1.64R means <em>"for every $1 you risk, you expect +$1.64 back on average"</em>
            {' '}— independent of account size or risk %.
          </p>
        </div>
        <p className="text-[9px] text-slate-600 uppercase tracking-wider font-medium pt-0.5">
          How it's calculated
        </p>
        <div className="flex items-center gap-1.5 text-[11px] font-mono flex-wrap">
          <span className="text-slate-500">E(R) =</span>
          <span className="text-emerald-400">{(winRate * 100).toFixed(0)}%</span>
          <span className="text-slate-600">× {avgWinR.toFixed(2)}R</span>
          <span className="text-slate-600">−</span>
          <span className="text-red-400">{(lossRate * 100).toFixed(0)}%</span>
          <span className="text-slate-600">× 1R</span>
          <span className="text-slate-500">=</span>
          <span className={cn('font-bold', grade.text)}>
            {expectancyR >= 0 ? '+' : ''}{expectancyR.toFixed(2)}R
          </span>
          <span className="text-slate-600">≈</span>
          <span className={cn('font-bold text-[10px]', grade.text)}>
            {expectancyEur >= 0 ? '+' : ''}{fmt(expectancyEur)} {ccy}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 pt-1">
          <div className="text-[10px]">
            <span className="text-slate-600">Win rate</span>
            <p className={cn('font-semibold', wrBadgeCls)}>
              {(winRate * 100).toFixed(0)}%
            </p>
            <p className="text-[9px] text-slate-600 truncate leading-tight mt-0.5">{winRateSourceLabel}</p>
          </div>
          <div className="text-[10px]">
            <span className="text-slate-600">Avg win (R)</span>
            <p className="text-emerald-400 font-semibold">{avgWinR.toFixed(2)}R</p>
            <p className="text-[9px] text-slate-600 leading-tight mt-0.5">
              +{fmt(totalProfit)} ÷ {fmt(riskAmt)} {ccy}
            </p>
          </div>
          <div className="text-[10px]">
            <span className="text-slate-600">Avg loss (R)</span>
            <p className="text-red-400 font-semibold">1.00R</p>
            <p className="text-[9px] text-slate-600 leading-tight mt-0.5">
              always −{fmt(riskAmt)} {ccy}
            </p>
          </div>
        </div>
      </div>

      {/* Verdict */}
      <p className={cn('text-[11px] font-medium', grade.text, 'opacity-90')}>{grade.sub}</p>

      {/* WR source notice — only shown when NOT using strategy-level stats */}
      {wrSource !== 'strategy' && (
        <p className="text-[10px] text-slate-600 border-t border-surface-700/40 pt-2 leading-relaxed">
          {wrSource === 'profile' && (
            <>📊 Profile win rate used — {activeProfile.name}: {(winRate * 100).toFixed(0)}% across {profileTrades} trades. Select a strategy with ≥{selectedStrategy?.min_trades_for_stats ?? 5} trades for strategy-specific data.</>
          )}
          {wrSource === 'global' && (
            <>🌐 Global average win rate used ({(winRate * 100).toFixed(0)}% across {globalWrStats!.profiles.filter((p) => p.has_data).length} profiles). No profile history yet — close {MIN_PROFILE_TRADES}+ trades to unlock profile WR.</>
          )}
          {wrSource === 'fallback' && (
            <>📊 Using {(DEFAULT_WIN_RATE * 100).toFixed(0)}% default — no trade history yet. Win rate becomes dynamic once you close {MIN_PROFILE_TRADES}+ trades.</>
          )}
        </p>
      )}
    </div>
  )
}


// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function NewTradePage() {
  const navigate                                   = useNavigate()
  const { activeProfile, loading: profileLoading } = useProfile()

  const [instruments, setInstruments]   = useState<Instrument[]>([])
  const [instrLoading, setInstrLoading] = useState(false)
  const [strategies, setStrategies]     = useState<Strategy[]>([])
  const [stratLoading, setStratLoading] = useState(false)
  const [strategyId, setStrategyId]     = useState<number | null>(null)

  // Global WR stats — for the 3rd-level WR fallback in ExpectancyPanel
  const [globalWrStats, setGlobalWrStats] = useState<WinRateStats | null>(null)

  // Portfolio risk — TODO Phase 2: show risk-exceeded banner on trade form
  // (state removed for now — will be re-added when the UI uses it)

  const [instrument, setInstrument] = useState<Instrument | null>(null)
  const [direction, setDirection]   = useState<'LONG' | 'SHORT'>('LONG')
  const [orderType, setOrderType]   = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [entry, setEntry]           = useState('')
  const [sl, setSl]                 = useState('')

  const [tpCount, setTpCount]           = useState<1 | 2 | 3 | 4>(1)
  const [activePreset, setActivePreset] = useState<string>('Smart Scale')
  const [tps, setTps]                   = useState<TpRow[]>([{ price: '', pct: '100' }])

  const [riskPct, setRiskPct]         = useState('')
  const [riskAmt, setRiskAmt]         = useState('')
  const [riskSyncDir, setRiskSyncDir] = useState<'pct' | 'amt'>('pct')

  // Leverage & margin — Crypto profiles only
  // lastEdit tracks which field the user touched last so the *other* field
  // is auto-derived.  'leverage' = slider/button drove last change;
  // 'margin' = user typed in the margin input.
  const [leverage, setLeverage]             = useState('1')
  const [marginInput, setMarginInput]       = useState<string>('')    // raw user margin input
  const [lastEdit, setLastEdit]             = useState<'leverage' | 'margin'>('margin')
  // Safety buffer sur la marge proposée (fees + slippage). Configurable par l'user.
  // Valeurs typiques : 10% (tight), 20% (standard), 30% (conservative)
  const [safetyBuffer, setSafetyBuffer]     = useState(0.20)

  const [timeframe, setTimeframe]   = useState('')
  const [confidence, setConfidence] = useState('')
  const [tradeTags, setTradeTags]   = useState<string[]>([])
  const [notes, setNotes]           = useState('')

  const [showSession, setShowSession] = useState(false)
  const [sessionTag, setSessionTag]   = useState<SessionLabel | ''>(detectSession)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // ── Profile type flags ────────────────────────────────────────────────────
  //   isCrypto = Crypto PROFILE → leverage slider visible, units displayed
  //   isCFD    = CFD PROFILE    → lots only, NO leverage slider ever
  const isCrypto = activeProfile?.market_type === 'Crypto'
  const isCFD    = activeProfile?.market_type === 'CFD'
  const ccy      = activeProfile?.currency ?? ''

  // ── Load instruments when profile broker changes ──────────────────────────
  useEffect(() => {
    if (!activeProfile?.broker_id) { setInstruments([]); return }
    setInstrLoading(true)
    instrumentsApi.listByBroker(activeProfile.broker_id)
      .then(setInstruments).catch(() => setInstruments([]))
      .finally(() => setInstrLoading(false))
  }, [activeProfile?.broker_id])

  // ── Load strategies when profile changes ─────────────────────────────────
  useEffect(() => {
    if (!activeProfile?.id) { setStrategies([]); return }
    setStratLoading(true)
    strategiesApi.list(activeProfile.id)
      .then(setStrategies).catch(() => setStrategies([]))
      .finally(() => setStratLoading(false))
  }, [activeProfile?.id])

  // ── Load global WR stats (for 3rd-level fallback in ExpectancyPanel) ──────
  // Fetched once on mount; refreshed if profile changes (profile id = cache key).
  // Errors are silent — panel falls back to 60% default gracefully.
  useEffect(() => {
    statsApi.winrate().then(setGlobalWrStats).catch(() => setGlobalWrStats(null))
  }, [])

  // ── Reset form fields when active profile changes ─────────────────────────
  useEffect(() => {
    setInstrument(null)
    setEntry('')
    setSl('')
    setRiskPct('')
    setRiskAmt('')
    setRiskSyncDir('pct')
    setStrategyId(null)
    setTpCount(1)
    setActivePreset('Smart Scale')
    setTps([{ price: '', pct: '100' }])
    setConfidence('')
    setTradeTags([])
    setNotes('')
    setMarginInput('')
    setLastEdit('margin')  // par défaut : marge proposée drive le levier
  }, [activeProfile?.id])

  // ── Quand l'instrument change (Crypto) : reset vers marge proposée ───────
  // On NE pré-remplit PAS avec max_leverage — le slider se calera automatiquement
  // sur proposedLeverage dès que entry + SL + risk sont renseignés.
  // On passe en mode lastEdit='margin' avec marginInput='' (= marge proposée active).
  useEffect(() => {
    if (!isCrypto) return
    setMarginInput('')
    setLastEdit('margin')
    // Leverage state = max_leverage pour la borne du slider,
    // mais l'affichage réel sera effectiveLeverage = proposedLeverage.
    setLeverage(instrument?.max_leverage ? String(instrument.max_leverage) : '1')
  }, [instrument, isCrypto])

  // ── Numerics ──────────────────────────────────────────────────────────────
  const capital     = activeProfile ? Number(activeProfile.capital_current) : null
  const profileRisk = activeProfile ? Number(activeProfile.risk_percentage_default) : null
  const entryNum    = entry ? Number(entry) : null
  const slNum       = sl    ? Number(sl)    : null
  const maxLeverage = isCrypto ? (instrument?.max_leverage ?? 100) : 1
  const leverageNum = isCrypto ? Math.max(1, Number(leverage) || 1) : 1

  // Effective risk %
  const effectiveRisk = useMemo(() => {
    if (riskSyncDir === 'amt' && riskAmt && capital) return (Number(riskAmt) / capital) * 100
    return riskPct ? Number(riskPct) : profileRisk
  }, [riskSyncDir, riskAmt, riskPct, capital, profileRisk])

  const calc = useRiskCalc({ capital, risk_pct: effectiveRisk, entry: entryNum, stop_loss: slNum })

  // ── SL distance ───────────────────────────────────────────────────────────
  const slDistancePts = useMemo(() => {
    if (entryNum == null || slNum == null) return null
    return Math.abs(entryNum - slNum)
  }, [entryNum, slNum])

  const slDistancePct = useMemo(() => {
    if (slDistancePts == null || !entryNum) return null
    return (slDistancePts / entryNum) * 100
  }, [slDistancePts, entryNum])

  // ── SL direction validation ────────────────────────────────────────────────
  //   LONG  → SL must be BELOW entry (sl < entry)
  //   SHORT → SL must be ABOVE entry (sl > entry)
  const slSideError = useMemo(() => {
    if (entryNum == null || slNum == null || slNum === 0 || entryNum === 0) return null
    if (direction === 'LONG'  && slNum >= entryNum) return 'Stop loss must be below entry for a LONG trade'
    if (direction === 'SHORT' && slNum <= entryNum) return 'Stop loss must be above entry for a SHORT trade'
    return null
  }, [direction, entryNum, slNum])

  // ── Margin & liquidation ──────────────────────────────────────────────────
  //
  // ┌─ CRYPTO (isolated futures — Binance/Bybit style) ──────────────────────┐
  // │                                                                        │
  // │  PROPOSED MARGIN formula (from risk-first approach):                  │
  // │                                                                        │
  // │    margin = 2 × risk_amount × (1 + SAFETY_BUFFER)                     │
  // │                                                                        │
  // │    - ×2    : garantit que la liq est environ 2× plus loin que le SL   │
  // │    - ×1.20 : buffer 20% pour absorber fees + slippage SL              │
  // │                                                                        │
  // │    Ex: risk=10$, entry=64465, SL=62451 (3.12%)                        │
  // │      margin = 2 × 10 × 1.20 = 24$                                     │
  // │                                                                        │
  // │  LEVERAGE DÉDUIT de la marge proposée:                                │
  // │                                                                        │
  // │    L = risk / (margin × SL_pct)                                       │
  // │                                                                        │
  // │    Preuve : PnL_si_SL_hit = margin × L × SL_pct = risk_amount         │
  // │    → L = risk / (margin × SL_pct)                                     │
  // │                                                                        │
  // │    Ex: L = 10 / (24 × 0.0312) = 10 / 0.749 ≈ 13.4 → arrondi à 13    │
  // │                                                                        │
  // │  BIDIRECTIONNEL:                                                       │
  // │    lastEdit='margin'   → leverage dérivé via la formule ci-dessus     │
  // │    lastEdit='leverage' → margin dérivée via notional / leverage        │
  // │                                                                        │
  // │  Liquidation (LONG)  = entry × (1 − 1/L + MMR)                        │
  // │  Liquidation (SHORT) = entry × (1 + 1/L − MMR)                        │
  // └────────────────────────────────────────────────────────────────────────┘
  //
  // ┌─ CFD (retail broker — IG, XM, OANDA style) ────────────────────────────┐
  // │  Le trader ne choisit pas la marge — il choisit les LOTS.             │
  // │  Le broker verrouille la marge automatiquement.                       │
  // │  Marge estimée = notional / broker_leverage                           │
  // │    notional = lot_size × entry_price                                  │
  // │  Maintenance margin = 50% de la marge (norme ESMA)                   │
  // │  Margin level = capital / marge × 100  (avertissement si < 150%)     │
  // └────────────────────────────────────────────────────────────────────────┘

  const CRYPTO_MMR = 0.005  // 0.5% — maintenance margin rate tier-1 standard
  // MARGIN_SAFETY_BUFFER est maintenant l'état `safetyBuffer` (configurable dans l'UI)

  // ── Notional value ────────────────────────────────────────────────────────
  // = lot_size × entry_price  (contract_size = 1 pour tous les instruments Phase 1)
  const notional = useMemo((): number | null => {
    if (!isCrypto || calc.lot_size == null || entryNum == null) return null
    return calc.lot_size * entryNum
  }, [isCrypto, calc.lot_size, entryNum])

  // ── Proposed margin (default quand l'utilisateur n'a rien tapé) ───────────
  //   margin = 2 × risk × (1 + SAFETY_BUFFER)
  //   → ×2 : liq ~2× au-delà du SL
  //   → ×1.20 : buffer fees/slippage
  const proposedMargin = useMemo((): number | null => {
    if (!isCrypto || calc.risk_amount == null) return null
    return calc.risk_amount * 2 * (1 + safetyBuffer)
  }, [isCrypto, calc.risk_amount, safetyBuffer])

  // ── Proposed leverage (déduit de la marge proposée) ──────────────────────
  //   L = risk / (margin × SL_pct)
  //   → formule exacte : PnL_si_SL = margin × L × SL_pct = risk
  const proposedLeverage = useMemo((): number | null => {
    if (!isCrypto || calc.risk_amount == null || proposedMargin == null) return null
    if (slDistancePct == null || slDistancePct <= 0) return null
    const slPct = slDistancePct / 100
    const raw = calc.risk_amount / (proposedMargin * slPct)
    // Arrondi à l'entier, borné entre 1 et maxLeverage
    return Math.max(1, Math.min(maxLeverage, Math.round(raw)))
  }, [isCrypto, calc.risk_amount, proposedMargin, slDistancePct, maxLeverage])

  // ── Effective margin (valeur réellement utilisée) ─────────────────────────
  // • User a tapé dans le champ margin → on utilise ça
  // • Sinon → proposedMargin
  const effectiveMargin = useMemo((): number | null => {
    if (!isCrypto) return null
    if (marginInput !== '' && Number(marginInput) > 0) return Number(marginInput)
    return proposedMargin
  }, [isCrypto, marginInput, proposedMargin])

  // ── Effective leverage ─────────────────────────────────────────────────────
  // • lastEdit='leverage' → slider/bouton → leverageNum (saisi directement)
  // • lastEdit='margin'   → dérivé: L = risk / (margin × SL_pct)
  //   Si marginInput='' (marge proposée active), on utilise proposedLeverage directement.
  //   Si l'utilisateur a tapé une marge, on recalcule via la formule.
  const effectiveLeverage = useMemo((): number => {
    if (!isCrypto) return 1

    if (lastEdit === 'margin') {
      // Cas 1 : marge proposée active (user n'a rien tapé)
      if (marginInput === '' && proposedLeverage != null) {
        return proposedLeverage
      }
      // Cas 2 : user a tapé une marge → L = risk / (margin × SL_pct)
      if (effectiveMargin != null && effectiveMargin > 0) {
        if (calc.risk_amount != null && slDistancePct != null && slDistancePct > 0) {
          const slPct = slDistancePct / 100
          const derived = calc.risk_amount / (effectiveMargin * slPct)
          return Math.max(1, Math.min(maxLeverage, Math.round(derived)))
        }
        // Fallback si SL pas encore renseigné: notional / margin
        if (notional != null) {
          const derived = notional / effectiveMargin
          return Math.max(1, Math.min(maxLeverage, Math.round(derived)))
        }
      }
    }

    // lastEdit='leverage' → valeur directe du slider
    return leverageNum
  }, [isCrypto, lastEdit, marginInput, proposedLeverage, effectiveMargin, calc.risk_amount, slDistancePct, notional, leverageNum, maxLeverage])

  // ── Displayed margin in the input field ───────────────────────────────────
  // • lastEdit='leverage' → margin dérivée via notional / leverage
  // • lastEdit='margin'   → ce que l'utilisateur a tapé (ou proposedMargin si vide)
  const derivedMarginFromLeverage = useMemo((): number | null => {
    if (!isCrypto || notional == null || effectiveLeverage <= 0) return null
    return notional / effectiveLeverage
  }, [isCrypto, notional, effectiveLeverage])

  const displayedMargin = useMemo((): number | null => {
    if (!isCrypto) return null
    if (lastEdit === 'leverage') return derivedMarginFromLeverage
    if (marginInput !== '' && Number(marginInput) > 0) return Number(marginInput)
    return proposedMargin
  }, [isCrypto, lastEdit, derivedMarginFromLeverage, marginInput, proposedMargin])

  // Estimated liquidation price (Crypto only — isolated margin formula)
  const liqPrice = useMemo((): number | null => {
    if (!isCrypto || entryNum == null || effectiveLeverage <= 1) return null
    if (direction === 'LONG')
      return entryNum * (1 - 1 / effectiveLeverage + CRYPTO_MMR)
    return entryNum * (1 + 1 / effectiveLeverage - CRYPTO_MMR)
  }, [isCrypto, entryNum, effectiveLeverage, direction])

  // Safety check: liq price must be on the other side of SL
  const liqBeforeSl = useMemo((): boolean => {
    if (!isCrypto || liqPrice == null || slNum == null) return false
    if (direction === 'LONG')  return liqPrice >= slNum   // liq ≥ SL → danger
    return liqPrice <= slNum                               // liq ≤ SL → danger
  }, [isCrypto, liqPrice, slNum, direction])

  // Margin vs. capital health indicators
  const marginVsCapital = useMemo((): 'ok' | 'high' | 'exceeds' | null => {
    if (!isCrypto || displayedMargin == null || capital == null) return null
    if (displayedMargin > capital)         return 'exceeds'
    if (displayedMargin > capital * 0.3)   return 'high'
    return 'ok'
  }, [isCrypto, displayedMargin, capital])

  // ── CFD margin ────────────────────────────────────────────────────────────
  const marginCalculated = useMemo((): number | null => {
    if (!isCFD) return null
    if (calc.lot_size == null || entryNum == null) return null
    const brokerLeverage = instrument?.max_leverage ?? 1
    const cfNotional = calc.lot_size * entryNum
    return cfNotional / brokerLeverage
  }, [isCFD, calc.lot_size, entryNum, instrument?.max_leverage])

  const cfdMaintenanceMargin = isCFD && marginCalculated != null
    ? marginCalculated * 0.5 : null
  const cfdMarginLevel = isCFD && marginCalculated != null && capital != null && marginCalculated > 0
    ? (capital / marginCalculated) * 100 : null
  const cfdMarginCallRisk = cfdMarginLevel != null && cfdMarginLevel < 150

  // marginDisplay (CFD) — for the informational block
  const marginDisplay = marginCalculated

  // ── Pill display for Crypto ───────────────────────────────────────────────
  // Show the broker-required margin (notional / effective leverage) in the pill
  const cryptoMarginRequired = useMemo((): number | null => {
    if (!isCrypto || notional == null || effectiveLeverage <= 0) return null
    return notional / effectiveLeverage
  }, [isCrypto, notional, effectiveLeverage])

  const marginPillValue = isCrypto ? cryptoMarginRequired : marginDisplay
  const marginIsHigh  = marginPillValue != null && capital != null && marginPillValue > capital * 0.5

  // ── Per-TP metrics ────────────────────────────────────────────────────────
  const tpMetrics = useMemo(() => tps.map((tp) => {
    const tpN  = tp.price ? Number(tp.price) : null
    const pct  = Number(tp.pct) || 0
    // Quantity allocated to this TP (units for Crypto, lots for CFD)
    const qty  = calc.lot_size != null ? calc.lot_size * (pct / 100) : null

    // ── Direction validation: TP must be on the profit side ──────────────
    // LONG  → TP must be ABOVE entry (tpN > entry)
    // SHORT → TP must be BELOW entry (tpN < entry)
    const tpSideOk: boolean = tpN == null || entryNum == null
      ? true   // no value yet → don't show error
      : direction === 'LONG'
        ? tpN > entryNum
        : tpN < entryNum

    // Est. profit: only positive when TP is on the correct side.
    // If TP is on wrong side the formula would still produce a positive number
    // (Math.abs) — so we gate it behind tpSideOk.
    const profit = (qty == null || tpN == null || entryNum == null || !tpSideOk) ? null
      : qty * Math.abs(tpN - entryNum)

    // R:R = |tp - entry| / |entry - sl|
    const rr = (tpN == null || slDistancePts == null || slDistancePts === 0 || entryNum == null || !tpSideOk) ? null
      : Math.abs(tpN - entryNum) / slDistancePts

    return { profit, rr, qty, tpSideOk }
  }), [calc, tps, entryNum, slDistancePts, direction])

  // Any TP on the wrong side → totalProfit is null (block expectancy + submit)
  const tpSideErrors = tpMetrics.some((m) => !m.tpSideOk)

  const totalProfit = useMemo(() => {
    if (tpMetrics.length === 0 || tpMetrics.some((t) => t.profit == null)) return null
    if (tpSideErrors) return null
    return tpMetrics.reduce((s, t) => s + (t.profit ?? 0), 0)
  }, [tpMetrics, tpSideErrors])

  // ── TP helpers ────────────────────────────────────────────────────────────
  const applyPreset = useCallback((label: string, count: number) => {
    const preset = TP_PRESETS.find((p) => p.label === label) ?? TP_PRESETS[0]
    const pcts   = preset.pcts(count)
    setTps((prev) => Array.from({ length: count }, (_, i) => ({ price: prev[i]?.price ?? '', pct: String(pcts[i]) })))
    setActivePreset(label)
  }, [])

  const handleTpCountChange = (n: 1 | 2 | 3 | 4) => { setTpCount(n); applyPreset(activePreset, n) }
  const setTpPrice = (i: number, v: string) => setTps((r) => r.map((x, j) => j === i ? { ...x, price: v } : x))
  const setTpPct   = (i: number, v: string) => setTps((r) => r.map((x, j) => j === i ? { ...x, pct: v } : x))

  const totalPct = tps.reduce((s, t) => s + (Number(t.pct) || 0), 0)
  const pctValid = totalPct === 100

  const toggleTag = (tag: string) =>
    setTradeTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeProfile || !instrument || slSideError) return
    setError(null); setSubmitting(true)
    try {
      await tradesApi.open({
        profile_id:         activeProfile.id,
        instrument_id:      instrument.id,
        pair:               instrument.symbol,
        direction:          direction.toLowerCase() as 'long' | 'short',
        order_type:         orderType,
        asset_class:        instrument.asset_class,
        analyzed_timeframe: timeframe || null,
        entry_price:        entry,
        entry_date:         null,       // backend defaults to utcnow()
        stop_loss:          sl,
        positions:          tps.map((t, i) => ({
          position_number:    i + 1,
          take_profit_price:  t.price,
          lot_percentage:     Number(t.pct),
        })),
        risk_pct_override:  riskPct || null,
        strategy_id:        strategyId ?? null,
        session_tag:        sessionTag || null,
        notes:              notes || null,
        confidence_score:   confidence ? Number(confidence) : null,
      })
      navigate('/trades')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (profileLoading) return (
    <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
      <Loader2 size={16} className="animate-spin" /> Loading profile…
    </div>
  )
  if (!activeProfile) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <AlertTriangle size={24} className="text-amber-400 mb-3" />
      <p className="text-sm text-slate-300 font-medium mb-1">No active profile</p>
      <p className="text-xs text-slate-500">Select a profile in the topbar.</p>
    </div>
  )
  if (!activeProfile.broker_id) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <AlertTriangle size={24} className="text-amber-400 mb-3" />
      <p className="text-sm text-slate-300 font-medium mb-1">Profile has no broker</p>
      <p className="text-xs text-slate-500">
        Go to <strong>Settings → Profiles</strong> and assign a broker to <strong>{activeProfile.name}</strong>.
      </p>
    </div>
  )

  const autoSession = detectSession()
  const isFormValid = !!instrument && pctValid && !slSideError && !tpSideErrors

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        icon="📈"
        title="New trade"
        subtitle={`${activeProfile.name} · ${activeProfile.market_type} · ${Number(activeProfile.capital_current).toLocaleString()} ${ccy}`}
      />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-5 mt-2">

        {error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <AlertTriangle size={14} className="shrink-0" />{error}
          </div>
        )}

        {/* ════════════════════════ 1. INSTRUMENT ════════════════════════ */}
        <Section icon="🔍" title="Instrument">
          <Field label="Search & select *">
            {instrLoading
              ? <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500"><Loader2 size={13} className="animate-spin" /> Loading instruments…</div>
              : <InstrumentPicker instruments={instruments} value={instrument} onChange={setInstrument} />
            }
          </Field>
          {instrument && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>Base: <span className="text-slate-300 font-medium">{instrument.base_currency}</span></span>
              <span>Quote: <span className="text-slate-300 font-medium">{instrument.quote_currency}</span></span>
              {instrument.pip_size && <span>Pip: <span className="text-slate-300 font-medium">{instrument.pip_size}</span></span>}
              {instrument.min_lot && <span>Min lot: <span className="text-slate-300 font-medium">{instrument.min_lot}</span></span>}
              {isCrypto && instrument.max_leverage && (
                <span>Max leverage: <span className="text-brand-400 font-bold">×{instrument.max_leverage}</span></span>
              )}
            </div>
          )}
        </Section>

        {/* ════════════════ 2. STRATEGY & SETUP INTENT ════════════════ */}
        {/* Placed before direction/prices so the trader commits to their method  */}
        {/* before touching numbers. Strategy + confidence will gate risk max      */}
        {/* in future phases (market analysis will also feed into this).           */}
        <Section icon="🧠" title="Strategy & setup intent">
          <div className="grid grid-cols-2 gap-3">
            <Field label={<>Strategy <Tip text="Your trading method for this trade. Win rate stats accumulate per strategy after 5+ trades. Different from setup tags." /></>}>
              <StrategySelect
                strategies={strategies} loading={stratLoading}
                value={strategyId} onChange={setStrategyId}
                profileId={activeProfile.id}
                onCreated={(s) => setStrategies((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)))}
              />
            </Field>
            <Field label="Timeframe analysed">
              <div className="grid grid-cols-4 gap-1">
                {['1m','5m','15m','30m','1H','4H','1D','1W'].map((tf) => (
                  <button key={tf} type="button" onClick={() => setTimeframe((p) => p === tf ? '' : tf)}
                    className={cn('py-2 rounded-lg border text-[11px] font-mono font-medium transition-all',
                      timeframe === tf
                        ? 'bg-brand-600/20 border-brand-500/50 text-brand-300'
                        : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200')}>
                    {tf}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* Confidence score — shown here so it's locked in before sizing */}
          <div>
            <span className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-2">
              Confidence score
              <Tip text="1 = very low conviction · 10 = max. Will gate risk % in a future phase." />
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" onClick={() => setConfidence((p) => p === String(n) ? '' : String(n))}
                  className={cn('w-9 h-9 rounded-lg border text-xs font-bold transition-all',
                    confidence === String(n)
                      ? n <= 3
                        ? 'bg-red-500/20 border-red-500/40 text-red-300'
                        : n <= 6
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                      : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-200')}>
                  {n}
                </button>
              ))}
              {confidence && (
                <span className="text-[10px] text-slate-500 ml-1">
                  {Number(confidence) <= 3 ? '😬 Low' : Number(confidence) <= 6 ? '🙂 Medium' : '🔥 High conviction'}
                </span>
              )}
            </div>
          </div>
        </Section>

        {/* ════════════════ 3. DIRECTION & ORDER TYPE ════════════════════ */}
        <Section icon="🧭" title="Direction & order type">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction *">
              <div className="grid grid-cols-2 gap-2">
                {(['LONG', 'SHORT'] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setDirection(d)}
                    className={cn(
                      'flex items-center justify-center gap-2 py-3 rounded-lg border text-sm font-semibold transition-all',
                      direction === d
                        ? d === 'LONG'
                          ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 shadow-sm'
                          : 'bg-red-500/20 border-red-500/40 text-red-300 shadow-sm'
                        : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200',
                    )}>
                    {d === 'LONG' ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {d}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Order type *">
              <div className="grid grid-cols-2 gap-2">
                {(['MARKET', 'LIMIT'] as const).map((o) => (
                  <button key={o} type="button" onClick={() => setOrderType(o)}
                    className={cn(
                      'py-3 rounded-lg border text-sm font-medium transition-all',
                      orderType === o
                        ? 'bg-brand-600/20 border-brand-600/50 text-brand-300 shadow-sm'
                        : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200',
                    )}>
                    {o}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        </Section>

        {/* ══════════════ 4. PRICES, RISK & POSITION SIZING ══════════════ */}
        <Section icon="💰" title="Prices, risk & position sizing">

          {/* Entry / SL */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Entry price *">
              <PriceInput required value={entry} onChange={setEntry} ccy={ccy} />
            </Field>
            <Field
              label={<>Stop loss * <Tip text={direction === 'LONG' ? 'Must be BELOW entry for a LONG trade.' : 'Must be ABOVE entry for a SHORT trade.'} /></>}
              error={slSideError}
              hint={!slSideError && slDistancePts != null
                ? `${fmt(slDistancePts, 4)} pts — ${fmt(slDistancePct, 2)}% from entry`
                : undefined}
            >
              <PriceInput required value={sl} onChange={setSl} ccy={ccy}
                className={slSideError ? 'border-amber-500/50' : sl && !slSideError ? 'border-red-500/30' : ''} />
            </Field>
          </div>

          {/* Risk % ↔ Max loss (bidirectional) */}
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={<>Risk % <Tip text="% of capital you accept to lose. Changes this recalculates max loss." /></>}
              hint={`Profile default: ${profileRisk ?? '—'}%`}>
              <div className="flex">
                <input type="number" step="0.01" min="0.01" max="100"
                  value={riskPct}
                  onChange={(e) => {
                    setRiskSyncDir('pct'); setRiskPct(e.target.value)
                    if (capital && e.target.value) setRiskAmt(String((capital * Number(e.target.value) / 100).toFixed(2)))
                  }}
                  placeholder={profileRisk ? String(profileRisk) : '2.0'}
                  className={cn(inputCls, 'rounded-r-none border-r-0')} />
                <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500 font-medium">%</span>
              </div>
            </Field>
            <Field
              label={<>Max loss <Tip text="Max monetary loss. Changing this recalculates risk % automatically." /></>}
              hint={!riskAmt && calc.valid && calc.risk_amount != null ? `Auto: ${fmt(calc.risk_amount)} ${ccy}` : undefined}>
              <PriceInput
                value={riskAmt}
                onChange={(v) => {
                  setRiskSyncDir('amt'); setRiskAmt(v)
                  if (capital && v) setRiskPct(String(((Number(v) / capital) * 100).toFixed(4)))
                }}
                ccy={ccy} className="border-red-500/20"
                placeholder={calc.risk_amount != null ? fmt(calc.risk_amount, 2).replace(/,/g, '') : '—'} />
            </Field>
          </div>

          {/* ── Leverage + Margin — CRYPTO profiles ─────────────────────────── */}
          {isCrypto && (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={<>Leverage <Tip text={`Max: ×${maxLeverage}. ×1 = spot (no leverage). Changing leverage auto-recalculates margin. Changing margin auto-derives leverage.`} /></>}
                hint={`Instrument max: ×${maxLeverage}`}>
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="text-brand-300 text-sm font-mono font-bold w-12 shrink-0 text-right">×{effectiveLeverage}</span>
                    <input type="range" min="1" max={maxLeverage} step="1" value={effectiveLeverage}
                      onChange={(e) => {
                        setLeverage(e.target.value)
                        setLastEdit('leverage')
                        // clear margin input so derivation runs from leverage
                        setMarginInput('')
                      }}
                      className="flex-1 accent-brand-500 cursor-pointer" />
                    <span className="text-[10px] text-slate-600 w-8 shrink-0">×{maxLeverage}</span>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {[1, 2, 5, 10, 20, 50, 100].filter((v) => v <= maxLeverage).map((v) => (
                      <button key={v} type="button"
                        onClick={() => {
                          setLeverage(String(v))
                          setLastEdit('leverage')
                          setMarginInput('')
                        }}
                        className={cn('px-2 py-0.5 rounded text-[10px] font-mono border transition-all',
                          effectiveLeverage === v
                            ? 'bg-brand-600/20 border-brand-500/50 text-brand-300'
                            : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300')}>
                        ×{v}
                      </button>
                    ))}
                  </div>
                </div>
              </Field>
              <Field
                label={<>Margin — collateral ({ccy}) <Tip text={`Your margin = collateral you deposit to open the trade.\n\nThis is YOUR choice — you just need to deposit enough to cover the broker's minimum requirement (Margin Required = notional ÷ leverage).\n\nProposed formula:\nmargin = 2 × risk × (1 + buffer)\nbuffer = ${(safetyBuffer * 100).toFixed(0)}% (covers fees + slippage)\n\nDerived leverage:\nL = risk / (margin × SL%)\n→ if SL is hit, you lose exactly risk_amount\n\nEdit margin → leverage recalculated.\nEdit leverage → margin recalculated.`} /></>}
                hint={(() => {
                  if (displayedMargin == null || capital == null) return undefined
                  const pct = (displayedMargin / capital) * 100
                  if (marginVsCapital === 'exceeds') return `${fmt(pct, 1)}% of capital ⚠ exceeds capital`
                  if (marginVsCapital === 'high')    return `${fmt(pct, 1)}% of capital — consider lower margin`
                  return `${fmt(pct, 1)}% of capital`
                })()}
                hintClassName={
                  marginVsCapital === 'exceeds' ? 'text-red-400'
                  : marginVsCapital === 'high'  ? 'text-amber-400'
                  : 'text-slate-500'
                }>
                <PriceInput
                  value={marginInput !== ''
                    ? marginInput
                    : (displayedMargin != null ? String(displayedMargin.toFixed(2)) : '')}
                  onChange={(v) => {
                    setMarginInput(v)
                    setLastEdit('margin')
                    // Dérive le levier via L = risk / (margin × SL_pct) si SL connu
                    if (v && Number(v) > 0) {
                      if (calc.risk_amount != null && slDistancePct != null && slDistancePct > 0) {
                        const slPct = slDistancePct / 100
                        const derived = Math.max(1, Math.min(maxLeverage, Math.round(calc.risk_amount / (Number(v) * slPct))))
                        setLeverage(String(derived))
                      } else if (notional != null) {
                        const derived = Math.max(1, Math.min(maxLeverage, Math.round(notional / Number(v))))
                        setLeverage(String(derived))
                      }
                    }
                  }}
                  ccy={ccy}
                  className={
                    marginVsCapital === 'exceeds' ? 'border-red-500/50'
                    : marginVsCapital === 'high'  ? 'border-amber-500/40'
                    : ''
                  }
                  placeholder={
                    proposedMargin != null
                      ? fmt(proposedMargin, 2).replace(/,/g, '')
                      : '—'
                  }
                />
                {/* Formule + sélecteur de buffer — visible quand l'user n'a pas touché le champ */}
                {marginInput === '' && proposedMargin != null && calc.risk_amount != null && (
                  <div className="mt-1.5 space-y-1">
                    <p className="text-[10px] text-slate-500 font-mono">
                      2 × {fmt(calc.risk_amount, 2)} × {(1 + safetyBuffer).toFixed(2)} ={' '}
                      <span className="text-brand-400">{fmt(proposedMargin, 2)} {ccy}</span>
                      {proposedLeverage != null && slDistancePct != null && (
                        <span className="text-slate-600 ml-1">→ ×{proposedLeverage}</span>
                      )}
                    </p>
                    {/* Buffer configurable — fees/slippage cushion */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] text-slate-600 uppercase tracking-wider">Buffer fees/slippage :</span>
                      {([0.10, 0.20, 0.30, 0.40] as const).map((b) => (
                        <button key={b} type="button"
                          onClick={() => setSafetyBuffer(b)}
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all',
                            safetyBuffer === b
                              ? 'bg-brand-600/20 border-brand-500/50 text-brand-300'
                              : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300',
                          )}>
                          +{(b * 100).toFixed(0)}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {/* Warning: margin > capital */}
                {marginVsCapital === 'exceeds' && displayedMargin != null && capital != null && (
                  <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
                    <AlertTriangle size={9} className="shrink-0" />
                    Margin {fmt(displayedMargin, 2)} {ccy} &gt; capital — increase leverage or reduce risk %
                  </p>
                )}
                {/* Estimated liquidation price */}
                {liqPrice != null && (
                  <p className={cn(
                    'text-[10px] font-mono mt-1 flex items-center gap-1',
                    liqBeforeSl ? 'text-red-400' : 'text-slate-500',
                  )}>
                    {liqBeforeSl
                      ? <AlertTriangle size={9} className="shrink-0" />
                      : <span className="text-slate-600">⚡</span>}
                    Liq. est. {fmt(liqPrice, 4)} {ccy}
                    {liqBeforeSl && <span className="text-red-400/80"> — liq before SL! increase leverage (reduce margin)</span>}
                  </p>
                )}
              </Field>
            </div>
          )}

          {/* ── Margin info — CFD profiles ─────────────────────────────────────────
               In CFD the trader only declares LOTS — the broker locks margin automatically.
               This block is purely informational: it shows how much margin the broker
               will reserve and what safety headroom you have. No user input needed.       */}
          {isCFD && calc.valid && marginCalculated != null && (
            <div className="rounded-lg border border-surface-600 bg-surface-700/40 px-4 py-3 space-y-2">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium flex items-center gap-1">
                📋 Broker margin estimate
                <Tip text="For CFD you only enter lots — the broker locks margin automatically. This is an estimate based on instrument leverage. Required margin = (lots × price) ÷ leverage." />
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-600 uppercase tracking-wider">Est. margin locked</span>
                  <span className="text-xs font-mono font-bold text-slate-200 mt-0.5">
                    {fmt(marginDisplay)} {ccy}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {instrument?.max_leverage ? `÷ ×${instrument.max_leverage} leverage` : '—'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-600 uppercase tracking-wider">Maintenance</span>
                  <span className="text-xs font-mono font-bold text-amber-300 mt-0.5">
                    {cfdMaintenanceMargin != null ? `${fmt(cfdMaintenanceMargin)} ${ccy}` : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">50% of required</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-600 uppercase tracking-wider">Capital / margin</span>
                  <span className={cn('text-xs font-mono font-bold mt-0.5',
                    cfdMarginLevel == null ? 'text-slate-500'
                    : cfdMarginCallRisk ? 'text-red-400'
                    : cfdMarginLevel < 300 ? 'text-amber-300'
                    : 'text-emerald-400')}>
                    {cfdMarginLevel != null ? `${fmt(cfdMarginLevel, 0)}%` : '—'}
                  </span>
                  <span className="text-[10px] text-slate-500">buffer ratio</span>
                </div>
              </div>
              {/* Low buffer warning — informational, not blocking */}
              {cfdMarginCallRisk && (
                <p className="text-[10px] text-amber-400 flex items-center gap-1 pt-1 border-t border-surface-600/50">
                  <AlertTriangle size={9} className="shrink-0" />
                  Low capital/margin buffer ({fmt(cfdMarginLevel, 0)}%). If other positions are also open, consider reducing lot size.
                </p>
              )}
            </div>
          )}

          {/* Live calc pills */}
          {calc.valid && (
            <div className={cn('grid gap-2', isCrypto ? 'grid-cols-3' : 'grid-cols-2')}>
              <CalcPill label="Max loss" value={`-${fmt(calc.risk_amount)} ${ccy}`} sub={`${fmt(effectiveRisk, 2)}% of capital`} color="red" />
              {/* CFD: lot size is the actionable value → blue. Crypto: position size is informational → default. */}
              <CalcPill
                label={isCFD ? 'Lot size (total)' : 'Position size'}
                value={calc.lot_size != null ? fmt(calc.lot_size, isCFD ? 2 : 4) : '—'}
                sub={isCFD ? 'lots' : 'units'}
                color={isCFD ? 'blue' : 'default'}
              />
              {/* Crypto: margin REQUIRED by the broker = notional / leverage. This is the minimum you must deposit. */}
              {isCrypto && marginPillValue != null && (
                <CalcPill
                  label="Margin required (broker)"
                  value={`${fmt(marginPillValue)} ${ccy}`}
                  sub={`notional ÷ ×${effectiveLeverage}`}
                  color={marginIsHigh ? 'amber' : 'blue'}
                />
              )}
            </div>
          )}

          {isCrypto && marginIsHigh && marginPillValue != null && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
              <AlertTriangle size={13} className="shrink-0" />
              Margin <span className="font-mono font-bold mx-1">{fmt(marginPillValue)} {ccy}</span> exceeds 50% of capital — consider reducing leverage.
            </div>
          )}
        </Section>

        {/* ═══════════════════════ 5. TAKE PROFITS ═══════════════════════ */}
        <Section icon="🎯" title="Take profits">

          {/* Number of TPs */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-500 shrink-0">Number of TPs:</span>
            <div className="flex gap-1.5">
              {([1, 2, 3, 4] as const).map((n) => (
                <button key={n} type="button" onClick={() => handleTpCountChange(n)}
                  className={cn('w-9 h-9 rounded-lg border text-sm font-bold transition-all',
                    tpCount === n
                      ? 'bg-brand-600/20 border-brand-500/50 text-brand-300 shadow-sm'
                      : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200')}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Preset scenarios */}
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wider font-medium mb-2">Distribution preset</p>
            <div className="flex flex-wrap gap-1.5">
              {TP_PRESETS.map((p) => {
                const pcts = p.pcts(tpCount)
                return (
                  <button key={p.label} type="button" onClick={() => applyPreset(p.label, tpCount)}
                    className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all',
                      activePreset === p.label
                        ? 'bg-brand-600/20 border-brand-500/50 text-brand-300'
                        : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200')}>
                    <span>{p.emoji}</span>
                    <span>{p.label}</span>
                    <span className={cn('font-mono text-[9px]', activePreset === p.label ? 'text-brand-400/70' : 'text-slate-600')}>
                      [{pcts.join('/')}%]
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* TP rows */}
          <div className="space-y-2">
            {/* Column headers */}
            <div className="grid gap-2 text-[9px] text-slate-600 uppercase tracking-wider font-medium"
              style={{ gridTemplateColumns: '2.5rem 1fr 5rem 1.5rem 6rem 5rem 8rem' }}>
              <span />
              <span>Price ({ccy})</span>
              <span>Split %</span>
              <span />
              <span>{isCFD ? 'Lots' : 'Units'}</span>
              <span className="text-center">R:R</span>
              <span className="text-right">Est. profit</span>
            </div>

            {tps.map((tp, i) => {
              const m     = tpMetrics[i]
              const rrCls = m?.rr == null ? 'text-slate-600'
                : m.rr >= 3 ? 'text-emerald-400'
                : m.rr >= 2 ? 'text-emerald-500/80'
                : m.rr >= 1 ? 'text-amber-400'
                :              'text-red-400'

              // TP side error: value entered but on wrong side of entry
              const tpNum = tp.price ? Number(tp.price) : null
              const showTpSideErr = tpNum != null && entryNum != null && !m.tpSideOk

              return (
                <div key={i} className="space-y-0.5">
                  <div className="grid items-center gap-2"
                    style={{ gridTemplateColumns: '2.5rem 1fr 5rem 1.5rem 6rem 5rem 8rem' }}>
                    <span className="text-[11px] text-slate-400 font-bold">TP{i + 1}</span>
                    <input required type="number" step="any" min="0" value={tp.price}
                      onChange={(e) => setTpPrice(i, e.target.value)} placeholder="Price"
                      className={cn(
                        inputCls,
                        showTpSideErr
                          ? 'border-red-500/60 bg-red-500/5'
                          : tp.price && m?.rr != null && m.rr >= 2 ? 'border-emerald-500/30' : ''
                      )} />
                    <input required type="number" step="1" min="1" max="100"
                      value={tp.pct} onChange={(e) => setTpPct(i, e.target.value)}
                      placeholder="%" className={inputCls} />
                    <span className="text-[10px] text-slate-600 text-center">%</span>
                    {/* Quantity per TP: units (Crypto) or lots (CFD) */}
                    <span className="text-[11px] font-mono text-slate-400 truncate">
                      {m.qty != null ? fmt(m.qty, isCFD ? 2 : 4) : '—'}
                    </span>
                    <span className={cn('text-xs font-mono font-bold text-center', rrCls)}>
                      {m?.rr != null ? `${m.rr.toFixed(2)}R` : '—'}
                    </span>
                    <span className={cn('text-xs font-mono font-bold text-right', m?.profit != null ? 'text-emerald-400' : 'text-slate-600')}>
                      {m?.profit != null ? `+${fmt(m.profit)} ${ccy}` : '—'}
                    </span>
                  </div>
                  {/* TP direction error */}
                  {showTpSideErr && (
                    <p className="text-[10px] text-red-400 flex items-center gap-1 pl-9">
                      <AlertTriangle size={10} />
                      TP{i + 1} must be {direction === 'LONG' ? 'above' : 'below'} entry ({entry}) for a {direction} trade
                    </p>
                  )}
                </div>
              )
            })}

            {/* Split total */}
            <div className={cn('flex items-center gap-1.5 text-[10px] font-semibold',
              pctValid ? 'text-emerald-400' : totalPct > 0 ? 'text-amber-400' : 'text-slate-600')}>
              <span>Total split: {totalPct}%</span>
              {!pctValid && totalPct > 0 && <span className="text-amber-500/70">(must equal 100%)</span>}
              {pctValid && <span>✓</span>}
            </div>

            {/* Total expected profit banner */}
            {totalProfit != null && calc.valid && pctValid && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 mt-1">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🏆</span>
                  <div>
                    <p className="text-[10px] text-emerald-500/70 uppercase tracking-wider font-medium">Total expected profit</p>
                    <p className="text-emerald-300 font-mono font-bold text-base leading-tight">+{fmt(totalProfit)} {ccy}</p>
                  </div>
                </div>
                {calc.risk_amount != null && calc.risk_amount > 0 && (
                  <div className="text-right">
                    <p className="text-[10px] text-emerald-500/70 uppercase tracking-wider font-medium">Total R:R</p>
                    <p className="text-emerald-300 font-mono font-bold text-base leading-tight">
                      {fmt(totalProfit / calc.risk_amount, 2)}R
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* ══════════════ 6. SETUP TAGS, NOTES & SESSION ═════════════════ */}
        {/* ExpectancyPanel sits here — between TP section and setup tags    */}
        <ExpectancyPanel
          calc={calc}
          totalProfit={totalProfit}
          pctValid={pctValid}
          selectedStrategy={strategies.find((s) => s.id === strategyId) ?? null}
          activeProfile={activeProfile}
          globalWrStats={globalWrStats}
          ccy={ccy}
        />

        <Section icon="📝" title="Setup tags, notes & session">

          {/* Setup tags — distinct from strategy! */}
          <div>
            <span className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-1">
              Setup tags
              <Tip text="Chart patterns & confluences observed. Multiple tags allowed. These are the 'what you saw', strategy is the 'how you trade it'." />
            </span>
            <p className="text-[10px] text-slate-600 mb-2">Technical confluences visible on the chart</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_TAGS.map((tag) => (
                <button key={tag} type="button" onClick={() => toggleTag(tag)}
                  className={cn('px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all',
                    tradeTags.includes(tag)
                      ? 'bg-brand-600/20 border-brand-500/50 text-brand-300'
                      : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200')}>
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <Field label="Notes (optional)">
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Setup rationale, confluences, key levels, market context…"
              rows={3} className={cn(inputCls, 'resize-none')} />
          </Field>

          {/* Trading session — collapsed by default */}
          <div>
            <button type="button" onClick={() => setShowSession((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
              {showSession ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              <Clock size={12} />
              <span>Trading session</span>
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-surface-700 border border-surface-600 text-brand-400 font-medium">
                {sessionTag || autoSession}
              </span>
            </button>

            {showSession && (
              <div className="mt-3 space-y-2">
                {/* Local time hint — tells the trader which timezone drives detection */}
                <p className="text-[10px] text-slate-600">
                  Auto-detected · {localTimeStr()} {tzLabel()} →{' '}
                  <span className="text-brand-400 font-semibold">{autoSession}</span>
                  <span className="text-slate-700 ml-1">(UTC {new Date().getUTCHours()}:00)</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {SESSIONS.map((s) => (
                    <button key={s.label} type="button"
                      onClick={() => setSessionTag((p) => p === s.label ? '' : s.label)}
                      className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all',
                        sessionTag === s.label
                          ? 'bg-brand-600/25 border-brand-500/50 text-brand-300'
                          : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200')}>
                      <span>{s.emoji}</span>
                      <span>{s.label}</span>
                      <span className="text-[9px] text-slate-600">{s.hours}</span>
                      {s.label === autoSession && <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Form actions */}
        <div className="flex items-center justify-between pt-2 pb-4 border-t border-surface-700">
          <p className="text-[10px] text-slate-600">
            {!instrument && '⚠ Select an instrument to start'}
            {instrument && slSideError && <span className="text-amber-400">{slSideError}</span>}
            {instrument && !slSideError && !calc.valid && '· Fill entry & SL to size position'}
            {instrument && !slSideError && calc.valid && !pctValid && '· TP split must total 100%'}
            {isFormValid && calc.valid && <span className="text-emerald-500/70">✓ Ready to submit</span>}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/trades')} className="atd-btn-ghost">Cancel</button>
            <button type="submit" disabled={submitting || !isFormValid} className="atd-btn-primary disabled:opacity-40">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <TrendingUp size={14} />}
              Open trade
            </button>
          </div>
        </div>

      </form>
    </div>
  )
}
