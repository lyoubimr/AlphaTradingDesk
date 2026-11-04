// Renders an AI summary as titled cards (no raw Markdown symbols shown).
import { parseAISummary, splitInline, type SummaryTone } from './parseAISummary'

const TONE_STYLES: Record<SummaryTone, { card: string; title: string }> = {
  good: { card: 'border-l-emerald-500/70', title: 'text-emerald-300' },
  bad: { card: 'border-l-amber-500/70', title: 'text-amber-300' },
  action: { card: 'border-l-violet-500/70', title: 'text-violet-300' },
  watch: { card: 'border-l-slate-500/60', title: 'text-slate-400' },
  neutral: { card: 'border-l-surface-600', title: 'text-slate-300' },
}

export function AIInsightBody({ summary }: { summary: string }) {
  const sections = parseAISummary(summary)

  return (
    <div className="space-y-3">
      {sections.map((section, i) => {
        const style = TONE_STYLES[section.tone]
        return (
          <section
            key={`${section.title}-${i}`}
            className={`rounded-xl border border-surface-700/60 border-l-4 ${style.card} bg-surface-900/60 px-4 py-3`}
          >
            {section.title && (
              <h4 className={`text-xs font-semibold uppercase tracking-wide mb-2 ${style.title}`}>
                {section.title}
              </h4>
            )}
            <ul className="space-y-2">
              {section.items.map((item, j) => (
                <li key={j} className="flex gap-2.5 text-sm leading-relaxed text-slate-300">
                  {item.ordered && (
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-600/30 text-[11px] font-semibold text-violet-200">
                      {j + 1}
                    </span>
                  )}
                  <span>
                    {splitInline(item.text).map((seg, k) =>
                      seg.bold
                        ? <strong key={k} className="font-semibold text-slate-100">{seg.text}</strong>
                        : <span key={k}>{seg.text}</span>,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
