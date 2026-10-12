import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import PortalApp from './portal/PortalApp.jsx'
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/baloo-da-2/400.css'
import '@fontsource/baloo-da-2/800.css'

// Caregiver portal and patient terminal are separate apps on one origin
const isPortal = window.location.pathname.startsWith('/portal')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isPortal ? <PortalApp /> : <App />}
  </StrictMode>,
)
