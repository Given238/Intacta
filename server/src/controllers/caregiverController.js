/**
 * caregiverController.js — GET/PUT /api/caregiver (own profile).
 * The name is shown to the patient ("Connected · {name}"), so a new name is validated as a person name (zod,
 * validators.js) AND safety-checked (kind display_name): 422 unsafe_content / 503 safety_unavailable (fail closed),
 * nothing saved. A saved name change goes out as caregiver:updated to every team the caregiver is on.
 */

const caregiverService = require('../services/caregiverService');
const { logAudit } = require('../services/audit');
const { screenOrRefuse } = require('../services/safetyGate');
const { emitForCaregiver } = require('../services/careTeamService');

async function getMe(req, res) {
  try {
    const caregiver = await caregiverService.getProfile(req.caregiverId);
    if (!caregiver) return res.status(404).json({ error: 'Caregiver not found' });
    return res.json({ caregiver });
  } catch (err) {
    console.error('getMe error:', err.message);
    return res.status(500).json({ error: 'Failed to load profile' });
  }
}

async function putMe(req, res) {
  try {
    const changes = { ...req.body };
    const nameChanged = Object.prototype.hasOwnProperty.call(changes, 'name');
    if (nameChanged && changes.name) {
      const gate = await screenOrRefuse({ texts: [changes.name], kind: 'display_name', caregiverId: req.caregiverId });
      if (!gate.ok) return res.status(gate.status).json(gate.body);
      changes.nameVerdict = gate.stored;
    }
    const caregiver = await caregiverService.updateProfile(req.caregiverId, changes);
    if (!caregiver) return res.status(404).json({ error: 'Caregiver not found' });
    await logAudit({ caregiverId: req.caregiverId, action: 'caregiver.update', payload: req.body });
    if (nameChanged) await emitForCaregiver(req.app?.get('io'), req.caregiverId);
    return res.json({ caregiver });
  } catch (err) {
    if (err instanceof caregiverService.CaregiverError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('putMe error:', err.message);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
}

module.exports = { getMe, putMe };
