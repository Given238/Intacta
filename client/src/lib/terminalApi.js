/**
 * terminalApi — every terminal → server REST call goes through terminalFetch,
 * which adds the x-device-token header from the stored device token.
 */
const API = import.meta.env.VITE_API_URL || ''

export class TerminalApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message)
    this.status = status
    this.code   = code
  }
}

export async function terminalFetch(path, { headers, ...options } = {}) {
  const token = localStorage.getItem('device_token')
  if (!token) {
    throw new TerminalApiError('terminal not registered', { code: 'no_device_token' })
  }

  let res
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...headers, 'x-device-token': token },
    })
  } catch (netErr) {
    throw new TerminalApiError(`network (${netErr.message})`, { code: 'network' })
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body.error || res.statusText
    throw new TerminalApiError(
      `${res.status}${detail ? ` ${detail}` : ''}${body.code ? ` (${body.code})` : ''}`,
      { status: res.status, code: body.code || null },
    )
  }

  return res.status === 204 ? null : res.json()
}
