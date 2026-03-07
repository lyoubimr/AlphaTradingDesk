import { Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from './layouts/AppLayout'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { TradesPage } from './pages/trades/TradesPage'
import { NewTradePage } from './pages/trades/NewTradePage'
import { TradeDetailPage } from './pages/trades/TradeDetailPage'
import { MarketAnalysisPage } from './pages/market-analysis/MarketAnalysisPage'
import { NewAnalysisPage } from './pages/market-analysis/NewAnalysisPage'
import { GoalsPage } from './pages/goals/GoalsPage'
import { RiskPage } from './pages/risk/RiskPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ProfilesPage } from './pages/settings/ProfilesPage'
import { MarketAnalysisSettingsPage } from './pages/settings/MarketAnalysisSettingsPage'
import { GoalsSettingsPage } from './pages/settings/GoalsSettingsPage'
import { StrategiesSettingsPage } from './pages/settings/StrategiesSettingsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/trades" element={<TradesPage />} />
        <Route path="/trades/new" element={<NewTradePage />} />
        <Route path="/trades/:id" element={<TradeDetailPage />} />
        <Route path="/market-analysis" element={<MarketAnalysisPage />} />
        <Route path="/market-analysis/new" element={<NewAnalysisPage />} />
        <Route path="/goals" element={<GoalsPage />} />
        <Route path="/risk" element={<RiskPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/profiles" element={<ProfilesPage />} />
        <Route path="/settings/market-analysis" element={<MarketAnalysisSettingsPage />} />
        <Route path="/settings/goals" element={<GoalsSettingsPage />} />
        <Route path="/settings/strategies" element={<StrategiesSettingsPage />} />
      </Route>
    </Routes>
  )
}
