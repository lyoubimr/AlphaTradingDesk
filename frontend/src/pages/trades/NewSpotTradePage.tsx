// ── /trades/new-spot — v2 ─────────────────────────────────────────────────
// Spot trade entry form — mirrors NewTradePage (contracts) adapted for spot:
//   • Auto-fetch market price on instrument select
//   • MultiStrategySelect (global + profile, inline create)
//   • Confidence 1–10 button grid (same as contracts)
//   • Strategy + confidence → potential win rate panel
//   • Trailing stop toggle — 🚀 Let it ride (last TP becomes trailing)
//   • Portfolio-aware qty (available capital hint + allocation %)
//   • Entry screenshots (before) + exit preview (after)
//   • Analysis section: timeframe, chart tags, notes

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  Loader2, AlertTriangle, ChevronDown, Search, X, Plus, Star, ShieldAlert,
  ImagePlus, Trash2, Info, Zap,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { investmentApi, strategiesApi, statsApi, automationApi, spotVolatilityApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { Instrument, Strategy, WinRateStats, PortfolioOut, SpotWatchlistPairOut } from '../../types/api'

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
  label: React.ReactNode; hint?: string; hintClassName?: string; error?: string | null; children: React.ReactNode
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

// ─────────────────────────────────────────────────────────────────────────────
// InstrumentPicker (spot — no "create" action, pre-synced from Kraken)
// ─────────────────────────────────────────────────────────────────────────────

const SPOT_FAVORITES_KEY = 'atd_spot_instrument_favorites'

function useSpotFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(SPOT_FAVORITES_KEY)
      return new Set(raw ? (JSON.parse(raw) as string[]) : [])
    } catch { return new Set() }
  })
  const toggle = useCallback((symbol: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(symbol)) { next.delete(symbol) } else { next.add(symbol) }
      try { localStorage.setItem(SPOT_FAVORITES_KEY, JSON.stringify([...next])) } catch { /* quota */ }
      return next
    })
  }, [])
  return { favorites, toggle }
}

function SpotInstrumentPicker({
  instruments, value, onChange,
}: {
  instruments: Instrument[]
  value: Instrument | null
  onChange: (i: Instrument | null) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const ref               = useRef<HTMLDivElement>(null)
  const { favorites, toggle } = useSpotFavorites()

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const { favList, otherList } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = q
      ? instruments.filter((i) =>
          i.symbol.toLowerCase().includes(q) ||
          i.display_name.toLowerCase().includes(q)
        )
      : instruments
    if (q) return { favList: [] as Instrument[], otherList: pool.slice(0, 50) }
    const favL   = pool.filter((i) => favorites.has(i.symbol))
    const otherL = pool.filter((i) => !favorites.has(i.symbol)).slice(0, 50 - favL.length)
    return { favList: favL, otherList: otherL }
  }, [instruments, query, favorites])

  const renderRow = (i: Instrument) => {
    const isFav = favorites.has(i.symbol)
    const base = i.base_currency ?? i.display_name.split('/')[0] ?? ''
    return (
      <div key={i.id} className="flex items-center group hover:bg-surface-700 transition-colors">
        <button type="button"
          onClick={() => { onChange(i); setOpen(false); setQuery('') }}
          className="flex-1 flex items-center gap-2.5 px-3 py-2.5 text-left">
          <span className="shrink-0 w-7 h-7 rounded-full bg-brand-600/20 border border-brand-500/30 flex items-center justify-center">
            <span className="text-[9px] font-bold text-brand-300">{base.slice(0, 3)}</span>
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-semibold text-slate-200 truncate">{i.display_name}</span>
            <span className="block text-[10px] text-slate-500">{i.symbol}</span>
          </span>
          {i.min_lot && (
            <span className="text-[9px] text-slate-600 shrink-0">min {i.min_lot}</span>
          )}
        </button>
        <button type="button"
          onClick={(e) => toggle(i.symbol, e)}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          className="px-3 py-2.5 shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
          <Star size={12} className={isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600 hover:text-amber-400'} />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cn(inputCls, 'flex items-center justify-between gap-2 cursor-pointer text-left', !value && 'text-slate-600')}>
        {value ? (
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="shrink-0 w-6 h-6 rounded-full bg-brand-600/20 border border-brand-500/30 flex items-center justify-center">
              <span className="text-[8px] font-bold text-brand-300">
                {(value.base_currency ?? value.display_name.split('/')[0] ?? '').slice(0, 3)}
              </span>
            </span>
            <span className="font-medium text-slate-100 truncate">{value.display_name}</span>
            <span className="text-slate-500 text-xs shrink-0">{value.symbol}</span>
            {favorites.has(value.symbol) && <Star size={10} className="shrink-0 fill-amber-400 text-amber-400" />}
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
                placeholder="BTC, ETH, SOL, XRP…"
                className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 focus:outline-none" />
              {query && (
                <button type="button" onClick={() => setQuery('')}>
                  <X size={12} className="text-slate-500 hover:text-slate-300" />
                </button>
              )}
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {instruments.length === 0 && (
              <div className="px-4 py-6 text-center">
                <p className="text-xs text-slate-500">No spot instruments synced yet.</p>
                <p className="text-[10px] text-slate-600 mt-1">
                  Go to Settings → Investment → Sync Kraken pairs
                </p>
              </div>
            )}
            {favList.length === 0 && otherList.length === 0 && instruments.length > 0 && (
              <p className="px-4 py-3 text-xs text-slate-500">No results for "{query}"</p>
            )}
            {favList.length > 0 && (
              <>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-500/70 flex items-center gap-1">
                  <Star size={9} className="fill-amber-500/70 text-amber-500/70" /> Favorites
                </p>
                {favList.map(renderRow)}
                {otherList.length > 0 && <div className="mx-3 my-1 border-t border-surface-700" />}
              </>
            )}
            {otherList.map(renderRow)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// MultiStrategy dropdown — global + profile sections + inline create
// ─────────────────────────────────────────────────────────────────────────────

function MultiStrategySelect({
  strategies, loading, value, onChange, profileId, onCreated,
}: {
  strategies: Strategy[]
  loading: boolean
  value: number[]
  onChange: (ids: number[]) => void
  profileId: number
  onCreated: (s: Strategy) => void
}) {
  const [open, setOpen]         = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [saving, setSaving]     = useState(false)
  const ref                     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCreating(false) }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const toggleId = (id: number) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const s = await strategiesApi.create(profileId, { name: newName.trim() })
      onCreated(s)
      onChange([...value, s.id])
      setNewName(''); setCreating(false)
    } finally { setSaving(false) }
  }

  const globalList  = strategies.filter((s) => s.profile_id === null)
  const profileList = strategies.filter((s) => s.profile_id !== null)
  const selectedNames = value.map((id) => strategies.find((s) => s.id === id)).filter(Boolean) as Strategy[]

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cn(inputCls, 'flex items-center justify-between gap-2 cursor-pointer text-left min-h-[2.5rem]')}>
        <span className="flex-1 flex flex-wrap gap-1 min-w-0">
          {loading
            ? <span className="text-slate-500 text-sm">Loading…</span>
            : selectedNames.length === 0
              ? <span className="text-slate-500 text-sm">None (optional)</span>
              : selectedNames.map((s) => (
                  <span key={s.id}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-brand-600/20 border border-brand-500/40 text-[11px] font-medium text-brand-300">
                    {s.emoji && <span>{s.emoji}</span>}
                    {s.name}
                    <button type="button" onMouseDown={(e) => { e.stopPropagation(); toggleId(s.id) }}
                      className="ml-0.5 text-brand-400/70 hover:text-brand-200"><X size={9} /></button>
                  </span>
                ))
          }
        </span>
        <ChevronDown size={13} className="shrink-0 text-slate-500" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50
          bg-surface-800 border border-surface-600 rounded-xl shadow-2xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto">
            {globalList.length > 0 && (
              <>
                <div className="px-4 pt-2.5 pb-1 text-[9px] uppercase tracking-widest text-slate-600 font-semibold">🌐 Global</div>
                {globalList.map((s) => (
                  <button key={s.id} type="button" onClick={() => toggleId(s.id)}
                    className={cn('w-full flex items-center gap-2 px-4 py-2 hover:bg-surface-700 transition-colors text-left',
                      value.includes(s.id) && 'bg-brand-600/15')}>
                    <span className={cn('shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center',
                      value.includes(s.id) ? 'bg-brand-500/40 border-brand-500/60' : 'border-surface-500 bg-surface-700')}>
                      {value.includes(s.id) && <span className="text-[8px] text-brand-300 font-bold">✓</span>}
                    </span>
                    {s.emoji && <span className="text-sm">{s.emoji}</span>}
                    <span className="flex-1 text-xs font-medium text-slate-200 truncate">{s.name}</span>
                    {s.trades_count >= s.min_trades_for_stats
                      ? <span className="text-[10px] text-emerald-400 font-mono shrink-0">{((s.win_count / s.trades_count) * 100).toFixed(0)}% WR</span>
                      : <span className="text-[10px] text-slate-600 shrink-0">{s.trades_count}t</span>
                    }
                  </button>
                ))}
              </>
            )}
            {profileList.length > 0 && (
              <>
                {globalList.length > 0 && (
                  <div className="px-4 pt-2.5 pb-1 text-[9px] uppercase tracking-widest text-slate-600 font-semibold border-t border-surface-700/50">👤 Profile</div>
                )}
                {profileList.map((s) => (
                  <button key={s.id} type="button" onClick={() => toggleId(s.id)}
                    className={cn('w-full flex items-center gap-2 px-4 py-2 hover:bg-surface-700 transition-colors text-left',
                      value.includes(s.id) && 'bg-brand-600/15')}>
                    <span className={cn('shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center',
                      value.includes(s.id) ? 'bg-brand-500/40 border-brand-500/60' : 'border-surface-500 bg-surface-700')}>
                      {value.includes(s.id) && <span className="text-[8px] text-brand-300 font-bold">✓</span>}
                    </span>
                    {s.emoji && <span className="text-sm">{s.emoji}</span>}
                    <span className="flex-1 text-xs font-medium text-slate-200 truncate">{s.name}</span>
                    {s.trades_count >= s.min_trades_for_stats
                      ? <span className="text-[10px] text-emerald-400 font-mono shrink-0">{((s.win_count / s.trades_count) * 100).toFixed(0)}% WR</span>
                      : <span className="text-[10px] text-slate-600 shrink-0">{s.trades_count}t</span>
                    }
                  </button>
                ))}
              </>
            )}
            {globalList.length === 0 && profileList.length === 0 && (
              <p className="px-4 py-3 text-xs text-slate-600">No strategies yet.</p>
            )}
          </div>
          <div className="border-t border-surface-700 p-2">
            {creating ? (
              <div className="flex gap-1.5">
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void handleCreate() }
                    if (e.key === 'Escape') setCreating(false)
                  }}
                  placeholder="New profile strategy…"
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
                <Plus size={11} /> New profile strategy…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TP Presets
// ─────────────────────────────────────────────────────────────────────────────

function evenly(n: number): number[] {
  const base = Math.floor(100 / n)
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? 100 - base * (n - 1) : base))
}

