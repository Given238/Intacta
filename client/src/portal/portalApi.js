/**
 * portalApi — caregiver portal → server REST calls.
 */
import { getSession, clearSession } from './session'

const API = import.meta.env.VITE_API_URL || ''

export class PortalApiError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message)
    this.status = status
    this.code   = code
  }
}

/**
 * Caregiver-authenticated request with the stored JWT.
 * A 401 (missing, expired or bad token) clears the session and sends the caregiver back to pairing.
 */
export async function portalFetch(path, { headers, ...options } = {}) {
  const session = getSession()
  if (!session) {
    redirectToPair()
    throw new PortalApiError('not paired', { status: 401, code: 'unauthorized' })
  }

  let res
  try {
    res = await fetch(`${API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...headers, Authorization: `Bearer ${session.token}` },
    })
  } catch (netErr) {
    throw new PortalApiError(`network (${netErr.message})`, { code: 'network' })
  }

  if (res.status === 401) {
    redirectToPair()
    throw new PortalApiError('401 unauthorized', { status: 401, code: 'unauthorized' })
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new PortalApiError(`${res.status} ${body.error || res.statusText}`, {
      status: res.status,
      code:   body.code || null,
    })
  }
  return res.status === 204 ? null : res.json()
}

/**
 * GET a binary resource (e.g. an audio clip) with the stored JWT.
 * 404 / 410 → code 'expired' (the clip was deleted or aged out); 401 → back to pairing.
 */
export async function portalFetchBlob(path) {
  const session = getSession()
  if (!session) {
    redirectToPair()
    throw new PortalApiError('not paired', { status: 401, code: 'unauthorized' })
  }
  let res
  try {
    res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${session.token}` } })
  } catch (netErr) {
    throw new PortalApiError(`network (${netErr.message})`, { code: 'network' })
  }
  if (res.status === 401) {
    redirectToPair()
    throw new PortalApiError('401 unauthorized', { status: 401, code: 'unauthorized' })
  }
  if (res.status === 404 || res.status === 410) {
    throw new PortalApiError(`${res.status} clip unavailable`, { status: res.status, code: 'expired' })
  }
  if (!res.ok) throw new PortalApiError(`${res.status} ${res.statusText}`, { status: res.status })
  return res.blob()
}

function redirectToPair() {
  clearSession()
  window.location.replace('/portal/pair')
}

/*
 * POST /api/devices/pair {code} → {success, token, patient_id, language, device_name}
 * With `token` (Settings → "Pair New Tablet") the tablet joins that caregiver's patient instead of a new one.
 */
export async function pairWithCode(code, { token } = {}) {
  let res
  try {
    res = await fetch(`${API}/api/devices/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ code }),
    })
  } catch (netErr) {
    throw new PortalApiError(`network (${netErr.message})`, { code: 'network' })
  }

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new PortalApiError(`${res.status} ${body.error || res.statusText}`, {
      status: res.status,
      code:   body.code || null,
    })
  }
  return body
}
