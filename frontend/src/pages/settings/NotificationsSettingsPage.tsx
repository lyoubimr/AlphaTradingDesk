// ── Notification Settings page ───────────────────────────────────────────────
// P2-15 — Settings > Notifications: Telegram bots + Market VI alerts + Watchlist alerts
//
// Backend:
//   GET  /api/volatility/notifications/{profile_id}  → NotificationSettingsOut
//   PUT  /api/volatility/notifications/{profile_id}  → merge-patch
//   POST /api/volatility/notifications/{profile_id}/test → send test Telegram message
// ───────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Loader2, RefreshCw, Check, AlertTriangle, Plus, Trash2, Send, Bell, Pencil, X, FileText,
} from 'lucide-react'
import { PageHeader } from '../../components/ui/PageHeader'
import { SaveBar } from '../../components/ui/SaveBar'
import { useSaveState } from '../../hooks/useSaveState'
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
  tolerance?: number      // ±zone around crossing value (default 0.5)
  min?: number            // 0–100, for type='range'
  max?: number            // 0–100, for type='range'
  enabled: boolean
  cooldown_min: number
  timeframe?: string      // specific TF ('15m','1h','4h','1d','aggregated') or undefined = all TFs
  day_type?: 'any' | 'workday' | 'weekend'  // filter by market day type
}

interface MarketStatusTFCfg {
  enabled: boolean
  interval_min: number
  template?: string
}

