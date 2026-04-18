// ── Post-trade review tag definitions ────────────────────────────────────────
// Shared between TradeReviewPanel (badge grid) and ProfilesPage (tag management).

export interface TagDef {
  key: string
  emoji: string
  label: string
  positive: boolean
}

export const EXECUTION_TAGS: TagDef[] = [
  { key: 'good_entry',  emoji: '✅', label: 'Good entry',   positive: true  },
  { key: 'good_sl',     emoji: '🛡️', label: 'Good SL',     positive: true  },
  { key: 'early_exit',  emoji: '⏩', label: 'Early exit',   positive: false },
  { key: 'late_exit',   emoji: '⏰', label: 'Late exit',    positive: false },
  { key: 'sl_be_early', emoji: '⚡', label: 'BE too early', positive: false },
]

export const PSYCHOLOGY_TAGS: TagDef[] = [
  { key: 'fomo',        emoji: '😱', label: 'FOMO',          positive: false },
  { key: 'revenge',     emoji: '😤', label: 'Revenge trade', positive: false },
  { key: 'rule_broken', emoji: '🚫', label: 'Rule broken',   positive: false },
]

export const MARKET_TAGS: TagDef[] = [
  { key: 'weekend_scam', emoji: '🎰', label: 'Weekend scam', positive: false },
  { key: 'news_impact',  emoji: '📰', label: 'News impact',  positive: false },
]
