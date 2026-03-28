// ── AutomationToggle ─────────────────────────────────────────────────────────
// Per-trade automation toggle shown in TradeDetailPage.
//
// "isAutomated" is derived from existing KrakenOrder records:
//   - has any order with status 'open'  → entry pending, can cancel
//   - has any order with status 'filled' → live, shows as active (no cancel)
//   - no orders yet                      → can open
//
// Props:
//   tradeId    — trade.id
//   tradeStatus — trade.status ('pending' | 'open' | 'closed')
//   hasOrders  — passed from KrakenOrdersPanel after it fetches; avoids double-fetch
//   hasOpenEntry — true when there is an order with role=entry and status=open
//   onAction   — callback to refresh parent / orders panel
// ────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { automationApi } from '../../lib/api'
import { cn } from '../../lib/cn'

interface Props {
  tradeId:      number
  tradeStatus:  string
  hasOrders:    boolean
  hasOpenEntry: boolean
  onAction:     () => void
}

export function AutomationToggle({ tradeId, tradeStatus, hasOrders, hasOpenEntry, onAction }: Props) {
  const canOpen   = !hasOrders && (tradeStatus === 'pending' || tradeStatus === 'open')
  const canCancel = hasOpenEntry
  const isActive  = hasOrders

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleToggle() {
    setLoading(true)
    setError(null)
    try {
      if (canOpen) {
        await automationApi.openTrade(tradeId)
      } else if (canCancel) {
        await automationApi.cancelEntry(tradeId)
      }
      onAction()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || (!canOpen && !canCancel)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          disabled={disabled}
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
            'transition-colors duration-200 focus:outline-none',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            isActive ? 'bg-brand-500' : 'bg-surface-600',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow',
              'transition-transform duration-200',
              isActive ? 'translate-x-4' : 'translate-x-0',
            )}
          />
        </button>

        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          {loading
            ? <Loader2 size={12} className="animate-spin text-brand-400" />
            : <Zap size={12} className={cn(isActive ? 'text-brand-400' : 'text-slate-600')} />
          }
          {isActive ? 'Automation active' : 'Enable automation'}
        </span>
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {canOpen && (
        <p className="text-[11px] text-slate-600">
          Opens an entry order on Kraken Futures via the configured profile API keys.
        </p>
      )}
    </div>
  )
}
