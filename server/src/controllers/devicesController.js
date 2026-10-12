/**
 * devicesController.js — Device pairing (Phase 1 pairing flow).
 *
 * Step 1 (terminal):  POST /api/devices/register  { device_id, code }
 *   Generates a 6-char pairing code, TTL 10 min, single use.
 *
 * Step 2 (caregiver): POST /api/devices/pair  { code }   — public, no login
 *   Rate-limited 5/min per IP. Optional caregiver JWT ("Pair New Tablet").
 *   Returns a caregiver JWT scoped to the paired patient + {patient_id, language, device_name}.
 */

const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const { query } = require('../db/query');
const { loadContextSnapshot, buildContextSync } = require('../services/contextService');
const { getSettings, buildSettingsSync } = require('../services/settingsService');
const { pairWithCode, hashCode, PairingError } = require('../services/pairingService');
const { logAudit } = require('../services/audit');

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

const DB_DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P03']);

function isDbUnavailable(err) {
  return DB_DOWN_CODES.has(err.code) || (err.errors || []).some((e) => DB_DOWN_CODES.has(e.code));
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
    const codeHash   = hashCode(code);
    // Terminal keeps this token for socket + REST auth, before and after pairing.
    // token stored plain-text in demo; swap for a hash in production
    const deviceToken = crypto.randomBytes(32).toString('hex');

    // Upsert by device_uid so re-registration refreshes the code
    const result = await query(
      `INSERT INTO devices (device_uid, pairing_code, code_expires_at, token_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (device_uid) DO UPDATE
         SET pairing_code = EXCLUDED.pairing_code,
             code_expires_at = EXCLUDED.code_expires_at,
             code_used_at = NULL,
             patient_id = NULL,
             token_hash = EXCLUDED.token_hash
       RETURNING id`,
      [device_id, codeHash, expiresAt, deviceToken]
    );

    return res.json({
      device_db_id: result.rows[0].id,
      device_token: deviceToken,
      code,
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    // pg connection failures are AggregateErrors with an empty message: log the code + stack.
    console.error('registerDevice error:', err.code || err.name, err.stack);
    if (isDbUnavailable(err)) {
      return res.status(503).json({ error: 'Database unavailable', code: 'db_unavailable' });
    }
    return res.status(500).json({ error: 'Failed to register device', code: 'register_failed' });
  }
}

// ── Step 2: Caregiver submits pairing code (public; optional caregiver JWT) ──
async function pairDevice(req, res) {
  const ip   = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkPairRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many pairing attempts. Wait 1 minute.', code: 'rate_limited' });
  }

  const { code } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required', code: 'code_required' });
  }

  const normalCode = code.trim().toUpperCase();
  if (normalCode.length !== CODE_LENGTH) {
    return res.status(400).json({ error: `Code must be ${CODE_LENGTH} characters`, code: 'invalid_code' });
  }

  let paired;
  try {
    paired = await pairWithCode({ code: normalCode, caregiverId: req.caregiverId || null });
  } catch (err) {
    if (err instanceof PairingError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    console.error('pairDevice error:', err.code || err.name, err.stack);
    if (isDbUnavailable(err)) {
      return res.status(503).json({ error: 'Database unavailable', code: 'db_unavailable' });
    }
    return res.status(500).json({ error: 'Pairing failed', code: 'pair_failed' });
  }

  const { caregiverId, patientId, language, deviceId, deviceName, createdPatient } = paired;
  await logAudit({
    caregiverId,
    action:  'device.pair',
    payload: { device_id: deviceId, patient_id: patientId, created_patient: createdPatient },
  });

  // Move the connected terminal into the patient room, then notify it.
  // Emits are best-effort: the device is linked, and the terminal re-syncs on reconnect.
  const io = req.app.get('io');
  if (io) {
    try {
      const deviceRoom = `device:${deviceId}`;
      io.in(deviceRoom).socketsJoin(`patient:${patientId}`);
      io.to(deviceRoom).emit('device:paired', { patient_id: patientId, language });
      const [contextSync, settingsSync] = await Promise.all([
        buildContextSync(patientId),
        buildSettingsSync(patientId),
      ]);
      if (contextSync)  io.to(deviceRoom).emit('context:sync', contextSync);
      if (settingsSync) io.to(deviceRoom).emit('settings:sync', settingsSync);
    } catch (err) {
      console.error('pairDevice sync emit failed:', err.message);
    }
  }

  // Caregiver JWT scoped to this patient
  const authToken = jwt.sign(
    { caregiverId, patientId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );

  return res.json({
    success:     true,
    token:       authToken,
    patient_id:  patientId,
    language,
    device_name: deviceName,
  });
}

// ── Terminal reads (x-device-token): context snapshot and settings ────────────
async function getDeviceContext(req, res) {
  try {
    const snapshot = await loadContextSnapshot(req.patientId);
    if (!snapshot) return res.status(404).json({ error: 'Patient not found' });
    const { language, updated_at, ...context } = snapshot;
    return res.json({ context, language, updated_at });
  } catch (err) {
    console.error('getDeviceContext error:', err.message);
    return res.status(500).json({ error: 'Failed to load context' });
  }
}

async function getDeviceSettings(req, res) {
  try {
    const settings = await getSettings(req.patientId);
    if (!settings) return res.status(404).json({ error: 'Patient not found' });
    return res.json({ settings });
  } catch (err) {
    console.error('getDeviceSettings error:', err.message);
    return res.status(500).json({ error: 'Failed to load settings' });
  }
}

module.exports = { registerDevice, pairDevice, getDeviceContext, getDeviceSettings };
