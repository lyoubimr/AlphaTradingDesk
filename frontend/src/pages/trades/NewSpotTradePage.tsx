// ── /trades/new-spot — Spot trade entry form ─────────────────────────────
// Full-page form iso with NewTradePage (contracts), adapted for spot:
//   • No leverage / margin (quantity × entry = total cost)
//   • Stop loss optional
//   • Up to 3 TP targets with price ↔ pct bidirectional sync
//   • Confidence slider, timeframe chips, session, chart tags, strategy, notes

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp,
  Loader2, AlertTriangle, ChevronDown, Search, X, Plus, Star, ShieldAlert,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { investmentApi, strategiesApi } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { Instrument, Strategy } from '../../types/api'

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
  label, hint, error, children,
}: {
  label: React.ReactNode; hint?: string; error?: string | null; children: React.ReactNode
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
          ? <p className="text-[10px] text-slate-500 mt-1">{hint}</p>
          : null
      }
    </div>
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
    default: 'bg-surface-700/60 border-surface-600    text-slate-200',
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

function PriceInput({
  value, onChange, placeholder, ccy, required,
}: {
  value: string; onChange: (v: string) => void
  placeholder?: string; ccy?: string; required?: boolean
}) {
  return (
    <div className="flex">
      <input
        required={required}
        type="number" step="any" min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '0.00'}
        className={cn(inputCls, ccy ? 'rounded-r-none border-r-0' : '')}
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
]

// ─────────────────────────────────────────────────────────────────────────────
// Tags / Timeframes / Sessions
// ─────────────────────────────────────────────────────────────────────────────

const ALL_TAGS = [
  '📐 Structure', '🔁 Retest',    '📊 Divergence', '🧲 Magnet',
  '📰 News',      '🕯️ Engulfing', '📍 FVG',        '🎯 OB',
  '📈 Breakout',  '📉 Breakdown', '🔄 Range',       '🌊 Trend',
]

const TIMEFRAMES = ['1W', '3D', '1D', '4H', '1H', '15m', '5m'] as const

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

interface TpRow { price: string; pct: string }

function tpPriceFromPct(entry: number, pct: number): string {
  return (entry * (1 + pct / 100)).toFixed(4)
}

