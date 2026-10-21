const router = require('express').Router();
const authenticate = require('../middleware/auth');
const fallbackStats = require('../llm/fallbackStats');

/**
 * GET /api/health/llm (caregiver JWT) → {llm: {window_minutes, total, fallbacks, fallback_rate, top_reasons, p50_ms, p95_ms}}
 * Server-wide reply stats for the last hour (in memory, reset on restart; no transcripts or replies).
 */
router.get('/llm', authenticate, (req, res) => {
  try {
    return res.json({ llm: fallbackStats.summary() });
  } catch (err) {
    console.error('health/llm error:', err.message);
    return res.status(500).json({ error: 'Failed to read LLM stats' });
  }
});

module.exports = router;
