import { useEffect, useState } from 'react'
import './App.css'

interface HealthStatus {
  status: string
  environment: string
}

function App() {
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(true))
  }, [])

  const statusColor = error ? '#ef4444' : health ? '#22c55e' : '#f59e0b'
  const statusLabel = error ? 'Offline' : health ? 'Online' : 'Connecting…'

  return (
    <div className="atd-layout">
      <aside className="atd-sidebar">
        <div className="atd-logo">
          <span className="atd-logo-alpha">α</span>
          <span>AlphaTradingDesk</span>
        </div>
        <nav className="atd-nav">
          <a href="#" className="atd-nav-item active">Dashboard</a>
          <a href="#" className="atd-nav-item">Trade Journal</a>
          <a href="#" className="atd-nav-item">Risk Manager</a>
          <a href="#" className="atd-nav-item">Watchlist</a>
          <a href="#" className="atd-nav-item">Volatility</a>
          <a href="#" className="atd-nav-item">Settings</a>
        </nav>
        <div className="atd-status-bar">
          <span className="atd-status-dot" style={{ background: statusColor }} />
          <span>API: {statusLabel}</span>
          {health && (
            <span className="atd-env-badge">{health.environment}</span>
          )}
        </div>
      </aside>

      <main className="atd-main">
        <header className="atd-header">
          <h1>Dashboard</h1>
          <span className="atd-version">v0.1.0 · Step 1 Bootstrap</span>
        </header>

        <section className="atd-cards">
          <div className="atd-card">
            <h3>Open Positions</h3>
            <p className="atd-card-value">—</p>
            <p className="atd-card-label">No data yet</p>
          </div>
          <div className="atd-card">
            <h3>Today's P&L</h3>
            <p className="atd-card-value">—</p>
            <p className="atd-card-label">No data yet</p>
          </div>
          <div className="atd-card">
            <h3>Portfolio Risk</h3>
            <p className="atd-card-value">—</p>
            <p className="atd-card-label">No data yet</p>
          </div>
          <div className="atd-card">
            <h3>Market Volatility</h3>
            <p className="atd-card-value">—</p>
            <p className="atd-card-label">No data yet</p>
          </div>
        </section>

        <section className="atd-health-section">
          <h2>System Health</h2>
          {error && (
            <p className="atd-error">
              ⚠ Cannot reach API — is the backend running?
              (<code>make dev</code> or <code>docker compose -f docker-compose.dev.yml up</code>)
            </p>
          )}
          {health && (
            <pre className="atd-json">{JSON.stringify(health, null, 2)}</pre>
          )}
          {!health && !error && <p className="atd-muted">Fetching /health…</p>}
        </section>
      </main>
    </div>
  )
}

export default App
