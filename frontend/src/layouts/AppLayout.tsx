// ── AppLayout ──────────────────────────────────────────────────────────────
// Root layout: sidebar (fixed left) + topbar + scrollable main content.
import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from '../components/sidebar/Sidebar'
import { Topbar } from '../components/topbar/Topbar'

type ApiStatus = 'online' | 'offline' | 'connecting'

interface HealthData {
  status: string
  environment: string
}

function useClock() {
  const [time, setTime] = useState(() => new Date().toUTCString().slice(17, 25) + ' UTC')
  useEffect(() => {
    const id = setInterval(() => {
      setTime(new Date().toUTCString().slice(17, 25) + ' UTC')
    }, 1_000)
    return () => clearInterval(id)
  }, [])
  return time
}

function useApiHealth(): { status: ApiStatus; environment?: string } {
  const [status, setStatus] = useState<ApiStatus>('connecting')
  const [environment, setEnvironment] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    const check = () => {
      fetch('/api/health')
        .then<HealthData>((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            setStatus('online')
            setEnvironment(data.environment)
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

  return { status, environment }
}

export function AppLayout() {
  const time = useClock()
  const { status: apiStatus, environment } = useApiHealth()

  return (
    <div className="flex h-screen bg-surface-950 overflow-hidden">
      <Sidebar apiStatus={apiStatus} environment={environment} />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar currentTime={time} />

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
