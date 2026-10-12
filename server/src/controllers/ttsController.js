/**
 * ttsController.js — GET /api/tts?text=… and GET /api/voices.
 *
 * /api/tts streams audio/mpeg from ElevenLabs in the patient's language and voice_gender, with
 * playback_speed. Auth: terminal device token (x-device-token header, or ?token= for an <audio> src,
 * which cannot send headers) or a caregiver JWT with ?patientId (ownership checked).
 * Nothing is stored. Missing key/voice or an ElevenLabs failure → 503 {error, code}.
 */

const { Readable } = require('stream');
const { query } = require('../db/query');
const { patientAccess, ACCESS_ERRORS } = require('../services/ownership');
const { getSettings } = require('../services/settingsService');
const voiceService = require('../services/voiceService');

// ── Per-device (or per-caregiver) rate limit, in memory ──────────────────────
const RATE_LIMIT = 30;          // requests
const RATE_WINDOW_MS = 60_000;  // per minute
const rateBuckets = new Map();  // key → { count, windowStart }

function checkRateLimit(key, now = Date.now()) {
  const entry = rateBuckets.get(key);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

function resetRateLimits() {
  rateBuckets.clear();
}

/** Which patient and rate-limit key this request speaks for; sends the error itself and returns null. */
async function resolveTarget(req, res) {
  if (req.deviceId) {
    return { patientId: req.patientId, language: req.language, key: `device:${req.deviceId}` };
  }
  const { patientId } = req.validQuery;
  if (!patientId) {
    res.status(400).json({ error: 'Validation failed', errors: [{ path: 'patientId', message: 'patientId is required' }] });
    return null;
  }
  const access = await patientAccess(patientId, req.caregiverId);
  if (access !== 200) {
    res.status(access).json(ACCESS_ERRORS[access]);
    return null;
  }
  const lang = await query('SELECT language FROM patients WHERE id = $1', [patientId]);
  return { patientId, language: lang.rows[0]?.language || 'en', key: `caregiver:${req.caregiverId}` };
}

async function getTts(req, res) {
  const { text } = req.validQuery;
  let target;
  let settings;
  try {
    target = await resolveTarget(req, res);
    if (!target) return;
    settings = await getSettings(target.patientId);
  } catch (err) {
    console.error('tts lookup error:', err.message);
    return res.status(500).json({ error: 'Failed to load voice settings' });
  }
  if (!checkRateLimit(target.key)) {
    return res.status(429).json({ error: 'Too many TTS requests', code: 'rate_limited' });
  }

  // Abort the upstream request if the client goes away before the audio is done.
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });

  let upstream;
  try {
    upstream = await voiceService.synthesizeStream({
      text,
      language:      target.language,
      gender:        settings?.voice_gender,
      playbackSpeed: settings?.playback_speed,
    }, { signal: controller.signal });
  } catch (err) {
    if (err instanceof voiceService.TtsError) {
      if (process.env.NODE_ENV !== 'test') console.warn(`[tts] ${err.code}: ${err.message}`);
      return res.status(503).json({ error: 'Voice unavailable', code: err.code });
    }
    console.error('tts error:', voiceService.redact(err.message));
    return res.status(503).json({ error: 'Voice unavailable', code: 'tts_upstream' });
  }

  res.status(200).set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' });
  const stream = Readable.fromWeb(upstream.body);
  stream.on('error', (err) => {
    if (!controller.signal.aborted) console.error('tts stream error:', voiceService.redact(err.message));
    res.destroy();
  });
  stream.pipe(res);
}

/** GET /api/voices — dropdown options, never the IDs. */
function getVoices(req, res) {
  return res.json({ voices: voiceService.listVoiceOptions() });
}

module.exports = { getTts, getVoices, checkRateLimit, resetRateLimits, RATE_LIMIT };
