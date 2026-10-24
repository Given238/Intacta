/**
 * Start menu mode memory and the "/" routing decision.
 *
 * localStorage `intacta_mode` = {"mode": "patient" | "caregiver"} (no sensitive data). Only the start menu writes it
 * (with "Remember this choice" on); switching mode clears it. Direct links to /terminal and /portal never touch it.
 */
const KEY = 'intacta_mode'
const MODES = ['patient', 'caregiver']

export function getStoredMode(storage = globalThis.localStorage) {
  try {
    const mode = JSON.parse(storage.getItem(KEY))?.mode
    return MODES.includes(mode) ? mode : null
  } catch {
    return null
  }
}

export function setStoredMode(mode, storage = globalThis.localStorage) {
  if (!MODES.includes(mode)) return
  try { storage.setItem(KEY, JSON.stringify({ mode })) } catch { /* storage blocked: just not remembered */ }
}

export function clearStoredMode(storage = globalThis.localStorage) {
  try { storage.removeItem(KEY) } catch { /* storage blocked */ }
}

export const pathForMode = (mode) => (mode === 'caregiver' ? '/portal' : '/terminal')

/**
 * Which app to mount for a URL.
 *   /portal…            → portal
 *   /  (+ remembered, no ?choose=1) → that mode's app, redirect to its path
 *   /                   → start menu
 *   anything else       → terminal (its own catch-all goes to /terminal)
 * @returns {{app: 'start' | 'terminal' | 'portal', redirect?: string}}
 */
export function resolveStart({ pathname, search = '', storedMode = null }) {
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return { app: 'portal' }
  if (pathname === '/' || pathname === '') {
    const choose = new URLSearchParams(search).get('choose') === '1'
    if (storedMode && !choose) {
      return { app: storedMode === 'caregiver' ? 'portal' : 'terminal', redirect: pathForMode(storedMode) }
    }
    return { app: 'start' }
  }
  return { app: 'terminal' }
}

/** Leave the current app for the start menu (Switch mode): forget the choice, keep device token and login. */
export function goToModeChooser() {
  clearStoredMode()
  window.location.assign('/?choose=1')
}
