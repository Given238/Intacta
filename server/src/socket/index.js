/**
 * Socket.IO setup — dual auth (caregiver JWT or device token).
 * Device sockets join device:{id} immediately (works before pairing).
 * On reconnect a paired device re-joins patient:{id} automatically.
 * Caregiver sockets load their patients and join patient:{id} rooms.
 */

const jwt    = require('jsonwebtoken');
const { query } = require('../db/query');
const { patientAccess, ACCESS_ERRORS } = require('../services/ownership');
const { buildContextSync, loadContextSnapshot } = require('../services/contextService');
const { buildSettingsSync, getSettings } = require('../services/settingsService');
const { logAudit } = require('../services/audit');
const { logInteraction } = require('../llm/interactionLogger');
const { deliverPending } = require('../services/routineScheduler');
const { blockIfUnsafe, UNSAFE_ERROR } = require('../services/safetyGate');

function setupSocket(io) {
  // ── Dual-auth handshake middleware ─────────────────────────────────────────
  io.use(async (socket, next) => {
    // 1. Try caregiver JWT
    const jwtToken = socket.handshake.auth?.token;
    if (jwtToken) {
      try {
        const payload = jwt.verify(jwtToken, process.env.JWT_SECRET);
        socket.caregiverId = payload.caregiverId;
        socket.authType = 'caregiver';
        return next();
      } catch {
        // fall through to device token
      }
    }

    // 2. Fall back to device token
    const deviceToken = socket.handshake.auth?.deviceToken || socket.handshake.auth?.device_token;
    if (!deviceToken) {
      return next(new Error('Authentication error: token missing'));
    }

    // LEFT JOIN: unpaired devices (patient_id NULL) may connect and wait for device:paired
    let result;
    try {
      result = await query(
        `SELECT d.id AS device_id, d.patient_id, p.language
         FROM devices d
         LEFT JOIN patients p ON p.id = d.patient_id
         WHERE d.token_hash = $1 AND d.token_hash <> ''`,
        [deviceToken]
      );
    } catch (err) {
      console.error('Socket device auth error:', err.message);
      return next(new Error('Authentication error: server error'));
    }

    if (result.rows.length === 0) {
      return next(new Error('Authentication error: invalid device token'));
    }

    const row = result.rows[0];
    socket.deviceId  = row.device_id;
    socket.patientId = row.patient_id;
    socket.language  = row.language || 'en';
    socket.authType  = 'device';
    return next();
  });

  io.on('connection', async (socket) => {
    const type = socket.authType;

    if (type === 'caregiver') {
      // ── Caregiver: load their patients and join rooms ─────────────────────
      console.log(`Socket connected: ${socket.id} (caregiver ${socket.caregiverId})`);
      // Register handlers before any await: events sent right after connect would otherwise be dropped
      socket.on('broadcast:message', handleBroadcast(io, socket));
      socket.on('voice:test', handleVoiceTest(io, socket));
      try {
        const patients = await query(
          'SELECT id FROM patients WHERE caregiver_id = $1',
          [socket.caregiverId]
        );
        for (const row of patients.rows) {
          socket.join(`patient:${row.id}`);
        }
      } catch (err) {
        console.error('Failed to load patient rooms for caregiver socket:', err.message);
      }

      socket.on('join_patient', async (patientId) => {
        if (!patientId) return;
        const result = await query(
          'SELECT id FROM patients WHERE id = $1 AND caregiver_id = $2',
          [patientId, socket.caregiverId]
        );
        if (result.rows.length === 0) {
          socket.emit('error', { message: 'Patient not found or access denied' });
          return;
        }
        const room = `patient:${patientId}`;
        socket.join(room);
        socket.emit('joined_patient', { patientId });
      });

    } else if (type === 'device') {
      // ── Device: always join device:{id} room (works before pairing) ────────
      console.log(`Socket connected: ${socket.id} (device ${socket.deviceId}, patient ${socket.patientId})`);
      socket.join(`device:${socket.deviceId}`);

      // If paired, also join patient room (handles reconnect) and send current state
      if (socket.patientId) {
        socket.join(`patient:${socket.patientId}`);
        await sendTerminalState(socket, socket.patientId);
        // Routines that came due while this terminal was offline (≤ GRACE_MIN minutes ago)
        deliverPending(io, socket.patientId);
      }

      socket.on('device:status', handleDeviceStatus(io, socket));
    }

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
}

// ── Shared handlers ────────────────────────────────────────────────────────────

/** context:sync + settings:sync to one terminal socket (connect / reconnect). */
async function sendTerminalState(socket, patientId) {
  try {
    const context = await buildContextSync(patientId);
    if (context) socket.emit('context:sync', context);
    const settings = await buildSettingsSync(patientId);
    if (settings) socket.emit('settings:sync', settings);
  } catch (err) {
    console.error('Failed to send terminal state on connect:', err.message);
  }
}

/** Ownership guard for caregiver events; reports via 'error' + ack. Returns true when allowed. */
async function caregiverOwns(socket, patientId, ack) {
  if (!Number.isInteger(patientId) || patientId <= 0) {
    socket.emit('error', { message: 'patientId must be a positive integer' });
    if (ack) ack({ success: false, error: 'patientId must be a positive integer' });
    return false;
  }
  const access = await patientAccess(patientId, socket.caregiverId);
  if (access !== 200) {
    socket.emit('error', { message: 'Patient not found or access denied' });
    if (ack) ack({ success: false, error: ACCESS_ERRORS[access].error });
    return false;
  }
  return true;
}

const BROADCAST_MAX_CHARS = 200;
const BROADCAST_LIMIT = 10;        // per caregiver
const BROADCAST_WINDOW_MS = 60_000; // per minute
const broadcastTimes = new Map();  // caregiverId → recent send timestamps

/** Sliding-window limit: true when this caregiver may send another broadcast now (and counts it). */
function takeBroadcastSlot(caregiverId, now = Date.now()) {
  const recent = (broadcastTimes.get(caregiverId) || []).filter(t => now - t < BROADCAST_WINDOW_MS);
  if (recent.length >= BROADCAST_LIMIT) {
    broadcastTimes.set(caregiverId, recent);
    return false;
  }
  recent.push(now);
  broadcastTimes.set(caregiverId, recent);
  return true;
}

/** caregiver → server → terminal: broadcast:message { patientId, text } → { text, created_at }
 *  Safety-checked before it is logged or emitted; unsafe → ack {success:false, code:'unsafe_content', category}. */
function handleBroadcast(io, socket) {
  return async (data, ack) => {
    const { patientId, text } = data || {};
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean || clean.length > BROADCAST_MAX_CHARS) {
      const error = `text is required (1-${BROADCAST_MAX_CHARS} characters)`;
      socket.emit('error', { message: error });
      if (ack) ack({ success: false, error });
      return;
    }
    try {
      if (!(await caregiverOwns(socket, patientId, ack))) return;
      if (!takeBroadcastSlot(socket.caregiverId)) {
        if (ack) ack({ success: false, code: 'rate_limited', error: `at most ${BROADCAST_LIMIT} messages per minute` });
        return;
      }
      const language = (await loadContextSnapshot(patientId))?.language;
      const blocked = await blockIfUnsafe({ texts: [clean], kind: 'broadcast', language, caregiverId: socket.caregiverId });
      if (blocked) {
        if (ack) ack({ success: false, code: 'unsafe_content', category: blocked.category, error: UNSAFE_ERROR });
        return;
      }
      const aiResponse = { text: clean, parts: [clean] };
      const log = await logInteraction({ patientId, transcript: clean, aiResponse, source: 'broadcast', latencyMs: 0 });
      await logAudit({ caregiverId: socket.caregiverId, action: 'broadcast.send', payload: { patientId, text: clean } });
      const created_at = log?.created_at || new Date().toISOString();
      io.to(`patient:${patientId}`).emit('broadcast:message', { text: clean, created_at });
      io.to(`patient:${patientId}`).emit('interaction:new', {
        transcript: clean, ai_response: aiResponse, source: 'broadcast', created_at,
      });
      if (ack) ack({ success: true });
    } catch (err) {
      console.error('broadcast:message error:', err.message);
      socket.emit('error', { message: 'Failed to send broadcast' });
      if (ack) ack({ success: false, error: 'Server error' });
    }
  };
}

const VOICE_TEST_TEXT = {
  en: 'Hello. This is how I will sound.',
  id: 'Halo. Seperti inilah suara saya.',
};

/** caregiver → server → terminal: voice:test { patientId } → { text, language, voice_gender, playback_speed, volume_db }
 *  (the terminal speaks it through /api/tts; voice IDs never leave the server) */
function handleVoiceTest(io, socket) {
  return async (data, ack) => {
    const { patientId } = data || {};
    try {
      if (!(await caregiverOwns(socket, patientId, ack))) return;
      const [settings, snapshot] = await Promise.all([
        getSettings(patientId),
        loadContextSnapshot(patientId),
      ]);
      const language = snapshot?.language || 'en';
      const text = VOICE_TEST_TEXT[language] || VOICE_TEST_TEXT.en;
      const blocked = await blockIfUnsafe({ texts: [text], kind: 'voice_test', language, caregiverId: socket.caregiverId });
      if (blocked) {
        if (ack) ack({ success: false, code: 'unsafe_content', category: blocked.category, error: UNSAFE_ERROR });
        return;
      }
      io.to(`patient:${patientId}`).emit('voice:test', {
        text,
        language,
        voice_gender:   settings.voice_gender,
        playback_speed: settings.playback_speed,
        volume_db:      settings.volume_db,
      });
      if (ack) ack({ success: true });
    } catch (err) {
      console.error('voice:test error:', err.message);
      socket.emit('error', { message: 'Failed to run voice test' });
      if (ack) ack({ success: false, error: 'Server error' });
    }
  };
}

function handleDeviceStatus(io, socket) {
  return async (data) => {
    const { online, battery, power } = data;
    if (!Number.isInteger(battery) || battery < 0 || battery > 100) {
      socket.emit('error', { message: 'battery must be an integer 0–100' });
      return;
    }
    try {
      // patient_id comes from the DB: the socket may have been paired after it connected
      const result = await query(
        `UPDATE devices
         SET is_online = $1, battery = $2, last_seen_at = NOW()
         WHERE id = $3
         RETURNING patient_id`,
        [!!online, battery, socket.deviceId]
      );
      const patientId = result.rows[0]?.patient_id;
      if (!patientId) return; // not paired yet: nothing to tell the portal
      // Broadcast device status to all caregiver sockets in the patient room
      io.to(`patient:${patientId}`).emit('device:status', {
        device_id: socket.deviceId,
        online:    !!online,
        battery,
        power:     power || null,
      });
    } catch (err) {
      console.error('device:status error:', err.message);
    }
  };
}

module.exports = setupSocket;
module.exports.handleBroadcast    = handleBroadcast;
module.exports.takeBroadcastSlot  = takeBroadcastSlot;
module.exports.broadcastTimes     = broadcastTimes;
module.exports.handleVoiceTest    = handleVoiceTest;
module.exports.sendTerminalState  = sendTerminalState;
module.exports.handleDeviceStatus  = handleDeviceStatus;
