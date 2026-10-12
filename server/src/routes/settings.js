const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { getSettings, putSettings } = require('../controllers/settingsController');
const { getVoices } = require('../controllers/ttsController');
const { putSettingsSchema, patientQuerySchema, validateBody, validateQuery } = require('../validators');
router.use(authenticate);
router.get('/voices', getVoices); // legacy path of GET /api/voices (same safe list)
router.get('/', validateQuery(patientQuerySchema), getSettings);
router.put('/', validateBody(putSettingsSchema), putSettings);
module.exports = router;
