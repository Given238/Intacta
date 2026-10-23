/**
 * safetyGate.js — runs the content safety check before caregiver text is saved or emitted. FAIL CLOSED:
 * when the classifier cannot give a verdict the text is refused (503 safety_unavailable), never allowed.
 * A blocked text is audited as 'content.blocked' with {kind, category} only, never the text.
 */

const { checkFields, storedVerdict, SafetyUnavailableError } = require('./contentSafety');
const { logAudit } = require('./audit');

const UNSAFE_ERROR = 'This text could frighten or upset the patient';
const UNAVAILABLE_ERROR = "We couldn't verify this message right now. Please try again in a moment.";

/**
 * @param {object} p
 * @param {Array<string|null|undefined>} p.texts  fields to check (empty ones are skipped)
 * @param {string} p.kind        context | broadcast | routine | voice_test
 * @param {string} [p.language]  'id' | 'en' (a hint for the classifier)
 * @param {number} p.caregiverId
 * @returns {Promise<{ok: true, stored: object} | {ok: false, status: 422|503, body: object}>}
 *   stored = the safety columns to save with the row (storedVerdict)
 */
async function screenOrRefuse({ texts, kind, language, caregiverId }) {
  let result;
  try {
    result = await checkFields(texts, { kind, language });
  } catch (err) {
    if (!(err instanceof SafetyUnavailableError)) throw err;
    return { ok: false, status: 503, body: unavailableBody() };
  }
  if (result.ok) return { ok: true, stored: storedVerdict(result) };
  await logAudit({ caregiverId, action: 'content.blocked', payload: { kind, category: result.category } });
  return { ok: false, status: 422, body: unsafeBody(result.category) };
}

/** The 422 body for REST routes; sockets ack {success:false, ...body}. */
function unsafeBody(category) {
  return { error: UNSAFE_ERROR, code: 'unsafe_content', category };
}

/** The 503 body when no verdict could be obtained. */
function unavailableBody() {
  return { error: UNAVAILABLE_ERROR, code: 'safety_unavailable' };
}

module.exports = { screenOrRefuse, unsafeBody, unavailableBody, UNSAFE_ERROR, UNAVAILABLE_ERROR };
