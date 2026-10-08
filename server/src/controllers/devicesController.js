/**
 * devicesController.js — Device pairing (Phase 1 pairing flow).
 *
 * Step 1 (terminal):  POST /api/devices/register  { device_id, code }
 *   Generates a 6-char pairing code, TTL 10 min, single use.
 *
 * Step 2 (caregiver): POST /api/pair  { code }
 *   Rate-limited 5/min per IP.
 *   Returns a caregiver JWT scoped to the paired patient.
 */

const crypto  = require('crypto');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { query } = require('../db/query');

const CODE_CHARS    = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 — avoids confusion
const CODE_LENGTH   = 6;
const CODE_TTL_MS   = 10 * 60 * 1000; // 10 minutes

function generateCode() {
  let code = '';
  const bytes = crypto.randomBytes(CODE_LENGTH);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

// In-memory rate-limit store (process restart clears it — fine for hackathon)
const pairRateLimit = new Map(); // ip → { count, windowStart }

function checkPairRateLimit(ip) {
  const now = Date.now();
  const entry = pairRateLimit.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    pairRateLimit.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= 5) return false;
  entry.count++;
  return true;
}

// ── Step 1: Terminal registers and gets a pairing code ────────────────────────
async function registerDevice(req, res) {
  const { device_id } = req.body;
  if (!device_id || typeof device_id !== 'string' || device_id.length < 8) {
    return res.status(400).json({ error: 'device_id is required (must be a stable terminal UUID)' });
  }

  try {
    const code      = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    const codeHash   = await bcrypt.hash(code, 8);

    // Upsert by device_uid so re-registration refreshes the code
    const result = await query(
      `INSERT INTO devices (device_uid, pairing_code, code_expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (device_uid) DO UPDATE
         SET pairing_code = EXCLUDED.pairing_code,
             code_expires_at = EXCLUDED.code_expires_at,
             patient_id = NULL,
             token_hash = ''
       RETURNING id`,
      [device_id, codeHash, expiresAt]
    );

    return res.json({ device_db_id: result.rows[0].id, code, expires_at: expiresAt.toISOString() });
  } catch (err) {
    console.error('registerDevice error:', err.message);
    return res.status(500).json({ error: 'Failed to register device' });
  }
}

// ── Step 2: Caregiver submits pairing code ────────────────────────────────────
async function pairDevice(req, res) {
  const ip   = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkPairRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many pairing attempts. Wait 1 minute.' });
  }

  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required' });
  }

  const normalCode = code.trim().toUpperCase();
  if (normalCode.length !== CODE_LENGTH) {
    return res.status(400).json({ error: `Code must be ${CODE_LENGTH} characters` });
  }

  try {
    // Find a device with a non-expired, non-null pairing code
    const deviceRows = await query(
      `SELECT id, pairing_code, patient_id
       FROM devices
       WHERE pairing_code IS NOT NULL
         AND code_expires_at > NOW()
       ORDER BY code_expires_at DESC
       LIMIT 10`
    );

    let matchedDevice = null;
    for (const row of deviceRows.rows) {
      const valid = await bcrypt.compare(normalCode, row.pairing_code);
      if (valid) { matchedDevice = row; break; }
    }

    if (!matchedDevice) {
      return res.status(400).json({ error: 'Invalid or expired pairing code' });
    }

    if (matchedDevice.patient_id !== null) {
      return res.status(400).json({ error: 'Device already paired' });
    }

    // Caregiver must be authenticated
    const caregiverId = req.caregiverId;
    if (!caregiverId) {
      return res.status(401).json({ error: 'Caregiver authentication required' });
    }

    // Get or create patient for this caregiver
    let patientRows = await query(
      'SELECT id FROM patients WHERE caregiver_id = $1 LIMIT 1',
      [caregiverId]
    );
    let patientId;
    if (patientRows.rows.length === 0) {
      const newPatient = await query(
        `INSERT INTO patients (caregiver_id, name, language)
         VALUES ($1, 'Patient', 'id')
         RETURNING id`,
        [caregiverId]
      );
      patientId = newPatient.rows[0].id;
    } else {
      patientId = patientRows.rows[0].id;
    }

    // Generate device token and link device to patient
    // token stored plain-text in demo; swap for bcrypt in production
    const deviceToken = crypto.randomBytes(32).toString('hex');
    // token_hash comparison is plain-text in demo; swap for bcrypt.compare in production

    await query(
      `UPDATE devices
       SET patient_id = $1, token_hash = $2,
           pairing_code = NULL, code_expires_at = NULL,
           is_online = true, last_seen_at = NOW()
       WHERE id = $3`,
      [patientId, deviceToken, matchedDevice.id]
    );

    // Issue JWT scoped to this caregiver
    const authToken = jwt.sign(
      { caregiverId, patientId },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Emit device:paired to terminal
    const io = req.app.get('io');
    if (io) {
      io.to(`patient:${patientId}`).emit('device:paired', { patient_id: patientId });
    }

    return res.json({
      success: true,
      token: authToken,
      patient_id: patientId,
      device_token: deviceToken, // shown once to caregiver to configure terminal
    });
  } catch (err) {
    console.error('pairDevice error:', err.message);
    return res.status(500).json({ error: 'Pairing failed' });
  }
}

module.exports = { registerDevice, pairDevice };
