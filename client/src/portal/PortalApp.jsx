/**
 * PortalApp — caregiver portal (/portal/*), mounted by main.jsx instead of the terminal App.
 *
 *   /portal/pair  → code entry (centered card), no shell
 *   /portal/*     → header + navigation; requires a stored caregiver JWT
 *
 * Responsive (mobile-first, C2):
 *   <1024px   header, content, bottom tab bar (64px + safe area)
 *   ≥1024px   header, left sidebar rail with the same 5 destinations, content
 *   content   centered container, max 1100px; pages put cards in 2 columns from 768px where it helps
 */
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import '../i18n'
import './portal.css'

import PortalHeader from './components/PortalHeader'
import TabBar, { SideRail } from './components/TabBar'
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
    <div className="flex h-full flex-col bg-canvas text-white">
      <PortalHeader />
      <div className="flex min-h-0 flex-1">
        <SideRail />
        <main className="portal-main min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[1100px] px-4 pt-6 md:px-6">
            <Outlet />
          </div>
        </main>
      </div>
      <TabBar />
    </div>
  )
}

export default function PortalApp() {
  return (
    <BrowserRouter>
      <div className="portal h-full bg-canvas">
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
    </BrowserRouter>
  )
}
