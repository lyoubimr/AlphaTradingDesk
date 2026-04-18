// ── Post-trade review tag definitions ────────────────────────────────────────
// Shared between TradeReviewPanel (badge grid) and ProfilesPage (tag management).

export interface TagDef {
  key: string
  emoji: string
  label: string
  positive: boolean
  /** 'good-bad': always-ON toggle (default = good). Only `badKey` stored when bad. */
  mode?: 'flag' | 'good-bad'
  /** Stored tag when quality is BAD (only for mode='good-bad') */
  badKey?: string
  /** Tooltip shown when state is GOOD (mode='good-bad') */
  goodDesc?: string
  /** Tooltip shown when state is BAD (mode='good-bad') */
  badDesc?: string
  /** Tooltip for flag tags */
  description?: string
}

export const EXECUTION_TAGS: TagDef[] = [
  {
    key: 'good_entry', emoji: '✅', label: 'Entry', positive: true, mode: 'good-bad', badKey: 'bad_entry',
    goodDesc: 'Good entry — precise timing, clean execution at the right level',
    badDesc:  'Bad entry — rushed, late, or at wrong price level',
  },
  {
    key: 'good_sl', emoji: '🛡️', label: 'Stop Loss', positive: true, mode: 'good-bad', badKey: 'bad_sl',
    goodDesc: 'Good SL — logical, well-placed stop loss below/above key level',
    badDesc:  'Bad SL — too tight, too wide, or poorly placed',
  },
  {
    key: 'smart_exit', emoji: '⏩', label: 'Early exit', positive: true, mode: 'good-bad', badKey: 'early_exit',
    goodDesc: 'Smart early exit — intentional (cut loss, closed at logical level)',
    badDesc:  'Bad early exit — undisciplined, FOMO or panic exit',
  },
  { key: 'late_exit',   emoji: '⏰', label: 'Late exit',    positive: false, description: 'Closed too late — missed the optimal exit window' },
  { key: 'sl_be_early', emoji: '⚡', label: 'BE too early', positive: false, description: 'Moved stop to break-even too soon and got stopped out prematurely' },
]

export const PSYCHOLOGY_TAGS: TagDef[] = [
  { key: 'fomo',        emoji: '😱', label: 'FOMO',          positive: false, description: 'Entered the trade out of fear of missing out' },
  { key: 'revenge',     emoji: '😤', label: 'Revenge trade', positive: false, description: 'Traded emotionally to recover a previous loss' },
  { key: 'rule_broken', emoji: '🚫', label: 'Rule broken',   positive: false, description: 'Violated your trading rules or system criteria' },
]

export const MARKET_TAGS: TagDef[] = [
  { key: 'weekend_scam', emoji: '🎰', label: 'Weekend scam', positive: false, description: 'Price was manipulated or gapped over the weekend' },
  { key: 'news_impact',  emoji: '📰', label: 'News impact',  positive: false, description: 'Trade was impacted by a news event or release' },
]
