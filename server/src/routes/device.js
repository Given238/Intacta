/**
 * device.js — Terminal reads (x-device-token auth).
 * GET /api/device/context        — today's daily + permanent context items, language, updated_at, caregiver name/count
 * GET /api/device/settings       — patient settings (voice, speed, volume, speech length)
 * POST /api/device/pairing-code  — a new pairing code for this (paired) device, so another caregiver can pair
 */

const router = require('express').Router();
const { authenticateDevice } = require('../middleware/deviceAuth');
const { getDeviceContext, getDeviceSettings, requestPairingCode } = require('../controllers/devicesController');
router.use(authenticateDevice);
router.get('/context', getDeviceContext);
router.get('/settings', getDeviceSettings);
router.post('/pairing-code', requestPairingCode);
module.exports = router;
