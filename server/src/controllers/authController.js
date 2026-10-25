const bcrypt = require('bcryptjs');
const { query } = require('../db/query');
const { issueCaregiverToken } = require('../services/sessionService');
const { logoutSession } = require('../services/logoutService');

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
  // Caregivers created by code-only pairing have no password yet
  if (!caregiver.password_hash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const valid = await bcrypt.compare(password, caregiver.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Not scoped to a patient: the session covers every patient of this caregiver
  const token = await issueCaregiverToken({ caregiverId: caregiver.id });
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

const LOGOUT_LIMIT = 10;          // per IP
const LOGOUT_WINDOW_MS = 60_000;  // per minute
const logoutRate = new Map();     // ip → { count, windowStart }

function takeLogoutSlot(ip, now = Date.now()) {
  const entry = logoutRate.get(ip);
  if (!entry || now - entry.windowStart > LOGOUT_WINDOW_MS) {
    logoutRate.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= LOGOUT_LIMIT) return false;
  entry.count++;
  return true;
}

/**
 * POST /api/auth/logout (caregiver JWT, may already be expired or revoked): revoke this session, leave the care team
 * when no other session is active, disconnect its sockets, tell the terminal. Idempotent: always 200 once accepted.
 */
async function logout(req, res) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  if (!takeLogoutSlot(ip)) {
    return res.status(429).json({ error: 'Too many requests. Wait 1 minute.', code: 'rate_limited' });
  }
  try {
    const { revoked, left } = await logoutSession(req.app.get('io'), req.session);
    return res.json({ success: true, already_logged_out: !revoked, left_patients: left });
  } catch (err) {
    console.error('logout error:', err.code || err.name, err.message);
    return res.status(500).json({ error: 'Logout failed', code: 'logout_failed' });
  }
}

module.exports = { login, register, logout };
