// ── Notification Settings page ───────────────────────────────────────────────
// P2-15 — Settings > Notifications: Telegram bots + Market VI alerts + Watchlist alerts
//
// Backend:
//   GET  /api/volatility/notifications/{profile_id}  → NotificationSettingsOut
//   PUT  /api/volatility/notifications/{profile_id}  → merge-patch
//   POST /api/volatility/notifications/{profile_id}/test → send test Telegram message
// ───────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, useCallback } from 'react'
import {
  Save, Loader2, RefreshCw, Check, AlertTriangle, Plus, Trash2, Send, Bell,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { useProfile } from '../../context/ProfileContext'
import { volatilityApi } from '../../lib/api'
import { cn } from '../../lib/cn'

// ── Local types ──────────────────────────────────────────────────────────────

interface TelegramBot {
  bot_name?: string
  bot_token: string
  chat_id: string
}

interface VILevel {
  id: string
  label?: string
  type: 'crossing' | 'range'
  value?: number          // 0–100, for type='crossing'
  direction?: 'both' | 'up' | 'down'
  min?: number            // 0–100, for type='range'
  max?: number            // 0–100, for type='range'
  enabled: boolean
  cooldown_min: number
}

interface MarketVIAlertsCfg {
  enabled: boolean
  bot_name?: string
  cooldown_min: number
  regimes: string[]
  vi_levels: VILevel[]
}

interface TFAlertCfg {
  enabled: boolean
  cooldown_min: number
  vi_min: number
}

interface WatchlistAlertsCfg {
  enabled: boolean
  bot_name?: string
  per_tf: Partial<Record<string, TFAlertCfg>>
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const D_MVI_ALERTS: MarketVIAlertsCfg = {
  enabled: false,
  cooldown_min: 60,
  regimes: ['ACTIVE', 'EXTREME'],
  vi_levels: [],
}

const D_TF_ALERT: TFAlertCfg = { enabled: false, cooldown_min: 30, vi_min: 0.5 }

const D_WL_ALERTS: WatchlistAlertsCfg = {
  enabled: false,
  per_tf: {},
}

// ── Constants ─────────────────────────────────────────────────────────────────

const REGIMES = ['DEAD', 'CALM', 'NORMAL', 'TRENDING', 'ACTIVE', 'EXTREME'] as const
const WL_TFS = ['15m', '1h', '4h', '1d'] as const
type WLTf = typeof WL_TFS[number]

// ── Hydration ─────────────────────────────────────────────────────────────────

function hydrateMVI(raw: Record<string, unknown>): MarketVIAlertsCfg {
  return {
    enabled:      (raw.enabled as boolean | undefined) ?? D_MVI_ALERTS.enabled,
    bot_name:     raw.bot_name as string | undefined,
    cooldown_min: (raw.cooldown_min as number | undefined) ?? D_MVI_ALERTS.cooldown_min,
    regimes:      (raw.regimes as string[] | undefined) ?? D_MVI_ALERTS.regimes,
    vi_levels:    (raw.vi_levels as VILevel[] | undefined) ?? [],
  }
}

function hydrateWL(raw: Record<string, unknown>): WatchlistAlertsCfg {
  return {
    enabled: (raw.enabled as boolean | undefined) ?? D_WL_ALERTS.enabled,
    bot_name: raw.bot_name as string | undefined,
    per_tf: (raw.per_tf as Partial<Record<string, TFAlertCfg>> | undefined) ?? {},
  }
}

// ── Atoms ─────────────────────────────────────────────────────────────────────

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      aria-label={label}
      className={cn(
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0',
        on ? 'bg-brand-500' : 'bg-surface-600',
      )}
    >
      <span
        className={cn(
          'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
          on ? 'translate-x-4' : 'translate-x-1',
        )}
      />
    </button>
  )
}

const inputCls =
  'w-full px-3 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-200 ' +
  'placeholder-slate-500 focus:outline-none focus:border-brand-500/60 focus:ring-1 ' +
  'focus:ring-brand-500/30 transition-colors'

const numCls =
  'px-2 py-1.5 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-300 ' +
  'text-right focus:outline-none focus:border-brand-500/60'

// ── Page ──────────────────────────────────────────────────────────────────────

