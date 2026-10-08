const router = require('express').Router();
const authenticate = require('../middleware/auth');
const {
  listRoutines, createRoutine, getRoutine, updateRoutine, deleteRoutine,
} = require('../controllers/routinesController');
const { createRoutineSchema, updateRoutineSchema, validateBody } = require('../validators');
router.use(authenticate);
router.get('/', listRoutines);
router.post('/', validateBody(createRoutineSchema), createRoutine);
router.get('/:id', getRoutine);
router.put('/:id', validateBody(updateRoutineSchema), updateRoutine);
router.delete('/:id', deleteRoutine);
module.exports = router;
