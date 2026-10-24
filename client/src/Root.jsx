/**
 * Root — picks the app for the URL: start menu ("/"), patient terminal or caregiver portal.
 */
import { useState } from 'react'
import App from './App.jsx'
import PortalApp from './portal/PortalApp.jsx'
import StartMenu from './pages/StartMenu.jsx'
import { getStoredMode, resolveStart, pathForMode } from './lib/startMode'
import { unlockAudio } from './lib/speaker'
import { requestMic } from './lib/voiceInput'

/* Caregiver portal and patient terminal are separate apps on one origin; "/" is the start menu
   (or, with a remembered mode and no ?choose=1, that mode's app). Decided once, before any router mounts. */
const initial = resolveStart({ pathname: window.location.pathname, search: window.location.search, storedMode: getStoredMode() })
if (initial.redirect) window.history.replaceState(null, '', initial.redirect)

export default function Root() {
  const [view, setView] = useState({ app: initial.app, boot: null })

  // Start menu choice: swap apps without a reload. "Patient tablet": this tap is the user gesture,
  // so audio is unlocked and the mic requested here, and the terminal skips its "Tap to start" gate.
  const handleChoose = (mode) => {
    let boot = null
    if (mode === 'patient') {
      const audioUnlocked = unlockAudio() // synchronously inside the tap
      const mic = requestMic() // also inside the tap (iOS needs the gesture)
      mic.catch(() => {}) // handled in useVoiceLoop
      boot = { audioUnlocked, mic }
    }
    window.history.replaceState(null, '', pathForMode(mode))
    setView({ app: mode === 'caregiver' ? 'portal' : 'terminal', boot })
  }

  if (view.app === 'start')  return <StartMenu onChoose={handleChoose} />
  if (view.app === 'portal') return <PortalApp />
  return <App boot={view.boot} />
}
