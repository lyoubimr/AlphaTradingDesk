// Parses the Markdown subset produced by the AI prompt (headings, bullets, numbered items, **bold**).

export type SummaryTone = 'good' | 'bad' | 'action' | 'watch' | 'neutral'

export interface SummaryItem {
  ordered: boolean
  text: string
}

export interface SummarySection {
  title: string
  tone: SummaryTone
  items: SummaryItem[]
}

export interface InlineSegment {
  bold: boolean
  text: string
}

const HEADING = /^#{1,6}\s+(.+)$/
const BOLD_LINE = /^\*\*(.+?)\*\*:?$/
const BULLET = /^[-*•]\s+(.+)$/
const NUMBERED = /^\d+[.)]\s+(.+)$/

function toneOf(title: string): SummaryTone {
  if (title.includes('✅')) return 'good'
  if (title.includes('❌') || title.includes('⚠')) return 'bad'
  if (title.includes('🎯')) return 'action'
  if (title.includes('🔎') || title.includes('📌')) return 'watch'
  return 'neutral'
}

const cleanTitle = (raw: string) => raw.replace(/\*\*/g, '').trim()

export function parseAISummary(summary: string): SummarySection[] {
  const sections: SummarySection[] = []
  let current: SummarySection | null = null

  const ensureSection = () => {
    if (!current) {
      current = { title: '', tone: 'neutral', items: [] }
      sections.push(current)
    }
    return current
  }

  for (const raw of summary.split('\n')) {
    const line = raw.trim()
    if (!line || /^[-*_]{3,}$/.test(line)) continue

    // Whole-line **bold** is accepted as a heading so older cached summaries still render.
    const heading = line.match(HEADING) ?? line.match(BOLD_LINE)
    if (heading) {
      const title = cleanTitle(heading[1])
      current = { title, tone: toneOf(title), items: [] }
      sections.push(current)
      continue
    }

    const numbered = line.match(NUMBERED)
    if (numbered) {
      ensureSection().items.push({ ordered: true, text: numbered[1] })
      continue
    }

    const bullet = line.match(BULLET)
    ensureSection().items.push({ ordered: false, text: bullet ? bullet[1] : line })
  }

  return sections.filter(s => s.items.length > 0)
}

export function splitInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ bold: false, text: text.slice(last, m.index) })
    out.push({ bold: true, text: m[1] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ bold: false, text: text.slice(last) })
  return out
}
