const { query } = require('../db/query');

async function loadPatientContext(patientId) {
  const result = await query(
    `SELECT p.id, p.name, p.language, p.caregiver_id,
            dc.visitor_name, dc.arrival_time, dc.passive_cue, dc.updated_at AS context_updated_at
     FROM patients p
     LEFT JOIN daily_contexts dc ON dc.patient_id = p.id AND dc.context_date = CURRENT_DATE
     WHERE p.id = $1`,
    [patientId]
  );
  return result.rows[0] || null;
}

module.exports = { loadPatientContext };
