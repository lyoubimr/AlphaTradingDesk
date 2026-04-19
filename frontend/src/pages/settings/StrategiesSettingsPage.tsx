// ── Strategies Settings ────────────────────────────────────────────────────
//
// Full CRUD for strategies — global (🌐) and profile-specific (👤).
//
// Global strategies (profile_id = NULL):
//   GET    /api/strategies?profile_id={id}    ← also returns profile-specific
//   POST   /api/strategies                    ← create global
//   PUT    /api/strategies/{sid}              ← update global
//   DELETE /api/strategies/{sid}              ← archive global
//
// Profile-specific strategies:
//   POST   /api/profiles/{id}/strategies
//   PUT    /api/profiles/{id}/strategies/{sid}
//   DELETE /api/profiles/{id}/strategies/{sid}
//   POST   /api/profiles/{id}/strategies/{sid}/image
//   DELETE /api/profiles/{id}/strategies/{sid}/image
// ──────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import type React from 'react'
import { Link } from 'react-router-dom'
import {
  BarChart2, Plus, Loader2, RefreshCw, Trash2,
  Pencil, X, Check, BookOpen, ExternalLink, Globe, User, ImagePlus, Maximize2,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { strategiesApi } from '../../lib/api'
import type { Strategy, StrategyCreate, StrategyUpdate } from '../../types/api'
import { cn } from '../../lib/cn'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const inputCls = [
  'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600',
  'text-sm text-slate-200 placeholder-slate-500',
  'focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 transition-colors',
].join(' ')

/** Raw WR — includes ALL trades tagged to this strategy, even non-respected ones. */
function rawWR(s: Strategy): string {
  if (s.trades_count < s.min_trades_for_stats) return 'N/A'
  return `${Math.round((s.win_count / s.trades_count) * 100)}%`
}

/** True if disciplined WR has enough data to be shown. */
function hasDisciplined(s: Strategy): boolean {
  return (s.disciplined_trades_count ?? 0) >= s.min_trades_for_stats
}

/**
 * Primary WR: disciplined (excl. strategy_broken trades) when available.
 * Those trades were taken without the strategy being triggered — they should
 * not affect the strategy's stats.
 */
function primaryWR(s: Strategy): string {
  if (hasDisciplined(s)) {
    const pct = Math.round((s.disciplined_win_count / s.disciplined_trades_count) * 100)
    return `${pct}%`
  }
  return rawWR(s)
}

function wrColor(s: Strategy): string {
  const pct = hasDisciplined(s)
    ? (s.disciplined_win_count / s.disciplined_trades_count) * 100
    : s.trades_count >= s.min_trades_for_stats
      ? (s.win_count / s.trades_count) * 100
      : null
  if (pct === null) return 'text-slate-500'
  if (pct >= 85) return 'text-violet-300'
  if (pct >= 75) return 'text-cyan-300'
  if (pct >= 70) return 'text-emerald-300'
  if (pct >= 60) return 'text-emerald-400'
  if (pct >= 50) return 'text-teal-400'
  if (pct >= 45) return 'text-amber-400'
  if (pct >= 35) return 'text-orange-400'
  return 'text-red-400'
}

// ─────────────────────────────────────────────────────────────────────────────
// StrategySnapshotGallery — multi-screenshot gallery (chart walk-throughs etc.)
// ─────────────────────────────────────────────────────────────────────────────

function StrategySnapshotGallery({
  strategy,
  profileId,
  onUpdated,
}: {
  strategy: Strategy
  /** null = global strategy */
  profileId: number | null
  onUpdated: (s: Strategy) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [deleting,  setDeleting]  = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)
  const [lightbox,  setLightbox]  = useState<string | null>(null)

  const list = strategy.screenshot_urls ?? []

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError(null)
    try {
      const updated = profileId === null
        ? await strategiesApi.addGlobalScreenshot(strategy.id, file)
        : await strategiesApi.addScreenshot(profileId, strategy.id, file)
      onUpdated(updated)
    } catch (ex: unknown) {
      setError((ex as Error).message)
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const handleDelete = async (url: string) => {
    setDeleting(url); setError(null)
    try {
      const updated = profileId === null
        ? await strategiesApi.removeGlobalScreenshot(strategy.id, url)
        : await strategiesApi.removeScreenshot(profileId, strategy.id, url)
      onUpdated(updated)
    } catch (ex: unknown) {
      setError((ex as Error).message)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-[10px] text-slate-500 uppercase tracking-wide flex items-center gap-1">
        <ImagePlus size={10} /> Screenshots
        <span className="text-slate-600 normal-case">(charts, examples · multiple allowed)</span>
      </label>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="screenshot"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 text-slate-400 hover:text-white bg-black/50 rounded-full p-2"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="flex flex-wrap gap-2">
        {list.map((url) => (
          <div
            key={url}
            className="relative group w-24 h-24 rounded-lg overflow-hidden border border-surface-600 bg-surface-700 shrink-0"
          >
            <img
              src={url}
              alt="screenshot"
              className="w-full h-full object-cover cursor-pointer"
              onClick={() => setLightbox(url)}
            />
            <button
              type="button"
              onClick={() => setLightbox(url)}
              className="absolute top-1 left-1 opacity-0 group-hover:opacity-100 bg-black/60 text-white rounded p-0.5 transition-opacity"
            >
              <Maximize2 size={11} />
            </button>
            <button
              type="button"
              onClick={() => void handleDelete(url)}
              disabled={deleting === url}
              className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-red-600/80 text-white rounded p-0.5 transition-opacity disabled:opacity-40"
            >
              {deleting === url ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
            </button>
          </div>
        ))}

        {/* Upload button */}
        <label className={cn(
          'flex flex-col items-center justify-center gap-1 w-24 h-24 rounded-lg border-2 border-dashed cursor-pointer shrink-0 transition-colors',
          uploading
            ? 'border-brand-500/40 bg-brand-500/5 cursor-wait'
            : 'border-surface-600 hover:border-brand-500/50 hover:bg-brand-500/5',
        )}>
          {uploading
            ? <Loader2 size={18} className="text-brand-400 animate-spin" />
            : <ImagePlus size={18} className="text-slate-500" />
          }
          <span className="text-[9px] text-slate-600 text-center leading-tight">
            {uploading ? 'Uploading…' : 'Add\nscreenshot'}
          </span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleUpload(e)}
            disabled={uploading}
          />
        </label>
      </div>

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionHeader
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  count,
  className,
}: {
  icon: React.ReactNode
  label: string
  count: number
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 py-1', className)}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {icon}
        {label}
      </span>
      <span className="text-[10px] font-medium text-slate-600 tabular-nums bg-surface-700 px-1.5 py-0.5 rounded-full">
        {count}
      </span>
      <div className="flex-1 h-px bg-surface-700" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// StrategyRow — read + inline-edit
// ─────────────────────────────────────────────────────────────────────────────

function StrategyRow({
  strategy,
  profileId,
  onUpdated,
  onDeleted,
}: {
  strategy: Strategy
  profileId: number
  onUpdated: (s: Strategy) => void
  onDeleted: (id: number) => void
}) {
  const isGlobal = strategy.profile_id === null

  const [editing,  setEditing]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  const [name,           setName]           = useState(strategy.name)
  const [description,    setDescription]    = useState(strategy.description ?? '')
  const [rules,          setRules]          = useState(strategy.rules ?? '')
  const [emoji,          setEmoji]          = useState(strategy.emoji ?? '')
  const [color,          setColor]          = useState(strategy.color ?? '#6366f1')
  const [minTradesLocal, setMinTradesLocal] = useState(String(strategy.min_trades_for_stats))

  const resetEdit = () => {
    setName(strategy.name)
    setDescription(strategy.description ?? '')
    setRules(strategy.rules ?? '')
    setEmoji(strategy.emoji ?? '')
    setColor(strategy.color ?? '#6366f1')
    setMinTradesLocal(String(strategy.min_trades_for_stats))
    setError(null)
    setEditing(false)
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required.'); return }
    const minT = parseInt(minTradesLocal, 10)
    if (isNaN(minT) || minT < 1) { setError('Min trades must be ≥ 1.'); return }
    setSaving(true); setError(null)
    try {
      const patch: StrategyUpdate = {
        name: name.trim(),
        description: description.trim() || null,
        rules: rules.trim() || null,
        emoji: emoji.trim() || null,
        color: color || null,
        min_trades_for_stats: minT,
      }
      const updated = isGlobal
        ? await strategiesApi.updateGlobal(strategy.id, patch)
        : await strategiesApi.update(profileId, strategy.id, patch)
      onUpdated(updated)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    const label = isGlobal ? 'global' : 'profile'
    if (!confirm(`Archive ${label} strategy "${strategy.name}"? It won't appear in trade forms anymore.`)) return
    setDeleting(true)
    try {
      if (isGlobal) {
        await strategiesApi.archiveGlobal(strategy.id)
      } else {
        await strategiesApi.delete(profileId, strategy.id)
      }
      onDeleted(strategy.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Archive failed.')
      setDeleting(false)
    }
  }

  return (
    <div className={cn(
      'rounded-xl border transition-all',
      editing
        ? 'border-brand-500/40 bg-surface-700/80'
        : 'border-surface-700 bg-surface-800 hover:border-surface-600',
    )}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="w-3 h-3 rounded-full ring-2 ring-offset-1 ring-offset-surface-800 ring-transparent"
            style={{ backgroundColor: strategy.color ?? '#6366f1' }}
          />
          <span className="text-base leading-none">{strategy.emoji ?? '📈'}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            {isGlobal
              ? <span title="Global strategy — shared across all profiles"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-[9px] font-semibold text-cyan-400 uppercase tracking-wide shrink-0">
                  <Globe size={8} /> Global
                </span>
              : <span title="Profile-specific strategy"
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/30 text-[9px] font-semibold text-violet-400 uppercase tracking-wide shrink-0">
                  <User size={8} /> Profile
                </span>
            }
            <p className="text-sm font-semibold text-slate-200 truncate">{strategy.name}</p>
          </div>
          {strategy.description && (
            <p className="text-xs text-slate-500 truncate mt-0.5">{strategy.description}</p>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p
              className={cn('text-sm font-bold tabular-nums', wrColor(strategy))}
              title={hasDisciplined(strategy) ? `WR discipliné — excl. trades pris hors setup de la strat (${strategy.disciplined_trades_count} trades)` : undefined}
            >
              {primaryWR(strategy)}
              {hasDisciplined(strategy) && <span className="text-[9px] text-emerald-400/50 ml-0.5">✓</span>}
            </p>
            <p className="text-[10px] text-slate-600">WR</p>
            {hasDisciplined(strategy) && rawWR(strategy) !== primaryWR(strategy) && (
              <p
                className="text-[9px] text-slate-600 tabular-nums"
                title="WR brut — inclut tous les trades même ceux pris hors setup de la strat"
              >
                {rawWR(strategy)} all
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-sm font-bold text-slate-300 tabular-nums">{strategy.trades_count}</p>
            <p className="text-[10px] text-slate-600">trades</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500 tabular-nums">≥{strategy.min_trades_for_stats}</p>
            <p className="text-[10px] text-slate-600">min</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {editing ? (
            <>
              <button onClick={handleSave} disabled={saving}
                className="p-1.5 rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50" title="Save">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              </button>
              <button onClick={resetEdit} disabled={saving}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-surface-600 transition-colors disabled:opacity-50" title="Cancel">
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(true)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-700 transition-colors" title="Edit">
                <Pencil size={14} />
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50" title="Archive">
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Image preview (outside edit mode) — removed, screenshots gallery below */}

      {/* Screenshot gallery read-view */}
      {!editing && strategy.screenshot_urls && strategy.screenshot_urls.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1.5">Screenshots</p>
          <div className="flex flex-wrap gap-2">
            {strategy.screenshot_urls.map((url) => (
              <div
                key={url}
                className="w-20 h-20 rounded-lg overflow-hidden border border-surface-700 bg-surface-900 cursor-pointer"
                onClick={() => window.open(url, '_blank')}
                title="Open full size"
              >
                <img src={url} alt="screenshot" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Inline edit form */}
      {editing && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-surface-700">
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="flex gap-2">
            <div className="w-20 shrink-0">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Emoji</label>
              <input className={inputCls} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="📈" maxLength={4} />
            </div>
            <div className="w-16 shrink-0">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Color</label>
              <input type="color" className="w-full h-[38px] rounded-lg border border-surface-600 bg-surface-700 cursor-pointer px-1"
                value={color} onChange={e => setColor(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Name *</label>
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Strategy name" maxLength={255} />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Description</label>
            <input className={inputCls} value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description…" />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
              <BookOpen size={10} /> Rules
            </label>
            <textarea className={cn(inputCls, 'h-20 resize-none')} value={rules} onChange={e => setRules(e.target.value)}
              placeholder="Entry criteria, filters, trade management rules…" />
          </div>
          <div className="w-52">
            <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">
              Min trades for WR stats
              <span className="text-slate-600 normal-case text-[9px] ml-1">— per strategy</span>
            </label>
            <input
              type="number"
              min={1}
              max={100}
              className={inputCls}
              value={minTradesLocal}
              onChange={e => setMinTradesLocal(e.target.value)}
            />
          </div>
          {!isGlobal
            ? <StrategySnapshotGallery strategy={strategy} profileId={profileId} onUpdated={onUpdated} />
            : <StrategySnapshotGallery strategy={strategy} profileId={null} onUpdated={onUpdated} />
          }
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AddStrategyForm — Global / Profile toggle
// ─────────────────────────────────────────────────────────────────────────────

function AddStrategyForm({
  profileId,
  onCreated,
  onCancel,
}: {
  profileId: number
  onCreated: (s: Strategy) => void
  onCancel: () => void
}) {
  const [scope,       setScope]       = useState<'global' | 'profile'>('profile')
  const [name,        setName]        = useState('')
  const [description, setDescription] = useState('')
  const [rules,       setRules]       = useState('')
  const [emoji,       setEmoji]       = useState('')
  const [color,       setColor]       = useState('#6366f1')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true); setError(null)
    try {
      const data: StrategyCreate = {
        name: name.trim(),
        description: description.trim() || null,
        rules: rules.trim() || null,
        emoji: emoji.trim() || null,
        color: color || null,
      }
      const created = scope === 'global'
        ? await strategiesApi.createGlobal(data)
        : await strategiesApi.create(profileId, data)
      onCreated(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Creation failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-brand-500/30 bg-surface-800 p-4 space-y-3">
      {/* Header + scope toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-brand-400 uppercase tracking-wide">New strategy</p>
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-surface-700 border border-surface-600">
          <button
            type="button"
            onClick={() => setScope('profile')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              scope === 'profile'
                ? 'bg-violet-600/80 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            <User size={11} /> Profile
          </button>
          <button
            type="button"
            onClick={() => setScope('global')}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all',
              scope === 'global'
                ? 'bg-cyan-600/80 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300',
            )}
          >
            <Globe size={11} /> Global
          </button>
        </div>
      </div>

      {/* Scope info banner */}
      {scope === 'global' ? (
        <div className="flex items-start gap-2 rounded-lg bg-cyan-500/[0.08] border border-cyan-500/20 px-3 py-2">
          <Globe size={12} className="text-cyan-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-cyan-300/80 leading-relaxed">
            <strong className="text-cyan-300">Global strategy</strong> — shared across all profiles.
            Appears in every profile's trade form. Add an image after creation via the edit ✏️ button.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg bg-violet-500/[0.08] border border-violet-500/20 px-3 py-2">
          <User size={12} className="text-violet-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-violet-300/80 leading-relaxed">
            <strong className="text-violet-300">Profile strategy</strong> — only visible to the current profile.
            Supports image upload.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}

      {/* emoji + color + name */}
      <div className="flex gap-2">
        <div className="w-20 shrink-0">
          <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Emoji</label>
          <input className={inputCls} value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="📈" maxLength={4} />
        </div>
        <div className="w-16 shrink-0">
          <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Color</label>
          <input type="color" className="w-full h-[38px] rounded-lg border border-surface-600 bg-surface-700 cursor-pointer px-1"
            value={color} onChange={e => setColor(e.target.value)} />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Name *</label>
          <input className={inputCls} value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. BOS Retest, OB Sweep…" maxLength={255} autoFocus />
        </div>
      </div>

      <div>
        <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Description</label>
        <input className={inputCls} value={description} onChange={e => setDescription(e.target.value)} placeholder="Short description…" />
      </div>

      <div>
        <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1">
          <BookOpen size={10} /> Rules
        </label>
        <textarea className={cn(inputCls, 'h-20 resize-none')} value={rules} onChange={e => setRules(e.target.value)}
          placeholder="Entry criteria, filters, trade management rules…" />
      </div>

      <p className="text-[10px] text-slate-600">💡 Add a strategy image after creation via the edit ✏️ button.</p>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50',
            scope === 'global' ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-violet-600 hover:bg-violet-500',
          )}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Create {scope} strategy
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className="px-4 py-2 rounded-lg border border-surface-600 text-sm text-slate-400 hover:text-slate-200 hover:border-surface-500 transition-colors">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export function StrategiesSettingsPage() {
  const { activeProfile } = useProfile()
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [showAdd,    setShowAdd]    = useState(false)

  const load = useCallback(async () => {
    if (!activeProfile) return
    setLoading(true); setError(null)
    try {
      const data = await strategiesApi.list(activeProfile.id)
      setStrategies(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed.')
    } finally {
      setLoading(false)
    }
  }, [activeProfile])

  useEffect(() => { void load() }, [load])

  const handleUpdated = (updated: Strategy) =>
    setStrategies(prev => prev.map(s => s.id === updated.id ? updated : s))

  const handleDeleted = (id: number) =>
    setStrategies(prev => prev.filter(s => s.id !== id))

  const handleCreated = (created: Strategy) => {
    setStrategies(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
    setShowAdd(false)
  }

  const globalStrategies  = strategies.filter(s => s.profile_id === null)
  const profileStrategies = strategies.filter(s => s.profile_id !== null)
  const hasBoth = globalStrategies.length > 0 && profileStrategies.length > 0

  return (
    <div>
      <PageHeader
        icon="🎯"
        title="Strategies"
        subtitle="Define and manage your trading strategies. Win rate is tracked automatically on every trade close."
      />

      {/* Profile-level thresholds */}
      {activeProfile && (
        <div className="mb-5 rounded-xl border border-surface-700 bg-surface-800 px-5 py-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Profile thresholds</p>
          <div className="rounded-lg bg-surface-700/60 border border-surface-600 px-4 py-3">
            <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">Break-even filter (profile-level)</p>
            <div className="flex items-end gap-3 mt-0.5">
              <p className="text-lg font-bold text-slate-200 tabular-nums">
                {parseFloat(activeProfile.min_pnl_pct_for_stats).toFixed(2)}R
              </p>
            </div>
            <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
              Trades closing within{' '}
              <span className="text-slate-400 font-medium">
                ±{parseFloat(activeProfile.min_pnl_pct_for_stats).toFixed(2)}R
              </span>{' '}of initial risk are excluded from WR stats.{' '}
              e.g. 0.20R on a $12 trade → filtered if |P&amp;L| &lt; $2.40.
            </p>
            <Link
              to="/settings/profiles"
              className="inline-flex items-center gap-1 mt-2 text-[11px] text-brand-400 hover:text-brand-300 transition-colors"
            >
              <ExternalLink size={10} />
              Edit in Profiles settings
            </Link>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart2 size={14} className="text-slate-500" />
          <span className="text-sm text-slate-400">
            {loading ? 'Loading…' : `${strategies.length} strateg${strategies.length === 1 ? 'y' : 'ies'}`}
          </span>
          {!loading && strategies.length > 0 && (globalStrategies.length > 0 || profileStrategies.length > 0) && (
            <span className="text-[11px] text-slate-600">
              ({globalStrategies.length} global · {profileStrategies.length} profile)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-700 transition-colors disabled:opacity-40" title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {!showAdd && (
            <button onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors">
              <Plus size={14} /> New strategy
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {!activeProfile && (
        <div className="rounded-xl border border-surface-700 bg-surface-800 px-6 py-10 text-center">
          <p className="text-slate-400 text-sm">No active profile. Select a profile first.</p>
        </div>
      )}

      {/* Add form */}
      {showAdd && activeProfile && (
        <div className="mb-4">
          <AddStrategyForm profileId={activeProfile.id} onCreated={handleCreated} onCancel={() => setShowAdd(false)} />
        </div>
      )}

      {/* Empty state */}
      {activeProfile && !loading && strategies.length === 0 && !showAdd && (
        <div className="rounded-xl border border-dashed border-surface-600 px-6 py-12 text-center">
          <BarChart2 size={32} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-400 text-sm font-medium mb-1">No strategies yet</p>
          <p className="text-slate-600 text-xs mb-4">Create your first strategy to start tracking your edge.</p>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium transition-colors">
            <Plus size={14} /> Create strategy
          </button>
        </div>
      )}

      {/* Strategy list — sectioned by global / profile */}
      {activeProfile && strategies.length > 0 && (
        <div className="space-y-1">

          {/* Global section */}
          {globalStrategies.length > 0 && (
            <div>
              {hasBoth && (
                <SectionHeader
                  icon={<Globe size={11} className="text-cyan-400" />}
                  label="Global strategies"
                  count={globalStrategies.length}
                  className="mb-2"
                />
              )}
              <div className="space-y-3">
                {globalStrategies.map(s => (
                  <StrategyRow
                    key={s.id}
                    strategy={s}
                    profileId={activeProfile.id}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Profile section */}
          {profileStrategies.length > 0 && (
            <div className={hasBoth ? 'mt-5' : ''}>
              {hasBoth && (
                <SectionHeader
                  icon={<User size={11} className="text-violet-400" />}
                  label="Profile strategies"
                  count={profileStrategies.length}
                  className="mb-2"
                />
              )}
              <div className="space-y-3">
                {profileStrategies.map(s => (
                  <StrategyRow
                    key={s.id}
                    strategy={s}
                    profileId={activeProfile.id}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                  />
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* WR legend */}
      {strategies.length > 0 && (
        <div className="mt-6 rounded-xl border border-surface-700 bg-surface-800 px-5 py-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Win rate legend</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2.5 text-xs">
            <span className="flex items-center gap-2 text-violet-300">
              <span className="w-2.5 h-2.5 rounded-full bg-violet-300 shrink-0" />
              <span><strong>≥ 85%</strong> — Exceptional</span>
            </span>
            <span className="flex items-center gap-2 text-cyan-300">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-300 shrink-0" />
              <span><strong>75–84%</strong> — Outstanding</span>
            </span>
            <span className="flex items-center gap-2 text-emerald-300">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-300 shrink-0" />
              <span><strong>70–74%</strong> — Elite edge</span>
            </span>
            <span className="flex items-center gap-2 text-emerald-400">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
              <span><strong>60–69%</strong> — Strong edge</span>
            </span>
            <span className="flex items-center gap-2 text-teal-400">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-400 shrink-0" />
              <span><strong>50–59%</strong> — Profitable</span>
            </span>
            <span className="flex items-center gap-2 text-amber-400">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
              <span><strong>45–49%</strong> — Developing</span>
            </span>
            <span className="flex items-center gap-2 text-orange-400">
              <span className="w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
              <span><strong>35–44%</strong> — Review needed</span>
            </span>
            <span className="flex items-center gap-2 text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
              <span><strong>&lt; 35%</strong> — High risk</span>
            </span>
            <span className="flex items-center gap-2 text-slate-500 col-span-2 sm:col-span-4 border-t border-surface-700 pt-2 mt-1">
              <span className="w-2.5 h-2.5 rounded-full bg-slate-600 shrink-0" />
              <span><strong>N/A</strong> — Below min trades threshold (not enough data)</span>
            </span>
          </div>
          <p className="text-[10px] text-slate-600 mt-3">
            Break-even trades (abs PnL% &lt; profile BE filter) are excluded from all WR calculations.
          </p>
        </div>
      )}

      {/* Min trades info footer */}
      {activeProfile && (
        <div className="mt-3 rounded-xl border border-surface-700/50 bg-surface-800/40 px-5 py-3 flex items-start gap-3">
          <span className="text-base leading-none mt-0.5 shrink-0">ℹ️</span>
          <div>
            <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-0.5">Min trades for WR (per strategy)</p>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Each strategy has its own minimum trades threshold. WR displays{' '}
              <span className="font-mono text-slate-500">N/A</span> until reached.
              Click <strong className="text-slate-500">✏️</strong> on any strategy to configure it.
              Default: <strong className="text-slate-500">5 trades</strong>.
            </p>
          </div>
        </div>
      )}

    </div>
  )
}
