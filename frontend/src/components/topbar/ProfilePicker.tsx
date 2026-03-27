// ── ProfilePicker ─────────────────────────────────────────────────────────
// Topbar dropdown to switch the active trading profile.
// Reads from ProfileContext — no local fetch needed.

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, User, TrendingUp, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../../context/ProfileContext'
import { cn } from '../../lib/cn'

const MARKET_COLORS: Record<string, string> = {
  Crypto: 'text-brand-400 bg-brand-600/15 border-brand-600/30',
  CFD:    'text-amber-400 bg-amber-500/10  border-amber-500/30',
}

export function ProfilePicker() {
  const { profiles, activeProfile, setActiveProfileId, loading } = useProfile()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (loading) {
    return (
      <div className="h-7 w-36 rounded-lg bg-surface-700 animate-pulse" />
    )
  }

  if (!activeProfile) {
    return (
      <button
        type="button"
        onClick={() => navigate('/settings/profiles')}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                   bg-brand-600/20 border border-brand-600/40 text-brand-300
                   text-xs font-medium hover:bg-brand-600/30 transition-colors"
      >
        <Plus size={12} />
        Create a profile
      </button>
    )
  }

  return (
    <div ref={ref} className="relative">
      {/* ── Trigger ──────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
          'bg-surface-800 border border-surface-700',
          'hover:border-surface-600 hover:bg-surface-700 transition-colors',
          'text-slate-200 min-w-0 max-w-[200px]',
          open && 'border-brand-600/50 bg-surface-700',
        )}
      >
        <User size={12} className="text-slate-500 shrink-0" />
        <span className="truncate flex-1 text-left">{activeProfile.name}</span>
        <span
          className={cn(
            'px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0',
            MARKET_COLORS[activeProfile.market_type] ?? 'text-slate-400 bg-surface-700 border-surface-600',
          )}
        >
          {activeProfile.market_type}
        </span>
        <ChevronDown
          size={11}
          className={cn('text-slate-500 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {/* ── Dropdown ─────────────────────────────────────────────────── */}
      {open && (
        <div className="
          absolute left-0 top-full mt-1.5 z-50
          w-64 rounded-xl overflow-hidden
          bg-surface-800 border border-surface-700
          shadow-2xl shadow-black/50
        ">
          {/* Profile list */}
          <div className="py-1 max-h-60 overflow-y-auto">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActiveProfileId(p.id)
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-left',
                  'hover:bg-surface-700 transition-colors',
                  p.id === activeProfile.id && 'bg-brand-600/10',
                )}
              >
                {/* Active dot */}
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    p.id === activeProfile.id
                      ? 'bg-brand-400'
                      : 'bg-surface-600',
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-sm truncate font-medium',
                        p.id === activeProfile.id
                          ? 'text-slate-100'
                          : 'text-slate-300',
                      )}
                    >
                      {p.name}
                    </span>
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-semibold border shrink-0',
                        MARKET_COLORS[p.market_type] ?? 'text-slate-400 bg-surface-700 border-surface-600',
                      )}
                    >
                      {p.market_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <TrendingUp size={10} className="text-slate-600" />
                    <span className="text-[11px] text-slate-500 font-mono">
                      {Number(p.capital_current).toLocaleString('en-US', {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                      {p.currency ? ` ${p.currency}` : ''}
                    </span>
                    <span className="text-slate-700 mx-0.5">·</span>
                    <span className="text-[11px] text-slate-500">
                      {p.risk_percentage_default}% risk
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Footer — manage profiles */}
          <div className="border-t border-surface-700 p-1">
            <button
              type="button"
              onClick={() => { navigate('/settings/profiles'); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                         text-xs text-slate-500 hover:text-slate-200
                         hover:bg-surface-700 transition-colors"
            >
              <Plus size={12} />
              Manage profiles
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
