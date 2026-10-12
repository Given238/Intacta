const router = require('express').Router();
const authenticate = require('../middleware/auth');
const { getPatientStatus, listInteractions } = require('../controllers/patientController');
const { patientQuerySchema, interactionsQuerySchema, validateQuery } = require('../validators');
// Mounted at /api, so auth is per route (a router-level guard would 401 every unknown /api path)
router.get('/patient/status', authenticate, validateQuery(patientQuerySchema), getPatientStatus);
router.get('/interactions', authenticate, validateQuery(interactionsQuerySchema), listInteractions);
module.exports = router;
