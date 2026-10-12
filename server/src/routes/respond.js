const router = require('express').Router();
const { authenticateDevice } = require('../middleware/deviceAuth');
const { runChain } = require('../llm/chain');
const { loadPatientContext } = require('../llm/contextLoader');
const { logInteraction } = require('../llm/interactionLogger');

const VALID_SOURCES = ['voice', 'typed', 'routine', 'broadcast'];

// POST /api/respond  { transcript, source? }
router.post('/', authenticateDevice, async (req, res) => {
  const { transcript, source = 'voice' } = req.body;

  if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
    return res.status(400).json({ error: 'transcript is required and must be non-empty' });
  }

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

  const timeOfDay = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  const start = Date.now();
  let aiResponse;
  try {
    aiResponse = await runChain({
      transcript: transcript.trim(),
      daily_items:        patient.daily_items,
      permanent_items:    patient.permanent_items,
      max_speech_seconds: patient.max_speech_seconds,
      timeOfDay,
      language: patient.language || 'en',
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
    text:  aiResponse.text,
    parts: aiResponse.parts,
    meta: {
      fallback: aiResponse._fallback || false,
      theme:    aiResponse._theme    || null,
      latency_ms: latencyMs,
    },
  });
});

module.exports = router;
