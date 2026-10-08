const { query } = require('../db/query');
const { logAudit } = require('../services/audit');

async function listRoutines(req, res) {
  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId query parameter is required' });
  const patient = await query('SELECT id FROM patients WHERE id = $1 AND caregiver_id = $2', [patientId, req.caregiverId]);
  if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient not found or access denied' });
  const result = await query('SELECT * FROM routines WHERE patient_id = $1 ORDER BY trigger_time ASC', [patientId]);
  return res.json({ routines: result.rows });
}

async function createRoutine(req, res) {
  const { patientId, trigger_time, category, audio_script, display_text, is_active } = req.body;
  if (!patientId || !trigger_time || !category) return res.status(400).json({ error: 'patientId, trigger_time, and category are required' });
  const patient = await query('SELECT id FROM patients WHERE id = $1 AND caregiver_id = $2', [patientId, req.caregiverId]);
  if (patient.rows.length === 0) return res.status(404).json({ error: 'Patient not found or access denied' });
  const result = await query(
    `INSERT INTO routines (patient_id, trigger_time, category, audio_script, display_text, is_active)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [patientId, trigger_time, category, audio_script || null, display_text || null, is_active !== false]
  );
  return res.status(201).json({ routine: result.rows[0] }).then(() =>
    logAudit({ caregiverId: req.caregiverId, action: 'routine.create', payload: { patientId, trigger_time, category } })
  );
}

async function getRoutine(req, res) {
  const { id } = req.params;
  const result = await query(
    `SELECT r.* FROM routines r JOIN patients p ON p.id = r.patient_id WHERE r.id = $1 AND p.caregiver_id = $2`,
    [id, req.caregiverId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Routine not found or access denied' });
  return res.json({ routine: result.rows[0] });
}

async function updateRoutine(req, res) {
  const { id } = req.params;
  const { trigger_time, category, audio_script, display_text, is_active } = req.body;
  const check = await query(
    `SELECT r.id FROM routines r JOIN patients p ON p.id = r.patient_id WHERE r.id = $1 AND p.caregiver_id = $2`,
    [id, req.caregiverId]
  );
  if (check.rows.length === 0) return res.status(404).json({ error: 'Routine not found or access denied' });
  const result = await query(
    `UPDATE routines SET trigger_time = COALESCE($1, trigger_time), category = COALESCE($2, category),
     audio_script = COALESCE($3, audio_script), display_text = COALESCE($4, display_text),
     is_active = COALESCE($5, is_active) WHERE id = $6 RETURNING *`,
    [trigger_time, category, audio_script, display_text, is_active, id]
  );
  return res.json({ routine: result.rows[0] }).then(() =>
    logAudit({ caregiverId: req.caregiverId, action: 'routine.update', payload: { id, trigger_time, category, is_active } })
  );
}

async function deleteRoutine(req, res) {
  const { id } = req.params;
  const check = await query(
    `SELECT r.id FROM routines r JOIN patients p ON p.id = r.patient_id WHERE r.id = $1 AND p.caregiver_id = $2`,
    [id, req.caregiverId]
  );
  if (check.rows.length === 0) return res.status(404).json({ error: 'Routine not found or access denied' });
  await query('DELETE FROM routines WHERE id = $1', [id]);
  return res.status(204).send().then(() =>
    logAudit({ caregiverId: req.caregiverId, action: 'routine.delete', payload: { id } })
  );
}

module.exports = { listRoutines, createRoutine, getRoutine, updateRoutine, deleteRoutine };
