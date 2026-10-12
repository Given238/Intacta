/**
 * patientService.js — portal read models: patient/device status and the interaction log.
 */

const { query } = require('../db/query');

/** Patient + their most recently seen device. Returns null when the patient does not exist. */
async function getPatientStatus(patientId) {
  const result = await query(
    `SELECT p.id AS patient_id, p.name AS patient_name, p.language,
            d.id AS device_id, d.name AS device_name, d.is_online, d.battery, d.last_seen_at
     FROM patients p
     LEFT JOIN LATERAL (
       SELECT id, name, is_online, battery, last_seen_at FROM devices
       WHERE patient_id = p.id
       ORDER BY last_seen_at DESC NULLS LAST, id DESC
       LIMIT 1
     ) d ON true
     WHERE p.id = $1`,
    [patientId]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return {
    patient_id:   r.patient_id,
    patient_name: r.patient_name,
    language:     r.language,
    device: r.device_id == null ? null : {
      id:           r.device_id,
      name:         r.device_name,
      online:       !!r.is_online,
      battery:      r.battery,
      last_seen_at: r.last_seen_at,
    },
  };
}

/** Newest first, cursor-paged by id: pass next_before back as ?before= for the next page. */
async function listInteractions(patientId, { limit, before }) {
  const params = [patientId, limit + 1];
  let cursor = '';
  if (before) {
    params.push(before);
    cursor = 'AND id < $3';
  }
  const result = await query(
    `SELECT id, transcript, ai_response, source, latency_ms, created_at
     FROM interaction_logs
     WHERE patient_id = $1 ${cursor}
     ORDER BY id DESC
     LIMIT $2`,
    params
  );
  const rows = result.rows.slice(0, limit);
  return {
    interactions: rows,
    next_before:  result.rows.length > limit ? rows[rows.length - 1].id : null,
  };
}

module.exports = { getPatientStatus, listInteractions };
