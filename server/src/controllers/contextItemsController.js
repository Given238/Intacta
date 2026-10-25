/**
 * contextItemsController.js — CRUD /api/context-items (caregiver JWT).
 * Every mutation is audited and emits a non-volatile context:sync to patient:{id}.
 * Text is safety-checked before it is saved: unsafe → 422 {code:'unsafe_content', category}; no verdict (classifier
 * down) → 503 {code:'safety_unavailable'} (fail closed). The verdict is stored with the row.
 */

const { patientAccess, ACCESS_ERRORS, onCareTeam } = require('../services/ownership');
const contextService = require('../services/contextService');
const { logAudit } = require('../services/audit');
const { screenOrRefuse } = require('../services/safetyGate');

/** Loads the item and checks the caregiver owns its patient; sends the error response if not. */
async function loadOwnedItem(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Validation failed', errors: [{ path: 'id', message: 'id must be a positive integer' }] });
    return null;
  }
  const found = await contextService.findItemWithOwner(id, req.caregiverId);
  if (!found) {
    res.status(404).json({ error: 'Context item not found' });
    return null;
  }
  if (!onCareTeam(found, req.caregiverId)) {
    res.status(403).json({ error: 'Access denied to this context item' });
    return null;
  }
  return found.item;
}

async function listContextItems(req, res) {
  const { patientId, scope } = req.validQuery;
  try {
    const access = await patientAccess(patientId, req.caregiverId);
    if (access !== 200) return res.status(access).json(ACCESS_ERRORS[access]);
    const items = await contextService.listItems(patientId, scope);
    return res.json({ items });
  } catch (err) {
    console.error('listContextItems error:', err.message);
    return res.status(500).json({ error: 'Failed to load context items' });
  }
}

async function createContextItem(req, res) {
  const { patientId, scope, text } = req.body;
  try {
    const access = await patientAccess(patientId, req.caregiverId);
    if (access !== 200) return res.status(access).json(ACCESS_ERRORS[access]);
    const gate = await screenOrRefuse({ texts: [text], kind: 'context', caregiverId: req.caregiverId });
    if (!gate.ok) return res.status(gate.status).json(gate.body);
    const item = await contextService.createItem({ patientId, scope, text, stored: gate.stored });
    await logAudit({ caregiverId: req.caregiverId, action: 'context_item.create', payload: { patientId, id: item.id, scope, text } });
    await contextService.emitContextSync(req.app.get('io'), patientId);
    return res.status(201).json({ item });
  } catch (err) {
    console.error('createContextItem error:', err.message);
    return res.status(500).json({ error: 'Failed to create context item' });
  }
}

async function updateContextItem(req, res) {
  try {
    const existing = await loadOwnedItem(req, res);
    if (!existing) return;
    const gate = await screenOrRefuse({ texts: [req.body.text], kind: 'context', caregiverId: req.caregiverId });
    if (!gate.ok) return res.status(gate.status).json(gate.body);
    const item = await contextService.updateItem(existing.id, req.body.text, gate.stored);
    await logAudit({ caregiverId: req.caregiverId, action: 'context_item.update', payload: { id: item.id, text: item.text } });
    await contextService.emitContextSync(req.app.get('io'), item.patient_id);
    return res.json({ item });
  } catch (err) {
    console.error('updateContextItem error:', err.message);
    return res.status(500).json({ error: 'Failed to update context item' });
  }
}

async function deleteContextItem(req, res) {
  try {
    const existing = await loadOwnedItem(req, res);
    if (!existing) return;
    await contextService.deleteItem(existing.id);
    await logAudit({ caregiverId: req.caregiverId, action: 'context_item.delete', payload: { id: existing.id } });
    await contextService.emitContextSync(req.app.get('io'), existing.patient_id);
    return res.status(204).send();
  } catch (err) {
    console.error('deleteContextItem error:', err.message);
    return res.status(500).json({ error: 'Failed to delete context item' });
  }
}

module.exports = { listContextItems, createContextItem, updateContextItem, deleteContextItem };
