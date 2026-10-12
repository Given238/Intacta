/**
 * Caregiver portal session — the JWT and pairing result from POST /api/devices/pair.
 * Stored under its own key so it never mixes with the terminal's localStorage.
 */
const KEY = 'portal_session'

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    return s?.token ? s : null
  } catch {
    return null
  }
}

export function setSession({ token, patient_id, language, device_name }) {
  localStorage.setItem(KEY, JSON.stringify({ token, patient_id, language, device_name }))
}

export function clearSession() {
  localStorage.removeItem(KEY)
}
