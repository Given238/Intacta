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
import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import '../i18n'
import './portal.css'

import { portalFetch } from './portalApi'
import NameSheet from './components/NameSheet'
import PortalHeader from './components/PortalHeader'
import TabBar, { SideRail } from './components/TabBar'
import Pair        from './pages/Pair'
import Home        from './pages/Home'
import Context     from './pages/Context'
import Patient     from './pages/Patient'
import Routines    from './pages/Routines'
import Settings    from './pages/Settings'
import { getSession } from './session'
import { startLogoutRetry } from './logout'

function RequireSession() {
  return getSession() ? <Outlet /> : <Navigate to="/portal/pair" replace />
}

/**
 * After a first pairing (Pair navigates with state {askName: true}): if the caregiver has no name yet, ask once.
 * Skip or save clears the flag from the history entry, so a reload or Back never asks again.
 */
function useAskName() {
  const location = useLocation()
  const navigate = useNavigate()
  const [ask, setAsk] = useState(false)
  const wanted = !!location.state?.askName

  useEffect(() => {
    if (!wanted) return
    let live = true
    portalFetch('/api/caregiver')
      .then(({ caregiver }) => { if (live) setAsk(!caregiver?.name) })
      .catch(() => {}) // not asking is fine; the name can be set in Settings
    return () => { live = false }
  }, [wanted])

  const done = () => {
    setAsk(false)
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }
  return { ask, done }
}

function PortalShell() {
  const { ask, done } = useAskName()
  return (
    <div className="flex h-full flex-col bg-canvas text-white">
      {ask && <NameSheet onDone={done} />}
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
  // A Log Out that couldn't reach the server is sent once when the network is back
  useEffect(() => startLogoutRetry(), [])
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
