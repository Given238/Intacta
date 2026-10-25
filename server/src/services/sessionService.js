/**
 * sessionService.js — caregiver sessions (migration 010): issue, verify, revoke.
 *
 * Every caregiver JWT issued from now on carries a jti that has a caregiver_sessions row (written before the token is
 * returned). A jti token is valid only while its row exists and is not revoked. Tokens issued before migration 010
 * have no jti: their session id is 'legacy:<sha256 of the token>' and they stay valid until they expire unless a
 * revoked row with that id exists (logout writes one). The revocation lookup is cached (revoked entries until the
 * token's expiry, valid ones for CACHE_OK_MS), and a logout on this server updates the cache at once.
 */

const crypto = require('crypto');
const jwt    = require('jsonwebtoken');
const { query } = require('../db/query');

const CACHE_OK_MS = 30_000;
const CACHE_MAX   = 5000;
const cache = new Map(); // session id → { revoked, until }

class SessionCheckError extends Error {}

const expiresIn = () => process.env.JWT_EXPIRES_IN || '24h';

/** Token lifetime in ms (JWT_EXPIRES_IN, default 24h). */
function tokenLifetimeMs() {
  const probe = jwt.decode(jwt.sign({}, 'probe', { expiresIn: expiresIn() }));
  return (probe.exp - probe.iat) * 1000;
}

const legacyId = (token) => `legacy:${crypto.createHash('sha256').update(token).digest('hex')}`;
const sessionIdOf = (token, payload) => payload.jti || legacyId(token);

/** Signs a caregiver JWT {caregiverId, patientId?} with a new session row. */
async function issueCaregiverToken({ caregiverId, patientId = null }) {
  const id = crypto.randomUUID();
  const token = jwt.sign(
    patientId ? { caregiverId, patientId } : { caregiverId },
    process.env.JWT_SECRET,
    { expiresIn: expiresIn(), jwtid: id }
  );
  const { exp } = jwt.decode(token);
  await query(
    `INSERT INTO caregiver_sessions (id, caregiver_id, patient_id, expires_at) VALUES ($1, $2, $3, to_timestamp($4))`,
    [id, caregiverId, patientId, exp]
  );
  return token;
}

function remember(id, revoked, expMs) {
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(id, { revoked, until: revoked ? expMs : Math.min(expMs, Date.now() + CACHE_OK_MS) });
}

/**
 * Is this (already signature-checked) token's session usable? true / false; throws SessionCheckError when the
 * database cannot answer (callers fail closed with 503, never 401: the caregiver is not logged out).
 */
async function isSessionActive(token, payload) {
  const id = sessionIdOf(token, payload);
  const expMs = payload.exp ? payload.exp * 1000 : Date.now() + CACHE_OK_MS;
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return !hit.revoked;
  let rows;
  try {
    ({ rows } = await query('SELECT revoked_at FROM caregiver_sessions WHERE id = $1', [id]));
  } catch (err) {
    throw new SessionCheckError(err.message);
  }
  // A jti token needs its row; a legacy token is fine without one (denylist)
  const revoked = rows.length ? rows[0].revoked_at != null : Boolean(payload.jti);
  remember(id, revoked, expMs);
  return !revoked;
}

/**
 * Full check for REST and sockets: signature + expiry, then revocation.
 * → { ok: true, caregiverId, patientId, sessionId, exp } | { ok: false, code: 'invalid_token' | 'session_revoked' }
 */
async function verifyCaregiverToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return { ok: false, code: 'invalid_token' };
  }
  if (!(await isSessionActive(token, payload))) return { ok: false, code: 'session_revoked' };
  return sessionFromPayload(token, payload);
}

function sessionFromPayload(token, payload) {
  return {
    ok: true,
    caregiverId: payload.caregiverId,
    patientId:   payload.patientId ?? null,
    sessionId:   sessionIdOf(token, payload),
    exp:         payload.exp ?? null,
  };
}

/**
 * Revokes a session (idempotent). Legacy tokens get a denylist row. → true when this call revoked it,
 * false when it already was.
 */
async function revokeSession({ sessionId, caregiverId, patientId, exp }) {
  const expSec = exp || Math.floor((Date.now() + tokenLifetimeMs()) / 1000);
  const { rows } = await query(
    `INSERT INTO caregiver_sessions (id, caregiver_id, patient_id, expires_at, revoked_at)
     VALUES ($1, $2, $3, to_timestamp($4), NOW())
     ON CONFLICT (id) DO UPDATE SET revoked_at = NOW() WHERE caregiver_sessions.revoked_at IS NULL
     RETURNING id`,
    [sessionId, caregiverId, patientId, expSec]
  );
  remember(sessionId, true, expSec * 1000);
  return rows.length > 0;
}

/** SQL: caregiver `cg` has an unexpired, unrevoked session that covers patient `patient` (scoped to it, or a login). */
const activeSessionSql = (cg, patient) =>
  `EXISTS (SELECT 1 FROM caregiver_sessions s WHERE s.caregiver_id = ${cg}
     AND (s.patient_id = ${patient} OR s.patient_id IS NULL) AND s.revoked_at IS NULL AND s.expires_at > NOW())`;

function clearSessionCache() {
  cache.clear();
}

module.exports = {
  issueCaregiverToken, verifyCaregiverToken, isSessionActive, sessionFromPayload, revokeSession, sessionIdOf,
  tokenLifetimeMs, activeSessionSql, clearSessionCache, SessionCheckError,
};
