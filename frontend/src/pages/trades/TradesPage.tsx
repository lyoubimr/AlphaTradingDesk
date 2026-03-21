// ── Trade Journal page ─────────────────────────────────────────────────────
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Plus, Filter, Download, X, Loader2, RefreshCw } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '../../components/ui/PageHeader'
import { Badge } from '../../components/ui/Badge'
import { StatCard } from '../../components/ui/StatCard'
import { useProfile } from '../../context/ProfileContext'
import { tradesApi, strategiesApi } from '../../lib/api'
import type { TradeListItem, Strategy } from '../../types/api'

// ── Status badge ──────────────────────────────────────────────────────────
function StatusBadge({ status, orderType }: { status: string; orderType?: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:   { label: '⏳ Pending',   className: 'text-yellow-300 bg-yellow-500/10 border border-yellow-500/30' },
    open:      { label: 'Open',         className: 'text-brand-300 bg-brand-600/15 border border-brand-600/30' },
    partial:   { label: 'Partial',      className: 'text-amber-300 bg-amber-500/10 border border-amber-500/30' },
    closed:    { label: 'Closed',       className: 'text-slate-400 bg-surface-700 border border-surface-600' },
    cancelled: { label: 'Cancelled',    className: 'text-slate-600 bg-surface-800 border border-surface-700 line-through' },
  }
  const s = map[status] ?? { label: status, className: 'text-slate-500' }
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${s.className}`}>
      {s.label}
      {status === 'pending' && orderType === 'LIMIT' && (
        <span className="text-yellow-600 font-mono">LIMIT</span>
      )}
    </span>
  )
}

// ── Derived KPIs ──────────────────────────────────────────────────────────
function deriveKPIs(trades: TradeListItem[]) {
  const closed   = trades.filter((t) => t.status === 'closed')
  const openList = trades.filter((t) => t.status === 'open' || t.status === 'partial')
  const wins     = closed.filter((t) => t.realized_pnl && parseFloat(t.realized_pnl) > 0)
  const winRate  = closed.length >= 5
    ? `${((wins.length / closed.length) * 100).toFixed(1)}%`
    : '—'
  // Total P&L = sum of realized_pnl (closed) + booked_pnl (partial positions already taken)
  const totalPnl = trades.reduce((acc, t) => {
    if (t.status === 'closed') return acc + parseFloat(t.realized_pnl ?? '0')
    if (t.booked_pnl) return acc + parseFloat(t.booked_pnl)
    return acc
  }, 0)
  const hasPnl = closed.length > 0 || trades.some((t) => t.booked_pnl)
  const sign = totalPnl >= 0 ? '+' : ''
  return {
    total:       trades.length,
    openCount:   openList.length,
    winRate,
    winRateSub:  closed.length < 5 ? 'Min 5 closed trades' : `${wins.length}/${closed.length} wins`,
    totalPnl:    hasPnl ? `${sign}$${totalPnl.toFixed(2)}` : '—',
    totalPnlPos: totalPnl >= 0,
  }
}

export function TradesPage() {
  const navigate = useNavigate()
  const { activeProfile } = useProfile()

  const [trades, setTrades]         = useState<TradeListItem[]>([])
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<number | null>(null)
  const [activating, setActivating] = useState<number | null>(null)
  const [strategies, setStrategies] = useState<Strategy[]>([])

  const strategyMap = useMemo(
    () => new Map(strategies.map((s) => [s.id, s])),
    [strategies],
  )

  const fetchTrades = useCallback(() => {
    if (!activeProfile) { setTrades([]); return }
    setLoading(true)
    setError(null)
    tradesApi
      .list(activeProfile.id)
      .then(setTrades)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [activeProfile])

  useEffect(() => { fetchTrades() }, [fetchTrades])

  // Load strategies (global + profile) to resolve names in trade rows
  useEffect(() => {
    if (!activeProfile) { setStrategies([]); return }
    strategiesApi.list(activeProfile.id).then(setStrategies).catch(() => setStrategies([]))
  }, [activeProfile])

  async function handleCancel(tradeId: number) {
    if (!confirm('Cancel this LIMIT order? It will be marked as cancelled with no capital or win-rate impact.')) return
    setCancelling(tradeId)
    try {
      await tradesApi.cancel(tradeId)
      setTrades((prev) =>
        prev.map((t) => t.id === tradeId ? { ...t, status: 'cancelled' as const } : t)
      )
    } catch (e: unknown) {
      alert(`Cancel failed: ${(e as Error).message}`)
    } finally {
      setCancelling(null)
    }
  }

  async function handleActivate(tradeId: number) {
    if (!confirm('Mark this LIMIT order as triggered? It will become an active trade and reserve capital-risk.')) return
    setActivating(tradeId)
    try {
      await tradesApi.activate(tradeId)
      setTrades((prev) =>
        prev.map((t) => t.id === tradeId ? { ...t, status: 'open' as const } : t)
      )
    } catch (e: unknown) {
      alert(`Activate failed: ${(e as Error).message}`)
    } finally {
      setActivating(null)
    }
  }

  const kpis = deriveKPIs(trades)

  return (
    <div>
      <PageHeader
        icon="📒"
        title="Trade Journal"
        subtitle="Log, review, and analyse every trade you take"
        info="Each trade can have multiple take-profit positions (multi-TP). Win rate is only shown after 5+ trades."
        actions={
          <>
            <button
              type="button"
              className="atd-btn-ghost"
              onClick={fetchTrades}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" className="atd-btn-ghost hidden sm:inline-flex" disabled>
              <Filter size={14} /> Filters
            </button>
            <button type="button" className="atd-btn-ghost hidden sm:inline-flex" disabled>
              <Download size={14} /> Export
            </button>
            <button
              type="button"
              className="atd-btn-primary"
              onClick={() => navigate('/trades/new')}
            >
              <Plus size={14} /> New Trade
            </button>
          </>
        }
      />

      {/* ── KPIs ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Trades"
          value={loading ? '…' : String(kpis.total)}
          sub={loading ? '' : `${kpis.openCount} open`}
          accent="brand"
          info="Total trades in your journal (open + partial + closed)."
        />
        <StatCard
          label="Win Rate"
          value={loading ? '…' : kpis.winRate}
          sub={loading ? '' : kpis.winRateSub}
          accent="bull"
          info="Win rate across closed trades. Requires at least 5 closed trades to be meaningful."
        />
        <StatCard
          label="Avg R:R"
          value="—"
          sub="Coming soon"
          accent="neutral"
          info="Average realised risk-to-reward ratio across all closed trades."
        />
        <StatCard
          label="Total P&L"
          value={loading ? '…' : kpis.totalPnl}
          sub="Closed trades only"
          accent={kpis.totalPnl.startsWith('-') ? 'bear' : kpis.totalPnl === '—' ? 'neutral' : 'bull'}
          info="Sum of P&L for all closed trades. Does not include open positions."
        />
      </div>

      {/* ── Error state ───────────────────────────────────────────────── */}
      {error && (
        <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          ⚠️ {error}
        </div>
      )}

      {/* ── No active profile ─────────────────────────────────────────── */}
      {!activeProfile && !loading && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 p-10 text-center text-slate-500 text-sm">
          Select or create a profile to view your trades.
        </div>
      )}

      {/* ── Trades table ──────────────────────────────────────────────── */}
      {activeProfile && (
        <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden mb-6">
          {/* Table header bar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700">
            <span className="text-sm font-medium text-slate-400">
              Recent Trades
              {!loading && trades.length > 0 && (
                <span className="ml-2 text-xs text-slate-600">({trades.length})</span>
              )}
            </span>
            {loading
              ? <Loader2 size={14} className="animate-spin text-slate-600" />
              : trades.length === 0
                ? <Badge label="No trades yet" variant="neutral" />
                : null
            }
          </div>

          {/* Empty state */}
          {!loading && trades.length === 0 && (
            <div className="px-5 py-12 text-center text-slate-600 text-sm">
              No trades logged yet.{' '}
              <button
                type="button"
                className="text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors"
                onClick={() => navigate('/trades/new')}
              >
                Log your first trade →
              </button>
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="px-5 py-8 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-7 rounded bg-surface-700 animate-pulse" />
              ))}
            </div>
          )}

          {/* ── Mobile card list ───────────────────────────────────────── */}
          {!loading && trades.length > 0 && (
            <div className="sm:hidden divide-y divide-surface-700/50">
              {trades.map((t) => {
                const pnlNum = t.realized_pnl
                  ? parseFloat(t.realized_pnl)
                  : t.booked_pnl
                    ? parseFloat(t.booked_pnl)
                    : null
                const isBull = pnlNum !== null && pnlNum > 0
                const isBear = pnlNum !== null && pnlNum < 0
                return (
                  <div
                    key={t.id}
                    onClick={() => navigate(`/trades/${t.id}`)}
                    className={cn(
                      'px-4 py-3 cursor-pointer transition-colors',
                      t.status === 'cancelled' ? 'opacity-40' : 'hover:bg-surface-700/30',
                    )}>
                    {/* pair + direction + status */}
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn(
                          'text-xs font-bold shrink-0',
                          t.direction === 'LONG' ? 'text-green-400' : 'text-red-400',
                        )}>
                          {t.direction}
                        </span>
                        <span className="text-sm font-semibold text-slate-200 truncate">
                          {t.instrument_display_name ?? t.pair}
                        </span>
                      </div>
                      <StatusBadge status={t.status} orderType={t.order_type} />
                    </div>
                    {/* date + entry + pnl */}
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-slate-500">
                        {(t.entry_date || t.created_at)
                          ? new Date(t.entry_date ?? t.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
                          : '—'}
                        {' · '}
                        <span className="text-slate-600">@ {parseFloat(t.entry_price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 })}</span>
                      </span>
                      {pnlNum !== null ? (
                        <span className={cn('font-semibold', isBull ? 'text-green-400' : isBear ? 'text-red-400' : 'text-slate-400')}>
                          {isBull ? '+' : ''}{pnlNum.toFixed(2)}
                        </span>
                      ) : (t.status === 'open' || t.status === 'partial') ? (
                        <span className="text-brand-500/60">Open</span>
                      ) : null}
                    </div>
                    {/* strategy chips */}
                    {t.strategy_ids && t.strategy_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {t.strategy_ids.map((sid) => {
                          const s = strategyMap.get(sid)
                          return (
                            <span key={sid} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-brand-600/15 border border-brand-500/30 text-[10px] font-medium text-brand-300">
                              {s?.emoji && <span>{s.emoji}</span>}
                              {s?.name ?? `#${sid}`}
                            </span>
                          )
                        })}
                      </div>
                    )}
                    {/* pending actions */}
                    {t.status === 'pending' && (
                      <div className="flex gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          disabled={activating === t.id}
                          onClick={() => handleActivate(t.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-medium text-green-400 bg-green-500/10 border border-green-500/30 disabled:opacity-40">
                          {activating === t.id ? <Loader2 size={10} className="animate-spin" /> : <span>▶</span>}
                          Activate
                        </button>
                        <button
                          type="button"
                          disabled={cancelling === t.id}
                          onClick={() => handleCancel(t.id)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-medium text-slate-400 border border-surface-600 disabled:opacity-40">
                          {cancelling === t.id ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {/* ── Desktop table ───────────────────────────────────────────── */}
          {!loading && trades.length > 0 && (
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-surface-700">
                    {['Date', 'Pair', 'Side', 'Status', 'Entry', 'Stop Loss', 'Risk', 'Strategy', 'P&L', ''].map((h, i) => (
                      <th
                        key={i}
                        className="px-4 py-2.5 text-left text-slate-600 font-medium uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    const pnlNum         = t.realized_pnl ? parseFloat(t.realized_pnl)
                                         : t.booked_pnl   ? parseFloat(t.booked_pnl)
                                         : null
                    const isBull         = pnlNum !== null && pnlNum > 0
                    const isBear         = pnlNum !== null && pnlNum < 0
                    const isActivatable  = t.status === 'pending'
                    const isCancellable  = t.status === 'pending'
                    const isActivating_  = activating === t.id
                    const isCancelling_  = cancelling === t.id
                    const isDimmed       = t.status === 'cancelled'

                    return (
                      <tr
                        key={t.id}
                        onClick={() => navigate(`/trades/${t.id}`)}
                        className={`border-b border-surface-700/50 transition-colors cursor-pointer ${
                          isDimmed
                            ? 'opacity-40 hover:opacity-60'
                            : 'hover:bg-surface-700/30'
                        }`}
                      >
                        {/* Date */}
                        <td className="px-4 py-2.5 text-slate-500 font-mono whitespace-nowrap">
                          {(t.entry_date || t.created_at)
                            ? new Date(t.entry_date ?? t.created_at).toLocaleDateString('en-GB', {
                                day: '2-digit', month: 'short', year: '2-digit',
                              })
                            : '—'}
                        </td>

                        {/* Pair */}
                        <td className="px-4 py-2.5 font-medium">
                          <span className="text-slate-200">{t.instrument_display_name ?? t.pair}</span>
                          {t.instrument_display_name && (
                            <span className="ml-1.5 text-[10px] text-slate-600 font-mono">{t.pair}</span>
                          )}
                        </td>

                        {/* Direction */}
                        <td className="px-4 py-2.5">
                          <span className={t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                            {t.direction}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-2.5">
                          <StatusBadge status={t.status} orderType={t.order_type} />
                        </td>

                        {/* Entry */}
                        <td className="px-4 py-2.5 text-slate-400 tabular-nums font-mono">
                          {parseFloat(t.entry_price).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 5,
                          })}
                        </td>

                        {/* Stop loss */}
                        <td className="px-4 py-2.5 text-red-500/70 tabular-nums font-mono">
                          {parseFloat(t.stop_loss).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 5,
                          })}
                        </td>

                        {/* Risk */}
                        <td className="px-4 py-2.5 text-slate-500 tabular-nums">
                          ${parseFloat(t.risk_amount).toFixed(2)}
                        </td>

                        {/* Strategy badges */}
                        <td className="px-4 py-2.5">
                          {t.strategy_ids && t.strategy_ids.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {t.strategy_ids.map((sid) => {
                                const s = strategyMap.get(sid)
                                return (
                                  <span key={sid}
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded
                                      bg-brand-600/15 border border-brand-500/30 text-[10px] font-medium text-brand-300 whitespace-nowrap">
                                    {s?.emoji && <span>{s.emoji}</span>}
                                    {s?.name ?? `#${sid}`}
                                  </span>
                                )
                              })}
                            </div>
                          ) : (
                            <span className="text-slate-700 text-[10px]">—</span>
                          )}
                        </td>

                        {/* P&L */}
                        <td className="px-4 py-2.5 tabular-nums font-mono">
                          {pnlNum !== null ? (
                            <span className={isBull ? 'text-green-400' : isBear ? 'text-red-400' : 'text-slate-400'}>
                              {isBull ? '+' : ''}{pnlNum.toFixed(2)}
                              {/* Show TP marker for partial booked P&L */}
                              {!t.realized_pnl && t.booked_pnl && (
                                <span className="ml-1 text-[9px] text-slate-500">partial</span>
                              )}
                            </span>
                          ) : t.status === 'cancelled' ? (
                            <span className="text-slate-700">—</span>
                          ) : (
                            <span className="text-brand-500/60">Open</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1.5">
                            {/* Activate — pending LIMIT only */}
                            {isActivatable && (
                              <button
                                type="button"
                                disabled={isActivating_}
                                onClick={() => handleActivate(t.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium
                                           text-green-400 hover:text-green-300 hover:bg-green-500/10
                                           border border-transparent hover:border-green-500/30
                                           transition-colors disabled:opacity-40"
                                title="Mark this LIMIT order as triggered — reserves capital-risk"
                              >
                                {isActivating_
                                  ? <Loader2 size={10} className="animate-spin" />
                                  : <span>▶</span>
                                }
                                Activate
                              </button>
                            )}
                            {/* Cancel — pending LIMIT only */}
                            {isCancellable && (
                              <button
                                type="button"
                                disabled={isCancelling_}
                                onClick={() => handleCancel(t.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium
                                           text-slate-500 hover:text-red-400 hover:bg-red-500/10
                                           border border-transparent hover:border-red-500/30
                                           transition-colors disabled:opacity-40"
                                title="Cancel this LIMIT order — no capital or win-rate impact"
                              >
                                {isCancelling_
                                  ? <Loader2 size={10} className="animate-spin" />
                                  : <X size={10} />
                                }
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
