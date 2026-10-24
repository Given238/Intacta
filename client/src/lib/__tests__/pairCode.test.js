import { describe, it, expect } from 'vitest'
import { takeCodeParam, toRawCode } from '../../portal/pairCode'

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
