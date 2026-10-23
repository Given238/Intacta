const router = require('express').Router();
const multer = require('multer');
const { authenticateDevice } = require('../middleware/deviceAuth');
const { runChain } = require('../llm/chain');
const { loadPatientContext, loadRecentExchanges, loadUpcomingRoutines, jakartaTimeOfDay } = require('../llm/contextLoader');
const { logInteraction } = require('../llm/interactionLogger');
const stt = require('../services/sttService');

const VALID_SOURCES = ['voice', 'typed', 'routine', 'broadcast'];
const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~60 s of 16 kHz 16-bit mono WAV

// Voice segments arrive as multipart {audio, source:'voice'}; kept in memory only, never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 4 },
});

function audioUpload(req, res, next) {
  if (!req.is('multipart/form-data')) return next();
  upload.single('audio')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'audio too large' : `invalid upload: ${err.message}`, code: tooBig ? 'audio_too_large' : 'bad_upload' });
  });
}

/**
 * POST /api/respond
 *   JSON      {transcript, source?}                  typed / legacy
 *   multipart {audio (WAV), source:'voice'}          transcribed server-side first
 * → {transcript, text, parts, meta}. An empty or junk transcript gets no reply and is not logged:
 *   {transcript: '', text: null, parts: [], meta: {no_speech: true, stt_ms}}.
 */
router.post('/', authenticateDevice, audioUpload, async (req, res) => {
  const source = req.body?.source || 'voice';
  if (!VALID_SOURCES.includes(source)) {
    return res.status(400).json({ error: `source must be one of: ${VALID_SOURCES.join(', ')}` });
  }

  let patient;
  try {
    patient = await loadPatientContext(req.patientId);
  } catch (err) {
    console.error('loadPatientContext error:', err.message);
    return res.status(500).json({ error: 'Failed to load patient context' });
  }
  if (!patient) {
    return res.status(404).json({ error: 'Patient not found' });
  }
  const language = patient.language || 'en';

  // ── Speech → transcript (audio is used for transcription only, then dropped) ──
  let transcript;
  let sttMs = null;
  if (req.file) {
    if (source !== 'voice') return res.status(400).json({ error: "audio uploads must use source 'voice'" });
    const sttStart = Date.now();
    try {
      ({ transcript } = await stt.transcribe(req.file.buffer, { mimeType: req.file.mimetype || 'audio/wav', language }));
    } catch (err) {
      console.error(`[stt] ${err.code || 'error'}${err.status ? ` ${err.status}` : ''}: ${err.message}`);
      return res.status(502).json({ error: 'Transcription failed', code: err.code || 'stt_failed' });
    } finally {
      sttMs = Date.now() - sttStart;
      req.file.buffer = null; // FR-4.2.5: discard the audio right after transcription
      req.file = null;
    }
    if (stt.isJunkTranscript(transcript)) {
      return res.json({ transcript: '', text: null, parts: [], meta: { no_speech: true, stt_ms: sttMs } });
    }
  } else {
    transcript = req.body?.transcript;
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
      return res.status(400).json({ error: 'transcript is required and must be non-empty' });
    }
  }
  transcript = transcript.trim();

  const timeOfDay = jakartaTimeOfDay();
  // Variety + situation inputs; a failure here only makes the reply less specific, never an error
  const [recent, upcomingRoutines] = await Promise.all([
    loadRecentExchanges(req.patientId).catch(err => { console.error('loadRecentExchanges error:', err.message); return []; }),
    loadUpcomingRoutines(req.patientId).catch(err => { console.error('loadUpcomingRoutines error:', err.message); return []; }),
  ]);

  const start = Date.now();
  let aiResponse;
  try {
    aiResponse = await runChain({
      transcript,
      daily_items:        patient.daily_items,
      permanent_items:    patient.permanent_items,
      sensitive_items:    patient.sensitive_items,
      max_speech_seconds: patient.max_speech_seconds,
      timeOfDay,
      language,
      recent,
      upcoming_routines: upcomingRoutines,
      patientId: req.patientId,
    });
  } catch (err) {
    console.error('LLM chain error:', err.message);
    return res.status(500).json({ error: 'LLM processing failed' });
  }
  const latencyMs = Date.now() - start;

  let logRow;
  try {
    logRow = await logInteraction({
      patientId: req.patientId,
      transcript,
      aiResponse,
      source,
      latencyMs,
    });
  } catch (err) {
    console.error('Failed to write interaction log:', err.message);
  }

  // Emit to Caregiver Portal room
  const io = req.app.get('io');
  if (io) {
    io.to(`patient:${req.patientId}`).volatile.emit('interaction:new', {
      transcript,
      ai_response: aiResponse,
      source,
      latency_ms: latencyMs,
      created_at: logRow?.created_at || new Date().toISOString(),
    });
  }

  return res.json({
    transcript,
    text:  aiResponse.text,
    parts: aiResponse.parts,
    meta: {
      fallback: aiResponse._fallback || false,
      theme:    aiResponse._theme    || null,
      fallback_reason: aiResponse._reason || null,
      stage:    aiResponse._stage    || null,
      latency_ms: latencyMs,
      stt_ms: sttMs,
    },
  });
});

module.exports = router;
module.exports.MAX_AUDIO_BYTES = MAX_AUDIO_BYTES;
