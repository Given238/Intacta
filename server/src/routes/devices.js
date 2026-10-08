/**
 * devices.js — Device pairing routes.
 *
 * POST /api/devices/register  — terminal registers and receives a pairing code
 * POST /api/devices/pair      — caregiver submits code and receives JWT + device token
 */

const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { registerDevice, pairDevice } = require('../controllers/devicesController');

router.post('/register', registerDevice);
router.post('/pair', authenticate, pairDevice);

module.exports = router;
