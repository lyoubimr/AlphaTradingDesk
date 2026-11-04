import { describe, it, expect } from 'vitest'
import { parseAISummary, splitInline } from '../pages/analytics/components/parseAISummary'

const NEW_FORMAT = `## ✅ What's working
- 🌞 **Fib 0.618 retest** — 6 trades, 66.7% WR.
- 💰 **Profit factor** — 5.03 over 13 trades.
## ⚠️ What needs fixing
- 📉 **Intraday** — 9 trades, 22.2% WR.
## 🎯 Actions
1. 🔄 **Cut intraday size** — 22.2% WR over 9 trades.
2. 🧭 **Review losers** — 4 tagged bad_entry.
## 🔎 Too early to tell
- 🐺 **Wolf trendline** — 2 trades, keep tracking.`

describe('parseAISummary', () => {
  it('splits the new format into toned sections', () => {
    const sections = parseAISummary(NEW_FORMAT)
    expect(sections.map(s => s.tone)).toEqual(['good', 'bad', 'action', 'watch'])
    expect(sections[0].items).toHaveLength(2)
    expect(sections[2].items.every(i => i.ordered)).toBe(true)
    expect(sections[0].items[0].ordered).toBe(false)
  })

  it('keeps legacy **bold-line** headings working', () => {
    const legacy = `**✅ What's working**\n- 🌞 **Fib** – 3 trades\n\n**🎯 Actions to take**\n- 🔄 do it`
    const sections = parseAISummary(legacy)
    expect(sections.map(s => s.tone)).toEqual(['good', 'action'])
    expect(sections[0].title).not.toContain('**')
  })

  it('drops empty sections and horizontal rules, keeps plain text', () => {
    const sections = parseAISummary('## ✅ Empty\n---\n## 🎯 Actions\nJust text')
    expect(sections).toHaveLength(1)
    expect(sections[0].items[0].text).toBe('Just text')
  })
})

describe('splitInline', () => {
  it('separates bold and plain segments', () => {
    expect(splitInline('a **b** c')).toEqual([
      { bold: false, text: 'a ' },
      { bold: true, text: 'b' },
      { bold: false, text: ' c' },
    ])
  })

  it('returns a single plain segment when there is no bold', () => {
    expect(splitInline('plain')).toEqual([{ bold: false, text: 'plain' }])
  })
})
