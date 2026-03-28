// ── KrakenOrdersPanel ────────────────────────────────────────────────────────
// Shows the list of Kraken execution orders for a trade + the AutomationToggle.
// Also exposes hasOrders / hasOpenEntry upward via onOrdersLoaded so the parent
// (TradeDetailPage) can pass them down to AutomationToggle.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { automationApi } from '../../lib/api'
import { useApi } from '../../hooks/useApi'
import { AutomationStatusBadge } from './AutomationStatusBadge'
import { AutomationToggle } from './AutomationToggle'
import type { KrakenOrderOut } from '../../types/api'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

interface Props {
  tradeId:          number
  tradeStatus:      string
  onOrdersLoaded?:  (orders: KrakenOrderOut[]) => void
}

export function KrakenOrdersPanel({ tradeId, tradeStatus, onOrdersLoaded }: Props) {
  const { data: orders, loading, error, refetch } = useApi(
    () => automationApi.getOrders(tradeId),
    [tradeId],
  )

  // Notify parent whenever orders change
  useEffect(() => {
    if (orders !== null) {
      onOrdersLoaded?.(orders)
    }
  }, [orders, onOrdersLoaded])

  const hasOrders    = (orders?.length ?? 0) > 0
  const hasOpenEntry = orders?.some((o) => o.role === 'entry' && o.status === 'open') ?? false

  return (
    <div className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-surface-700 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-widest">
          Kraken Execution
        </h3>
        <button
          type="button"
          onClick={refetch}
          className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-surface-700 transition-colors"
          title="Refresh orders"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* ── Toggle ────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-surface-700">
        <AutomationToggle
          tradeId={tradeId}
          tradeStatus={tradeStatus}
          hasOrders={hasOrders}
          hasOpenEntry={hasOpenEntry}
          onAction={refetch}
        />
      </div>

      {/* ── Orders table ──────────────────────────────────────────────────── */}
      <div className="px-4 py-3">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
            <Loader2 size={12} className="animate-spin" />
            Loading orders…
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400 py-2">{error}</p>
        )}

        {!loading && !error && orders !== null && orders.length === 0 && (
          <p className="text-xs text-slate-600 py-2">No execution orders yet for this trade.</p>
        )}

        {!loading && orders && orders.length > 0 && (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-600">
                  <th className="pb-2 pr-3 font-medium">Role / Status</th>
                  <th className="pb-2 pr-3 font-medium">Order ID</th>
                  <th className="pb-2 pr-3 font-medium">Side</th>
                  <th className="pb-2 pr-3 font-medium">Size</th>
                  <th className="pb-2 pr-3 font-medium">Limit</th>
                  <th className="pb-2 pr-3 font-medium">Filled @ </th>
                  <th className="pb-2 font-medium">Sent</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-t border-surface-700">
                    <td className="py-1.5 pr-3">
                      <AutomationStatusBadge role={o.role} status={o.status} size="xs" />
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-slate-400 truncate max-w-[120px]">
                      {o.kraken_order_id ?? '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-400 uppercase">{o.side}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{o.size}</td>
                    <td className="py-1.5 pr-3 text-slate-400">
                      {o.limit_price != null ? o.limit_price : '—'}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-400">
                      {o.filled_price != null ? `${o.filled_price}` : '—'}
                    </td>
                    <td className="py-1.5 text-slate-500">{fmtDate(o.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {orders?.some((o) => o.status === 'error') && (
          <div className="mt-2 space-y-1">
            {orders.filter((o) => o.status === 'error').map((o) => (
              <p key={o.id} className="text-[11px] text-red-400">
                [{o.role.toUpperCase()}] {o.error_message}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