const TP_PRESETS = [
  { label: 'Smart Scale', emoji: '🎯', pcts: (n: number) => ({ 1: [100], 2: [55, 45], 3: [35, 45, 20] }[n] ?? evenly(n)) },
  { label: 'Profit Max',  emoji: '💎', pcts: (n: number) => ({ 1: [100], 2: [45, 55], 3: [30, 55, 15] }[n] ?? evenly(n)) },
  { label: 'Balanced',    emoji: '⚖️', pcts: (n: number) => ({ 1: [100], 2: [60, 40], 3: [45, 35, 20] }[n] ?? evenly(n)) },
  { label: 'Aggressive',  emoji: '🚀', pcts: (n: number) => ({ 1: [100], 2: [40, 60], 3: [25, 50, 25] }[n] ?? evenly(n)) },
  { label: 'Conservative', emoji: '🛡️', pcts: (n: number) => ({ 1: [100], 2: [70, 30], 3: [60, 30, 10] }[n] ?? evenly(n)) },
]

// ─────────────────────────────────────────────────────────────────────────────
// Tags / Timeframes
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TAGS = [
  '📐 Structure', '🔁 Retest',    '📊 Divergence', '🧲 Magnet',
  '📰 News',      '🕯️ Engulfing', '📍 FVG',        '🎯 OB',
  '📈 Breakout',  '📉 Breakdown', '🔄 Range',       '🌊 Trend',
]

const TIMEFRAMES = ['1W', '1D', '4H'] as const

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

/** Adapts decimal places to price magnitude */
function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (n >= 1)   return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
}

interface TpRow { price: string; pct: string }

function tpPriceFromPct(entry: number, pct: number): string {
  return (entry * (1 + pct / 100)).toFixed(6).replace(/\.?0+$/, '')
}

function tpPctFromPrice(entry: number, price: number): string {
  return (((price / entry) - 1) * 100).toFixed(2)
}

const DEFAULT_WIN_RATE = 0.6
const MIN_PROFILE_TRADES = 5

// ─────────────────────────────────────────────────────────────────────────────
// Spot expectancy panel — simplified (no risk_amount, uses cost-based R:R)
// ─────────────────────────────────────────────────────────────────────────────

