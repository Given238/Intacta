/**
 * device.js — Terminal reads (x-device-token auth).
 * GET /api/device/context   — today's daily + permanent context items, language, updated_at
 * GET /api/device/settings  — patient settings (voice, speed, volume, speech length)
 */

const router = require('express').Router();
const { authenticateDevice } = require('../middleware/deviceAuth');
const { getDeviceContext, getDeviceSettings } = require('../controllers/devicesController');
router.use(authenticateDevice);
router.get('/context', getDeviceContext);
router.get('/settings', getDeviceSettings);
module.exports = router;
