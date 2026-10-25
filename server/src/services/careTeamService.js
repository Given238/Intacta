/**
 * careTeamService.js — the caregivers linked to a patient (patient_caregivers, migration 009) and what the
 * terminal shows about them ("Connected · {name}", "{first name} +N").
 *
 * caregiverSummary(patientId) → {name, count}: name = the most recently paired caregiver's name, or null when it
 * is unset, blocked or not yet screened (the terminal then shows "Caregiver"); count = active team size (members who
 * logged out or whose sessions all expired have left_at set and do not count, migration 010).
 * The name is patient-facing text: it is shown only with a stored safety verdict (kind display_name) of the current
 * SAFETY_VERSION. A stale one is re-screened in the background and caregiver:updated goes out when it is done.
 */

const { query } = require('../db/query');
const { checkPatientFacingText, storedVerdict, SAFETY_VERSION } = require('./contentSafety');

/** Joins (or re-joins after leaving) the team; paired_at moves to now, so this caregiver becomes the one shown. */
async function addToCareTeam(patientId, caregiverId) {
  await query(
    `INSERT INTO patient_caregivers (patient_id, caregiver_id, paired_at) VALUES ($1, $2, NOW())
     ON CONFLICT (patient_id, caregiver_id) DO UPDATE SET paired_at = NOW(), left_at = NULL`,
    [patientId, caregiverId]
  );
}

const nameIsCurrent = (c) => c?.name_safety_version != null && Number(c.name_safety_version) === SAFETY_VERSION;
const nameIsUsable = (c) => Boolean(c?.name) && nameIsCurrent(c) && c.name_safety_verdict === 'allow';

const inflight = new Map(); // one re-screen per caregiver at a time
let onRescreened = null;    // set by the socket layer: (caregiverId) → emit caregiver:updated

/** Re-screens a stored name and saves the verdict; failures leave it unscreened (never shown). */
function rescreenName(caregiver) {
  const key = caregiver.id;
  if (!inflight.has(key)) {
    inflight.set(key, (async () => {
      try {
        const v = storedVerdict(await checkPatientFacingText(caregiver.name, { kind: 'display_name' }));
        await query(
          'UPDATE caregivers SET name_safety_version = $1, name_safety_verdict = $2 WHERE id = $3 AND name = $4',
          [v.safety_version, v.safety_verdict, caregiver.id, caregiver.name]
        );
        onRescreened?.(caregiver.id);
      } catch (err) {
        console.warn(`[safety] caregiver ${caregiver.id} name not re-screened: ${err.message}`);
      }
    })().finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

function setRescreenListener(fn) {
  onRescreened = fn;
}

async function caregiverSummary(patientId) {
  const result = await query(
    `SELECT c.id, c.name, c.name_safety_version, c.name_safety_verdict
     FROM patient_caregivers pc JOIN caregivers c ON c.id = pc.caregiver_id
     WHERE pc.patient_id = $1 AND pc.left_at IS NULL
     ORDER BY pc.paired_at DESC, c.id DESC`,
    [patientId]
  );
  const latest = result.rows[0];
  if (latest?.name && !nameIsCurrent(latest)) rescreenName(latest).catch(() => {});
  return { name: nameIsUsable(latest) ? latest.name : null, count: result.rows.length };
}

/** Patients the caregiver created or is on the team of (left teams excluded). */
async function patientsOfCaregiver(caregiverId) {
  const result = await query(
    `SELECT id FROM patients WHERE caregiver_id = $1
     UNION SELECT patient_id AS id FROM patient_caregivers WHERE caregiver_id = $1 AND left_at IS NULL`,
    [caregiverId]
  );
  return result.rows.map(r => r.id);
}

/** caregiver:updated {name, count} to the patient room and every device paired to the patient. Best effort. */
async function emitCaregiverUpdated(io, patientId) {
  if (!io) return;
  try {
    const [summary, devices] = await Promise.all([
      caregiverSummary(patientId),
      query('SELECT id FROM devices WHERE patient_id = $1', [patientId]),
    ]);
    io.to([`patient:${patientId}`, ...devices.rows.map(d => `device:${d.id}`)]).emit('caregiver:updated', summary);
  } catch (err) {
    console.error('caregiver:updated emit failed:', err.message);
  }
}

/** After a caregiver's name changed: every team they are on hears about it. */
async function emitForCaregiver(io, caregiverId) {
  if (!io) return;
  try {
    for (const patientId of await patientsOfCaregiver(caregiverId)) await emitCaregiverUpdated(io, patientId);
  } catch (err) {
    console.error('caregiver:updated emit failed:', err.message);
  }
}

module.exports = {
  addToCareTeam, caregiverSummary, patientsOfCaregiver, emitCaregiverUpdated, emitForCaregiver,
  nameIsUsable, rescreenName, setRescreenListener,
};
