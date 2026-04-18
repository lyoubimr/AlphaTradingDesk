// ── Post-trade review tag definitions ────────────────────────────────────────
// Shared between TradeReviewPanel (badge grid) and ProfilesPage (tag management).

export interface TagDef {
  key: string
  emoji: string
  label: string
  positive: boolean
  /**
   * 'tri-state': null → good (key stored) → bad (badKey stored) → null
   * 'flag': binary, off → on (key stored) — for events that either happened or didn't
   * default: 'flag'
   */
  mode?: 'flag' | 'tri-state'
  /** Stored tag when quality is BAD (tri-state only) */
  badKey?: string
  /** Tooltip when tri-state is null (not yet evaluated) */
  nullDesc?: string
  /** Tooltip when tri-state is good */
  goodDesc?: string
  /** Tooltip when tri-state is bad */
  badDesc?: string
  /** Tooltip for flag tags */
  description?: string
}

export const EXECUTION_TAGS: TagDef[] = [
  {
    key: 'good_entry', emoji: '✅', label: 'Entry', positive: true, mode: 'tri-state', badKey: 'bad_entry',
    nullDesc: 'Entry non évalué — cliquer pour marquer',
    goodDesc: 'Good entry — precise timing, clean execution at the right level',
    badDesc:  'Bad entry — rushed, late, or at wrong price level',
  },
  {
    key: 'good_sl', emoji: '🛡️', label: 'Stop Loss', positive: true, mode: 'tri-state', badKey: 'bad_sl',
    nullDesc: 'SL non évalué — cliquer pour marquer',
    goodDesc: 'Good SL — logical, well-placed stop loss below/above key level',
    badDesc:  'Bad SL — too tight, too wide, or poorly placed',
  },
  {
    key: 'smart_exit', emoji: '⏩', label: 'Early exit', positive: true, mode: 'tri-state', badKey: 'early_exit',
    nullDesc: 'Exit timing N/A — cliquer si applicable (laisser vide si full TP atteint)',
    goodDesc: 'Smart early exit — intentional cut of loss or logical level close',
    badDesc:  'Bad early exit — undisciplined, panic or FOMO exit',
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
