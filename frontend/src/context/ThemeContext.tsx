// ── ThemeContext ──────────────────────────────────────────────────────────
// Persists the chosen colour theme in localStorage.
// Applies the theme by setting data-theme="<id>" on <html>.
//
// Available themes:
//   indigo   → Indigo Night   (default, original brand)
//   amber    → Amber Desert   (golden, warm dark surfaces)
//   cyan     → Cyan Terminal  (cyan-sky, true-black terminal surfaces)
//   night    → Night Black    (pure black, OLED-friendly)
//   obsidian → Obsidian Gold  (obsidian-black + refined gold, Bloomberg terminal)
//   aurora   → Aurora         (deep space purple + electric violet)
//   graphite → Graphite       (gunmetal neutral + vivid lime, algo/quant)

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react'

// ── Types ─────────────────────────────────────────────────────────────────

export type ThemeId = 'indigo' | 'amber' | 'cyan' | 'night' | 'obsidian' | 'aurora' | 'graphite'

export interface ThemeMeta {
  id: ThemeId
  label: string
  emoji: string
  description: string
  /** Preview swatch hex (brand-500 equivalent) */
  swatch: string
}

// eslint-disable-next-line react-refresh/only-export-components
export const THEMES: ThemeMeta[] = [
  {
    id: 'indigo',
    label: 'Indigo Night',
    emoji: '🌌',
    description: 'Default deep-indigo — focused, professional',
    swatch: '#6366f1',
  },
  {
    id: 'amber',
    label: 'Amber Desert',
    emoji: '🏜️',
    description: 'Warm gold — desert warmth, patience, wealth',
    swatch: '#f59e0b',
  },
  {
    id: 'cyan',
    label: 'Cyan Terminal',
    emoji: '💻',
    description: 'Matrix cyan — precision, algorithmic mindset',
    swatch: '#06b6d4',
  },
  {
    id: 'night',
    label: 'Night Black',
    emoji: '🌑',
    description: 'Pure black — maximum contrast, OLED-friendly',
    swatch: '#f8fafc',
  },
  {
    id: 'obsidian',
    label: 'Obsidian Gold',
    emoji: '🏆',
    description: 'Obsidian-black + refined gold — institutional terminal',
    swatch: '#ca8a04',
  },
  {
    id: 'aurora',
    label: 'Aurora',
    emoji: '🔮',
    description: 'Deep space purple + electric violet — cosmic precision',
    swatch: '#a855f7',
  },
  {
    id: 'graphite',
    label: 'Graphite',
    emoji: '⚡',
    description: 'Gunmetal black + vivid lime — raw algorithmic power',
    swatch: '#84cc16',
  },
]

const LS_KEY = 'atd_theme'

// ── Context shape ─────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: ThemeId
  setTheme: (id: ThemeId) => void
  themes: ThemeMeta[]
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// ── Provider ──────────────────────────────────────────────────────────────

function applyTheme(id: ThemeId) {
  const html = document.documentElement
  // Remove all theme data attributes first
  html.removeAttribute('data-theme')
  if (id !== 'indigo') {
    html.setAttribute('data-theme', id)
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, _setTheme] = useState<ThemeId>(() => {
    const stored = localStorage.getItem(LS_KEY)
    return (stored as ThemeId | null) ?? 'indigo'
  })

  // Apply on mount and whenever theme changes
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = (id: ThemeId) => {
    localStorage.setItem(LS_KEY, id)
    _setTheme(id)
    applyTheme(id)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
