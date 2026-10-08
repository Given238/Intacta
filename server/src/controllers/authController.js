const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { query } = require('../db/query');

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const result = await query(
    'SELECT id, email, password_hash FROM caregivers WHERE email = $1',
    [email]
  );
  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const caregiver = result.rows[0];
  const valid = await bcrypt.compare(password, caregiver.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign(
    { caregiverId: caregiver.id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
  return res.json({ token });
}

async function register(req, res) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const existing = await query('SELECT id FROM caregivers WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Email already in use' });
  }
  const password_hash = await bcrypt.hash(password, 12);
  const result = await query(
    'INSERT INTO caregivers (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
    [email, password_hash]
  );
  return res.status(201).json({ caregiver: result.rows[0] });
}

module.exports = { login, register };
