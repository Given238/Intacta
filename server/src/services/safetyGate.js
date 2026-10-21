/**
 * safetyGate.js — runs the content safety check before caregiver text is saved or emitted.
 * A blocked text is audited as 'content.blocked' with {kind, category} only, never the text.
 */

const { checkFields } = require('./contentSafety');
const { logAudit } = require('./audit');

const UNSAFE_ERROR = 'This text could frighten or upset the patient';

/**
 * @param {object} p
 * @param {Array<string|null|undefined>} p.texts  fields to check (empty ones are skipped)
 * @param {string} p.kind        context | broadcast | routine | voice_test
 * @param {string} [p.language]  'id' | 'en' (a hint for the classifier)
 * @param {number} p.caregiverId
 * @returns {Promise<null | {category: string}>}  null when every field is safe
 */
async function blockIfUnsafe({ texts, kind, language, caregiverId }) {
  const result = await checkFields(texts, { kind, language });
  if (result.ok) return null;
  await logAudit({ caregiverId, action: 'content.blocked', payload: { kind, category: result.category } });
  return { category: result.category };
}

/** The 422 body for REST routes; sockets ack {success:false, code, category, error}. */
function unsafeBody(category) {
  return { error: UNSAFE_ERROR, code: 'unsafe_content', category };
}

module.exports = { blockIfUnsafe, unsafeBody, UNSAFE_ERROR };
