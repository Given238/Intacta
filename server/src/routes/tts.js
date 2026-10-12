const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { authenticateDevice } = require('../middleware/deviceAuth');
const { getTts, getVoices } = require('../controllers/ttsController');
const { ttsQuerySchema, validateQuery } = require('../validators');

/** Terminal device token (header, or ?token= for an <audio> src) or a caregiver JWT. */
function deviceOrCaregiver(req, res, next) {
  if (!req.headers['x-device-token'] && typeof req.query.token === 'string' && req.query.token) {
    req.headers['x-device-token'] = req.query.token;
  }
  if (req.headers['x-device-token']) return authenticateDevice(req, res, next);
  if (req.headers.authorization) return authenticate(req, res, next);
  return res.status(401).json({ error: 'Missing x-device-token header or Authorization' });
}

// Mounted at /api, so auth is per route.
router.get('/tts', deviceOrCaregiver, validateQuery(ttsQuerySchema), getTts);
router.get('/voices', authenticate, getVoices);
module.exports = router;
module.exports.deviceOrCaregiver = deviceOrCaregiver;