export function NotificationsSettingsPage() {
  const { activeProfileId: profileId } = useProfile()
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [bots, setBots] = useState<TelegramBot[]>([])
  const [mviA, setMviA] = useState<MarketVIAlertsCfg>(D_MVI_ALERTS)
  const [wlA,  setWlA]  = useState<WatchlistAlertsCfg>(D_WL_ALERTS)

  // New bot form state
  const [newName,  setNewName]  = useState('')
  const [newToken, setNewToken] = useState('')
  const [newChat,  setNewChat]  = useState('')

  // Per-bot test state
  const [testingBot, setTestingBot] = useState<number | null>(null)
  const [botTestResults, setBotTestResults] = useState<Record<number, { ok: boolean; text: string }>>({})

  // VI level add-form state
  const [vlType,     setVlType]     = useState<'crossing' | 'range'>('crossing')
  const [vlValue,    setVlValue]    = useState('')
  const [vlMin,      setVlMin]      = useState('')
  const [vlMax,      setVlMax]      = useState('')
  const [vlDir,      setVlDir]      = useState<'both' | 'up' | 'down'>('both')
  const [vlLabel,    setVlLabel]    = useState('')
  const [vlCooldown, setVlCooldown] = useState('30')

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setLoadErr(null)
    try {
      const n = await volatilityApi.getNotificationSettings(profileId)
      setBots(n.bots ?? [])
      setMviA(hydrateMVI(n.market_vi_alerts as Record<string, unknown>))
      setWlA(hydrateWL(n.watchlist_alerts as Record<string, unknown>))
    } catch {
      setLoadErr('Failed to load notification settings')
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!profileId) return
    setSaving(true)
    setSaveErr(null)
    setSaved(false)
    try {
      await volatilityApi.updateNotificationSettings(profileId, {
        bots,
        market_vi_alerts: mviA,
        watchlist_alerts: wlA,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch {
      setSaveErr('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    if (!profileId) return
    setTesting(true)
    setTestMsg(null)
    try {
      const res = await volatilityApi.testNotification(profileId)
      setTestMsg({ ok: true, text: res.message ?? 'Test message sent' })
    } catch {
      setTestMsg({ ok: false, text: 'Test failed — check bot token and chat ID' })
    } finally {
      setTesting(false)
    }
  }

  const addBot = () => {
    if (!newToken.trim() || !newChat.trim()) return
    setBots(prev => [
      ...prev,
      {
        bot_name: newName.trim() || undefined,
        bot_token: newToken.trim(),
        chat_id: newChat.trim(),
      },
    ])
    setNewName('')
    setNewToken('')
    setNewChat('')
  }

  const removeBot = (idx: number) => setBots(prev => prev.filter((_, i) => i !== idx))

  const testBot = async (b: TelegramBot, i: number) => {
    if (!profileId) return
    setTestingBot(i)
    setBotTestResults(p => { const n = { ...p }; delete n[i]; return n })
    try {
      await volatilityApi.testNotification(profileId, { botToken: b.bot_token, chatId: b.chat_id })
      setBotTestResults(p => ({ ...p, [i]: { ok: true, text: 'Message sent ✓' } }))
    } catch {
      setBotTestResults(p => ({ ...p, [i]: { ok: false, text: 'Failed — check token & chat ID' } }))
    } finally {
      setTestingBot(null)
    }
  }

  const addVILevel = () => {
    if (vlType === 'crossing' && !vlValue.trim()) return
    if (vlType === 'range' && (!vlMin.trim() || !vlMax.trim())) return
    const newLevel: VILevel = {
      id: Date.now().toString(),
      label:       vlLabel.trim() || undefined,
      type:        vlType,
      ...(vlType === 'crossing'
        ? { value: Number(vlValue), direction: vlDir }
        : { min: Number(vlMin), max: Number(vlMax) }),
      enabled:     true,
      cooldown_min: Number(vlCooldown) || 30,
    }
    setMviA(p => ({ ...p, vi_levels: [...p.vi_levels, newLevel] }))
    setVlValue(''); setVlMin(''); setVlMax(''); setVlLabel(''); setVlCooldown('30')
  }

  const removeVILevel = (id: string) =>
    setMviA(p => ({ ...p, vi_levels: p.vi_levels.filter(l => l.id !== id) }))

  const toggleVILevel = (id: string) =>
    setMviA(p => ({
      ...p,
      vi_levels: p.vi_levels.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l),
    }))

  const toggleRegime = (r: string) =>
    setMviA(p => ({
      ...p,
      regimes: p.regimes.includes(r) ? p.regimes.filter(x => x !== r) : [...p.regimes, r],
    }))

  const getTFAlert = (tf: string): TFAlertCfg => wlA.per_tf[tf] ?? D_TF_ALERT

  const setTFAlert = (tf: WLTf, patch: Partial<TFAlertCfg>) =>
    setWlA(p => ({ ...p, per_tf: { ...p.per_tf, [tf]: { ...getTFAlert(tf), ...patch } } }))

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Loader2 size={20} className="animate-spin mr-2" /> Loading notifications…
      </div>
    )
  }

  if (loadErr) {
    return <div className="text-center py-24 text-red-400">{loadErr}</div>
  }

  return (
    <div>
      <PageHeader
        icon="🔔"
        title="Notification Settings"
        subtitle="Telegram bots and volatility alert configuration"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-400 transition-colors"
          >
            <RefreshCw size={12} /> Reload
          </button>
        }
      />

      <div className="space-y-5 max-w-2xl">

        {/* ── Telegram Bots ─────────────────────────────────────────────────── */}
        <section className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-surface-700">
            <h2 className="text-sm font-semibold text-slate-300">Telegram Bots</h2>
            <p className="text-xs text-slate-600 mt-0.5">Configure bots used to send alerts</p>
          </div>
          <div className="px-5 py-4 space-y-3">

            {/* Bot list */}
            {bots.length === 0 && (
              <p className="text-xs text-slate-600 italic">No bots configured yet</p>
            )}
            {bots.map((b, i) => (
              <div key={i} className="py-2.5 border-b border-surface-700 last:border-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-300 truncate">
                      {b.bot_name ?? <span className="text-slate-500 italic">unnamed</span>}
                    </p>
                    <p className="text-[10px] font-mono text-slate-600">
                      …{b.bot_token.slice(-8)} · chat {b.chat_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void testBot(b, i)}
                      disabled={testingBot === i}
                      title="Test this bot (inline — works before saving)"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] text-indigo-400 bg-indigo-600/10 border border-indigo-600/30 hover:bg-indigo-600/20 disabled:opacity-40 transition-colors"
                    >
                      {testingBot === i ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />}
                      Test
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBot(i)}
                      className="text-slate-600 hover:text-red-400 transition-colors"
                      aria-label="Remove bot"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {botTestResults[i] && (
                  <p className={cn(
                    'text-[10px] mt-1.5 flex items-center gap-1',
                    botTestResults[i].ok ? 'text-emerald-400' : 'text-red-400',
                  )}>
                    {botTestResults[i].ok ? <Check size={10} /> : <AlertTriangle size={10} />}
                    {botTestResults[i].text}
                  </p>
                )}
              </div>
            ))}

            {/* Add bot form */}
            <div className="pt-2 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Add bot</p>
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Bot name (optional)"
                className={inputCls}
              />
              <input
                value={newToken}
                onChange={e => setNewToken(e.target.value)}
                placeholder="Bot token  e.g. 110201543:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw"
                className={inputCls}
              />
              <input
                value={newChat}
                onChange={e => setNewChat(e.target.value)}
                placeholder="Chat ID  e.g. -1001234567890"
                className={inputCls}
              />
              <button
                type="button"
                onClick={addBot}
                disabled={!newToken.trim() || !newChat.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 disabled:opacity-40 text-xs text-slate-300 transition-colors"
              >
                <Plus size={13} /> Add bot
              </button>
            </div>

            {/* Test */}
            {bots.length > 0 && (
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => void test()}
                  disabled={testing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/25 border border-indigo-600/30 text-xs text-indigo-400 transition-colors disabled:opacity-40"
                >
                  {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Send test message
                </button>
                {testMsg && (
                  <span
                    className={cn(
                      'text-xs flex items-center gap-1',
                      testMsg.ok ? 'text-emerald-400' : 'text-red-400',
                    )}
                  >
                    {testMsg.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                    {testMsg.text}
                  </span>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ── Market VI Alerts ──────────────────────────────────────────────── */}
        <section className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-surface-700 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-300">Market VI Alerts</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Notify when aggregate VI enters a trigger regime
              </p>
            </div>
            <Toggle
              on={mviA.enabled}
              onChange={v => setMviA(p => ({ ...p, enabled: v }))}
              label="Enable Market VI alerts"
            />
          </div>

          <div
            className={cn(
              'px-5 py-4 space-y-4 transition-opacity',
              !mviA.enabled && 'opacity-40 pointer-events-none',
            )}
          >
            {/* Bot select */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-slate-400">Target bot</span>
              <select
                value={mviA.bot_name ?? ''}
                onChange={e => setMviA(p => ({ ...p, bot_name: e.target.value || undefined }))}
                className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500/60"
              >
                <option value="">— First available —</option>
                {bots.map((b, i) => (
                  <option key={i} value={b.bot_name ?? ''}>
                    {b.bot_name ?? `…${b.bot_token.slice(-8)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Cooldown */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-slate-400">Cooldown</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={mviA.cooldown_min}
                  onChange={e => setMviA(p => ({ ...p, cooldown_min: Number(e.target.value) }))}
                  className={cn(numCls, 'w-20')}
                />
                <span className="text-xs text-slate-500">min</span>
              </div>
            </div>

            {/* Trigger regimes */}
            <div>
              <p className="text-xs text-slate-400 mb-2">Trigger on regime change</p>
              <div className="flex flex-wrap gap-2">
                {REGIMES.map(r => {
                  const active = mviA.regimes.includes(r)
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => toggleRegime(r)}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all',
                        active
                          ? 'bg-brand-600/20 border-brand-600/40 text-brand-400'
                          : 'bg-surface-700 border-surface-600 text-slate-500 hover:border-surface-500',
                      )}
                    >
                      {r}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ── VI Level / Range Alerts ──────────────────────────────────── */}
            <div className="border-t border-surface-700 pt-4">
              <div className="flex items-center gap-2 mb-3">
                <Bell size={13} className="text-brand-400" />
                <p className="text-xs font-semibold text-slate-300">Custom VI Level Alerts</p>
                <span className="text-[10px] text-slate-600">trigger on exact value or range (0–100 scale)</span>
              </div>

              {/* Existing levels */}
              {mviA.vi_levels.length === 0 && (
                <p className="text-xs text-slate-600 italic mb-3">No custom levels yet</p>
              )}
              <div className="space-y-2 mb-3">
                {mviA.vi_levels.map(lv => (
                  <div key={lv.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface-700/60 border border-surface-600">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Toggle on={lv.enabled} onChange={() => toggleVILevel(lv.id)} label="toggle" />
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-slate-300 truncate">
                          {lv.label || (lv.type === 'crossing'
                            ? `VI = ${lv.value} ${lv.direction === 'up' ? '↑' : lv.direction === 'down' ? '↓' : '↕'}`
                            : `VI ∈ [${lv.min}, ${lv.max}]`)}
                        </p>
                        <p className="text-[10px] text-slate-600">
                          {lv.type} · cooldown {lv.cooldown_min}min
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeVILevel(lv.id)}
                      className="text-slate-600 hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add level form */}
              <div className="rounded-lg border border-surface-600 bg-surface-700/30 p-3 space-y-2">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Add alert</p>
                {/* Type selector */}
                <div className="flex gap-1">
                  {(['crossing', 'range'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setVlType(t)}
                      className={cn(
                        'px-3 py-1 rounded text-[11px] font-medium transition-colors',
                        vlType === t
                          ? 'bg-brand-600/25 border border-brand-500/50 text-brand-300'
                          : 'bg-surface-700 border border-surface-600 text-slate-500 hover:text-slate-300',
                      )}
                    >{t}</button>
                  ))}
                </div>

                {vlType === 'crossing' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">VI value (0–100)</p>
                      <input
                        type="number" min={0} max={100} step={1}
                        value={vlValue} onChange={e => setVlValue(e.target.value)}
                        placeholder="e.g. 22"
                        className={cn(inputCls)}
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Direction</p>
                      <select
                        value={vlDir}
                        onChange={e => setVlDir(e.target.value as typeof vlDir)}
                        className="w-full px-2 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-300 focus:outline-none focus:border-brand-500/60"
                      >
                        <option value="both">↕ Both</option>
                        <option value="up">↑ Up only</option>
                        <option value="down">↓ Down only</option>
                      </select>
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Cooldown (min)</p>
                      <input
                        type="number" min={1} max={1440}
                        value={vlCooldown} onChange={e => setVlCooldown(e.target.value)}
                        className={cn(inputCls)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Min (≥)</p>
                      <input
                        type="number" min={0} max={100}
                        value={vlMin} onChange={e => setVlMin(e.target.value)}
                        placeholder="e.g. 12"
                        className={cn(inputCls)}
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Max (≤)</p>
                      <input
                        type="number" min={0} max={100}
                        value={vlMax} onChange={e => setVlMax(e.target.value)}
                        placeholder="e.g. 20"
                        className={cn(inputCls)}
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-1">Cooldown (min)</p>
                      <input
                        type="number" min={1} max={1440}
                        value={vlCooldown} onChange={e => setVlCooldown(e.target.value)}
                        className={cn(inputCls)}
                      />
                    </div>
                  </div>
                )}

                <input
                  value={vlLabel}
                  onChange={e => setVlLabel(e.target.value)}
                  placeholder="Label (optional)"
                  className={cn(inputCls)}
                />
                <button
                  type="button"
                  onClick={addVILevel}
                  disabled={vlType === 'crossing' ? !vlValue : !vlMin || !vlMax}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 disabled:opacity-40 text-xs text-slate-300 transition-colors"
                >
                  <Plus size={13} /> Add level
                </button>
              </div>
            </div>

          </div>
        </section>

        {/* ── Watchlist Alerts ──────────────────────────────────────────────── */}
        <section className="rounded-xl bg-surface-800 border border-surface-700 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-surface-700 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-300">Watchlist Alerts</h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Per-timeframe watchlist generation alerts
              </p>
            </div>
            <Toggle
              on={wlA.enabled}
              onChange={v => setWlA(p => ({ ...p, enabled: v }))}
              label="Enable watchlist alerts"
            />
          </div>

          <div
            className={cn(
              'px-5 py-4 space-y-4 transition-opacity',
              !wlA.enabled && 'opacity-40 pointer-events-none',
            )}
          >
            {/* Bot select */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-slate-400">Target bot</span>
              <select
                value={wlA.bot_name ?? ''}
                onChange={e => setWlA(p => ({ ...p, bot_name: e.target.value || undefined }))}
                className="bg-surface-700 border border-surface-600 text-xs text-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-brand-500/60"
              >
                <option value="">— First available —</option>
                {bots.map((b, i) => (
                  <option key={i} value={b.bot_name ?? ''}>
                    {b.bot_name ?? `…${b.bot_token.slice(-8)}`}
                  </option>
                ))}
              </select>
            </div>

            {/* Per-TF rows */}
            <div className="space-y-3">
              {WL_TFS.map((tf: WLTf) => {
                const cfg = getTFAlert(tf)
                return (
                  <div
                    key={tf}
                    className="rounded-lg border border-surface-700 bg-surface-700/40 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono font-semibold text-slate-300">{tf}</span>
                      <Toggle
                        on={cfg.enabled}
                        onChange={v => setTFAlert(tf, { enabled: v })}
                        label={`Enable ${tf} alerts`}
                      />
                    </div>
                    {cfg.enabled && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] text-slate-500 mb-1">Cooldown (min)</p>
                          <input
                            type="number"
                            min={5}
                            max={1440}
                            step={5}
                            value={cfg.cooldown_min}
                            onChange={e => setTFAlert(tf, { cooldown_min: Number(e.target.value) })}
                            className={cn(numCls, 'w-full')}
                          />
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-1">Min VI score (0–1)</p>
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={cfg.vi_min.toFixed(2)}
                            onChange={e => setTFAlert(tf, { vi_min: Number(e.target.value) })}
                            className={cn(numCls, 'w-full')}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Global save bar ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-2">
          <div className="text-xs">
            {saveErr && (
              <span className="text-red-400 flex items-center gap-1.5">
                <AlertTriangle size={12} /> {saveErr}
              </span>
            )}
            {saved && !saveErr && (
              <span className="text-emerald-400 flex items-center gap-1.5">
                <Check size={12} /> Saved
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-xs font-medium text-white transition-colors"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save all
          </button>
        </div>

      </div>
    </div>
  )
}
