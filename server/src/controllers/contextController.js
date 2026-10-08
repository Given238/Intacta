const { query } = require('../db/query');
const { logAudit } = require('../services/audit');

async function getContext(req, res) {
  const { patientId } = req.query;
  if (!patientId) {
    return res.status(400).json({ error: 'patientId query parameter is required' });
  }
  const patient = await query(
    'SELECT id FROM patients WHERE id = $1 AND caregiver_id = $2',
    [patientId, req.caregiverId]
  );
  if (patient.rows.length === 0) {
    return res.status(404).json({ error: 'Patient not found or access denied' });
  }
  const result = await query(
    'SELECT * FROM daily_contexts WHERE patient_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [patientId]
  );
  const context = result.rows.length > 0 ? result.rows[0] : null;
  return res.json({ context });
}

async function putContext(req, res) {
  const { patientId, visitor_name, arrival_time, passive_cue } = req.body;
  if (!patientId) {
    return res.status(400).json({ error: 'patientId is required' });
  }
  const patient = await query(
    'SELECT id FROM patients WHERE id = $1 AND caregiver_id = $2',
    [patientId, req.caregiverId]
  );
  if (patient.rows.length === 0) {
    return res.status(404).json({ error: 'Patient not found or access denied' });
  }
  const result = await query(
    `INSERT INTO daily_contexts (patient_id, context_date, visitor_name, arrival_time, passive_cue, updated_at)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, NOW())
     ON CONFLICT (patient_id, context_date) DO UPDATE
       SET visitor_name = EXCLUDED.visitor_name,
           arrival_time = EXCLUDED.arrival_time,
           passive_cue  = EXCLUDED.passive_cue,
           updated_at   = NOW()
     RETURNING *`,
    [patientId, visitor_name || null, arrival_time || null, passive_cue || null]
  );
  return res.json({ context: result.rows[0] }).then(() =>
    logAudit({ caregiverId: req.caregiverId, action: 'context.update', payload: { patientId, visitor_name, arrival_time, passive_cue } })
  );
}

module.exports = { getContext, putContext };
