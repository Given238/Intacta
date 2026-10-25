/**
 * The caregiver's own name, shown on the patient's tablet as "Connected · {name}".
 * Same rules as the server (validators.js personNameField): letters (any script), spaces and . ' - ;
 * 2 to 40 characters; empty = no name (the tablet shows "Caregiver"). The server also runs the content safety
 * check (kind display_name): 422 unsafe_content, 503 safety_unavailable.
 * Used by Settings → Account & Security and the first-pairing "What should we call you?" sheet.
 */
import { portalFetch } from './portalApi'

const PERSON_NAME = /^[\p{L}\p{M}](?:[\p{L}\p{M} .'-]*[\p{L}\p{M}.])?$/u

export function normalizeName(raw) {
  return String(raw ?? '').normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim()
}

/** → {ok: true, value: string|null} or {ok: false} */
export function checkName(raw) {
  const value = normalizeName(raw)
  if (!value) return { ok: true, value: null }
  if (value.length < 2 || value.length > 40 || !PERSON_NAME.test(value)) return { ok: false }
  return { ok: true, value }
}

/** PUT /api/caregiver {name} → the saved caregiver. Throws PortalApiError. */
export async function saveCaregiverName(value) {
  const { caregiver } = await portalFetch('/api/caregiver', { method: 'PUT', body: JSON.stringify({ name: value }) })
  return caregiver
}

/** i18n key for a failed save. */
export function nameErrorKey(err) {
  if (err?.code === 'unsafe_content') return 'portal.settings.account.errors.nameUnsafe'
  if (err?.code === 'safety_unavailable') return 'portal.safety.unavailable'
  if (err?.status === 400) return 'portal.settings.account.errors.name'
  return 'portal.settings.saveFailed'
}