function SpotExpectancyPanel({
  totalCost, potentialProfit, stopLossAmount, selectedStrategy, globalWrStats, confidence, ccy, pairVi,
}: {
  totalCost: number | null
  potentialProfit: number | null
  stopLossAmount: number | null
  selectedStrategy: Strategy | null
  globalWrStats: WinRateStats | null
  confidence: number   // 1–10, 0 = not set
  ccy: string
  pairVi: SpotWatchlistPairOut | null
}) {
  const globalWr: number | null = useMemo(() => {
    if (!globalWrStats) return null
    const withData = globalWrStats.profiles.filter((p) => p.has_data && p.win_rate_pct != null)
    if (withData.length === 0) return null
    return withData.reduce((s, p) => s + (p.win_rate_pct ?? 0), 0) / withData.length / 100
  }, [globalWrStats])

  // ── Win-rate source ─────────────────────────────────────────────────────────
  const hasStratStats = selectedStrategy != null
    && selectedStrategy.trades_count >= selectedStrategy.min_trades_for_stats

  const rawWr: number = hasStratStats
    ? selectedStrategy!.win_count / selectedStrategy!.trades_count
    : globalWr ?? DEFAULT_WIN_RATE

  const wrSource = hasStratStats ? 'strategy' : globalWr != null ? 'global' : 'fallback'
  const wrBadgeCls = wrSource === 'strategy' ? 'text-emerald-400' : wrSource === 'global' ? 'text-amber-300' : 'text-slate-400'
  const wrSourceLabel = wrSource === 'strategy'
    ? `${selectedStrategy!.name} (${selectedStrategy!.trades_count} trades)`
    : wrSource === 'global'
      ? `Global average`
      : `Default 60% fallback`

  // Regime adjustment: for spot, high VI = pump window (buy edge ↑)
  // EXTREME/ACTIVE → +5%; TRENDING → +3%; CALM → −3%; DEAD → −5%
  const viRegimeAdj = pairVi?.regime === 'EXTREME' ? 0.05
    : pairVi?.regime === 'ACTIVE'   ? 0.05
    : pairVi?.regime === 'TRENDING' ? 0.03
    : pairVi?.regime === 'CALM'     ? -0.03
    : pairVi?.regime === 'DEAD'     ? -0.05
    : 0  // NORMAL or no data

  // ── "Form incomplete" mini mode — show just WR when entry/qty/TP not filled ─
  if (potentialProfit == null || totalCost == null) {
    if (!selectedStrategy && !globalWrStats) return null
    return (
      <div className="rounded-xl border border-surface-700 bg-surface-800/60 p-4 space-y-2">
        <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Win Rate preview</p>
        <div className="flex items-end gap-2">
          <p className={cn('text-2xl font-mono font-bold leading-none', wrBadgeCls)}>
            {(Math.max(0.05, Math.min(0.95, rawWr + viRegimeAdj)) * 100).toFixed(0)}%
          </p>
          {hasStratStats && (
            <p className="text-[10px] text-slate-500 mb-0.5">
              {selectedStrategy!.trades_count} trades · {selectedStrategy!.win_count} wins
            </p>
          )}
        </div>
        <p className="text-[10px] text-slate-600 truncate">{wrSourceLabel}</p>
        {pairVi && (
          <p className="text-[10px] leading-relaxed"
            style={{ color: viRegimeAdj > 0 ? '#34d399' : viRegimeAdj < 0 ? '#f87171' : '#64748b' }}>
            VI {(pairVi.vi_score * 100).toFixed(0)} · {pairVi.regime}
            {viRegimeAdj !== 0 && ` → ${viRegimeAdj > 0 ? '+' : ''}${(viRegimeAdj * 100).toFixed(0)}% edge adj`}
          </p>
        )}
        <p className="text-[11px] text-slate-600 border-t border-surface-700/50 pt-2">
          Fill entry, quantity &amp; TP to see full expectancy analysis.
        </p>
      </div>
    )
  }
  const rawWrAdj = Math.max(0.05, Math.min(0.95, rawWr + viRegimeAdj))

  // Confidence adjustment: scale ±10% around raw WR based on confidence (1–10)
  // confidence=5 → no adjustment; 1 → −10%; 10 → +10%
  const confAdj = confidence > 0 ? ((confidence - 5) / 5) * 0.10 : 0
  const winRate = Math.max(0.05, Math.min(0.95, rawWrAdj + confAdj))
  const lossRate = 1 - winRate

  // R:R  (only when SL exists)
  const rMultiple = stopLossAmount != null && stopLossAmount > 0
    ? potentialProfit / stopLossAmount : null

  // Expected value in ccy
  const expectedValue = stopLossAmount != null && stopLossAmount > 0
    ? winRate * potentialProfit - lossRate * stopLossAmount : null

  // Potential ROI %
  const roiPct = (potentialProfit / totalCost) * 100

  const grade = expectedValue == null
    ? { emoji: '📊', label: 'No SL', text: 'text-slate-300', bg: 'bg-surface-700/40', border: 'border-surface-600', sub: 'Add a stop loss for full expectancy.' }
    : expectedValue < 0
      ? { emoji: '🔴', label: 'Negative EV', text: 'text-red-300', bg: 'bg-red-500/10', border: 'border-red-500/30', sub: 'Expected value is negative — review setup.' }
      : expectedValue < potentialProfit * 0.2
        ? { emoji: '🟡', label: 'Marginal', text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30', sub: 'Small edge. Improve confidence or R:R.' }
        : { emoji: '🟢', label: 'Positive EV', text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', sub: 'Good setup — positive expected value.' }

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', grade.bg, grade.border)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl leading-none">{grade.emoji}</span>
          <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Trade expectancy</p>
            <p className={cn('text-sm font-bold leading-tight', grade.text)}>{grade.label}</p>
          </div>
        </div>
        <div className="text-right space-y-0.5">
          <p className={cn('text-xl font-mono font-bold leading-tight', grade.text)}>
            +{fmtPrice(potentialProfit)} {ccy}
          </p>
          <p className="text-[10px] text-slate-400 font-mono">{fmtPct(roiPct)} ROI</p>
          {rMultiple != null && (
            <p className="text-[10px] text-slate-500 font-mono">{rMultiple.toFixed(2)}R ratio</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg bg-surface-800/70 px-3 py-2.5 border border-surface-700/50">
        <div className="text-[10px]">
          <span className="text-slate-600">WR used</span>
          <p className={cn('font-semibold', wrBadgeCls)}>{(winRate * 100).toFixed(0)}%</p>
          <p className="text-[9px] text-slate-600 truncate mt-0.5">{wrSourceLabel}</p>
        </div>
        <div className="text-[10px]">
          <span className="text-slate-600">Confidence</span>
          <p className={cn('font-semibold',
            confidence <= 0 ? 'text-slate-500' :
            confidence <= 3 ? 'text-red-400' :
            confidence <= 6 ? 'text-amber-400' : 'text-emerald-400')}>
            {confidence > 0 ? `${confidence}/10` : '—'}
          </p>
          <p className="text-[9px] text-slate-600 mt-0.5">
            {(confAdj + viRegimeAdj) > 0
              ? `+${((confAdj + viRegimeAdj) * 100).toFixed(0)}% adj`
              : (confAdj + viRegimeAdj) < 0
              ? `${((confAdj + viRegimeAdj) * 100).toFixed(0)}% adj`
              : 'no adj'}
          </p>
        </div>
        <div className="text-[10px]">
          <span className="text-slate-600">Expected val.</span>
          <p className={cn('font-semibold font-mono',
            expectedValue == null ? 'text-slate-500' :
            expectedValue >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {expectedValue != null ? `${expectedValue >= 0 ? '+' : ''}${fmtPrice(expectedValue)} ${ccy}` : '—'}
          </p>
          <p className="text-[9px] text-slate-600 mt-0.5">per trade avg</p>
        </div>
      </div>

      <p className={cn('text-[11px] font-medium', grade.text, 'opacity-90')}>{grade.sub}</p>

      {pairVi && viRegimeAdj !== 0 && (
        <p className="text-[10px] border-t border-surface-700/40 pt-2 leading-relaxed"
          style={{ color: viRegimeAdj > 0 ? '#34d399' : '#f87171' }}>
          {viRegimeAdj > 0
            ? `🚀 ${pairVi.regime} regime — high VI = pump window detected (+${(viRegimeAdj * 100).toFixed(0)}% edge)`
            : `⚠️ ${pairVi.regime} regime — low volatility reduces edge (${(viRegimeAdj * 100).toFixed(0)}%)`
          }
        </p>
      )}
      {wrSource !== 'strategy' && (
        <p className="text-[10px] text-slate-600 border-t border-surface-700/40 pt-2 leading-relaxed">
          {wrSource === 'global'
            ? <>🌐 Global win rate — select a strategy with ≥5 trades for specific data.</>
            : <>📊 Using {(DEFAULT_WIN_RATE * 100).toFixed(0)}% default — close {MIN_PROFILE_TRADES}+ trades to unlock real WR.</>
          }
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function NewSpotTradePage() {
  const navigate          = useNavigate()
  const { activeProfile } = useProfile()

  // ── Server data ────────────────────────────────────────────────────────────
  const [instruments, setInstruments] = useState<Instrument[]>([])
  const [strategies, setStrategies]   = useState<Strategy[]>([])
  const [stratLoading, setStratLoading] = useState(false)
  const [strategyIds, setStrategyIds]   = useState<number[]>([])
  const [portfolio, setPortfolio]       = useState<PortfolioOut | null>(null)
  const [globalWrStats, setGlobalWrStats] = useState<WinRateStats | null>(null)

  // ── Instrument + market price ──────────────────────────────────────────────
  const [instrument, setInstrument]   = useState<Instrument | null>(null)
  const [priceLoading, setPriceLoading] = useState(false)
  const [marketPrice, setMarketPrice]   = useState<number | null>(null)

  // ── Entry form ────────────────────────────────────────────────────────────
  const [orderType, setOrderType]     = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [entry, setEntry]             = useState('')
  const [quantity, setQuantity]       = useState('')
  const [costInput, setCostInput]     = useState('')
  const lastQtyField                  = useRef<'qty' | 'cost'>('qty')

  // ── Risk ──────────────────────────────────────────────────────────────────
  const [stopLoss, setStopLoss]       = useState('')
  // Trailing stop — toggle-driven (like contracts runner)
  const [trailingEnabled, setTrailingEnabled]   = useState(false)
  const [trailingPct, setTrailingPct]           = useState('5')
  const [lastTpIsTrailing, setLastTpIsTrailing] = useState(false)

  // ── TPs ───────────────────────────────────────────────────────────────────
  const [tpCount, setTpCount]           = useState<0 | 1 | 2 | 3>(1)
  const [activePreset, setActivePreset] = useState('Smart Scale')
  const [tps, setTps]                   = useState<TpRow[]>([{ price: '', pct: '100' }])

  // ── Analysis ─────────────────────────────────────────────────────────────
  const [timeframe, setTimeframe]       = useState('')
  const [confidence, setConfidence]     = useState(0)   // 0 = not set, 1–10
  const [tradeTags, setTradeTags]       = useState<string[]>([])
  const [notes, setNotes]               = useState('')

  // ── Automation ────────────────────────────────────────────────────────────
  const [automateOnCreate,         setAutomateOnCreate]         = useState(false)
  const [profileAutomationEnabled, setProfileAutomationEnabled] = useState(false)

  // ── Screenshots ───────────────────────────────────────────────────────────
  const [entryScreenshots, setEntryScreenshots] = useState<File[]>([])
  const [screenshotUrls, setScreenshotUrls]     = useState<{ file: File; url: string }[]>([])

  // ── Pair VI data — fetched from latest spot watchlist when pair changes ───
  const [pairVi, setPairVi] = useState<SpotWatchlistPairOut | null>(null)

  // ── Submit ────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  const profileId = activeProfile?.id ?? 0
  const ccy       = activeProfile?.currency ?? 'USD'

  // ── Load instruments + strategies + portfolio + WR stats ──────────────────
  useEffect(() => {
    if (!profileId) return
    investmentApi.listInstruments(profileId).then(setInstruments).catch(() => {})
    setStratLoading(true)
    strategiesApi.list(profileId).then(setStrategies).catch(() => setStrategies([])).finally(() => setStratLoading(false))
    investmentApi.getPortfolio(profileId).then(setPortfolio).catch(() => {})
    statsApi.winrate().then(setGlobalWrStats).catch(() => {})
    automationApi.getSettings(profileId)
      .then((s) => { const en = s.config.enabled; setProfileAutomationEnabled(en); setAutomateOnCreate(en) })
      .catch(() => {})
  }, [profileId])

  // ── Auto-fetch market price when instrument selected ───────────────────────
  useEffect(() => {
    if (!instrument?.symbol) {
      setMarketPrice(null)
      return
    }
    setPriceLoading(true)
    setMarketPrice(null)
    investmentApi.getSpotPrice(instrument.symbol)
      .then(({ last_price }) => {
        setMarketPrice(last_price)
        setEntry(String(last_price))
      })
      .catch(() => {})
      .finally(() => setPriceLoading(false))
  }, [instrument?.symbol])

  // ── Auto-fetch pair VI from spot watchlist when instrument or TF changes ────
  useEffect(() => {
    if (!instrument?.symbol) { setPairVi(null); return }
    const tf = timeframe ? timeframe.toLowerCase() : '4h'
    spotVolatilityApi.getWatchlist(tf)
      .then((wl) => {
        const found = wl.pairs.find((p) => p.pair === instrument.symbol)
        setPairVi(found ?? null)
      })
      .catch(() => setPairVi(null))
  }, [instrument?.symbol, timeframe])

  // ── Stable screenshot URLs (avoid scroll-jump on add) ─────────────────────
  useEffect(() => {
    setScreenshotUrls((prev) => {
      prev.filter((p) => !entryScreenshots.includes(p.file)).forEach((p) => URL.revokeObjectURL(p.url))
      return entryScreenshots.map((file) => {
        const existing = prev.find((p) => p.file === file)
        return existing ?? { file, url: URL.createObjectURL(file) }
      })
    })
  }, [entryScreenshots])

  // ── Clipboard paste → add screenshot ──────────────────────────────────────
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          const file = new File([blob], `paste-${Date.now()}.png`, { type: blob.type })
          setEntryScreenshots((prev) => [...prev, file])
          break
        }
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  // ── Numerics ───────────────────────────────────────────────────────────────
  const entryNum    = entry    ? Number(entry)    : null
  const quantityNum = quantity ? Number(quantity) : null
  const slNum       = stopLoss ? Number(stopLoss) : null

  const totalCost = useMemo(() => {
    if (entryNum == null || quantityNum == null) return null
    return entryNum * quantityNum
  }, [entryNum, quantityNum])

  // ── Qty ⇔ Cost bidirectional sync ─────────────────────────────────────────
  const handleQtyChange = useCallback((v: string) => {
    lastQtyField.current = 'qty'
    setQuantity(v)
    const e = entryNum
    if (e && v) setCostInput((e * Number(v)).toFixed(2))
    else if (!v) setCostInput('')
  }, [entryNum])

  const handleCostChange = useCallback((v: string) => {
    lastQtyField.current = 'cost'
    setCostInput(v)
    const e = entryNum
    if (e && v) {
      const raw = (Number(v) / e).toFixed(8)
      setQuantity(raw.replace(/\.?0+$/, '') || '0')
    } else if (!v) {
      setQuantity('')
    }
  }, [entryNum])

  // Re-sync on entry change
  useEffect(() => {
    if (!entryNum) return
    if (lastQtyField.current === 'cost' && costInput) {
      const raw = (Number(costInput) / entryNum).toFixed(8)
      setQuantity(raw.replace(/\.?0+$/, '') || '0')
    } else if (lastQtyField.current === 'qty' && quantity) {
      setCostInput((entryNum * Number(quantity)).toFixed(2))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryNum])

  // ── TP management ──────────────────────────────────────────────────────────
  const applyPreset = useCallback((presetLabel: string, count: number) => {
    const preset = TP_PRESETS.find((p) => p.label === presetLabel)
    if (!preset || count === 0) return
    const pcts = preset.pcts(count)
    setTps(
      pcts.map((pct) => ({
        price: entryNum != null ? tpPriceFromPct(entryNum, pct) : '',
        pct: String(pct),
      }))
    )
  }, [entryNum])

  // Sync tpCount → resize TPs array
  useEffect(() => {
    const count = tpCount
    if (count === 0) { setTps([]); return }
    setTps((prev) => {
      const preset = TP_PRESETS.find((p) => p.label === activePreset)
      const pcts = preset ? preset.pcts(count) : Array(count).fill(Math.floor(100 / count))
      return Array.from({ length: count }, (_, i) => ({
        price: entryNum != null ? tpPriceFromPct(entryNum, pcts[i]) : (prev[i]?.price ?? ''),
        pct: String(pcts[i]),
      }))
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpCount])

  // When entry changes → recompute TP prices from stored pct
  useEffect(() => {
    if (entryNum == null) return
    setTps((prev) =>
      prev.map((tp) => (!tp.pct ? tp : { ...tp, price: tpPriceFromPct(entryNum, Number(tp.pct)) }))
    )
  }, [entryNum])

  const setTpPrice = (idx: number, price: string) => {
    setTps((prev) =>
      prev.map((tp, i) => {
        if (i !== idx) return tp
        const pct = entryNum != null && price ? tpPctFromPrice(entryNum, Number(price)) : tp.pct
        return { price, pct }
      })
    )
  }

  const setTpPct = (idx: number, pct: string) => {
    setTps((prev) =>
      prev.map((tp, i) => {
        if (i !== idx) return tp
        const price = entryNum != null && pct ? tpPriceFromPct(entryNum, Number(pct)) : tp.price
        return { pct, price }
      })
    )
  }

  const tpPctSum = tps.reduce((s, tp) => s + (Number(tp.pct) || 0), 0)
  const tpPctError = tpCount > 0 && tps.length > 0
    ? (Math.abs(tpPctSum - 100) > 0.5 ? `TP allocations sum to ${tpPctSum.toFixed(0)}% (need 100%)` : null)
    : null

  const tpOrdered = tps.every((tp, i) => {
    if (i === 0 || !entryNum) return true
    if (lastTpIsTrailing && i === tps.length - 1) return true // trailing row has no price constraint
    return !tp.price || !tps[i - 1].price || Number(tp.price) > Number(tps[i - 1].price)
  })

  // ── Computed metrics ────────────────────────────────────────────────────────
  const potentialProfit = useMemo(() => {
    if (!entryNum || !quantityNum || tps.length === 0) return null
    const relevantTps = lastTpIsTrailing ? tps.slice(0, -1) : tps
    if (relevantTps.length === 0) return null
    return relevantTps.reduce((sum, tp) => {
      if (!tp.price || !tp.pct) return sum
      const portion = quantityNum * (Number(tp.pct) / 100)
      return sum + (Number(tp.price) - entryNum) * portion
    }, 0)
  }, [entryNum, quantityNum, tps, lastTpIsTrailing])

  const stopLossAmount = useMemo(() => {
    if (!entryNum || !slNum || !quantityNum) return null
    return (entryNum - slNum) * quantityNum
  }, [entryNum, slNum, quantityNum])

  const stopLossPct = useMemo(() => {
    if (!entryNum || !slNum) return null
    return ((entryNum - slNum) / entryNum) * 100
  }, [entryNum, slNum])

  const rMultiple = useMemo(() => {
    if (!potentialProfit || !stopLossAmount || stopLossAmount <= 0) return null
    return potentialProfit / stopLossAmount
  }, [potentialProfit, stopLossAmount])

  // Selected strategy (first selected — for expectancy panel)
  const selectedStrategy = strategies.find((s) => s.id === strategyIds[0]) ?? null

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (tpPctError || !tpOrdered) return
    setSubmitting(true)
    setError(null)
    try {
      // Trailing pct: use per-field value OR global trailing pct
      const trailingStopValue = trailingEnabled ? trailingPct || null : null

      const newTrade = await investmentApi.createTrade(profileId, {
        pair:               instrument?.symbol ?? entry.toUpperCase().trim(),
        entry_price:        entry,
        quantity,
        stop_loss:          stopLoss || null,
        trailing_stop_pct:  trailingStopValue,
        order_type:         orderType,
        nb_take_profits:    tpCount,
        tp_targets:         tps
          .filter((t, i) => {
            if (lastTpIsTrailing && i === tps.length - 1) return false
            return t.price
          })
          .map((t) => ({ price: t.price, pct_allocation: Number(t.pct) })),
        analyzed_timeframe: timeframe || null,
        confidence_score:   confidence > 0 ? String(confidence) : null,
        strategy_id:        strategyIds[0] ?? null,
        instrument_id:      instrument?.id ?? null,
        notes:              notes || null,
      })

      // Upload entry screenshots (non-blocking — trade already created)
      for (const file of entryScreenshots) {
        try {
          await investmentApi.uploadSnapshot(profileId, newTrade.id, file)
        } catch { /* non-fatal */ }
      }

      navigate('/trades')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!activeProfile) {
    return <div className="flex items-center justify-center h-64 text-slate-500 text-sm">No active profile.</div>
  }

  // ── Available capital ──────────────────────────────────────────────────────
  const availableCapital = portfolio ? Number(portfolio.capital_current) : null
  const allocationPct = availableCapital && totalCost
    ? (totalCost / availableCapital) * 100 : null

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <PageHeader
        icon="🪙"
        title="New spot trade"
        subtitle={activeProfile.name}
        actions={
          <button type="button" onClick={() => navigate('/trades')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600
              text-xs text-slate-400 hover:text-slate-200 transition-colors border border-surface-600">
            <X size={13} /> Cancel
          </button>
        }
      />

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

          {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
          <div className="space-y-5">

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3">
                <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            {/* ── 1. INSTRUMENT ─────────────────────────────────────────── */}
            <Section icon="🔍" title="Instrument">
              <Field label={<>Instrument <span className="text-red-400">*</span></>}>
                <SpotInstrumentPicker
                  instruments={instruments}
                  value={instrument}
                  onChange={(i) => { setInstrument(i) }}
                />
              </Field>

              {/* Market price badge */}
              {instrument && (
                <div className="flex items-center gap-2">
                  {priceLoading
                    ? <span className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <Loader2 size={11} className="animate-spin" /> Fetching price…
                      </span>
                    : marketPrice != null
                      ? <span className="flex items-center gap-1.5 text-[10px]">
                          <Zap size={10} className="text-brand-400" />
                          <span className="text-slate-500">Market:</span>
                          <span className="text-brand-300 font-mono font-semibold">{fmtPrice(marketPrice)} {ccy}</span>
                          <span className="text-slate-600">· auto-filled</span>
                        </span>
                      : <span className="text-[10px] text-slate-600">Price fetch failed — enter manually</span>
                  }
                </div>
              )}

              {/* VI score badge from latest 4h spot watchlist */}
              {pairVi && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-medium bg-surface-700/60 border border-surface-600">
                    <span className="text-slate-500">VI</span>
                    <span className="font-mono font-bold text-brand-300">{(pairVi.vi_score * 100).toFixed(0)}</span>
                    <span className={cn('font-semibold',
                      pairVi.regime === 'EXTREME'  ? 'text-red-400'    :
                      pairVi.regime === 'ACTIVE'   ? 'text-orange-400' :
                      pairVi.regime === 'TRENDING' ? 'text-amber-400'  :
                      pairVi.regime === 'NORMAL'   ? 'text-brand-300'  :
                      pairVi.regime === 'CALM'     ? 'text-blue-400'   : 'text-slate-500')}>
                      {pairVi.regime}
                    </span>
                    {pairVi.ema_signal && pairVi.ema_signal !== 'mixed' && (
                      <span className="text-slate-600">· {pairVi.ema_signal.replace(/_/g, ' ')}</span>
                    )}
                  </span>
                </div>
              )}
            </Section>

            {/* ── 2. STRATEGY & SETUP INTENT ───────────────────────────── */}
            <Section icon="🧠" title="Strategy & setup intent">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={<>Strategy <Tip text="Select strategy to get win rate stats in the expectancy panel. Multiple allowed." /></>}>
                  <MultiStrategySelect
                    strategies={strategies}
                    loading={stratLoading}
                    value={strategyIds}
                    onChange={setStrategyIds}
                    profileId={profileId}
                    onCreated={(s) => setStrategies((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)))}
                  />
                </Field>

                <Field label="Timeframe analysed">
                  <div className="grid grid-cols-3 gap-1">
                    {TIMEFRAMES.map((tf) => (
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

              {/* Confidence score — 1–10 button grid like contracts */}
              <div>
                <span className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-2">
                  Confidence score
                  <Tip text="1 = very low conviction · 10 = max. Adjusts win rate estimate in the expectancy panel." />
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button key={n} type="button" onClick={() => setConfidence((p) => p === n ? 0 : n)}
                      className={cn('w-9 h-9 rounded-lg border text-xs font-bold transition-all',
                        confidence === n
                          ? n <= 3
                            ? 'bg-red-500/20 border-red-500/40 text-red-300'
                            : n <= 6
                              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                              : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                          : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-200')}>
                      {n}
                    </button>
                  ))}
                  {confidence > 0 && (
                    <span className="text-[10px] text-slate-500 ml-1">
                      {confidence <= 3 ? '😬 Low' : confidence <= 6 ? '🙂 Medium' : '🔥 High conviction'}
                    </span>
                  )}
                </div>
              </div>
            </Section>

            {/* ── 3. ORDER & ENTRY ──────────────────────────────────────── */}
            <Section icon="📍" title="Order & entry">
              {/* Order type */}
              <div className="flex gap-2">
                {(['MARKET', 'LIMIT'] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setOrderType(t)}
                    className={cn('flex-1 py-2 rounded-lg text-xs font-medium transition-colors border',
                      orderType === t
                        ? 'bg-brand-600/30 border-brand-500/50 text-brand-200'
                        : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200')}>
                    {t}
                  </button>
                ))}
              </div>

              {/* Entry price */}
              <Field label={<>Entry price <span className="text-red-400">*</span></>}
                hint={orderType === 'LIMIT' ? 'Target limit price — fill at this price or better' : 'Market price — auto-filled, override if needed'}>
                <div className="flex">
                  <input required type="number" step="any" min="0"
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    placeholder="0.00"
                    className={cn(inputCls, ccy ? 'rounded-r-none border-r-0' : '')} />
                  <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500 font-medium">
                    {ccy}
                  </span>
                </div>
              </Field>

              {/* Qty ⇔ Cost bidirectional */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium text-slate-400">
                    Quantity <span className="text-red-400">*</span>
                  </span>
                  {quantityNum != null && entryNum != null && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      {fmt(quantityNum, 6)} × {fmtPrice(entryNum)} = <span className="text-brand-300 font-semibold">{fmt(totalCost)} {ccy}</span>
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">Invest ({ccy})</p>
                    <div className="flex">
                      <input type="number" step="any" min="0"
                        value={costInput}
                        onChange={(e) => handleCostChange(e.target.value)}
                        placeholder="500.00"
                        className={cn(inputCls, 'rounded-r-none border-r-0')} />
                      <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">{ccy}</span>
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">
                      {instrument?.base_currency ? `Units (${instrument.base_currency})` : 'Units'}
                    </p>
                    <div className="flex">
                      <input required type="number" step="any" min="0"
                        value={quantity}
                        onChange={(e) => handleQtyChange(e.target.value)}
                        placeholder="0.00487"
                        className={cn(inputCls, instrument?.base_currency ? 'rounded-r-none border-r-0' : '')} />
                      {instrument?.base_currency && (
                        <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">
                          {instrument.base_currency}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Portfolio-aware hint */}
                {availableCapital != null && (
                  <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 px-0.5">
                    <span>
                      Portfolio available:{' '}
                      <span className="text-emerald-300 font-mono font-semibold">{fmt(availableCapital)} {ccy}</span>
                    </span>
                    {allocationPct != null && (
                      <span>
                        Allocated:{' '}
                        <span className={cn('font-mono font-semibold',
                          allocationPct > 50 ? 'text-red-400' :
                          allocationPct > 25 ? 'text-amber-400' : 'text-brand-300')}>
                          {allocationPct.toFixed(1)}%
                        </span>
                        {allocationPct > 50 && <span className="ml-1 text-red-400">⚠</span>}
                      </span>
                    )}
                  </div>
                )}

                {instrument?.min_lot && quantityNum != null && Number(instrument.min_lot) > quantityNum && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={10} /> Below minimum lot ({instrument.min_lot} {instrument.base_currency})
                  </p>
                )}
              </div>
            </Section>

            {/* ── 4. RISK & TAKE PROFITS ────────────────────────────────── */}
            <Section icon="🛡️" title="Risk & take profits">

              {/* Stop loss */}
              <Field label="Stop loss (optional)"
                hint={stopLossAmount != null
                  ? `Potential loss: −${fmt(Math.abs(stopLossAmount))} ${ccy} (${fmtPct(-(stopLossPct ?? 0))})`
                  : 'Leave empty to manage risk manually'}>
                <div className="flex">
                  <input type="number" step="any" min="0"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(e.target.value)}
                    placeholder="Optional guard"
                    className={cn(inputCls, 'rounded-r-none border-r-0')} />
                  <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">{ccy}</span>
                </div>
              </Field>

              {entryNum != null && slNum != null && slNum >= entryNum && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <ShieldAlert size={12} className="text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-300">Stop loss must be below entry price (spot = long only).</p>
                </div>
              )}

              {/* ── TPs ──────────────────────────────────────────────────── */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Take profit targets</span>
                  <div className="flex gap-1">
                    {([0, 1, 2, 3] as const).map((n) => (
                      <button key={n} type="button" onClick={() => setTpCount(n)}
                        className={cn('w-7 h-7 rounded-md text-xs font-medium transition-colors',
                          tpCount === n
                            ? 'bg-brand-600/40 text-brand-200 border border-brand-500/50'
                            : 'bg-surface-700 text-slate-500 hover:text-slate-300 border border-surface-600')}>
                        {n === 0 ? '✕' : n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Presets */}
                {tpCount > 0 && (
                  <div className="flex gap-1.5 flex-wrap">
                    {TP_PRESETS.map((p) => (
                      <button key={p.label} type="button"
                        onClick={() => { setActivePreset(p.label); applyPreset(p.label, tpCount) }}
                        className={cn('px-2 py-1 rounded-md text-[10px] font-medium transition-colors border',
                          activePreset === p.label
                            ? 'bg-brand-600/30 border-brand-500/40 text-brand-300'
                            : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300')}>
                        {p.emoji} {p.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* 🚀 Trailing stop toggle — like "Runner" in contracts */}
                <div className={cn(
                  'flex items-center justify-between gap-3 p-3 rounded-xl border',
                  trailingEnabled
                    ? 'bg-brand-500/10 border-brand-500/30'
                    : 'bg-surface-700/50 border-surface-600',
                )}>
                  <div>
                    <p className="text-xs font-semibold text-slate-300">🚀 Trailing stop — Let it ride</p>
                    <p className="text-[10px] text-slate-500">Dynamic guard that rises with price, locking in gains.</p>
                  </div>
                  <button type="button" onClick={() => { setTrailingEnabled((v) => !v); if (trailingEnabled) setLastTpIsTrailing(false) }}
                    className={cn('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
                      trailingEnabled ? 'bg-brand-600' : 'bg-surface-500')}>
                    <span className={cn('inline-block h-3 w-3 transform rounded-full bg-white transition-transform',
                      trailingEnabled ? 'translate-x-5' : 'translate-x-1')} />
                  </button>
                </div>

                {trailingEnabled && (
                  <div className="pl-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 shrink-0">Trailing %:</span>
                      <input type="number" step="0.5" min="0.5" max="50"
                        value={trailingPct}
                        onChange={(e) => setTrailingPct(e.target.value)}
                        className={cn(inputCls, 'w-24')} />
                      <span className="text-xs text-slate-500">%</span>
                      {entryNum && trailingPct && (
                        <span className="text-[10px] text-slate-600">
                          Init. stop: {fmtPrice(entryNum * (1 - Number(trailingPct) / 100))} {ccy}
                        </span>
                      )}
                    </div>
                    {/* Apply to last TP (when >= 2 TPs) */}
                    {tpCount >= 2 && (
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={lastTpIsTrailing}
                          onChange={(e) => setLastTpIsTrailing(e.target.checked)}
                          className="rounded border-surface-600 bg-surface-700 accent-brand-500" />
                        <span className="text-[11px] text-slate-400">
                          Apply trailing to TP{tpCount} — last TP becomes a trailing stop 🚀
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {tpPctError && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={10} />{tpPctError}
                  </p>
                )}

                {/* TP rows */}
                {tps.map((tp, i) => {
                  const isTrailingRow = lastTpIsTrailing && trailingEnabled && i === tps.length - 1
                  const tpPctNum = tp.price && entryNum ? ((Number(tp.price) / entryNum) - 1) * 100 : null
                  const rrForTp = stopLossAmount != null && stopLossAmount > 0 && tpPctNum != null && quantityNum != null
                    ? (tpPctNum / 100 * entryNum! * quantityNum * (Number(tp.pct) / 100)) / stopLossAmount : null

                  return (
                    <div key={i} className="grid grid-cols-[1fr_100px] gap-2 items-start">
                      <Field
                        label={<span className={isTrailingRow ? 'text-brand-400' : 'text-emerald-400'}>
                          {isTrailingRow ? '🚀 TP' + (i + 1) + ' (trailing)' : `TP${i + 1} price`}
                        </span>}
                        error={
                          !tpOrdered && i > 0 && !isTrailingRow && tp.price && tps[i - 1].price && Number(tp.price) <= Number(tps[i - 1].price)
                            ? `TP${i + 1} must be above TP${i}`
                            : null
                        }>
                        {isTrailingRow ? (
                          <div className={cn(inputCls, 'flex items-center gap-1 text-[10px] text-brand-300/80 bg-brand-500/5 border-brand-500/30 cursor-default')}>
                            <span>Trailing</span>
                            <span className="text-brand-400/60">{trailingPct}%</span>
                          </div>
                        ) : (
                          <div className="flex">
                            <input type="number" step="any" min="0"
                              value={tp.price}
                              onChange={(e) => setTpPrice(i, e.target.value)}
                              placeholder="0.00"
                              className={cn(inputCls, ccy ? 'rounded-r-none border-r-0' : '')} />
                            <span className="shrink-0 px-2 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">{ccy}</span>
                          </div>
                        )}
                        {!isTrailingRow && tpPctNum != null && (
                          <p className="text-[10px] text-slate-600 mt-0.5 font-mono">
                            +{tpPctNum.toFixed(2)}%
                            {rrForTp != null && <span className="ml-1.5 text-emerald-500/70">{rrForTp.toFixed(2)}R</span>}
                          </p>
                        )}
                      </Field>
                      <Field label={<span className={isTrailingRow ? 'text-brand-400' : 'text-emerald-400'}>% alloc.</span>}>
                        <div className="flex">
                          <input type="number" step="1" min="1" max="100"
                            value={tp.pct}
                            onChange={(e) => setTpPct(i, e.target.value)}
                            className={cn(inputCls, 'rounded-r-none border-r-0')}
                            placeholder="50" />
                          <span className="shrink-0 px-2 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">%</span>
                        </div>
                      </Field>
                    </div>
                  )
                })}

                {/* Pct sum indicator */}
                {tpCount > 0 && (
                  <div className={cn('flex items-center gap-1.5 text-[10px] font-semibold',
                    Math.abs(tpPctSum - 100) < 0.5 ? 'text-emerald-400' : tpPctSum > 0 ? 'text-amber-400' : 'text-slate-600')}>
                    <span>Total split: {tpPctSum}%</span>
                    {Math.abs(tpPctSum - 100) >= 0.5 && tpPctSum > 0 && <span className="text-amber-500/70">(must equal 100%)</span>}
                    {Math.abs(tpPctSum - 100) < 0.5 && <span>✓</span>}
                  </div>
                )}
              </div>
            </Section>

            {/* ── 5. SETUP TAGS, NOTES & SCREENSHOTS ───────────────────── */}
            <Section icon="📝" title="Setup tags, notes & screenshots">
              {/* Chart patterns / setup tags */}
              <div>
                <span className="flex items-center gap-1 text-xs font-medium text-slate-400 mb-1.5">
                  Chart patterns / setup tags
                  <Tip text="Technical confluences visible on the chart. These describe what you saw — strategy describes how you trade it." />
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TAGS.map((tag) => (
                    <button key={tag} type="button"
                      onClick={() => setTradeTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )}
                      className={cn(
                        'px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all',
                        tradeTags.includes(tag)
                          ? 'bg-brand-600/25 border-brand-500/50 text-brand-300'
                          : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200'
                      )}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Screenshots */}
              <div className="[overflow-anchor:none]">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400 mb-1.5">
                  <ImagePlus size={12} className="text-slate-500" />
                  Screenshots
                  <span className="text-[10px] text-slate-600 font-normal">(chart setup, confluences)</span>
                </span>
                {screenshotUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {screenshotUrls.map(({ file, url }, idx) => (
                      <div key={url} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-surface-600 bg-surface-700">
                        <img src={url} alt={file.name} className="w-full h-full object-cover" />
                        <button type="button"
                          onClick={() => setEntryScreenshots((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 size={14} className="text-red-400" />
                        </button>
                        <span className="absolute bottom-0 left-0 right-0 text-[9px] text-slate-400 bg-black/60 px-1 truncate">{file.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-surface-500
                  bg-surface-700/30 text-xs text-slate-500 hover:text-slate-300 hover:border-brand-500/50 cursor-pointer transition-colors w-fit">
                  <ImagePlus size={13} />
                  {entryScreenshots.length === 0 ? 'Add screenshot' : 'Add more'}
                  <input type="file" accept="image/*" multiple className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? [])
                      if (files.length) setEntryScreenshots((prev) => [...prev, ...files])
                      e.target.value = ''
                    }} />
                </label>
                <p className="text-[10px] text-slate-600 mt-1">⌘V / Ctrl+V to paste a screenshot</p>
              </div>

              {/* Notes */}
              <Field label="Notes (optional)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Setup rationale, confluences, key levels, market context…"
                  className={cn(inputCls, 'resize-none')}
                />
              </Field>
            </Section>

          </div>{/* end left column */}

          {/* ── RIGHT COLUMN ─────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* ── Spot indicator */}
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
              <TrendingUp size={14} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-300">Long (Buy)</p>
                <p className="text-[10px] text-emerald-400/60">Spot = always a buy. You acquire the asset directly.</p>
              </div>
            </div>

            {/* ── Trade summary ──────────────────────────────────────────── */}
            {(totalCost != null || potentialProfit != null || stopLossAmount != null) && (
              <div className="bg-surface-800 rounded-xl border border-surface-700 p-4 space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">📈 Trade summary</h3>
                <div className="grid grid-cols-1 gap-2">
                  {totalCost != null && (
                    <div className="flex flex-col px-3 py-2.5 rounded-lg border bg-brand-500/10 border-brand-500/30 text-brand-300">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium">Total investment</span>
                      <span className="text-sm font-mono font-bold mt-0.5">{fmt(totalCost)} {ccy}</span>
                      {availableCapital && <span className="text-[10px] text-slate-500 mt-0.5">{((totalCost / availableCapital) * 100).toFixed(1)}% of portfolio</span>}
                    </div>
                  )}
                  {potentialProfit != null && potentialProfit > 0 && (
                    <div className="flex flex-col px-3 py-2.5 rounded-lg border bg-emerald-500/10 border-emerald-500/30 text-emerald-300">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium">Potential profit (TPs)</span>
                      <span className="text-sm font-mono font-bold mt-0.5">+{fmt(potentialProfit)} {ccy}</span>
                      {totalCost && <span className="text-[10px] text-slate-500 mt-0.5">{fmtPct((potentialProfit / totalCost) * 100)} ROI{lastTpIsTrailing ? ' + trailing 🚀' : ''}</span>}
                    </div>
                  )}
                  {stopLossAmount != null && stopLossAmount > 0 && (
                    <div className="flex flex-col px-3 py-2.5 rounded-lg border bg-red-500/10 border-red-500/30 text-red-300">
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium">Max loss (SL hit)</span>
                      <span className="text-sm font-mono font-bold mt-0.5">−{fmt(stopLossAmount)} {ccy}</span>
                      {stopLossPct != null && <span className="text-[10px] text-slate-500 mt-0.5">{fmtPct(-stopLossPct)} from entry</span>}
                    </div>
                  )}
                  {rMultiple != null && (
                    <div className={cn('flex flex-col px-3 py-2.5 rounded-lg border',
                      rMultiple >= 2 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                      rMultiple >= 1 ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' :
                      'bg-red-500/10 border-red-500/30 text-red-300')}>
                      <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium">R:R ratio</span>
                      <span className="text-sm font-mono font-bold mt-0.5">{rMultiple.toFixed(2)}R</span>
                      <span className="text-[10px] text-slate-500 mt-0.5">
                        {rMultiple >= 2 ? 'Good risk/reward' : rMultiple >= 1 ? 'Acceptable' : 'Low R:R'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Expectancy panel ──────────────────────────────────────── */}
            <SpotExpectancyPanel
              totalCost={totalCost}
              potentialProfit={potentialProfit}
              stopLossAmount={stopLossAmount}
              selectedStrategy={selectedStrategy}
              globalWrStats={globalWrStats}
              confidence={confidence}
              ccy={ccy}
              pairVi={pairVi}
            />

            {/* ── Automation toggle — Kraken Spot ──────────────────────── */}
            <div className={cn(
              'flex items-center justify-between gap-4 rounded-xl border p-4',
              automateOnCreate
                ? 'bg-brand-500/10 border-brand-500/30'
                : 'bg-surface-800 border-surface-700',
            )}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Zap size={14} className={automateOnCreate ? 'text-brand-400' : 'text-slate-500'} />
                  <p className="text-sm font-semibold text-slate-200">Enable automation</p>
                </div>
                {profileAutomationEnabled ? (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Places an order on Kraken Spot immediately after creation.
                  </p>
                ) : (
                  <p className="text-[11px] text-amber-400/80 mt-0.5 flex items-center gap-1">
                    <AlertTriangle size={10} className="shrink-0" />
                    Profile automation disabled —{' '}
                    <a href="/settings/automation" className="underline text-amber-400 hover:text-amber-300">
                      Settings → Automation
                    </a>
                  </p>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={automateOnCreate}
                disabled={!profileAutomationEnabled}
                onClick={() => setAutomateOnCreate((v) => !v)}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                  'transition-colors duration-200 focus:outline-none',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                  automateOnCreate ? 'bg-brand-500' : 'bg-surface-500',
                )}
              >
                <span className={cn(
                  'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow',
                  'transition-transform duration-200',
                  automateOnCreate ? 'translate-x-5' : 'translate-x-0',
                )} />
              </button>
            </div>

            {/* ── Submit ────────────────────────────────────────────────── */}
            <button
              type="submit"
              disabled={submitting || !entry || !quantity || !!tpPctError || !tpOrdered || (slNum != null && entryNum != null && slNum >= entryNum)}
              className={cn(
                'w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2',
                'bg-brand-600 hover:bg-brand-500 text-white',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}>
              {submitting
                ? <><Loader2 size={14} className="animate-spin" /> Adding trade…</>
                : <><Plus size={14} /> Add spot trade</>}
            </button>
          </div>

        </div>
      </form>
    </div>
  )
}
