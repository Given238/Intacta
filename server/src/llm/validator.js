/**
 * validator.js — Clinical guardrail validator for LLM output.
 * Enforces: no '?', banned phrases, ≤25 words total, no empty parts.
 * Returns { valid: boolean, error?: string }.
 */

const BANNED_PHRASES_ID = ['ingat', 'sudah dibilang', 'tadi kan', 'salah', 'bukan begitu'];
const BANNED_PHRASES_EN = ['remember', 'i told you', 'as i said', 'wrong', "that's not right"];

function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

function hasQuestion(text) {
  return (text || '').includes('?');
}

function hasBannedPhrase(text, lang) {
  const phrases = lang === 'id' ? BANNED_PHRASES_ID : BANNED_PHRASES_EN;
  const lower = (text || '').toLowerCase();
  return phrases.some(p => lower.includes(p));
}

function validateResponse(response, lang = 'en') {
  if (!response || typeof response !== 'object') {
    return { valid: false, error: 'Response is not an object' };
  }

  for (const key of ['validate', 'reassure', 'redirect']) {
    if (!response[key] || typeof response[key] !== 'string') {
      return { valid: false, error: `Missing or invalid field: ${key}` };
    }
    if (hasQuestion(response[key])) {
      return { valid: false, error: `Field '${key}' contains '?' — no questions allowed` };
    }
    if (hasBannedPhrase(response[key], lang)) {
      return { valid: false, error: `Field '${key}' contains a banned phrase (${lang})` };
    }
  }

  const totalWords = ['validate', 'reassure', 'redirect']
    .reduce((sum, key) => sum + countWords(response[key]), 0);

  if (totalWords > 25) {
    return { valid: false, error: `Total word count ${totalWords} exceeds limit of 25` };
  }

  return { valid: true };
}

module.exports = { validateResponse, countWords, hasQuestion, hasBannedPhrase };
