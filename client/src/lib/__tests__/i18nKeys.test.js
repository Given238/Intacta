import { describe, it, expect } from 'vitest'
import en from '../../i18n/en.json'
import id from '../../i18n/id.json'

const paths = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? paths(v, `${prefix}${k}.`) : [`${prefix}${k}`])

const get = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj)

const REQUIRED = [
  'enable', 'caregiverConnection', 'authCode', 'regenerate',
  'connect.title', 'connect.helpBefore', 'connect.helpAfter', 'connect.scan', 'connect.qrLabel',
  'connect.expiresIn', 'connect.expired', 'connect.loading',
  'startMenu.title', 'startMenu.patientTitle', 'startMenu.patientBody', 'startMenu.caregiverTitle',
  'startMenu.caregiverBody', 'startMenu.remember', 'startMenu.language', 'startMenu.en', 'startMenu.id',
  'startMenu.enName', 'startMenu.idName',
  'switchMode.title', 'switchMode.body', 'switchMode.cancel', 'switchMode.confirm',
  'portal.settings.account.deviceMode', 'portal.settings.account.changeMode',
]

describe('i18n dictionaries', () => {
  it('en and id have the same keys', () => {
    expect(paths(id).sort()).toEqual(paths(en).sort())
  })

  it.each(REQUIRED)('%s exists and is non-empty in en and id', (key) => {
    expect(typeof get(en, key)).toBe('string')
    expect(get(en, key).trim()).not.toBe('')
    expect(typeof get(id, key)).toBe('string')
    expect(get(id, key).trim()).not.toBe('')
  })

  it('no string still says "Caregiver mode"', () => {
    const all = JSON.stringify([en, id])
    expect(all).not.toMatch(/caregiver mode|mode caregiver/i)
  })
})
