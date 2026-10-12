/**
 * settingsController.js — GET/PUT /api/settings (caregiver JWT).
 * PUT is audited and emits a non-volatile settings:sync to patient:{id}.
 */

const { patientAccess, ACCESS_ERRORS } = require('../services/ownership');
const settingsService = require('../services/settingsService');
const { logAudit } = require('../services/audit');

async function getSettings(req, res) {
  const { patientId } = req.validQuery;
  try {
    const access = await patientAccess(patientId, req.caregiverId);
    if (access !== 200) return res.status(access).json(ACCESS_ERRORS[access]);
    const settings = await settingsService.getSettings(patientId);
    return res.json({ settings });
  } catch (err) {
    console.error('getSettings error:', err.message);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
}

async function putSettings(req, res) {
  const { patientId, ...changes } = req.body;
  try {
    const access = await patientAccess(patientId, req.caregiverId);
    if (access !== 200) return res.status(access).json(ACCESS_ERRORS[access]);
    const settings = await settingsService.updateSettings(patientId, changes);
    await logAudit({ caregiverId: req.caregiverId, action: 'settings.update', payload: { patientId, ...changes } });
    await settingsService.emitSettingsSync(req.app.get('io'), patientId, settings);
    return res.json({ settings });
  } catch (err) {
    console.error('putSettings error:', err.message);
    return res.status(500).json({ error: 'Failed to update settings' });
  }
}

module.exports = { getSettings, putSettings };
