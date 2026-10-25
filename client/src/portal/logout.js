/**
 * logout — caregiver Log Out and "you've been logged out" handling.
 *
 * logOut(): POST /api/auth/logout with the stored JWT (the server revokes this session, the caregiver leaves the care
 * team, the tablet's chip updates), then the local session is cleared (the saved start-menu mode is kept).
 * When the server can't be reached the phone still logs out; the old token is kept ONLY for one automatic retry when
 * the network returns (retryPendingLogout, started by PortalApp), then dropped.
 *
 * A revoked or expired session anywhere (REST 401, socket auth error, `session:revoked`) → sessionEnded(): clear the
 * session and load /portal/pair once with the "You've been logged out" notice (never from /portal/pair itself: no loop).
 */
import { getSession, clearSession } from './session'

const API = import.meta.env.VITE_API_URL || ''
const RETRY_KEY  = 'portal_logout_retry' // {token}: one server logout still owed
const NOTICE_KEY = 'portal_notice'       // sessionStorage: 'logged_out' | 'logged_out_offline', shown once on /portal/pair
const TIMEOUT_MS = 8000

let selfLogout = false // our own Log Out is running: its socket being kicked is not a "you've been logged out"

const safe = (fn, fallback = null) => { try { return fn() } catch { return fallback } }

export function setNotice(kind) {
  safe(() => sessionStorage.setItem(NOTICE_KEY, kind))
}

/** The pending notice, read once. */
export function takeNotice() {
  return safe(() => {
    const kind = sessionStorage.getItem(NOTICE_KEY)
    sessionStorage.removeItem(NOTICE_KEY)
    return kind
  })
}

/** POST /api/auth/logout with `token`. → 'ok' (also 401: nothing left to revoke) | 'failed' (offline, timeout, 5xx). */
export async function serverLogout(token, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetchImpl(`${API}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: ctrl?.signal,
    })
    return res.ok || res.status === 401 ? 'ok' : 'failed'
  } catch {
    return 'failed'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Log Out (Settings → Account & Security, after the confirm dialog).
 * → {offline}: true when only the phone was logged out (the retry is queued and the notice says so).
 */
export async function logOut({ socket, fetchImpl } = {}) {
  const token = getSession()?.token
  selfLogout = true
  try {
    const result = token ? await serverLogout(token, { fetchImpl }) : 'ok'
    const offline = result !== 'ok'
    if (offline) safe(() => localStorage.setItem(RETRY_KEY, JSON.stringify({ token })))
    clearSession()
    socket?.disconnect()
    if (offline) setNotice('logged_out_offline')
    return { offline }
  } finally {
    selfLogout = false
  }
}

/** One owed server logout (after an offline Log Out): sent once, then forgotten whatever the result. */
export async function retryPendingLogout({ fetchImpl } = {}) {
  const pending = safe(() => JSON.parse(localStorage.getItem(RETRY_KEY)))
  if (!pending?.token) return null
  safe(() => localStorage.removeItem(RETRY_KEY))
  return serverLogout(pending.token, { fetchImpl })
}

/** PortalApp: retry now if online, else on the next `online` event. → cleanup. */
export function startLogoutRetry({ win = window } = {}) {
  const hasPending = () => Boolean(safe(() => localStorage.getItem(RETRY_KEY)))
  if (!hasPending()) return () => {}
  const run = () => { win.removeEventListener('online', run); retryPendingLogout() }
  if (win.navigator?.onLine !== false) {
    run()
    return () => {}
  }
  win.addEventListener('online', run)
  return () => win.removeEventListener('online', run)
}

/** The session was revoked or expired (401, socket auth error, session:revoked). */
export function sessionEnded({ location = window.location } = {}) {
  if (selfLogout) return false
  clearSession()
  if (location.pathname.startsWith('/portal/pair')) return false
  setNotice('logged_out')
  location.replace('/portal/pair')
  return true
}

/** Socket auth errors that mean the session is over (not a network problem). */
export const isSessionError = (err) => ['session_revoked', 'invalid_token'].includes(err?.data?.code)
