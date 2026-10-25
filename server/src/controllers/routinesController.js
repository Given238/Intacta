const { query } = require('../db/query');
const { logAudit } = require('../services/audit');
const { initialLastFiredOn, recheckRoutine } = require('../services/routineScheduler');
const { screenOrRefuse } = require('../services/safetyGate');
const { memberSql, onCareTeam } = require('../services/ownership');

/** Patient-facing routine fields: the scheduler speaks audio_script, else display_text, else title. */
const spokenFields = (b) => [b.title, b.audio_script, b.display_text];

/*
 * trigger_time is wall-clock time in Asia/Jakarta (TIME, no zone); the scheduler reads it with the
 * Jakarta clock. last_fired_on is set when a routine is created or re-timed after its time today, so it
 * is not fired late or logged as missed for today.
 * Title, audio_script and display_text are safety-checked before saving (unsafe → 422 unsafe_content; classifier
 * unavailable → 503 safety_unavailable, fail closed) and the verdict is stored with the row. Listing re-screens rows
 * whose verdict is older than the current SAFETY_VERSION; blocked or unscreened routines never fire.
 */

async function listRoutines(req, res) {
  const { patientId } = req.query;
  if (!patientId) return res.status(400).json({ error: 'patientId query parameter is required' });
  // Check patient exists at all
  const byId = await query(`SELECT id, caregiver_id, ${memberSql('patients.id', '$2')} AS is_member FROM patients WHERE id = $1`, [patientId, req.caregiverId]);
  if (byId.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });
  if (!onCareTeam(byId.rows[0], req.caregiverId)) return res.status(403).json({ error: 'Access denied to this patient' });
  const result = await query('SELECT * FROM routines WHERE patient_id = $1 ORDER BY trigger_time ASC', [patientId]);
  const routines = [];
  for (const r of result.rows) routines.push(await recheckRoutine(r));
  return res.json({ routines });
}

async function createRoutine(req, res) {
  const { patientId, title, days, trigger_time, category, audio_script, display_text, is_active } = req.body;
  if (!patientId || !trigger_time || !category) return res.status(400).json({ error: 'patientId, trigger_time, and category are required' });
  const byId = await query(`SELECT id, caregiver_id, ${memberSql('patients.id', '$2')} AS is_member FROM patients WHERE id = $1`, [patientId, req.caregiverId]);
  if (byId.rows.length === 0) return res.status(404).json({ error: 'Patient not found' });
  if (!onCareTeam(byId.rows[0], req.caregiverId)) return res.status(403).json({ error: 'Access denied to this patient' });
  const gate = await screenOrRefuse({ texts: spokenFields(req.body), kind: 'routine', caregiverId: req.caregiverId });
  if (!gate.ok) return res.status(gate.status).json(gate.body);
  const v = gate.stored;
  const result = await query(
    `INSERT INTO routines (patient_id, title, days, trigger_time, category, audio_script, display_text, is_active, last_fired_on,
                           safety_version, safety_verdict, safety_score)
     VALUES ($1, $2, COALESCE($3::smallint[], '{0,1,2,3,4,5,6}'), $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [patientId, title || null, days || null, trigger_time, category, audio_script || null, display_text || null, is_active !== false,
     initialLastFiredOn(trigger_time, days), v.safety_version, v.safety_verdict, v.safety_score]
  );
  await logAudit({ caregiverId: req.caregiverId, action: 'routine.create', payload: { patientId, title, days, trigger_time, category } });
  return res.status(201).json({ routine: await recheckRoutine(result.rows[0]) });
}

async function getRoutine(req, res) {
  const { id } = req.params;
  const result = await query(
    `SELECT r.*, p.caregiver_id, ${memberSql('p.id', '$2')} AS is_member
     FROM routines r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = $1`,
    [id, req.caregiverId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Routine not found' });
  if (!onCareTeam(result.rows[0], req.caregiverId)) return res.status(403).json({ error: 'Access denied to this routine' });
  const { caregiver_id: _cg, is_member: _m, ...routine } = result.rows[0];
  return res.json({ routine });
}

async function updateRoutine(req, res) {
  const { id } = req.params;
  const { title, days, trigger_time, category, audio_script, display_text, is_active } = req.body;
  const check = await query(
    `SELECT r.id, r.trigger_time, r.days, r.last_fired_on, r.title, r.audio_script, r.display_text, p.caregiver_id, ${memberSql('p.id', '$2')} AS is_member
     FROM routines r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = $1`,
    [id, req.caregiverId]
  );
  if (check.rows.length === 0) return res.status(404).json({ error: 'Routine not found' });
  if (!onCareTeam(check.rows[0], req.caregiverId)) return res.status(403).json({ error: 'Access denied to this routine' });
  // The stored verdict covers the routine as it will be after the update (unchanged fields keep their value)
  const before = check.rows[0];
  const merged = { title: title ?? before.title, audio_script: audio_script ?? before.audio_script, display_text: display_text ?? before.display_text };
  const gate = await screenOrRefuse({ texts: spokenFields(merged), kind: 'routine', caregiverId: req.caregiverId });
  if (!gate.ok) return res.status(gate.status).json(gate.body);
  const v = gate.stored;
  // Re-timed (time or days): fire again today only if the new time is still ahead.
  const retimed = trigger_time !== undefined || days !== undefined;
  const lastFiredOn = retimed
    ? initialLastFiredOn(trigger_time ?? check.rows[0].trigger_time, days ?? check.rows[0].days)
    : check.rows[0].last_fired_on;
  const result = await query(
    `UPDATE routines SET trigger_time = COALESCE($1, trigger_time), category = COALESCE($2, category),
     audio_script = COALESCE($3, audio_script), display_text = COALESCE($4, display_text),
     is_active = COALESCE($5, is_active), title = COALESCE($6, title),
     days = COALESCE($7::smallint[], days), last_fired_on = $9, blocked_category = NULL,
     safety_version = $10, safety_verdict = $11, safety_score = $12 WHERE id = $8 RETURNING *`,
    [trigger_time, category, audio_script, display_text, is_active, title, days, id, lastFiredOn,
     v.safety_version, v.safety_verdict, v.safety_score]
  );
  await logAudit({ caregiverId: req.caregiverId, action: 'routine.update', payload: { id, title, days, trigger_time, category, is_active } });
  return res.json({ routine: await recheckRoutine(result.rows[0]) });
}

async function deleteRoutine(req, res) {
  const { id } = req.params;
  const check = await query(
    `SELECT r.id, p.caregiver_id, ${memberSql('p.id', '$2')} AS is_member
     FROM routines r
     JOIN patients p ON p.id = r.patient_id
     WHERE r.id = $1`,
    [id, req.caregiverId]
  );
  if (check.rows.length === 0) return res.status(404).json({ error: 'Routine not found' });
  if (!onCareTeam(check.rows[0], req.caregiverId)) return res.status(403).json({ error: 'Access denied to this routine' });
  await query('DELETE FROM routines WHERE id = $1', [id]);
  await logAudit({ caregiverId: req.caregiverId, action: 'routine.delete', payload: { id } });
  return res.status(204).send();
}

module.exports = { listRoutines, createRoutine, getRoutine, updateRoutine, deleteRoutine };
