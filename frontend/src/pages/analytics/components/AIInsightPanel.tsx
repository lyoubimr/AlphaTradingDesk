// ── AIInsightPanel ────────────────────────────────────────────────────────
// Display AI-generated narrative + regenerate button
import { useState } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
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
}

export function AIInsightPanel({ profileId, period, aiEnabled, existing }: Props) {
  const [result, setResult] = useState<AIGenerateOut | null>(existing ?? null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!aiEnabled) {
    return (
      <div className="flex items-center gap-2 text-slate-500 text-sm py-4">
        <Sparkles size={14} />
        AI insights disabled — enable in settings below.
      </div>
    )
  }

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await analyticsApi.generateSummary(profileId, period)
      setResult(data)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Generation failed'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-300">
          <Sparkles size={14} className="text-violet-400" />
          <span className="text-sm font-medium">AI Trading Insights</span>
          {result && (
            <span className="text-xs text-slate-600">
              · {PROVIDER_LABELS[result.provider] ?? result.provider}
              {result.model ? ` (${result.model})` : ''}
            </span>
          )}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Generating…' : result ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-950/40 border border-red-900 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {result?.summary && (
        <div className="text-sm text-slate-300 leading-relaxed whitespace-pre-line bg-surface-800/60 rounded-lg p-4 border border-surface-700">
          {result.summary}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="text-xs text-slate-600 py-2">
          Click "Generate" to get an AI analysis of your trading performance.
        </div>
      )}

      {result?.generated_at && (
        <div className="text-xs text-slate-600">
          Generated {new Date(result.generated_at).toLocaleString()}
        </div>
      )}
    </div>
  )
}
