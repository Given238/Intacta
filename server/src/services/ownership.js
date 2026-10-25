/**
 * ownership.js — Caregiver → patient access check shared by every caregiver route.
 * A caregiver may access a patient they created (patients.caregiver_id) or whose care team they joined by
 * pairing a device (patient_caregivers, migration 009).
 * Returns 200 when the caregiver has access, 403 when the patient belongs to others, 404 when none exists.
 */

const { query } = require('../db/query');

/** SQL: true when caregiver `caregiverParam` is an active member of patient `patientExpr`'s care team (owner not
 *  included; a member who left, migration 010, is not). */
const memberSql = (patientExpr, caregiverParam) =>
  `EXISTS (SELECT 1 FROM patient_caregivers pc WHERE pc.patient_id = ${patientExpr} AND pc.caregiver_id = ${caregiverParam} AND pc.left_at IS NULL)`;

/** A row with caregiver_id (the owner) and is_member (memberSql) → may this caregiver access it? */
const onCareTeam = (row, caregiverId) => row.caregiver_id === caregiverId || row.is_member === true;

async function patientAccess(patientId, caregiverId) {
  const result = await query(
    `SELECT caregiver_id, ${memberSql('patients.id', '$2')} AS is_member FROM patients WHERE id = $1`,
    [patientId, caregiverId]
  );
  if (result.rows.length === 0) return 404;
  return onCareTeam(result.rows[0], caregiverId) ? 200 : 403;
}

const ACCESS_ERRORS = {
  404: { error: 'Patient not found' },
  403: { error: 'Access denied to this patient' },
};

module.exports = { patientAccess, ACCESS_ERRORS, memberSql, onCareTeam };
