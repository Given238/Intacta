/**
 * contextService.js — context_items (daily | permanent) and the snapshot the
 * terminal and the LLM prompt consume: today's daily items + all permanent items.
 */

const { query } = require('../db/query');
const { memberSql } = require('./ownership');
const { isUsable, withPending, rescreenContextItem, ensureScreened } = require('./storedSafety');

const ITEM_COLUMNS = `id, patient_id, scope, text, context_date, created_at, blocked_category,
  safety_version, safety_verdict, safety_score, sensitive`;

/**
 * Today's daily items + permanent items, optionally filtered to one scope (blocked ones included, flagged).
 * Rows without a current safety verdict are re-screened first (wait=false: in the background, returned as pending).
 */
async function listItems(patientId, scope, { wait = true } = {}) {
  const params = [patientId];
  let where = `patient_id = $1
    AND ((scope = 'daily' AND context_date = CURRENT_DATE) OR scope = 'permanent')`;
  if (scope) {
    params.push(scope);
    where += ' AND scope = $2';
  }
  const result = await query(
    `SELECT ${ITEM_COLUMNS} FROM context_items WHERE ${where} ORDER BY scope, created_at ASC, id ASC`,
    params
  );
  return (await ensureScreened(result.rows, rescreenContextItem, { wait })).map(withPending);
}

/** stored = the safety columns from the gate (safetyGate.screenOrRefuse). */
async function createItem({ patientId, scope, text, stored }) {
  const result = await query(
    `INSERT INTO context_items (patient_id, scope, text, context_date, safety_version, safety_verdict, safety_score, sensitive)
     VALUES ($1, $2::varchar, $3, CASE WHEN $2::varchar = 'daily' THEN CURRENT_DATE END, $4, $5, $6, $7)
     RETURNING ${ITEM_COLUMNS}`,
    [patientId, scope, text, stored.safety_version, stored.safety_verdict, stored.safety_score, stored.sensitive]
  );
  return withPending(result.rows[0]);
}

/** Returns { item, caregiver_id, is_member } or null — used for the ownership check on :id routes. */
async function findItemWithOwner(id, caregiverId) {
  const result = await query(
    `SELECT ci.id, ci.patient_id, ci.scope, ci.text, ci.context_date, ci.created_at, p.caregiver_id, ${memberSql('p.id', '$2')} AS is_member
     FROM context_items ci JOIN patients p ON p.id = ci.patient_id
     WHERE ci.id = $1`,
    [id, caregiverId]
  );
  if (result.rows.length === 0) return null;
  const { caregiver_id, is_member, ...item } = result.rows[0];
  return { item, caregiver_id, is_member };
}

async function updateItem(id, text, stored) {
  const result = await query(
    `UPDATE context_items SET text = $1, blocked_category = NULL, safety_version = $3, safety_verdict = $4,
       safety_score = $5, sensitive = $6
     WHERE id = $2 RETURNING ${ITEM_COLUMNS}`,
    [text, id, stored.safety_version, stored.safety_verdict, stored.safety_score, stored.sensitive]
  );
  return withPending(result.rows[0]);
}

async function deleteItem(id) {
  await query('DELETE FROM context_items WHERE id = $1', [id]);
}

/**
 * Snapshot for context:sync, GET /api/device/context and the LLM prompt. Only usable items (current verdict,
 * allowed) are included: blocked and not-yet-screened items never reach the terminal or the LLM, and stale rows
 * are re-screened in the background (the reply path never waits for the classifier).
 * Sensitive notes come back apart (`sensitive`) for the LLM prompt only; they are never sent to the terminal.
 * updated_at is the snapshot time (items can be deleted, so max(created_at) could go backwards).
 * Returns null when the patient does not exist.
 */
async function loadContextSnapshot(patientId) {
  const patient = await query('SELECT name, language FROM patients WHERE id = $1', [patientId]);
  if (patient.rows.length === 0) return null;
  const items = (await listItems(patientId, undefined, { wait: false })).filter(isUsable);
  const texts = (list) => list.map(({ id, text }) => ({ id, text }));
  const shared = items.filter(i => !i.sensitive);
  return {
    patient_name: patient.rows[0].name,
    language:     patient.rows[0].language || 'en',
    daily:        texts(shared.filter(i => i.scope === 'daily')),
    permanent:    texts(shared.filter(i => i.scope === 'permanent')),
    sensitive:    texts(items.filter(i => i.sensitive)),
    updated_at:   new Date().toISOString(),
  };
}

/** The terminal's view of a snapshot: sensitive notes removed. */
function terminalContext(snapshot) {
  const { sensitive: _private, ...rest } = snapshot;
  return rest;
}

/** The context:sync event body { payload, updated_at }, or null when the patient does not exist. */
async function buildContextSync(patientId) {
  const snapshot = await loadContextSnapshot(patientId);
  if (!snapshot) return null;
  const { updated_at, ...payload } = terminalContext(snapshot);
  return { payload, updated_at };
}

/** Non-volatile so the terminal always ends up with the latest context. */
async function emitContextSync(io, patientId) {
  if (!io) return;
  const body = await buildContextSync(patientId);
  if (body) io.to(`patient:${patientId}`).emit('context:sync', body);
}

module.exports = {
  listItems, createItem, findItemWithOwner, updateItem, deleteItem,
  loadContextSnapshot, terminalContext, buildContextSync, emitContextSync,
};
