// Active and "earlier" rows of the EMA setups panel.
import { cn } from '../../lib/cn'
import { currentStateLabel, formatWhen, pathLabel, signalLabel, activeLabel } from '../../lib/emaSetups'
import type { EmaOutcome, EmaSetupHistoryOut, EmaSetupOut } from '../../types/api'
import { DirectionIcon, OutcomeBadge, PairName, RowActions, TierBadge } from './EmaSetupBits'

const REGIME_COLOR: Record<string, string> = {
  dead: '#64748b', calm: '#38bdf8', normal: '#a3a3a3', trending: '#34d399', active: '#fbbf24', explosive: '#f87171',
}

export function ActiveRow({ setup, latestIso, isNew, busy, onTogglePin }: {
  setup: EmaSetupOut
  latestIso: string | null
  isNew: boolean
  busy: boolean
  onTogglePin: (pair: string, pinId: number | null) => void
}) {
  const long = setup.direction === 'long'
  const regimeColor = REGIME_COLOR[setup.regime] ?? '#a3a3a3'
  const lifecycle = setup.path.length > 1 ? pathLabel(setup.path) : null
  const age = activeLabel(setup.since, latestIso)

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border py-2 pl-3 pr-2 transition-colors',
        'border-surface-700/70 bg-surface-900/40 hover:border-surface-600 hover:bg-surface-800/80',
        setup.tier === 'prime' && (long ? 'border-l-2 border-l-emerald-400' : 'border-l-2 border-l-rose-400'),
      )}
    >
      <DirectionIcon direction={setup.direction} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PairName pair={setup.pair} />
          <TierBadge tier={setup.tier} direction={setup.direction} label={signalLabel(setup.signal)} />
          {isNew && setup.tier !== 'retest' && (
            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-amber-300">NEW</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[10px] text-slate-500">
          vs EMA{setup.ema_ref_period}
          {age && <> · {age}</>}
          {lifecycle && <> · <span className="text-slate-400">{lifecycle}</span></>}
        </p>
      </div>

      <div className="hidden shrink-0 items-center gap-3 sm:flex">
        <div className="w-20" title={`Volatility ${setup.vi_score.toFixed(2)} · ${setup.regime}`}>
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-mono text-slate-300">{setup.vi_score.toFixed(2)}</span>
            <span style={{ color: regimeColor }} className="capitalize">{setup.regime}</span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-surface-700">
            <div className="h-1 rounded-full" style={{ width: `${Math.min(setup.vi_score, 1) * 100}%`, background: regimeColor }} />
          </div>
        </div>
        <span
          className={cn(
            'w-14 text-right font-mono text-[11px]',
            setup.change_24h == null ? 'text-slate-600' : setup.change_24h >= 0 ? 'text-emerald-400' : 'text-rose-400',
          )}
          title="24h change"
        >
          {setup.change_24h == null ? '—' : `${setup.change_24h >= 0 ? '+' : ''}${setup.change_24h.toFixed(2)}%`}
        </span>
      </div>

      <RowActions
        pair={setup.pair}
        timeframe={setup.timeframe}
        pinned={setup.pin_id != null}
        busy={busy}
        onTogglePin={() => onTogglePin(setup.pair, setup.pin_id)}
      />
    </li>
  )
}

const OUTCOME_BAR: Record<EmaOutcome, string> = {
  holding: 'border-l-emerald-500/70',
  failed: 'border-l-rose-500/70',
  neutral: 'border-l-slate-500/50',
  unknown: 'border-l-surface-600',
}

export function EarlierRow({ item, busy, onTogglePin }: {
  item: EmaSetupHistoryOut
  busy: boolean
  onTogglePin: (pair: string, pinId: number | null) => void
}) {
  const sameRun = item.first_seen === item.last_seen
  const when = sameRun
    ? formatWhen(item.last_seen, item.timeframe)
    : `${formatWhen(item.first_seen, item.timeframe)} → ${formatWhen(item.last_seen, item.timeframe)}`

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-lg border border-l-2 border-surface-700/50 bg-surface-900/20 py-2 pl-3 pr-2 transition-colors',
        'hover:border-surface-600 hover:bg-surface-800/60',
        OUTCOME_BAR[item.outcome],
      )}
    >
      <DirectionIcon direction={item.direction} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PairName pair={item.pair} />
          <TierBadge tier={item.best_tier} direction={item.direction} />
        </div>
        <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
          <span className="text-slate-400">{pathLabel(item.path)}</span>
          <> · {when}</>
          {item.times_seen > 1 && <> · {item.times_seen} runs</>}
          <> · now: <span className="text-slate-400">{currentStateLabel(item.current_signal)}</span></>
        </p>
      </div>
      <OutcomeBadge outcome={item.outcome} nowLabel={currentStateLabel(item.current_signal)} />
      <RowActions
        pair={item.pair}
        timeframe={item.timeframe}
        pinned={item.pin_id != null}
        busy={busy}
        onTogglePin={() => onTogglePin(item.pair, item.pin_id)}
      />
    </li>
  )
}
