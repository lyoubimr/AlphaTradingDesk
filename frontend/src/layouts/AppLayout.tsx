// ── AppLayout ──────────────────────────────────────────────────────────────
// Root layout: sidebar (fixed left) + topbar + scrollable main content.
// On mobile (< lg) the sidebar becomes an off-canvas drawer toggled by a
// hamburger button in the topbar.
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/sidebar/Sidebar'
import { Topbar } from '../components/topbar/Topbar'
import { ProfileProvider } from '../context/ProfileContext'

type ApiStatus = 'online' | 'offline' | 'connecting'

interface HealthData {
  status: string
  environment: string
  version?: string
}

function useApiHealth(): { status: ApiStatus; environment?: string; version?: string } {
  const [status, setStatus] = useState<ApiStatus>('connecting')
  const [environment, setEnvironment] = useState<string | undefined>()
  const [version, setVersion] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    const check = () => {
      fetch('/api/health')
        .then<HealthData>((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            setStatus('online')
            setEnvironment(data.environment)
            setVersion(data.version)
          }
        })
        .catch(() => {
          if (!cancelled) setStatus('offline')
        })
    }
    check()
    const id = setInterval(check, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  return { status, environment, version }
}

export function AppLayout() {
  const { status: apiStatus, environment, version } = useApiHealth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <ProfileProvider>
      <div className="flex h-screen bg-surface-950 overflow-hidden">

        {/* ── Mobile backdrop ─────────────────────────────────────────── */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          apiStatus={apiStatus}
          environment={environment}
          version={version}
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <Topbar onMenuOpen={() => setSidebarOpen(true)} />

          <main className="flex-1 overflow-y-auto">
            <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </ProfileProvider>
  )
}
