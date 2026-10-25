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
  // Part D: "Connected · {name}" chip, the name rules and the first-pairing name sheet
  'connected.label', 'connected.more', 'connected.fallbackName', 'connected.full', 'connected.fullMore', 'connected.holdHint',
  'portal.settings.account.nameHint', 'portal.settings.account.errors.name', 'portal.settings.account.errors.nameUnsafe',
  'portal.nameSheet.title', 'portal.nameSheet.body', 'portal.nameSheet.label', 'portal.nameSheet.placeholder',
  'portal.nameSheet.save', 'portal.nameSheet.skip',
  // Part E: "Scan QR code" on the pair screen
  'portal.pair.or', 'portal.pair.scan', 'portal.pair.detected',
  'portal.scan.title', 'portal.scan.why', 'portal.scan.help', 'portal.scan.starting', 'portal.scan.notIntacta',
  'portal.scan.close', 'portal.scan.typeInstead', 'portal.scan.torchOn', 'portal.scan.torchOff',
  'portal.scan.errors.denied', 'portal.scan.errors.noCamera', 'portal.scan.errors.insecure',
  'portal.scan.errors.unsupported', 'portal.scan.errors.error',
  // Part F: Log Out (server logout, offline notice, "you've been logged out")
  'portal.settings.account.logout', 'portal.settings.account.logoutTitle', 'portal.settings.account.logoutBody',
  'portal.settings.account.loggingOut', 'portal.pair.loggedOut', 'portal.pair.loggedOutOffline',
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

  it('the chip is "Connected · {{name}}" / "Terhubung · {{name}}"', () => {
    expect(en.connected.label).toBe('Connected · {{name}}')
    expect(id.connected.label).toBe('Terhubung · {{name}}')
  })

  it('the scan strings read as asked', () => {
    expect(en.portal.pair.scan).toBe('Scan QR code')
    expect(id.portal.pair.scan).toBe('Pindai kode QR')
    expect(en.portal.scan.help).toBe('Point the camera at the QR code on the tablet')
    expect(en.portal.scan.notIntacta).toBe("This isn't an Intacta code.")
    expect(en.portal.pair.detected).toBe('Code detected, connecting...')
  })

  it('no string still says "Caregiver mode"', () => {
    const all = JSON.stringify([en, id])
    expect(all).not.toMatch(/caregiver mode|mode caregiver/i)
  })
})
