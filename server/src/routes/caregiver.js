const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { getMe, putMe } = require('../controllers/caregiverController');
const { updateCaregiverSchema, validateBody } = require('../validators');
router.use(authenticate);
router.get('/', getMe);
router.put('/', validateBody(updateCaregiverSchema), putMe);
module.exports = router;
