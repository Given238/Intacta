import { describe, it, expect } from 'vitest'
import { takeCodeParam, toRawCode, pairLink, parseScannedCode } from '../../portal/pairCode'

describe('pair screen ?code= prefill', () => {
  it('reads and normalises the code, and returns the query without it', () => {
    expect(takeCodeParam('?code=abc-d23')).toEqual({ code: 'ABCD23', had: true, rest: '' })
  })

  it('keeps other params (link=1) when clearing the code', () => {
    expect(takeCodeParam('?link=1&code=XYZ234')).toEqual({ code: 'XYZ234', had: true, rest: 'link=1' })
  })

  it('no code param → empty input, nothing to clear', () => {
    expect(takeCodeParam('?link=1')).toEqual({ code: '', had: false, rest: 'link=1' })
    expect(takeCodeParam('')).toEqual({ code: '', had: false, rest: '' })
  })

  it('caps the prefill at 6 characters and drops junk', () => {
    expect(takeCodeParam('?code=%3Cscript%3EABCDEFGH').code).toBe('SCRIPT')
    expect(toRawCode(' ab c ')).toBe('ABC')
  })
})

describe('tablet QR payload', () => {
  it('is {origin}/portal/pair?code=XXXXXX and carries only the one-time code', () => {
    const link = pairLink('https://intacta.id', 'AB23CD')
    expect(link).toBe('https://intacta.id/portal/pair?code=AB23CD')
    expect([...new URL(link).searchParams.keys()]).toEqual(['code'])
    expect(link).not.toMatch(/token/i)
  })

  it('round-trips through the scanner parser', () => {
    expect(parseScannedCode(pairLink('https://intacta.id', 'AB23CD'), 'intacta.id')).toBe('AB23CD')
  })
})

describe('scanned QR payload', () => {
  const HOST = 'intacta.id'

  it('accepts a URL on our own host with ?code=', () => {
    expect(parseScannedCode('https://intacta.id/portal/pair?code=XYZ234', HOST)).toBe('XYZ234')
    expect(parseScannedCode('  http://INTACTA.id/portal/pair?code=xyz234&x=1  ', HOST)).toBe('XYZ234')
    expect(parseScannedCode('http://localhost:5173/portal/pair?code=AB23CD', 'localhost')).toBe('AB23CD')
  })

  it('accepts a bare 6-character code, also lowercase', () => {
    expect(parseScannedCode('AB23CD', HOST)).toBe('AB23CD')
    expect(parseScannedCode(' ab23cd ', HOST)).toBe('AB23CD')
  })

  it('rejects another origin (also look-alike hosts)', () => {
    expect(parseScannedCode('https://evil.example/portal/pair?code=XYZ234', HOST)).toBeNull()
    expect(parseScannedCode('https://intacta.id.evil.example/portal/pair?code=XYZ234', HOST)).toBeNull()
    expect(parseScannedCode('https://evil.example/?u=intacta.id&code=XYZ234', HOST)).toBeNull()
  })

  it('rejects junk', () => {
    for (const junk of [
      '', 'hello world', 'ABC', 'ABCDEFG', 'AB-23C', 'AB 23C', '<script>',
      'https://intacta.id/portal/pair', 'https://intacta.id/portal/pair?code=ABC', 'https://intacta.id/portal/pair?code=AB%2023C',
      'javascript:alert(1)//?code=AB23CD', 'WIFI:S:home;T:WPA;P:secret;;', null, undefined,
    ]) {
      expect(parseScannedCode(junk, HOST)).toBeNull()
    }
  })
})
