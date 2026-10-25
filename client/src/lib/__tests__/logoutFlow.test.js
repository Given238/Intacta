/**
 * Part F: portal Log Out (portal/logout.js) and "you've been logged out".
 * Online: POST /api/auth/logout with the JWT, then the session is cleared (the start-menu mode is kept) and the socket
 * closed. Offline: logged out on the phone anyway, a notice, and ONE retry with the old token when the network is back.
 * A revoked session anywhere → /portal/pair with a notice, never a redirect loop.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

function memoryStorage() {
  const m = new Map()
  return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k),
    get size() { return m.size },
  }
}
vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('sessionStorage', memoryStorage())
vi.stubGlobal('window', { location: { pathname: '/portal', replace: vi.fn() } })

const { logOut, retryPendingLogout, startLogoutRetry, sessionEnded, takeNotice, isSessionError, serverLogout } =
  await import('../../portal/logout')
const { setSession, getSession } = await import('../../portal/session')

const ok = (status = 200) => vi.fn(async () => ({ ok: status < 400, status }))
const offline = () => vi.fn(async () => { throw new TypeError('Failed to fetch') })

beforeEach(() => {
  localStorage.removeItem('portal_logout_retry')
  localStorage.setItem('intacta_mode', JSON.stringify({ mode: 'caregiver' }))
  sessionStorage.removeItem('portal_notice')
  setSession({ token: 'jwt-old', patient_id: 5, language: 'id', device_name: 'Tablet' })
})

describe('Log Out', () => {
  it('online: POST /api/auth/logout with the JWT, then clears the session (mode kept) and closes the socket', async () => {
    const fetchImpl = ok()
    const socket = { disconnect: vi.fn() }
    const result = await logOut({ socket, fetchImpl })

    expect(result).toEqual({ offline: false })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toMatch(/\/api\/auth\/logout$/)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jwt-old')
    expect(getSession()).toBeNull()
    expect(localStorage.getItem('intacta_mode')).toBe(JSON.stringify({ mode: 'caregiver' }))
    expect(socket.disconnect).toHaveBeenCalled()
    expect(localStorage.getItem('portal_logout_retry')).toBeNull()
    expect(takeNotice()).toBeNull()
  })

  it('a 401 from the server (already revoked) counts as done', async () => {
    expect(await serverLogout('t', { fetchImpl: ok(401) })).toBe('ok')
    expect(await serverLogout('t', { fetchImpl: ok(500) })).toBe('failed')
  })

  it('offline: still logs out on the phone, shows the offline notice and queues ONE retry with the old token', async () => {
    const result = await logOut({ socket: { disconnect: vi.fn() }, fetchImpl: offline() })
    expect(result).toEqual({ offline: true })
    expect(getSession()).toBeNull()
    expect(takeNotice()).toBe('logged_out_offline')
    expect(takeNotice()).toBeNull() // shown once

    const retry = ok()
    expect(await retryPendingLogout({ fetchImpl: retry })).toBe('ok')
    expect(retry.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-old')
    // once only, whatever the result
    expect(await retryPendingLogout({ fetchImpl: retry })).toBeNull()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('the retry waits for the network (online event) when the phone is offline', async () => {
    await logOut({ fetchImpl: offline() })
    const listeners = {}
    const win = {
      navigator: { onLine: false },
      addEventListener: vi.fn((e, fn) => { listeners[e] = fn }),
      removeEventListener: vi.fn(),
    }
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }))
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', fetchSpy)
    startLogoutRetry({ win })
    expect(fetchSpy).not.toHaveBeenCalled()
    listeners.online()
    await Promise.resolve()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer jwt-old')
    expect(localStorage.getItem('portal_logout_retry')).toBeNull()
    vi.stubGlobal('fetch', realFetch)
  })

  it('nothing owed → no retry listener', () => {
    const win = { navigator: { onLine: false }, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    startLogoutRetry({ win })
    expect(win.addEventListener).not.toHaveBeenCalled()
  })
})

describe('a revoked or expired session', () => {
  it('sends the caregiver to /portal/pair once with the "logged out" notice', () => {
    const location = { pathname: '/portal/settings', replace: vi.fn() }
    expect(sessionEnded({ location })).toBe(true)
    expect(location.replace).toHaveBeenCalledWith('/portal/pair')
    expect(getSession()).toBeNull()
    expect(takeNotice()).toBe('logged_out')
  })

  it('on /portal/pair itself: no redirect (no loop)', () => {
    const location = { pathname: '/portal/pair', replace: vi.fn() }
    expect(sessionEnded({ location })).toBe(false)
    expect(location.replace).not.toHaveBeenCalled()
  })

  it('our own Log Out kicking its socket is not reported as "you\'ve been logged out"', async () => {
    const location = { pathname: '/portal/settings', replace: vi.fn() }
    let during
    const fetchImpl = vi.fn(async () => { during = sessionEnded({ location }); return { ok: true, status: 200 } })
    await logOut({ fetchImpl })
    expect(during).toBe(false)
    expect(location.replace).not.toHaveBeenCalled()
  })

  it('socket auth errors that end the session vs a network error', () => {
    expect(isSessionError({ data: { code: 'session_revoked' } })).toBe(true)
    expect(isSessionError({ data: { code: 'invalid_token' } })).toBe(true)
    expect(isSessionError({ data: { code: 'auth_unavailable' } })).toBe(false)
    expect(isSessionError(new Error('xhr poll error'))).toBe(false)
  })
})