function tpPctFromPrice(entry: number, price: number): string {
  return (((price / entry) - 1) * 100).toFixed(2)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function NewSpotTradePage() {
  const navigate     = useNavigate()
  const { activeProfile } = useProfile()

  const [instruments, setInstruments]   = useState<Instrument[]>([])
  const [strategies, setStrategies]     = useState<Strategy[]>([])

  const [instrument, setInstrument]       = useState<Instrument | null>(null)
  const [orderType, setOrderType]         = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [entry, setEntry]                 = useState('')
  // Qty: two synced fields — costInput (USD) ⇔ quantity (base units)
  const [quantity, setQuantity]           = useState('') // base units (e.g. BTC)
  const [costInput, setCostInput]         = useState('') // investment in account ccy
  const lastQtyField                      = useRef<'qty' | 'cost'>('qty')
  const [stopLoss, setStopLoss]           = useState('')
  const [trailingStopPct, setTrailingStopPct] = useState('')

  const [tpCount, setTpCount]           = useState<0 | 1 | 2 | 3>(1)
  const [activePreset, setActivePreset] = useState('Smart Scale')
  const [tps, setTps]                   = useState<TpRow[]>([{ price: '', pct: '' }])

  const [timeframe, setTimeframe]   = useState('')
  const [confidence, setConfidence] = useState(5)
  const [tradeTags, setTradeTags]   = useState<string[]>([])
  const [strategyId, setStrategyId] = useState<number | string>('')
  const [notes, setNotes]           = useState('')

  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)

  const profileId = activeProfile?.id ?? 0
  const ccy       = activeProfile?.currency ?? 'USD'

  // ── Load instruments + strategies ──────────────────────────────────────────
  useEffect(() => {
    if (!profileId) return
    investmentApi.listInstruments(profileId).then(setInstruments).catch(() => {})
    strategiesApi.list(profileId).then(setStrategies).catch(() => {})
  }, [profileId])

  // ── Numerics ───────────────────────────────────────────────────────────────
  const entryNum    = entry    ? Number(entry)    : null
  const quantityNum = quantity ? Number(quantity) : null
  const slNum       = stopLoss ? Number(stopLoss) : null

  const totalCost = useMemo(() => {
    if (entryNum == null || quantityNum == null) return null
    return entryNum * quantityNum
  }, [entryNum, quantityNum])
  // ── Qty ⇔ Cost bidirectional sync ──────────────────────────────
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

  // Re-sync qty ↔ cost when entry price changes
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
      pcts.map((pct, i) => {
        const prevPrice = tps[i]?.price ?? ''
        if (entryNum != null) {
          return { price: tpPriceFromPct(entryNum, pct), pct: String(pct) }
        }
        return { price: prevPrice, pct: String(pct) }
      })
    )
  }, [tps, entryNum])

  // Sync tpCount changes → resize TPs array
  useEffect(() => {
    const count = tpCount
    if (count === 0) { setTps([]); return }
    setTps((prev) => {
      const nextArr: TpRow[] = Array.from({ length: count }, (_, i) => prev[i] ?? { price: '', pct: '' })
      // Apply active preset pcts
      const preset = TP_PRESETS.find((p) => p.label === activePreset)
      if (preset) {
        const pcts = preset.pcts(count)
        return nextArr.map((row, i) => {
          const pct = String(pcts[i])
          const price = entryNum != null ? tpPriceFromPct(entryNum, pcts[i]) : row.price
          return { price, pct }
        })
      }
      return nextArr
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpCount])

  // When entry changes → recompute all TP prices from stored pct
  useEffect(() => {
    if (entryNum == null) return
    setTps((prev) =>
      prev.map((tp) => {
        if (!tp.pct) return tp
        return { ...tp, price: tpPriceFromPct(entryNum, Number(tp.pct)) }
      })
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

  // Validate TP pct sum
  const tpPctSum = tps.reduce((s, tp) => s + (Number(tp.pct) || 0), 0)
  const tpPctError = tpCount > 0 && tps.length > 0
    ? Math.abs(tpPctSum - 100) > 0.5 ? `TP allocations sum to ${tpPctSum.toFixed(0)}% (need 100%)` : null
    : null

  // Validation
  const tpOrdered = tps.every((tp, i) => {
    if (i === 0 || !entryNum) return true
    return !tp.price || !tps[i - 1].price || Number(tp.price) > Number(tps[i - 1].price)
  })

  // ── Computed metrics ────────────────────────────────────────────────────────
  const potentialProfit = useMemo(() => {
    if (!entryNum || !quantityNum || tps.length === 0) return null
    return tps.reduce((sum, tp) => {
      if (!tp.price || !tp.pct) return sum
      const portion = quantityNum * (Number(tp.pct) / 100)
      return sum + (Number(tp.price) - entryNum) * portion
    }, 0)
  }, [entryNum, quantityNum, tps])

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

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (tpPctError || !tpOrdered) return
    setSubmitting(true)
    setError(null)
    try {
      await investmentApi.createTrade(profileId, {
        pair:               instrument?.symbol ?? entry.toUpperCase().trim(),
        entry_price:        entry,
        quantity,
        stop_loss:          stopLoss || null,
        trailing_stop_pct:  trailingStopPct || null,
        order_type:         orderType,
        nb_take_profits:    tpCount,
        tp_targets:         tps.filter((t) => t.price).map((t) => ({
          price:          t.price,
          pct_allocation: Number(t.pct),
        })),
        analyzed_timeframe: timeframe || null,
        confidence_score:   String(confidence),
        strategy_id:        strategyId ? Number(strategyId) : null,
        instrument_id:      instrument?.id ?? null,
        notes:              notes || null,
      })
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
          <button
            type="button"
            onClick={() => navigate('/trades')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-400 hover:text-slate-200 transition-colors border border-surface-600">
            <X size={13} />
            Cancel
          </button>
        }
      />

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

          {/* ── LEFT COLUMN ───────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* Error banner */}
            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-start gap-3">
                <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}

            {/* ── Entry ──────────────────────────────────────────────────── */}
            <Section icon="📍" title="Entry">
              <Field label={<>Instrument <span className="text-red-400">*</span></>}>
                <SpotInstrumentPicker
                  instruments={instruments}
                  value={instrument}
                  onChange={(i) => {
                    setInstrument(i)
                  }}
                />
              </Field>

              {/* Order type */}
              <div className="flex gap-2">
                {(['MARKET', 'LIMIT'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setOrderType(t)}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-xs font-medium transition-colors border',
                      orderType === t
                        ? 'bg-brand-600/30 border-brand-500/50 text-brand-200'
                        : 'bg-surface-700 border-surface-600 text-slate-400 hover:text-slate-200'
                    )}>
                    {t}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={<>Entry price <span className="text-red-400">*</span></>}
                  hint={orderType === 'LIMIT' ? 'Target limit price' : undefined}>
                  <PriceInput
                    required
                    value={entry}
                    onChange={setEntry}
                    ccy={ccy}
                  />
                </Field>
              </div>

              {/* Qty ⇔ Cost — dual synced fields */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium text-slate-400">
                    Quantity <span className="text-red-400">*</span>
                  </span>
                  {quantityNum != null && entryNum != null && (
                    <span className="text-[10px] text-slate-500 font-mono">
                      {fmt(quantityNum, 6)} × {fmt(entryNum)} = <span className="text-brand-300 font-semibold">{fmt(totalCost)} {ccy}</span>
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">Invest ({ccy})</p>
                    <PriceInput
                      value={costInput}
                      onChange={handleCostChange}
                      placeholder="500.00"
                      ccy={ccy}
                    />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">
                      {instrument?.base_currency ? `Units (${instrument.base_currency})` : 'Units'}
                    </p>
                    <PriceInput
                      required
                      value={quantity}
                      onChange={handleQtyChange}
                      placeholder="0.00487"
                      ccy={instrument?.base_currency ?? undefined}
                    />
                  </div>
                </div>
                {instrument?.min_lot && quantityNum != null && Number(instrument.min_lot) > quantityNum && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={10} /> Below minimum lot ({instrument.min_lot} {instrument.base_currency})
                  </p>
                )}
              </div>
            </Section>

            {/* ── Risk management ─────────────────────────────────────────── */}
            <Section icon="🛡️" title="Risk management">
              <div className="grid grid-cols-[1fr_140px] gap-3">
                <Field label="Stop loss (optional)"
                  hint={stopLossAmount != null ? `Potential loss: −${fmt(Math.abs(stopLossAmount))} ${ccy} (${fmtPct(-(stopLossPct ?? 0))})` : 'Leave empty if you manage risk manually'}>
                  <PriceInput
                    value={stopLoss}
                    onChange={setStopLoss}
                    placeholder="Optional guard"
                    ccy={ccy}
                  />
                </Field>
                <Field label="Trailing stop"
                  hint={trailingStopPct && entryNum
                    ? `Init. at ${fmt(entryNum * (1 - Number(trailingStopPct) / 100))} ${ccy}`
                    : 'Optional %'}>
                  <div className="flex">
                    <input
                      type="number" step="0.5" min="0.5" max="50"
                      value={trailingStopPct}
                      onChange={(e) => setTrailingStopPct(e.target.value)}
                      placeholder="5"
                      className={cn(inputCls, 'rounded-r-none border-r-0')}
                    />
                    <span className="shrink-0 px-2.5 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">%</span>
                  </div>
                </Field>
              </div>

              {/* SL warning: SL above entry */}
              {entryNum != null && slNum != null && slNum >= entryNum && (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <ShieldAlert size={12} className="text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-300">Stop loss must be below entry price for a long (buy) trade.</p>
                </div>
              )}

              {/* TP section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">Take profit targets</span>
                  <div className="flex gap-1">
                    {([0, 1, 2, 3] as const).map((n) => (
                      <button key={n} type="button"
                        onClick={() => setTpCount(n)}
                        className={cn(
                          'w-7 h-7 rounded-md text-xs font-medium transition-colors',
                          tpCount === n
                            ? 'bg-brand-600/40 text-brand-200 border border-brand-500/50'
                            : 'bg-surface-700 text-slate-500 hover:text-slate-300 border border-surface-600'
                        )}>
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
                        className={cn(
                          'px-2 py-1 rounded-md text-[10px] font-medium transition-colors border',
                          activePreset === p.label
                            ? 'bg-brand-600/30 border-brand-500/40 text-brand-300'
                            : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300'
                        )}>
                        {p.emoji} {p.label}
                      </button>
                    ))}
                  </div>
                )}

                {tpPctError && (
                  <p className="text-[10px] text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={10} />{tpPctError}
                  </p>
                )}

                {/* TP rows */}
                {tps.map((tp, i) => (
                  <div key={i} className="grid grid-cols-[1fr_100px] gap-2 items-center">
                    <Field
                      label={<span className="text-emerald-400">TP{i + 1} price</span>}
                      error={
                        !tpOrdered && i > 0 && tp.price && tps[i - 1].price && Number(tp.price) <= Number(tps[i - 1].price)
                          ? `TP${i + 1} must be above TP${i}`
                          : null
                      }>
                      <PriceInput
                        value={tp.price}
                        onChange={(v) => setTpPrice(i, v)}
                        ccy={ccy}
                      />
                    </Field>
                    <Field label={<span className="text-emerald-400">% alloc.</span>}>
                      <div className="flex">
                        <input
                          type="number" step="1" min="1" max="100"
                          value={tp.pct}
                          onChange={(e) => setTpPct(i, e.target.value)}
                          className={cn(inputCls, 'rounded-r-none border-r-0')}
                          placeholder="50"
                        />
                        <span className="shrink-0 px-2 py-2 rounded-r-lg border border-surface-600 bg-surface-700/60 text-xs text-slate-500">%</span>
                      </div>
                    </Field>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── Analysis ─────────────────────────────────────────────────── */}
            <Section icon="📊" title="Analysis">
              {/* Timeframe */}
              <Field label="Timeframe">
                <div className="flex flex-wrap gap-1.5">
                  {TIMEFRAMES.map((tf) => (
                    <button key={tf} type="button"
                      onClick={() => setTimeframe(timeframe === tf ? '' : tf)}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors border',
                        timeframe === tf
                          ? 'bg-brand-600/30 border-brand-500/40 text-brand-200'
                          : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300'
                      )}>
                      {tf}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Confidence slider */}
              <Field
                label={
                  <span className="flex items-center gap-2">
                    Confidence
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-bold',
                      confidence >= 8 ? 'bg-emerald-500/20 text-emerald-300' :
                      confidence >= 6 ? 'bg-brand-500/20 text-brand-300' :
                      confidence >= 4 ? 'bg-amber-500/20 text-amber-300' :
                      'bg-red-500/20 text-red-300'
                    )}>
                      {confidence}/10
                    </span>
                  </span>
                }>
                <div className="space-y-1.5">
                  <input
                    type="range" min={1} max={10} step={1}
                    value={confidence}
                    onChange={(e) => setConfidence(Number(e.target.value))}
                    className="w-full accent-brand-500 h-1.5"
                  />
                  <div className="flex justify-between text-[9px] text-slate-600 font-medium">
                    <span>1 Low</span><span>5 Neutral</span><span>10 High</span>
                  </div>
                </div>
              </Field>

              {/* Tags */}
              <Field label="Chart patterns">
                <div className="flex flex-wrap gap-1.5">
                  {ALL_TAGS.map((tag) => (
                    <button key={tag} type="button"
                      onClick={() => setTradeTags((prev) =>
                        prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                      )}
                      className={cn(
                        'px-2 py-1 rounded-md text-[10px] font-medium transition-colors border',
                        tradeTags.includes(tag)
                          ? 'bg-brand-600/25 border-brand-500/40 text-brand-200'
                          : 'bg-surface-700 border-surface-600 text-slate-500 hover:text-slate-300'
                      )}>
                      {tag}
                    </button>
                  ))}
                </div>
              </Field>

            </Section>
          </div>

          {/* ── RIGHT COLUMN ───────────────────────────────────────────────── */}
          <div className="space-y-5">

            {/* ── Summary ──────────────────────────────────────────────────── */}
            {(totalCost != null || potentialProfit != null || stopLossAmount != null) && (
              <div className="bg-surface-800 rounded-xl border border-surface-700 p-4 space-y-3">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">📈 Trade summary</h3>
                <div className="grid grid-cols-1 gap-2">
                  {totalCost != null && (
                    <CalcPill label="Total investment" value={`${fmt(totalCost)} ${ccy}`} color="blue" />
                  )}
                  {potentialProfit != null && potentialProfit > 0 && (
                    <CalcPill
                      label="Potential profit (TPs)"
                      value={`+${fmt(potentialProfit)} ${ccy}`}
                      color="green"
                      sub={totalCost ? fmtPct((potentialProfit / totalCost) * 100) + ' ROI' : undefined}
                    />
                  )}
                  {stopLossAmount != null && stopLossAmount > 0 && (
                    <CalcPill
                      label="Max loss (SL hit)"
                      value={`-${fmt(stopLossAmount)} ${ccy}`}
                      color="red"
                      sub={stopLossPct != null ? fmtPct(-stopLossPct) + ' from entry' : undefined}
                    />
                  )}
                  {rMultiple != null && (
                    <CalcPill
                      label="R:R ratio"
                      value={`${rMultiple.toFixed(1)}R`}
                      color={rMultiple >= 2 ? 'green' : rMultiple >= 1 ? 'amber' : 'red'}
                      sub={rMultiple >= 2 ? 'Good risk/reward' : rMultiple >= 1 ? 'Acceptable' : 'Low R:R'}
                    />
                  )}
                </div>
              </div>
            )}

            {/* ── Strategy & Notes ──────────────────────────────────────────── */}
            <Section icon="📋" title="Strategy & Notes">
              <Field label="Strategy">
                <select
                  value={strategyId}
                  onChange={(e) => setStrategyId(e.target.value)}
                  className={inputCls}>
                  <option value="">None (optional)</option>
                  {strategies.filter((s) => s.profile_id === null).length > 0 && (
                    <optgroup label="🌐 Global">
                      {strategies.filter((s) => s.profile_id === null).map((s) => (
                        <option key={s.id} value={s.id}>{s.emoji ? `${s.emoji} ` : ''}{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {strategies.filter((s) => s.profile_id !== null).length > 0 && (
                    <optgroup label="👤 Profile">
                      {strategies.filter((s) => s.profile_id !== null).map((s) => (
                        <option key={s.id} value={s.id}>{s.emoji ? `${s.emoji} ` : ''}{s.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </Field>

              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                  placeholder="Entry rationale, key levels, macro context…"
                  className={cn(inputCls, 'resize-none')}
                />
              </Field>
            </Section>

            {/* ── Direction reminder (spot = always BUY) ───────────────────── */}
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-3">
              <TrendingUp size={14} className="text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-emerald-300">Long (Buy)</p>
                <p className="text-[10px] text-emerald-400/60">Spot trading is always a buy — you acquire the asset.</p>
              </div>
            </div>

            {/* ── Submit ───────────────────────────────────────────────────── */}
            <button
              type="submit"
              disabled={submitting || !entry || !quantity || !!tpPctError || !tpOrdered || (slNum != null && entryNum != null && slNum >= entryNum)}
              className={cn(
                'w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2',
                'bg-brand-600 hover:bg-brand-500 text-white',
                'disabled:opacity-40 disabled:cursor-not-allowed'
              )}>
              {submitting ? (
                <><Loader2 size={14} className="animate-spin" /> Adding trade…</>
              ) : (
                <><Plus size={14} /> Add trade</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
