/**
 * pairingService.js — code-only pairing (CLAUDE.md §Pairing Flow, step 2).
 *
 * Codes are stored as a SHA-256 hash (exact-match lookup) and are never cleared after
 * use, so a code can be told apart as invalid / expired / already used.
 * A code lives 10 min and is single use, so a fast hash is enough here.
 */

const crypto = require('crypto');
const { query } = require('../db/query');
const { memberSql } = require('./ownership');
const { addToCareTeam } = require('./careTeamService');

const DEFAULT_PATIENT_NAME = 'Patient';
const DEFAULT_LANGUAGE     = 'id';
const DEFAULT_DEVICE_NAME  = 'Tablet';

class PairingError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code   = code;
  }
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** Caregiver's first patient (created or joined), created when the caregiver has none ("Pair New Tablet"). */
async function patientForCaregiver(caregiverId) {
  const existing = await query(
    `SELECT id, caregiver_id, language FROM patients WHERE caregiver_id = $1 OR ${memberSql('patients.id', '$1')}
     ORDER BY id LIMIT 1`,
    [caregiverId]
  );
  if (existing.rows.length > 0) return { patient: existing.rows[0], created: false };

  const created = await query(
    `INSERT INTO patients (caregiver_id, name, language)
     VALUES ($1, $2, $3)
     RETURNING id, caregiver_id, language`,
    [caregiverId, DEFAULT_PATIENT_NAME, DEFAULT_LANGUAGE]
  );
  return { patient: created.rows[0], created: true };
}

/** New caregiver (no login yet) + their patient, in one statement. */
async function createCaregiverAndPatient() {
  const result = await query(
    `WITH cg AS (
       INSERT INTO caregivers (name) VALUES (NULL) RETURNING id
     )
     INSERT INTO patients (caregiver_id, name, language)
     SELECT cg.id, $1, $2 FROM cg
     RETURNING id, caregiver_id, language`,
    [DEFAULT_PATIENT_NAME, DEFAULT_LANGUAGE]
  );
  return result.rows[0];
}

/** New caregiver with no login yet (a second phone joining an existing patient). */
async function createCaregiver() {
  const result = await query('INSERT INTO caregivers (name) VALUES (NULL) RETURNING id');
  return result.rows[0].id;
}

/**
 * Pair the device holding `code`. Whoever pairs joins the patient's care team (patient_caregivers) and becomes
 * the most recently paired caregiver (the name the terminal shows).
 * - device already has a patient → keep it (never a second patient). With a caregiver JWT that caregiver joins
 *   the team; without one a NEW caregiver is created and joins it (the phone never gets another caregiver's login).
 * - unpaired device, caregiver JWT → that caregiver's patient ("Pair New Tablet").
 * - unpaired device, no JWT        → create a caregiver + patient.
 * Returns { caregiverId, patientId, language, deviceId, deviceName, createdPatient, joinedExisting }.
 * Throws PairingError (4xx) for invalid / expired / used codes.
 */
async function pairWithCode({ code, caregiverId = null }) {
  const found = await query(
    `SELECT id, patient_id, code_used_at, code_expires_at > NOW() AS is_live
     FROM devices
     WHERE pairing_code = $1`,
    [hashCode(code)]
  );
  const device = found.rows[0];
  if (!device)             throw new PairingError(400, 'invalid_code', 'Invalid pairing code');
  if (device.code_used_at) throw new PairingError(409, 'code_used', 'Pairing code already used');
  if (!device.is_live)     throw new PairingError(410, 'code_expired', 'Pairing code expired');

  // Claim the code first (atomic), so two phones racing on one code cannot both pair.
  const claimed = await query(
    `UPDATE devices SET code_used_at = NOW()
     WHERE id = $1 AND code_used_at IS NULL AND code_expires_at > NOW()
     RETURNING id`,
    [device.id]
  );
  if (claimed.rows.length === 0) {
    throw new PairingError(409, 'code_used', 'Pairing code already used');
  }

  try {
    let patient;
    let pairedBy = caregiverId;
    let createdPatient = false;
    if (device.patient_id !== null) {
      const existing = await query(
        'SELECT id, caregiver_id, language FROM patients WHERE id = $1',
        [device.patient_id]
      );
      patient = existing.rows[0];
      if (patient && !pairedBy) pairedBy = await createCaregiver();
    }
    const joinedExisting = Boolean(patient);
    if (!patient && pairedBy) {
      ({ patient, created: createdPatient } = await patientForCaregiver(pairedBy));
    }
    if (!patient) {
      patient = await createCaregiverAndPatient();
      pairedBy = patient.caregiver_id;
      createdPatient = true;
    }
    await addToCareTeam(patient.id, pairedBy);

    const linked = await query(
      `UPDATE devices
       SET patient_id = $1, name = COALESCE(name, $3),
           is_online = true, last_seen_at = NOW()
       WHERE id = $2
       RETURNING name`,
      [patient.id, device.id, DEFAULT_DEVICE_NAME]
    );

    return {
      caregiverId:    pairedBy,
      patientId:      patient.id,
      language:       patient.language || DEFAULT_LANGUAGE,
      deviceId:       device.id,
      deviceName:     linked.rows[0]?.name || DEFAULT_DEVICE_NAME,
      createdPatient,
      joinedExisting,
    };
  } catch (err) {
    // Linking failed after the claim: give the code back so the caregiver can retry.
    await query('UPDATE devices SET code_used_at = NULL WHERE id = $1', [device.id])
      .catch((releaseErr) => console.error('pairWithCode: code release failed:', releaseErr.message));
    throw err;
  }
}

module.exports = { pairWithCode, hashCode, PairingError };
