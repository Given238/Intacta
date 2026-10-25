import { describe, it, expect, beforeEach, vi } from 'vitest'
import { UNPAIRED, fromServer, loadConnection, saveConnection, chipText } from '../connection'

// Minimal i18n stand-in: the real strings are covered in headerStates.test.jsx
const t = (key, v = {}) => ({
  'connected.label': `Connected · ${v.name}`,
  'connected.more': `${v.name} +${v.count}`,
  'connected.fallbackName': 'Caregiver',
  'connected.full': `Connected to ${v.name}`,
  'connected.fullMore': `Connected to ${v.name} and ${v.count} more caregivers`,
}[key] ?? key)

function fakeStorage() {
  const m = new Map()
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }
}

describe('connection state from the server', () => {
  it('device:paired {caregiver_name, caregiver_count} → paired', () => {
    expect(fromServer({ caregiver_name: 'Budi', caregiver_count: 2 }, { paired: true })).toEqual({ paired: true, name: 'Budi', count: 2 })
  })

  it('caregiver:updated {name, count}: count 0 → not paired', () => {
    expect(fromServer({ name: 'Rina', count: 1 })).toEqual({ paired: true, name: 'Rina', count: 1 })
    expect(fromServer({ name: null, count: 0 })).toBe(UNPAIRED)
  })

  it('paired with no team rows yet still counts one caregiver; blank names are null', () => {
    expect(fromServer({ caregiver_name: '  ', caregiver_count: 0 }, { paired: true })).toEqual({ paired: true, name: null, count: 1 })
  })
})

describe('chip text', () => {
  it('one caregiver: the full name', () => {
    expect(chipText(t, { name: 'Budi Santoso', count: 1 })).toEqual({
      text: 'Connected · Budi Santoso', main: 'Connected · Budi Santoso', more: null, full: 'Connected to Budi Santoso',
    })
  })

  it('several caregivers: "{first name} +N", the full label keeps the whole name', () => {
    expect(chipText(t, { name: 'Budi Santoso', count: 3 })).toEqual({
      text: 'Connected · Budi +2', main: 'Connected · Budi', more: '+2', // "+2" is rendered apart: it never truncates
      full: 'Connected to Budi Santoso and 2 more caregivers',
    })
  })

  it('no name → "Caregiver"', () => {
    expect(chipText(t, { name: null, count: 1 }).text).toBe('Connected · Caregiver')
  })
})

describe('last known state in localStorage (terminal_connection)', () => {
  let storage
  beforeEach(() => { storage = fakeStorage(); vi.stubGlobal('localStorage', storage) })

  it('round-trips a paired state and clears it when unpaired', () => {
    saveConnection({ paired: true, name: 'Budi', count: 2 })
    expect(JSON.parse(storage.getItem('terminal_connection'))).toEqual({ paired: true, name: 'Budi', count: 2 })
    expect(loadConnection()).toEqual({ paired: true, name: 'Budi', count: 2 })
    saveConnection(UNPAIRED)
    expect(storage.getItem('terminal_connection')).toBeNull()
    expect(loadConnection()).toBe(UNPAIRED)
  })

  it('broken or blocked storage → not paired, never throws', () => {
    storage.setItem('terminal_connection', '{oops')
    expect(loadConnection()).toBe(UNPAIRED)
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } })
    expect(loadConnection()).toBe(UNPAIRED)
    expect(() => saveConnection({ paired: true, name: 'x', count: 1 })).not.toThrow()
  })
})