interface MarketVIAlertsCfg {
  enabled: boolean            // master switch
  status_enabled: boolean     // regime-change (market status) notifications sub-toggle
  levels_enabled: boolean     // custom VI level alerts sub-toggle
  bot_name?: string
  regimes: string[]
  per_tf_status: Record<string, MarketStatusTFCfg>
  vi_levels: VILevel[]
  // legacy fallbacks (kept for backward compat)
  cooldown_min: number
  message_template?: string
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

const STATUS_TFS = ['aggregated', '15m', '1h', '4h', '1d'] as const
type StatusTF = typeof STATUS_TFS[number]

const D_STATUS_TF_CFG: Record<StatusTF, MarketStatusTFCfg> = {
  aggregated: { enabled: true,  interval_min: 120 },
  '15m':      { enabled: true,  interval_min: 240 },
  '1h':       { enabled: true,  interval_min: 480 },
  '4h':       { enabled: false, interval_min: 960 },
  '1d':       { enabled: false, interval_min: 1440 },
}

const D_MVI_ALERTS: MarketVIAlertsCfg = {
  enabled:        false,
  status_enabled: true,
  levels_enabled: true,
  regimes:        [],
  per_tf_status:  { ...D_STATUS_TF_CFG },
  vi_levels:      [],
  cooldown_min:   60,
  message_template: undefined,
}

const DEFAULT_REGIME_TEMPLATE = `📡 <b>ATD Market VI</b> · {timeframe}

📊 Score: <b>{score}</b>
📈 Regime: <b>{regime}</b> — {summary}

<code>Components: {components}</code>`.trim()

const _DEFAULT_LEVEL_TEMPLATE = `🔔 VI Level Alert — {timeframe}

{label} {direction}
Value: {score}   Threshold: {threshold}`.trim()

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

function hydrateStatusTF(raw: Record<string, unknown> | undefined): Record<string, MarketStatusTFCfg> {
  const result: Record<string, MarketStatusTFCfg> = {}
  for (const tf of STATUS_TFS) {
    const src = raw?.[tf] as Record<string, unknown> | undefined
    result[tf] = {
      enabled:      (src?.enabled      as boolean | undefined) ?? D_STATUS_TF_CFG[tf].enabled,
      interval_min: (src?.interval_min as number  | undefined) ?? D_STATUS_TF_CFG[tf].interval_min,
      template:      src?.template     as string  | undefined,
    }
  }
  return result
}

function hydrateMVI(raw: Record<string, unknown>): MarketVIAlertsCfg {
  return {
    enabled:          (raw.enabled         as boolean   | undefined) ?? D_MVI_ALERTS.enabled,
    status_enabled:   (raw.status_enabled  as boolean   | undefined) ?? true,
    levels_enabled:   (raw.levels_enabled  as boolean   | undefined) ?? true,
    bot_name:          raw.bot_name        as string    | undefined,
    regimes:          (raw.regimes         as string[]  | undefined) ?? [],
    per_tf_status:    hydrateStatusTF(raw.per_tf_status as Record<string, unknown> | undefined),
    vi_levels:        (raw.vi_levels       as VILevel[] | undefined) ?? [],
    cooldown_min:     (raw.cooldown_min    as number    | undefined) ?? 60,
    message_template:  raw.message_template as string  | undefined,
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
  const { saving, saved, saveErr, dirty, setDirty, wrapSave } = useSaveState()

  // Prevents marking dirty during initial data load
  const skipDirtyRef = useRef(true)
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
  const [vlDir,       setVlDir]       = useState<'both' | 'up' | 'down'>('both')
  const [vlLabel,     setVlLabel]     = useState('')
  const [vlCooldown,  setVlCooldown]  = useState('30')
  const [vlTolerance, setVlTolerance] = useState('0.5')
  const [vlTf,        setVlTf]        = useState('')
  const [vlDayType,   setVlDayType]   = useState<'any' | 'workday' | 'weekend'>('any')

  // VI level inline-edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  interface EditDraft { label?: string; direction?: 'both'|'up'|'down'; valueStr?: string; minStr?: string; maxStr?: string; cooldownStr?: string; toleranceStr?: string; tfStr?: string; dayTypeStr?: 'any'|'workday'|'weekend' }
  const [editDraft, setEditDraft] = useState<EditDraft>({})

  // Template modal — per-TF (null = closed, string = which TF)
  const [templateModalTf, setTemplateModalTf] = useState<string | null>(null)
  const [templateDraft, setTemplateDraft] = useState<string>(DEFAULT_REGIME_TEMPLATE)

  function openTemplateForTF(tf: string) {
    const tfCfg = mviA.per_tf_status[tf]
    setTemplateDraft(tfCfg?.template ?? DEFAULT_REGIME_TEMPLATE)
    setTemplateModalTf(tf)
  }
  function confirmTemplate() {
    if (!templateModalTf) return
    const val = templateDraft.trim()
    const isDefault = val === DEFAULT_REGIME_TEMPLATE.trim()
    setMviA(p => ({
      ...p,
      per_tf_status: {
        ...p.per_tf_status,
        [templateModalTf]: { ...p.per_tf_status[templateModalTf], template: isDefault ? undefined : val },
      },
    }))
    setTemplateModalTf(null)
  }

  const load = useCallback(async () => {
    if (!profileId) return
    setLoading(true)
    setLoadErr(null)
    skipDirtyRef.current = true
    try {
      const n = await volatilityApi.getNotificationSettings(profileId)
      setBots(n.bots ?? [])
      setMviA(hydrateMVI(n.market_vi_alerts as Record<string, unknown>))
      setWlA(hydrateWL(n.watchlist_alerts as Record<string, unknown>))
      setDirty(false)
    } catch {
      setLoadErr('Failed to load notification settings')
    } finally {
      setLoading(false)
    }
  }, [profileId, setDirty])

  useEffect(() => { void load() }, [load])

  // After loading completes, allow dirty tracking (small delay ensures effects settle)
  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => { skipDirtyRef.current = false }, 100)
      return () => clearTimeout(t)
    } else {
      skipDirtyRef.current = true
    }
  }, [loading])

  // Mark as dirty on any mviA/wlA change — except during load
  useEffect(() => {
    if (skipDirtyRef.current) return
    setDirty(true)
  }, [mviA, wlA, setDirty])

  const save = async () => {
    if (!profileId) return
    await wrapSave(async () => {
      await volatilityApi.updateNotificationSettings(profileId, {
        bots,
        market_vi_alerts: mviA,
        watchlist_alerts: wlA,
      })
    })
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

  // Auto-save bots immediately to DB — no need to click "Save all" for bots
  const saveBots = useCallback(async (botList: TelegramBot[]) => {
    if (!profileId) return
    try {
      await volatilityApi.updateNotificationSettings(profileId, { bots: botList })
    } catch { /* silent — bots are in local state */ }
  }, [profileId])

  // Auto-save VI levels immediately to DB — no need to click "Save all" for level add/remove/toggle
  const saveMVI = useCallback(async (cfg: MarketVIAlertsCfg) => {
    if (!profileId) return
    try {
      await volatilityApi.updateNotificationSettings(profileId, { market_vi_alerts: cfg })
    } catch { /* silent — levels are in local state */ }
  }, [profileId])

  const addBot = () => {
    if (!newToken.trim() || !newChat.trim()) return
    const bot: TelegramBot = {
      bot_name: newName.trim() || undefined,
      bot_token: newToken.trim(),
      chat_id: newChat.trim(),
    }
    const updated = [...bots, bot]
    setBots(updated)
    void saveBots(updated)
    setNewName('')
    setNewToken('')
    setNewChat('')
  }

  const removeBot = (idx: number) => {
    const updated = bots.filter((_, i) => i !== idx)
    setBots(updated)
    void saveBots(updated)
  }

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
        ? { value: Number(vlValue), direction: vlDir, tolerance: Number(vlTolerance) || 0.5 }
        : { min: Number(vlMin), max: Number(vlMax) }),
      enabled:     true,
      cooldown_min: Number(vlCooldown) || 30,
      timeframe:   vlTf || undefined,
      day_type:    vlDayType === 'any' ? undefined : vlDayType,
    }
    const updated: MarketVIAlertsCfg = { ...mviA, vi_levels: [...mviA.vi_levels, newLevel] }
    setMviA(updated)
    void saveMVI(updated)
    setVlValue(''); setVlMin(''); setVlMax(''); setVlLabel(''); setVlCooldown('30'); setVlTolerance('0.5'); setVlTf(''); setVlDayType('any')
  }

  const removeVILevel = (id: string) => {
    const updated: MarketVIAlertsCfg = { ...mviA, vi_levels: mviA.vi_levels.filter(l => l.id !== id) }
    setMviA(updated)
    void saveMVI(updated)
  }

  const toggleVILevel = (id: string) => {
    const updated: MarketVIAlertsCfg = {
      ...mviA,
      vi_levels: mviA.vi_levels.map(l => l.id === id ? { ...l, enabled: !l.enabled } : l),
    }
    setMviA(updated)
    void saveMVI(updated)
  }

  const editVILevel = (id: string, patch: Partial<VILevel>) => {
    const updated: MarketVIAlertsCfg = {
      ...mviA,
      vi_levels: mviA.vi_levels.map(l => l.id === id ? { ...l, ...patch } : l),
    }
    setMviA(updated)
    void saveMVI(updated)
  }

  const startEdit = (lv: VILevel) => {
    setEditingId(lv.id)
    setEditDraft({
      label:        lv.label ?? '',
      direction:    lv.direction ?? 'both',
      cooldownStr:  String(lv.cooldown_min),
      valueStr:     lv.value     !== undefined ? String(lv.value)     : '',
      minStr:       lv.min       !== undefined ? String(lv.min)       : '',
      maxStr:       lv.max       !== undefined ? String(lv.max)       : '',
      toleranceStr: lv.tolerance !== undefined ? String(lv.tolerance) : '0.5',
      tfStr:        lv.timeframe ?? '',
      dayTypeStr:   lv.day_type ?? 'any',
    })
  }

  const commitEdit = (lv: VILevel) => {
    const patch: Partial<VILevel> = {
      label:        editDraft.label?.trim() || undefined,
      cooldown_min: Number(editDraft.cooldownStr) || lv.cooldown_min,
    }
    if (lv.type === 'crossing') {
      patch.value     = Number(editDraft.valueStr) || lv.value
      patch.direction = editDraft.direction ?? lv.direction
      patch.tolerance = Number(editDraft.toleranceStr) || lv.tolerance || 0.5
    } else {
      patch.min = Number(editDraft.minStr) || lv.min
      patch.max = Number(editDraft.maxStr) || lv.max
    }
    patch.timeframe = editDraft.tfStr || undefined
    patch.day_type  = (editDraft.dayTypeStr && editDraft.dayTypeStr !== 'any') ? editDraft.dayTypeStr : undefined
    editVILevel(lv.id, patch)
    setEditingId(null)
  }

  const toggleRegime = (r: string) =>
    setMviA(p => ({
      ...p,
      regimes: p.regimes.includes(r) ? p.regimes.filter(x => x !== r) : [...p.regimes, r],
    }))

  const getTFAlert = (tf: string): TFAlertCfg => wlA.per_tf[tf] ?? D_TF_ALERT

  const setTFAlert = (tf: WLTf, patch: Partial<TFAlertCfg>) =>
    setWlA(p => ({ ...p, per_tf: { ...p.per_tf, [tf]: { ...getTFAlert(tf), ...patch } } }))

  const getStatusTF = (tf: string): MarketStatusTFCfg =>
    mviA.per_tf_status[tf] ?? D_STATUS_TF_CFG[tf as StatusTF] ?? { enabled: false, interval_min: 120 }

  const setStatusTF = (tf: string, patch: Partial<MarketStatusTFCfg>) =>
    setMviA(p => ({ ...p, per_tf_status: { ...p.per_tf_status, [tf]: { ...getStatusTF(tf), ...patch } } }))

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
    <>
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

            {/* ── 📡 Market Status ─────────────────────────────────────── */}
            <div className="rounded-lg border border-surface-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 bg-surface-700/40">
                <div className="flex items-center gap-2">
                  <span className="text-sm">📡</span>
                  <p className="text-xs font-semibold text-slate-300">Market Status</p>
                  <span className="text-[10px] text-slate-600">regime change notifications</span>
                </div>
                <Toggle
                  on={mviA.status_enabled}
                  onChange={v => setMviA(p => ({ ...p, status_enabled: v }))}
                  label="Enable market status notifications"
                />
              </div>
              <div className={cn('px-3 py-3 space-y-3 transition-opacity', !mviA.status_enabled && 'opacity-40 pointer-events-none')}>
                {/* Trigger regimes */}
                <div>
                  <p className="text-[10px] text-slate-500 mb-1.5">Trigger on regime</p>
                  <div className="flex flex-wrap gap-1.5">
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
                {/* Per-TF intervals */}
                <div>
                  <p className="text-[10px] text-slate-500 mb-1.5">Send interval per timeframe</p>
                  <div className="space-y-1">
                    {STATUS_TFS.map(tf => {
                      const tfCfg = getStatusTF(tf)
                      return (
                        <div key={tf} className="flex items-center gap-2 py-1.5 px-2 rounded bg-surface-700/50">
                          <Toggle
                            on={tfCfg.enabled}
                            onChange={v => setStatusTF(tf, { enabled: v })}
                            label={`${tf} enabled`}
                          />
                          <span className="text-[11px] font-mono text-slate-400 w-12 shrink-0">
                            {tf === 'aggregated' ? 'AGG' : tf.toUpperCase()}
                          </span>
                          <div className={cn('flex items-center gap-1.5 flex-1', !tfCfg.enabled && 'opacity-40')}>
                            <input
                              type="number"
                              min={5}
                              max={2880}
                              step={30}
                              value={tfCfg.interval_min}
                              onChange={e => setStatusTF(tf, { interval_min: Number(e.target.value) })}
                              className={cn(numCls, 'w-16')}
                            />
                            <span className="text-[10px] text-slate-600">min</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openTemplateForTF(tf)}
                            title={tfCfg.template ? 'Custom template active — click to edit' : 'Customize template for this TF'}
                            className={cn('p-1 rounded transition-colors', tfCfg.template ? 'text-brand-400' : 'text-slate-600 hover:text-slate-400')}
                          >
                            <FileText size={11} />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* ── 🔔 Custom VI Level Alerts ─────────────────────────────── */}
            <div className="rounded-lg border border-surface-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2.5 bg-surface-700/40">
                <div className="flex items-center gap-2">
                  <Bell size={13} className="text-brand-400" />
                  <p className="text-xs font-semibold text-slate-300">Custom VI Level Alerts</p>
                  <span className="text-[10px] text-slate-600">trigger on exact value or range (0–100 scale)</span>
                </div>
                <Toggle
                  on={mviA.levels_enabled}
                  onChange={v => setMviA(p => ({ ...p, levels_enabled: v }))}
                  label="Enable level alerts"
                />
              </div>
              <div className={cn('px-3 py-3 transition-opacity', !mviA.levels_enabled && 'opacity-40 pointer-events-none')}>

              {/* Existing levels */}
              {mviA.vi_levels.length === 0 && (
                <p className="text-xs text-slate-600 italic mb-3">No custom levels yet</p>
              )}
              <div className="space-y-2 mb-3">
                {mviA.vi_levels.map(lv => (
                  <div key={lv.id} className="rounded-lg bg-surface-700/60 border border-surface-600 overflow-hidden">
                    {/* Level row */}
                    <div className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Toggle on={lv.enabled} onChange={() => toggleVILevel(lv.id)} label="toggle" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-slate-300 truncate">
                            {lv.label || (lv.type === 'crossing'
                              ? `VI = ${lv.value} ${lv.direction === 'up' ? '↑' : lv.direction === 'down' ? '↓' : '↕'}`
                              : `VI ∈ [${lv.min}, ${lv.max}]`)}
                          </p>
                          <p className="text-[10px] text-slate-600 flex items-center gap-1.5 flex-wrap">
                            <span>{lv.type} · cooldown {lv.cooldown_min}min</span>
                            {lv.type === 'crossing' && lv.tolerance !== undefined && (
                              <span className="px-1 rounded bg-surface-700 border border-surface-600 font-mono text-sky-500/80">
                                ±{lv.tolerance}
                              </span>
                            )}
                            {lv.timeframe && (
                              <span className="px-1 rounded bg-surface-700 border border-surface-600 font-mono text-amber-500/70">
                                {lv.timeframe === 'aggregated' ? 'AGG' : lv.timeframe.toUpperCase()}
                              </span>
                            )}
                            {lv.day_type && lv.day_type !== 'any' && (
                              <span className="px-1 rounded bg-surface-700 border border-surface-600 font-mono text-violet-400/70">
                                {lv.day_type === 'workday' ? 'WD' : 'WKD'}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => editingId === lv.id ? setEditingId(null) : startEdit(lv)}
                          title="Edit alert"
                          className={cn(
                            'p-1 rounded transition-colors',
                            editingId === lv.id
                              ? 'text-brand-400 bg-brand-500/15'
                              : 'text-slate-600 hover:text-brand-400',
                          )}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeVILevel(lv.id)}
                          className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>

                    {/* Inline edit form */}
                    {editingId === lv.id && (
                      <div className="px-3 pb-3 border-t border-surface-600 pt-3 space-y-2 bg-surface-800/60">
                        <p className="text-[10px] font-semibold text-brand-400 uppercase tracking-wide">Edit alert</p>
                        <input
                          value={editDraft.label ?? ''}
                          onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))}
                          placeholder="Label (optional)"
                          className={cn(inputCls)}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          {lv.type === 'crossing' ? (
                            <>
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">VI value (0–100)</p>
                                <input
                                  type="number" min={0} max={100}
                                  value={editDraft.valueStr ?? ''}
                                  onChange={e => setEditDraft(d => ({ ...d, valueStr: e.target.value }))}
                                  className={cn(inputCls)}
                                />
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Direction</p>
                                <select
                                  value={editDraft.direction ?? 'both'}
                                  onChange={e => setEditDraft(d => ({ ...d, direction: e.target.value as 'both'|'up'|'down' }))}
                                  className="w-full px-2 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-300 focus:outline-none focus:border-brand-500/60"
                                >
                                  <option value="both">↕ Both</option>
                                  <option value="up">↑ Up only</option>
                                  <option value="down">↓ Down only</option>
                                </select>
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Tolerance (±)</p>
                                <input
                                  type="number" min={0} max={10} step={0.5}
                                  value={editDraft.toleranceStr ?? '0.5'}
                                  onChange={e => setEditDraft(d => ({ ...d, toleranceStr: e.target.value }))}
                                  className={cn(inputCls)}
                                />
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Min (≥)</p>
                                <input
                                  type="number" min={0} max={100}
                                  value={editDraft.minStr ?? ''}
                                  onChange={e => setEditDraft(d => ({ ...d, minStr: e.target.value }))}
                                  className={cn(inputCls)}
                                />
                              </div>
                              <div>
                                <p className="text-[10px] text-slate-500 mb-1">Max (≤)</p>
                                <input
                                  type="number" min={0} max={100}
                                  value={editDraft.maxStr ?? ''}
                                  onChange={e => setEditDraft(d => ({ ...d, maxStr: e.target.value }))}
                                  className={cn(inputCls)}
                                />
                              </div>
                            </>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-[10px] text-slate-500 mb-1">Cooldown (min)</p>
                            <input
                              type="number" min={1} max={1440}
                              value={editDraft.cooldownStr ?? ''}
                              onChange={e => setEditDraft(d => ({ ...d, cooldownStr: e.target.value }))}
                              className={cn(inputCls)}
                            />
                          </div>
                          <div>
                            <p className="text-[10px] text-slate-500 mb-1">Timeframe</p>
                            <select
                              value={editDraft.tfStr ?? 'aggregated'}
                              onChange={e => setEditDraft(d => ({ ...d, tfStr: e.target.value }))}
                              className="w-full px-2 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-300 focus:outline-none focus:border-brand-500/60"
                            >
                              <option value="">All TFs</option>
                              {['15m', '1h', '4h', '1d'].map(tf => (
                                <option key={tf} value={tf}>{tf.toUpperCase()}</option>
                              ))}
                              <option value="aggregated">AGG — General</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 mb-1">Day type</p>
                          <select
                            value={editDraft.dayTypeStr ?? 'any'}
                            onChange={e => setEditDraft(d => ({ ...d, dayTypeStr: e.target.value as 'any'|'workday'|'weekend' }))}
                            className="w-full px-2 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-300 focus:outline-none focus:border-brand-500/60"
                          >
                            <option value="any">Any day</option>
                            <option value="workday">Workday only</option>
                            <option value="weekend">Weekend only</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-end gap-2 pb-0.5">
                            <button
                              type="button"
                              onClick={() => commitEdit(lv)}
                              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs text-white font-medium transition-colors"
                            >
                              <Check size={12} /> Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-400 transition-colors"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                      <p className="text-[10px] text-slate-500 mb-1">Tolerance (±) <span className="text-zinc-700">e.g. 0.5 → triggers at value±0.5</span></p>
                      <input
                        type="number" min={0} max={10} step={0.5}
                        value={vlTolerance} onChange={e => setVlTolerance(e.target.value)}
                        placeholder="0.5"
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">Label <span className="text-zinc-600">(optional)</span></p>
                    <input
                      value={vlLabel}
                      onChange={e => setVlLabel(e.target.value)}
                      placeholder="e.g. Active zone"
                      className={cn(inputCls)}
                    />
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">Timeframe</p>
                    <select
                      value={vlTf}
                      onChange={e => setVlTf(e.target.value)}
                      className="w-full px-2 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-300 focus:outline-none focus:border-brand-500/60"
                    >
                      <option value="">All TFs</option>
                      {['15m', '1h', '4h', '1d'].map(tf => (
                        <option key={tf} value={tf}>{tf.toUpperCase()}</option>
                      ))}
                      <option value="aggregated">AGG — General</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] text-slate-500 mb-1">Day type</p>
                    <select
                      value={vlDayType}
                      onChange={e => setVlDayType(e.target.value as typeof vlDayType)}
                      className="w-full px-2 py-2 rounded-lg bg-surface-700 border border-surface-600 text-xs text-slate-300 focus:outline-none focus:border-brand-500/60"
                    >
                      <option value="any">Any day</option>
                      <option value="workday">Workday only</option>
                      <option value="weekend">Weekend only</option>
                    </select>
                  </div>
                </div>
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
        <SaveBar saving={saving} saved={saved} saveErr={saveErr} dirty={dirty} onSave={() => void save()} />

      </div>
    </div>

      {/* ── Template modal ────────────────────────────────────────────────── */}
      {templateModalTf !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setTemplateModalTf(null) }}
        >
          <div className="w-full max-w-lg rounded-2xl bg-surface-800 border border-surface-600 shadow-2xl overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-700">
              <div className="flex items-center gap-2">
                <FileText size={14} className="text-brand-400" />
                <span className="text-sm font-semibold text-slate-200">Template · {templateModalTf === 'aggregated' ? 'AGG' : templateModalTf.toUpperCase()}</span>
              </div>
              <button
                type="button"
                onClick={() => setTemplateModalTf(null)}
                className="p-1 rounded text-slate-600 hover:text-slate-300 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                Available variables:{' '}
                {['{timeframe}','{score}','{regime}','{summary}','{components}'].map(v => (
                  <code key={v} className="mx-0.5 px-1 rounded bg-surface-700 text-zinc-300 font-mono">{v}</code>
                ))}
              </p>
              <textarea
                rows={8}
                autoFocus
                value={templateDraft}
                onChange={e => setTemplateDraft(e.target.value)}
                spellCheck={false}
                className="w-full px-3 py-2.5 rounded-lg bg-surface-900 border border-surface-600 text-xs text-slate-300 font-mono focus:outline-none focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 resize-y transition-colors"
              />
            </div>

            {/* Modal footer */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-surface-700 bg-surface-900/40">
              <button
                type="button"
                onClick={() => setTemplateDraft(DEFAULT_REGIME_TEMPLATE)}
                className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                Reset to default
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateModalTf(null)}
                  className="px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-slate-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmTemplate}
                  className="px-4 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-xs text-white font-medium transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
