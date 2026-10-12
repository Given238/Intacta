const router = require('express').Router();
const authenticate = require('../middleware/auth');
const {
  listContextItems, createContextItem, updateContextItem, deleteContextItem,
} = require('../controllers/contextItemsController');
const {
  createContextItemSchema, updateContextItemSchema, contextItemsQuerySchema, validateBody, validateQuery,
} = require('../validators');
router.use(authenticate);
router.get('/', validateQuery(contextItemsQuerySchema), listContextItems);
router.post('/', validateBody(createContextItemSchema), createContextItem);
router.put('/:id', validateBody(updateContextItemSchema), updateContextItem);
router.delete('/:id', deleteContextItem);
module.exports = router;
