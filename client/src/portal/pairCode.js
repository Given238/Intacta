/**
 * Pairing code helpers: normalising typed input, the ?code= prefill (the tablet's QR code opens
 * /portal/pair?code=XXXXXX), the QR payload the tablet shows, and what a scan may contain.
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

/** The tablet's QR payload: only the one-time code, never a device token. */
export const pairLink = (origin, code) => `${origin}/portal/pair?code=${encodeURIComponent(code)}`

// Exactly 6 letters/digits, nothing else (a scan is untrusted input)
const BARE_CODE = /^[A-Za-z0-9]{6}$/

/**
 * What a scanned QR code may contain: (1) a URL on our own host (hostname must equal `hostname`, http/https)
 * with ?code=XXXXXX, or (2) a bare 6-character code. Case-insensitive. Returns the upper-case code or null.
 */
export function parseScannedCode(text, hostname) {
  const raw = String(text ?? '').trim()
  if (BARE_CODE.test(raw)) return raw.toUpperCase()
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null
  if (!hostname || url.hostname.toLowerCase() !== String(hostname).toLowerCase()) return null
  const code = (url.searchParams.get('code') || '').trim()
  return BARE_CODE.test(code) ? code.toUpperCase() : null
}
