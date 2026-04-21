// ── AIInsightPanel ────────────────────────────────────────────────────────────
// Hero gradient AI insights card — placed at top of analytics page
import { useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Settings, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { analyticsApi } from '../../../lib/api'
import type { AIGenerateOut } from '../../../types/api'

interface Props {
  profileId: number
  period: string
  aiEnabled: boolean
  existing?: AIGenerateOut | null
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  perplexity: 'Perplexity',
  groq: 'Groq',
  gemini: 'Google Gemini',
}

export function AIInsightPanel({ profileId, period, aiEnabled, existing }: Props) {
  const [result, setResult] = useState<AIGenerateOut | null>(existing ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(true)
  const navigate = useNavigate()

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await analyticsApi.generateSummary(profileId, period)
      setResult(data)
      setCollapsed(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Generation failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-violet-900/40 bg-gradient-to-br from-violet-950/60 via-surface-900 to-surface-900 shadow-xl">
      {/* Subtle radial glow */}
      <div
        className="pointer-events-none absolute -top-16 -left-16 w-64 h-64 rounded-full opacity-20"
        style={{ background: 'radial-gradient(circle, #7c3aed 0%, transparent 70%)' }}
      />

      {/* Header row */}
      <div className="relative flex items-center justify-between px-5 py-4 flex-wrap gap-y-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Sparkles size={16} className="text-violet-400 shrink-0" />
          <span className="text-sm font-semibold text-slate-100">AI Trading Insights</span>
          {result && (
            <span className="text-[10px] text-slate-500 font-normal truncate">
              · {PROVIDER_LABELS[result.provider] ?? result.provider}
              {result.model ? ` (${result.model})` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate('/settings/ai')}
            title="AI Settings"
            className="p-2.5 rounded-lg text-slate-600 hover:text-violet-400 hover:bg-violet-950/40 transition-colors"
          >
            <Settings size={13} />
          </button>
          <button
            onClick={generate}
            disabled={loading || !aiEnabled}
            title={!aiEnabled ? 'AI disabled — configure in AI Settings' : ''}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-violet-600/80 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors font-medium"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Generating…' : result ? 'Regenerate' : 'Generate'}
          </button>
          {result && (
            <button
              onClick={() => setCollapsed(c => !c)}
              className="p-2.5 rounded-lg text-slate-600 hover:text-slate-400 transition-colors"
            >
              {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="relative px-5 pb-5 space-y-3">
          {!aiEnabled && (
            <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
              <Sparkles size={13} />
              AI insights disabled —
              <button
                className="text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors"
                onClick={() => navigate('/settings/ai')}
              >
                configure in AI Settings
              </button>
            </div>
          )}

          {error && (
            <div className="text-xs bg-red-950/40 border border-red-900/50 rounded-lg px-3 py-2 space-y-0.5">
              {error.includes('429') || error.toLowerCase().includes('quota') || error.toLowerCase().includes('insufficient') ? (
                <>
                  <div className="font-semibold text-red-400">API quota exceeded</div>
                  <div className="text-slate-500">
                    Your AI provider has run out of credits. Top up your balance or switch model in{' '}
                    <button onClick={() => navigate('/settings/ai')} className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
                      AI Settings
                    </button>.
                  </div>
                </>
              ) : (
                <div className="text-red-400">{error}</div>
              )}
            </div>
          )}

          {result?.summary && (
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">
              {result.summary}
            </p>
          )}

          {!result && !loading && !error && aiEnabled && (
            <p className="text-xs text-slate-600 py-2">
              Click “Generate” to get a personalised AI analysis of your trading performance for this period.
            </p>
          )}

          {result?.generated_at && (
            <p className="text-[10px] text-slate-700">
              Generated {new Date(result.generated_at).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface Props {
  profileId: number
  period: string
  aiEnabled: boolean
  existing?: AIGenerateOut | null
}
