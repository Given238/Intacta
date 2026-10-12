/**
 * caregiverController.js — GET/PUT /api/caregiver (own profile).
 */

const caregiverService = require('../services/caregiverService');
const { logAudit } = require('../services/audit');

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
    const caregiver = await caregiverService.updateProfile(req.caregiverId, req.body);
    if (!caregiver) return res.status(404).json({ error: 'Caregiver not found' });
    await logAudit({ caregiverId: req.caregiverId, action: 'caregiver.update', payload: req.body });
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
