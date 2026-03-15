// ── Sidebar component ──────────────────────────────────────────────────────
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpen,
  BarChart2,
  Target,
  Settings,
  TrendingUp,
  Eye,
  Activity,
  Users,
  SlidersHorizontal,
  Crosshair,
  Bell,
} from 'lucide-react'
import { cn } from '../../lib/cn'
import { Badge } from '../ui/Badge'

// ── Types ──────────────────────────────────────────────────────────────────

interface NavItem {
  to: string
  label: string
  icon: React.ReactNode
  badge?: string
  badgeVariant?: 'default' | 'bull' | 'bear' | 'neutral' | 'soon' | 'phase'
}

interface NavGroup {
  heading?: string
  items: NavItem[]
}

// ── Nav structure ──────────────────────────────────────────────────────────

const NAV_GROUPS: NavGroup[] = [
  {
    heading: 'Core',
    items: [
      {
        to: '/dashboard',
        label: 'Dashboard',
        icon: <LayoutDashboard size={16} />,
      },
      {
        to: '/trades',
        label: 'Trade Journal',
        icon: <BookOpen size={16} />,
      },
      {
        to: '/goals',
        label: 'Goals',
        icon: <Target size={16} />,
      },
    ],
  },
  {
    heading: 'Analysis',
    items: [
      {
        to: '/market-analysis',
        label: 'Market Analysis',
        icon: <BarChart2 size={16} />,
      },
      {
        to: '/volatility/market',
        label: 'Volatility',
        icon: <Activity size={16} />,
      },
      {
        to: '/volatility/pairs',
        label: 'Watchlist',
        icon: <Eye size={16} />,
      },
    ],
  },
  {
    heading: 'Settings',
    items: [
      {
        to: '/settings/profiles',
        label: 'Profiles',
        icon: <Users size={16} />,
      },
      {
        to: '/settings/goals',
        label: 'Goals Settings',
        icon: <Target size={16} />,
      },
      {
        to: '/settings/strategies',
        label: 'Strategies',
        icon: <Crosshair size={16} />,
      },
      {
        to: '/settings/market-analysis',
        label: 'Indicator Editor',
        icon: <SlidersHorizontal size={16} />,
      },
      {
        to: '/settings/volatility',
        label: 'Volatility Settings',
        icon: <Activity size={16} />,
      },
      {
        to: '/settings/notifications',
        label: 'Notifications',
        icon: <Bell size={16} />,
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: <Settings size={16} />,
      },
    ],
  },
]

// ── Sidebar ────────────────────────────────────────────────────────────────

interface SidebarProps {
  apiStatus: 'online' | 'offline' | 'connecting'
  environment?: string
}

const statusMeta = {
  online:     { color: 'bg-green-500',  label: 'API Online' },
  offline:    { color: 'bg-red-500',    label: 'API Offline' },
  connecting: { color: 'bg-amber-400',  label: 'Connecting…' },
}

export function Sidebar({ apiStatus, environment }: SidebarProps) {
  const meta = statusMeta[apiStatus]

  return (
    <aside className="
      flex flex-col w-56 shrink-0
      bg-surface-900 border-r border-surface-800
      h-screen sticky top-0 overflow-y-auto
    ">
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4 border-b border-surface-800">
        {/* Greek alpha + candlestick SVG mark */}
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-brand-600 shadow-lg shadow-brand-900/50 shrink-0">
          <TrendingUp size={15} className="text-white" strokeWidth={2.5} />
        </div>
        <div>
          <div className="flex items-baseline gap-1">
            <span className="text-brand-400 font-bold text-sm tracking-tight">α</span>
            <span className="text-slate-100 font-semibold text-sm tracking-tight">TradingDesk</span>
          </div>
        </div>
      </div>

      {/* ── Nav groups ────────────────────────────────────────────────────── */}
      <nav className="flex-1 px-2 py-3 space-y-4">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.heading && (
              <p className="px-2 mb-1 text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                {group.heading}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) => cn(
                      'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors',
                      'group relative',
                      isActive
                        ? 'bg-brand-600/20 text-brand-300 font-medium'
                        : 'text-slate-500 hover:text-slate-200 hover:bg-surface-800',
                    )}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <Badge label={item.badge} variant={item.badgeVariant} />
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── Status bar ────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-t border-surface-800 flex items-center gap-2">
        <span className={cn('w-2 h-2 rounded-full shrink-0 animate-pulse', meta.color)} />
        <span className="text-xs text-slate-600 flex-1 truncate">{meta.label}</span>
        {environment && (
          <span className="text-[9px] uppercase tracking-widest text-slate-700 bg-surface-800 px-1.5 py-0.5 rounded">
            {environment}
          </span>
        )}
      </div>
    </aside>
  )
}
