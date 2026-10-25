/**
 * logoutService.js — logout = revoke the session + leave the care team (migration 010), and the stale-membership job.
 *
 * logoutSession: revokes the token's session (idempotent), then the caregiver leaves the care team of every patient in
 * scope where they have no other active session (scope = the token's patient; an email/password login token, which
 * has no patient, covers every patient of the caregiver). Their notes, routines, history and the patient stay.
 * The session's sockets get `session:revoked` and are disconnected; caregiver:updated goes to each patient in scope.
 *
 * Stale job (hourly + once at start-up, runs never overlap): a member leaves when they have no active session for the
 * patient AND either some session row exists for it (all expired / revoked) or they paired longer ago than one token
 * lifetime (tokens issued before migration 010 have no row; their last one has expired by then).
 */

const { query } = require('../db/query');
const { logAudit } = require('./audit');
const { revokeSession, activeSessionSql, tokenLifetimeMs } = require('./sessionService');
const { emitCaregiverUpdated, patientsOfCaregiver } = require('./careTeamService');

/** Members of `patientIds` with no active session leave (left_at = now). → patient ids that changed. */
async function leaveIfNoActiveSession(caregiverId, patientIds) {
  if (!patientIds.length) return [];
  const { rows } = await query(
    `UPDATE patient_caregivers pc SET left_at = NOW()
     WHERE pc.caregiver_id = $1 AND pc.patient_id = ANY($2::int[]) AND pc.left_at IS NULL
       AND NOT ${activeSessionSql('pc.caregiver_id', 'pc.patient_id')}
     RETURNING pc.patient_id`,
    [caregiverId, patientIds]
  );
  return rows.map(r => r.patient_id);
}

/** Disconnects every socket of one session (they joined `session:{id}` on connect). Best effort. */
function disconnectSession(io, sessionId) {
  if (!io) return;
  try {
    const room = `session:${sessionId}`;
    io.to(room).emit('session:revoked', { reason: 'logout' });
    io.in(room).disconnectSockets(true);
  } catch (err) {
    console.error('session socket disconnect failed:', err.message);
  }
}

/**
 * session = req.session {caregiverId, patientId, sessionId, exp}.
 * → { revoked: bool (false = it already was), left: [patientId], patients: [patientId] }
 * DB errors propagate (the controller answers 500 and the client retries).
 */
async function logoutSession(io, session) {
  const { caregiverId, patientId, sessionId, exp } = session;
  const revoked = await revokeSession({ sessionId, caregiverId, patientId, exp });
  const patients = patientId ? [patientId] : await patientsOfCaregiver(caregiverId);
  const left = await leaveIfNoActiveSession(caregiverId, patients);

  disconnectSession(io, sessionId);
  for (const pid of patients) await emitCaregiverUpdated(io, pid);

  if (revoked) {
    await logAudit({
      caregiverId,
      action: 'caregiver.logout',
      payload: { caregiver_id: caregiverId, patient_id: patientId, session: sessionId, left_patients: left },
    });
  }
  return { revoked, left, patients };
}

/** One stale pass. → [{patient_id, caregiver_id}] that left; caregiver:updated per changed patient. */
async function cleanupStaleMemberships(io) {
  const { rows } = await query(
    `UPDATE patient_caregivers pc SET left_at = NOW()
     WHERE pc.left_at IS NULL
       AND NOT ${activeSessionSql('pc.caregiver_id', 'pc.patient_id')}
       AND (EXISTS (SELECT 1 FROM caregiver_sessions s WHERE s.caregiver_id = pc.caregiver_id
                      AND (s.patient_id = pc.patient_id OR s.patient_id IS NULL))
            OR pc.paired_at < NOW() - make_interval(secs => $1))
     RETURNING pc.patient_id, pc.caregiver_id`,
    [Math.ceil(tokenLifetimeMs() / 1000)]
  );
  for (const pid of new Set(rows.map(r => r.patient_id))) await emitCaregiverUpdated(io, pid);
  if (rows.length) console.log(`[care-team] ${rows.length} stale membership(s) marked as left`);
  return rows;
}

let running = null; // the pass in progress: a second call joins it instead of overlapping

function runStaleCleanup(io) {
  if (!running) {
    running = cleanupStaleMemberships(io)
      .catch((err) => { console.error('[care-team] stale cleanup failed:', err.message); return []; })
      .finally(() => { running = null; });
  }
  return running;
}

const CLEANUP_MS = 60 * 60 * 1000;
let timer = null;

/** Hourly, plus one pass now (same pattern as the routine scheduler). */
function startStaleCleanup(io, { intervalMs = CLEANUP_MS } = {}) {
  if (timer) return timer;
  timer = setInterval(() => runStaleCleanup(io), intervalMs);
  timer.unref?.();
  runStaleCleanup(io);
  return timer;
}

function stopStaleCleanup() {
  clearInterval(timer);
  timer = null;
}

module.exports = {
  logoutSession, leaveIfNoActiveSession, disconnectSession, cleanupStaleMemberships, runStaleCleanup,
  startStaleCleanup, stopStaleCleanup, CLEANUP_MS,
};
