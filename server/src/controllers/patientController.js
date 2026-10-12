/**
 * patientController.js — GET /api/patient/status and GET /api/interactions (caregiver JWT).
 */

const { patientAccess, ACCESS_ERRORS } = require('../services/ownership');
const patientService = require('../services/patientService');

async function getPatientStatus(req, res) {
  const { patientId } = req.validQuery;
  try {
    const access = await patientAccess(patientId, req.caregiverId);
    if (access !== 200) return res.status(access).json(ACCESS_ERRORS[access]);
    const status = await patientService.getPatientStatus(patientId);
    return res.json({ status });
  } catch (err) {
    console.error('getPatientStatus error:', err.message);
    return res.status(500).json({ error: 'Failed to load patient status' });
  }
}

async function listInteractions(req, res) {
  const { patientId, limit, before } = req.validQuery;
  try {
    const access = await patientAccess(patientId, req.caregiverId);
    if (access !== 200) return res.status(access).json(ACCESS_ERRORS[access]);
    const page = await patientService.listInteractions(patientId, { limit, before });
    return res.json(page);
  } catch (err) {
    console.error('listInteractions error:', err.message);
    return res.status(500).json({ error: 'Failed to load interactions' });
  }
}

module.exports = { getPatientStatus, listInteractions };
