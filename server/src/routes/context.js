const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { getContext, putContext } = require('../controllers/contextController');
const { putContextSchema, validateBody } = require('../validators');
router.use(authenticate);
router.get('/', getContext);
router.put('/', validateBody(putContextSchema), putContext);
module.exports = router;
