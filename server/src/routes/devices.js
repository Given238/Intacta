/**
 * devices.js — Device pairing routes.
 *
 * POST /api/devices/register  — terminal registers and receives a pairing code
 * POST /api/devices/pair      — PUBLIC: caregiver submits code and receives a caregiver JWT
 *                                (an optional Bearer JWT links the tablet to that caregiver's patient)
 */

const router = require('express').Router();
const { optionalAuthenticate } = require('../middleware/auth');
const { registerDevice, pairDevice } = require('../controllers/devicesController');

router.post('/register', registerDevice);
router.post('/pair', optionalAuthenticate, pairDevice);

module.exports = router;
