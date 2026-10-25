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
      // FormData (voice upload) sets its own multipart Content-Type with the boundary
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
        'x-device-token': token,
      },
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

/**
 * A pairing code for the "Connect a caregiver" popup.
 * A device linked to a patient (also when every caregiver has logged out) gets a fresh code that KEEPS the link, so
 * the next caregiver joins the same patient: POST /api/device/pairing-code → {code, expires_at}. Only a device with
 * no patient (401 there, or no token yet) registers, which resets the pairing: → {code, expires_at, device_token}.
 */
export async function requestPairingCode(deviceId, { fetchImpl = fetch } = {}) {
  if (localStorage.getItem('device_token')) {
    try {
      return await terminalFetch('/api/device/pairing-code', { method: 'POST' })
    } catch (e) {
      if (e.status !== 401) throw e // not linked to a patient → register below
    }
  }
  let res
  try {
    res = await fetchImpl(`${API}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    })
  } catch (netErr) {
    throw new Error(`register failed: network (${netErr.message})`)
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`register failed: ${res.status}${err.code || err.error ? ` (${err.code || err.error})` : ''}`)
  }
  return res.json()
}
