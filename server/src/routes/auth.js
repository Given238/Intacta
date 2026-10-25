const router = require('express').Router();
const { login, register, logout } = require('../controllers/authController');
const { authenticateForLogout } = require('../middleware/auth');
router.post('/login', login);
router.post('/register', register);
router.post('/logout', authenticateForLogout, logout);
module.exports = router;
