import { Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { TradesPage } from './pages/trades/TradesPage'
import { NewTradePage } from './pages/trades/NewTradePage'
import { TradeDetailPage } from './pages/trades/TradeDetailPage'
import { RiskPage } from './pages/risk/RiskPage'
import { MarketAnalysisPage } from './pages/market-analysis/MarketAnalysisPage'
import { GoalsPage } from './pages/goals/GoalsPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ProfilesPage } from './pages/settings/ProfilesPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/trades/new" element={<NewTradePage />} />
        <Route path="/trades/:id" element={<TradeDetailPage />} />
        <Route path="/risk" element={<RiskPage />} />
        <Route path="/market-analysis" element={<MarketAnalysisPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/profiles" element={<ProfilesPage />} />
      </Route>
    </Routes>
  )
}
