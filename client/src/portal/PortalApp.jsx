/**
 * PortalApp — caregiver portal (/portal/*), mounted by main.jsx instead of the terminal App.
 *
 *   /portal/pair  → code entry, no shell
 *   /portal/*     → header + bottom tab bar; requires a stored caregiver JWT
 */
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import '../i18n'
import './portal.css'

import PortalHeader from './components/PortalHeader'
import TabBar       from './components/TabBar'
import { TAB_BAR_HEIGHT } from './layout'
import Pair        from './pages/Pair'
import Home        from './pages/Home'
import Context     from './pages/Context'
import Patient     from './pages/Patient'
import Routines    from './pages/Routines'
import Settings    from './pages/Settings'
import { getSession } from './session'

function RequireSession() {
  return getSession() ? <Outlet /> : <Navigate to="/portal/pair" replace />
}

function PortalShell() {
  return (
    <div className="flex h-full flex-col bg-[#427aa1] text-white">
      <PortalHeader />
      <main
        className="w-full flex-1 overflow-y-auto"
        style={{ paddingBottom: `calc(${TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom) + 16px)` }}
      >
        <Outlet />
      </main>
      <TabBar />
    </div>
  )
}

export default function PortalApp() {
  return (
    <BrowserRouter>
      {/* Phone-width column: full width on phones, centered 480px on larger screens */}
      <div className="portal h-full bg-intacta-panel">
      <div className="relative mx-auto h-full w-full max-w-[480px] shadow-[0_0_24px_rgba(6,19,44,0.35)]">
      <Routes>
        <Route path="/portal/pair" element={<Pair />} />
        <Route element={<RequireSession />}>
          <Route element={<PortalShell />}>
            <Route path="/portal"          element={<Home />} />
            <Route path="/portal/patient"  element={<Patient />} />
            <Route path="/portal/routines" element={<Routines />} />
            <Route path="/portal/context"  element={<Context />} />
            <Route path="/portal/settings" element={<Settings />} />
            <Route path="/portal/*"        element={<Navigate to="/portal" replace />} />
          </Route>
        </Route>
      </Routes>
      </div>
      </div>
    </BrowserRouter>
  )
}
