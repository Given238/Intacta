import { describe, it, expect, beforeEach } from 'vitest'
import { resolveStart, getStoredMode, setStoredMode, clearStoredMode, pathForMode } from '../startMode'

function memoryStorage() {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  }
}

describe('resolveStart (/ routing)', () => {
  it('/ with nothing remembered → start menu', () => {
    expect(resolveStart({ pathname: '/', search: '', storedMode: null })).toEqual({ app: 'start' })
  })

  it('/ with a remembered mode → straight to that app', () => {
    expect(resolveStart({ pathname: '/', storedMode: 'patient' })).toEqual({ app: 'terminal', redirect: '/terminal' })
    expect(resolveStart({ pathname: '/', storedMode: 'caregiver' })).toEqual({ app: 'portal', redirect: '/portal' })
  })

  it('?choose=1 always shows the start menu', () => {
    expect(resolveStart({ pathname: '/', search: '?choose=1', storedMode: 'patient' })).toEqual({ app: 'start' })
    expect(resolveStart({ pathname: '/', search: '?choose=1', storedMode: null })).toEqual({ app: 'start' })
  })

  it('direct links keep working whatever is remembered, with no redirect', () => {
    for (const storedMode of [null, 'patient', 'caregiver']) {
      expect(resolveStart({ pathname: '/terminal', storedMode })).toEqual({ app: 'terminal' })
      expect(resolveStart({ pathname: '/terminal/pairing', storedMode })).toEqual({ app: 'terminal' })
      expect(resolveStart({ pathname: '/portal', storedMode })).toEqual({ app: 'portal' })
      expect(resolveStart({ pathname: '/portal/pair', search: '?code=ABC234', storedMode })).toEqual({ app: 'portal' })
    }
  })

  it('/portalx is not the portal', () => {
    expect(resolveStart({ pathname: '/portalx' })).toEqual({ app: 'terminal' })
  })

  it('pathForMode', () => {
    expect(pathForMode('patient')).toBe('/terminal')
    expect(pathForMode('caregiver')).toBe('/portal')
  })
})

describe('stored mode', () => {
  let s
  beforeEach(() => { s = memoryStorage() })

  it('stores only {mode}', () => {
    setStoredMode('caregiver', s)
    expect(s.dump()).toEqual({ intacta_mode: '{"mode":"caregiver"}' })
    expect(getStoredMode(s)).toBe('caregiver')
  })

  it('ignores unknown modes and junk', () => {
    setStoredMode('admin', s)
    expect(getStoredMode(s)).toBe(null)
    s.setItem('intacta_mode', 'not json')
    expect(getStoredMode(s)).toBe(null)
  })

  it('clear removes only the mode (device token and login stay)', () => {
    s.setItem('device_token', 'tok')
    s.setItem('portal_session', '{"token":"jwt"}')
    setStoredMode('patient', s)
    clearStoredMode(s)
    expect(s.dump()).toEqual({ device_token: 'tok', portal_session: '{"token":"jwt"}' })
  })

  it('blocked storage never throws', () => {
    const blocked = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') } }
    expect(getStoredMode(blocked)).toBe(null)
    expect(() => setStoredMode('patient', blocked)).not.toThrow()
    expect(() => clearStoredMode(blocked)).not.toThrow()
  })
})
