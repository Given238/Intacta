/**
 * contextService.js — context_items (daily | permanent) and the snapshot the
 * terminal and the LLM prompt consume: today's daily items + all permanent items.
 */

const { query } = require('../db/query');
const { checkTier1 } = require('./contentSafety');

const ITEM_COLUMNS = 'id, patient_id, scope, text, context_date, created_at, blocked_category';

/**
 * Re-checks stored items with the Tier 1 safety rules (rows saved before the check existed, or after a
 * rule change) and stores any change in blocked_category. Returns the items with blocked_category set.
 */
async function recheckItems(items) {
  const checked = [];
  for (const item of items) {
    const { ok, category } = checkTier1(item.text, { kind: 'context' });
    const blocked = ok ? null : category;
    if ((item.blocked_category ?? null) !== blocked) {
      try {
        await query('UPDATE context_items SET blocked_category = $1 WHERE id = $2', [blocked, item.id]);
        if (blocked) console.warn(`[safety] context item ${item.id} blocked on re-check (${blocked})`);
      } catch (err) {
        console.error('[safety] could not store blocked_category:', err.message);
      }
    }
    checked.push({ ...item, blocked_category: blocked });
  }
  return checked;
}

/** Today's daily items + permanent items, optionally filtered to one scope (blocked ones included, flagged). */
async function listItems(patientId, scope) {
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
  return recheckItems(result.rows);
}

async function createItem({ patientId, scope, text }) {
  const result = await query(
    `INSERT INTO context_items (patient_id, scope, text, context_date)
     VALUES ($1, $2::varchar, $3, CASE WHEN $2::varchar = 'daily' THEN CURRENT_DATE END)
     RETURNING ${ITEM_COLUMNS}`,
    [patientId, scope, text]
  );
  return result.rows[0];
}

/** Returns { item, caregiver_id } or null — used for the ownership check on :id routes. */
async function findItemWithOwner(id) {
  const result = await query(
    `SELECT ci.id, ci.patient_id, ci.scope, ci.text, ci.context_date, ci.created_at, p.caregiver_id
     FROM context_items ci JOIN patients p ON p.id = ci.patient_id
     WHERE ci.id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const { caregiver_id, ...item } = result.rows[0];
  return { item, caregiver_id };
}

async function updateItem(id, text) {
  const result = await query(
    `UPDATE context_items SET text = $1, blocked_category = NULL WHERE id = $2 RETURNING ${ITEM_COLUMNS}`,
    [text, id]
  );
  return result.rows[0];
}

async function deleteItem(id) {
  await query('DELETE FROM context_items WHERE id = $1', [id]);
}

/**
 * Snapshot for context:sync, GET /api/device/context and the LLM prompt. Blocked items are left out:
 * they never reach the terminal or the LLM.
 * updated_at is the snapshot time (items can be deleted, so max(created_at) could go backwards).
 * Returns null when the patient does not exist.
 */
async function loadContextSnapshot(patientId) {
  const patient = await query('SELECT name, language FROM patients WHERE id = $1', [patientId]);
  if (patient.rows.length === 0) return null;
  const items = (await listItems(patientId)).filter(i => !i.blocked_category);
  const texts = (scope) => items.filter(i => i.scope === scope).map(({ id, text }) => ({ id, text }));
  return {
    patient_name: patient.rows[0].name,
    language:     patient.rows[0].language || 'en',
    daily:        texts('daily'),
    permanent:    texts('permanent'),
    updated_at:   new Date().toISOString(),
  };
}

/** The context:sync event body { payload, updated_at }, or null when the patient does not exist. */
async function buildContextSync(patientId) {
  const snapshot = await loadContextSnapshot(patientId);
  if (!snapshot) return null;
  const { updated_at, ...payload } = snapshot;
  return { payload, updated_at };
}

/** Non-volatile so the terminal always ends up with the latest context. */
async function emitContextSync(io, patientId) {
  if (!io) return;
  const body = await buildContextSync(patientId);
  if (body) io.to(`patient:${patientId}`).emit('context:sync', body);
}

module.exports = {
  listItems, recheckItems, createItem, findItemWithOwner, updateItem, deleteItem,
  loadContextSnapshot, buildContextSync, emitContextSync,
};
