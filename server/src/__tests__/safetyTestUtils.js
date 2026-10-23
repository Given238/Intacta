/**
 * Test helpers for the content safety classifier (not a test file: jest only runs *.test.js).
 * Plumbing tests inject a fake classifier; the real model only runs in the live tests (RUN_LIVE_LLM_TESTS=1).
 */

const safety = require('../services/contentSafety');

const verdict = (fields = {}) => ({
  decision: 'allow', category: 'none', addressed_to_patient: false, patient_distress_0_to_10: 0,
  spoken_aloud_ok: true, reason_short: 'calm everyday information', ...fields,
});
const ALLOW = verdict();
const BLOCK = (category = 'threat_or_harm') => verdict({
  decision: 'block', category, addressed_to_patient: true, patient_distress_0_to_10: 9, spoken_aloud_ok: false, reason_short: 'threatens the person',
});

/** Stored columns of a row already screened (current SAFETY_VERSION, allowed). */
const SCREENED = { safety_version: safety.SAFETY_VERSION, safety_verdict: 'allow', blocked_category: null, sensitive: false };

/** Every text is allowed (plumbing tests that are not about safety). */
function allowAll() {
  safety.setClassifier(async () => ALLOW);
}

/** Texts in `blocked` (exact) get a block verdict, the rest are allowed. */
function blockOnly(blocked, category) {
  safety.setClassifier(async (text) => (blocked.includes(text) ? BLOCK(category) : ALLOW));
}

module.exports = { verdict, ALLOW, BLOCK, SCREENED, allowAll, blockOnly };
