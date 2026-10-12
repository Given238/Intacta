const { query } = require('../db/query');
const { logAudit } = require('../services/audit');
const { initialLastFiredOn } = require('../services/routineScheduler');

/*
 * trigger_time is wall-clock time in Asia/Jakarta (TIME, no zone); the scheduler reads it with the
 * Jakarta clock. last_fired_on is set when a routine is created or re-timed after its time today, so it
 * is not fired late or logged as missed for today.
 */

async function listRoutines(req, res) {
  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId query parameter is required' });
  // Check patient exists at all
  const byId = await query('SELECT id, caregiver_id FROM patients WHERE id = $1', [patientId]);
  if (byId.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });
  if (byId.rows[0].caregiver_id !== req.caregiverId) return res.status(403).json({ error: 'Access denied to this patient' });
  const result = await query('SELECT * FROM routines WHERE patient_id = $1 ORDER BY trigger_time ASC', [patientId]);
  return res.json({ routines: result.rows });
}

async function createRoutine(req, res) {
  const { patientId, title, days, trigger_time, category, audio_script, display_text, is_active } = req.body;
  if (!patientId || !trigger_time || !category) return res.status(400).json({ error: 'patientId, trigger_time, and category are required' });
  const byId = await query('SELECT id, caregiver_id FROM patients WHERE id = $1', [patientId]);
  if (byId.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });
  if (byId.rows[0].caregiver_id !== req.caregiverId) return res.status(403).json({ error: 'Access denied to this patient' });
  const result = await query(
    `INSERT INTO routines (patient_id, title, days, trigger_time, category, audio_script, display_text, is_active, last_fired_on)
     VALUES ($1, $2, COALESCE($3::smallint[], '{0,1,2,3,4,5,6}'), $4, $5, $6, $7, $8, $9) RETURNING *`,
    [patientId, title || null, days || null, trigger_time, category, audio_script || null, display_text || null, is_active !== false,
     initialLastFiredOn(trigger_time, days)]
  );
  await logAudit({ caregiverId: req.caregiverId, action: 'routine.create', payload: { patientId, title, days, trigger_time, category } });
  return res.status(201).json({ routine: result.rows[0] });
}

async function getRoutine(req, res) {
  const { id } = req.params;
  const result = await query(
    `SELECT r.*, p.caregiver_id
     FROM routines r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Routine not found' });
  if (result.rows[0].caregiver_id !== req.caregiverId) return res.status(403).json({ error: 'Access denied to this routine' });
  const { caregiver_id: _cg, ...routine } = result.rows[0];
  return res.json({ routine });
}

async function updateRoutine(req, res) {
  const { id } = req.params;
  const { title, days, trigger_time, category, audio_script, display_text, is_active } = req.body;
  const check = await query(
    `SELECT r.id, r.trigger_time, r.days, r.last_fired_on, p.caregiver_id
     FROM routines r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = $1`,
    [id]
  );
  if (check.rows.length === 0) return res.status(404).json({ error: 'Routine not found' });
  if (check.rows[0].caregiver_id !== req.caregiverId) return res.status(403).json({ error: 'Access denied to this routine' });
  // Re-timed (time or days): fire again today only if the new time is still ahead.
  const retimed = trigger_time !== undefined || days !== undefined;
  const lastFiredOn = retimed
    ? initialLastFiredOn(trigger_time ?? check.rows[0].trigger_time, days ?? check.rows[0].days)
    : check.rows[0].last_fired_on;
  const result = await query(
    `UPDATE routines SET trigger_time = COALESCE($1, trigger_time), category = COALESCE($2, category),
     audio_script = COALESCE($3, audio_script), display_text = COALESCE($4, display_text),
     is_active = COALESCE($5, is_active), title = COALESCE($6, title),
     days = COALESCE($7::smallint[], days), last_fired_on = $9 WHERE id = $8 RETURNING *`,
    [trigger_time, category, audio_script, display_text, is_active, title, days, id, lastFiredOn]
  );
  await logAudit({ caregiverId: req.caregiverId, action: 'routine.update', payload: { id, title, days, trigger_time, category, is_active } });
  return res.json({ routine: result.rows[0] });
}

async function deleteRoutine(req, res) {
  const { id } = req.params;
  const check = await query(
    `SELECT r.id, p.caregiver_id
     FROM routines r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = $1`,
    [id]
  );
  if (check.rows.length === 0) return res.status(404).json({ error: 'Routine not found' });
  if (check.rows[0].caregiver_id !== req.caregiverId) return res.status(403).json({ error: 'Access denied to this routine' });
  await query('DELETE FROM routines WHERE id = $1', [id]);
  await logAudit({ caregiverId: req.caregiverId, action: 'routine.delete', payload: { id } });
  return res.status(204).send();
}

module.exports = { listRoutines, createRoutine, getRoutine, updateRoutine, deleteRoutine };
