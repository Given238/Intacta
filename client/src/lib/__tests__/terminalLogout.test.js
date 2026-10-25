/**
 * Part F, terminal side: after every caregiver logs out the header follows the server's ACTIVE care team, and the
 * next "Enable caregiver connection" press asks for a code that KEEPS the patient link (pairing-code), so the next
 * caregiver joins the same patient. Only a device with no patient registers (which resets the pairing).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
})

const { requestPairingCode } = await import('../terminalApi')
const { fromServer, saveConnection, loadConnection, UNPAIRED } = await import('../connection')

const json = (status, body) => ({ ok: status < 400, status, statusText: '', json: async () => body })

beforeEach(() => store.clear())

describe('pairing code after logout', () => {
  it('a device with a token asks /api/device/pairing-code (keeps the patient: no register, no new token)', async () => {
    store.set('device_token', 'dev-tok')
    const fetchSpy = vi.fn(async () => json(200, { code: 'ABC234', expires_at: '2026-10-25T10:00:00Z' }))
    vi.stubGlobal('fetch', fetchSpy)
    const data = await requestPairingCode('uid-1', { fetchImpl: fetchSpy })
    expect(data).toEqual({ code: 'ABC234', expires_at: '2026-10-25T10:00:00Z' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toMatch(/\/api\/device\/pairing-code$/)
    expect(fetchSpy.mock.calls[0][1].headers['x-device-token']).toBe('dev-tok')
  })

  it('a device the server does not know as paired (401) registers', async () => {
    store.set('device_token', 'dev-tok')
    const fetchSpy = vi.fn(async (url) => (url.endsWith('/api/device/pairing-code')
      ? json(401, { error: 'Invalid device token' })
      : json(200, { code: 'XYZ789', expires_at: 'x', device_token: 'new-tok' })))
    vi.stubGlobal('fetch', fetchSpy)
    const data = await requestPairingCode('uid-1', { fetchImpl: fetchSpy })
    expect(data.device_token).toBe('new-tok')
    expect(fetchSpy.mock.calls.map(c => c[0].replace(/^.*\/api/, '/api'))).toEqual(['/api/device/pairing-code', '/api/devices/register'])
    expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({ device_id: 'uid-1' })
  })

  it('no token yet → register straight away; a server error is not mistaken for "unpaired"', async () => {
    const reg = vi.fn(async () => json(200, { code: 'Q', expires_at: 'x', device_token: 't' }))
    expect((await requestPairingCode('u', { fetchImpl: reg })).device_token).toBe('t')
    store.set('device_token', 'dev-tok')
    vi.stubGlobal('fetch', vi.fn(async () => json(503, { code: 'db_unavailable' })))
    await expect(requestPairingCode('u', { fetchImpl: reg })).rejects.toMatchObject({ status: 503 })
    expect(reg).toHaveBeenCalledTimes(1)
  })
})

describe('header state after logout', () => {
  it('GET /api/device/context with caregiver_count 0 (everyone logged out) → the buttons, not a cached "Connected"', () => {
    saveConnection({ paired: true, name: 'Budi', count: 1 })
    expect(loadConnection()).toEqual({ paired: true, name: 'Budi', count: 1 }) // first paint only
    const fromReconcile = fromServer({ context: {}, caregiver_name: null, caregiver_count: 0 })
    expect(fromReconcile).toBe(UNPAIRED)
    saveConnection(fromReconcile)
    expect(store.has('terminal_connection')).toBe(false) // cache cleared
  })

  it('two caregivers, one logs out → the other\'s name; the last leaves → unpaired', () => {
    expect(fromServer({ name: 'Budi Santoso', count: 2 })).toEqual({ paired: true, name: 'Budi Santoso', count: 2 })
    expect(fromServer({ name: 'Rina', count: 1 })).toEqual({ paired: true, name: 'Rina', count: 1 })
    expect(fromServer({ name: null, count: 0 })).toBe(UNPAIRED)
  })
})
