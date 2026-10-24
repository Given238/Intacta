/**
 * Pairing code helpers for the pair screen: normalising typed input and the ?code= prefill
 * (the tablet's QR code opens /portal/pair?code=XXXXXX).
 */
export const CODE_LENGTH = 6

export const toRawCode = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH)

/**
 * Reads ?code= from a query string. Returns the normalised code ('' when absent) and the query string
 * without it, so the caller can clear it from the address bar (other params such as link=1 stay).
 */
export function takeCodeParam(search) {
  const params = new URLSearchParams(search)
  const had = params.has('code')
  const code = had ? toRawCode(params.get('code')) : ''
  params.delete('code')
  return { code, had, rest: params.toString() }
}
