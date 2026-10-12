/**
 * ownership.js — Caregiver → patient access check shared by every caregiver route.
 * Returns 200 when the caregiver owns the patient, 403 when someone else does, 404 when none exists.
 */

const { query } = require('../db/query');

async function patientAccess(patientId, caregiverId) {
  const result = await query('SELECT caregiver_id FROM patients WHERE id = $1', [patientId]);
  if (result.rows.length === 0) return 404;
  return result.rows[0].caregiver_id === caregiverId ? 200 : 403;
}

const ACCESS_ERRORS = {
  404: { error: 'Patient not found' },
  403: { error: 'Access denied to this patient' },
};

module.exports = { patientAccess, ACCESS_ERRORS };
