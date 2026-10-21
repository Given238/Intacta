/**
 * chain.js — the reply ladder:
 *   1. full prompt (LLM_TIMEOUT_MS)
 *   2. one retry with the SHORT prompt and the rejection reason (RETRY_TIMEOUT_MS = 2 s); skipped for
 *      non-retryable API errors (400/401/403/404)
 *   3. static fallback assembled from the situation library (fallbacks.js), marked _fallback: true
 * Every reply is validated (guardrails, per-patient word cap, food/drink rule) and safety-checked.
 * Every fallback is logged with a reason (timeout | api_error:<status> | validation:<rule> | safety | empty) and latency,
 * and every result is recorded in fallbackStats (GET /api/health/llm).
 */

const { getStructuredModel } = require('./model');
const { buildPrompt, buildShortPrompt, wordCapFor } = require('./prompts');
const { validateResponse, countWords, describeRule } = require('./validator');
const { getFallback, mentionsHungerOrThirst } = require('./fallbacks');
const { checkTier1 } = require('../services/contentSafety');
const stats = require('./fallbackStats');

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 2500;
const RETRY_TIMEOUT_MS = 2000;
const MEAL_WINDOW_MIN = 60;
const NON_RETRYABLE = new Set([400, 401, 403, 404]);

// Food or drink words; allowed in "redirect" only when food_ok (hunger/thirst or a meal routine within 60 min)
const FOOD_WORDS = /(?:^|[^a-z])(teh|kopi|susu|camilan|kudapan|kue|roti|biskuit|buah|makan\w*|minum\w*|sup|air putih|segelas|secangkir|tea|coffee|milk|snack\w*|cookies?|biscuits?|cake|bread|fruit|soup|sandwich\w*|eat\w*|food|meal|lunch|dinner|breakfast|drink\w*|sip|water|juice|cup of)(?=$|[^a-z])/i;

/** One spoken sentence: trimmed, first letter capitalised, ends with . or ! (the model sometimes returns fragments). */
function tidySentence(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return s;
  s = s.charAt(0).toLocaleUpperCase() + s.slice(1);
  return /[.!]$/.test(s) ? s : `${s.replace(/[,;:]+$/, '')}.`;
}

const isAbort = (err) => err?.name === 'AbortError' || /abort/i.test(err?.message ?? '');

function statusOf(err) {
  const message = String(err?.message ?? '');
  return err?.status ?? err?.response?.status ?? (Number(message.match(/\[(\d{3})[ \]]/)?.[1]) || null);
}

/** Reason code for a failed attempt. */
function reasonOf(err) {
  if (err?.reason) return err.reason;
  if (isAbort(err)) return 'timeout';
  return `api_error:${statusOf(err) || 'unknown'}`;
}

/** A rejected model reply: carries its reason code and the validator rule. */
function rejection(reason, message, rule = null) {
  return Object.assign(new Error(`Validation failed: ${message}`), { reason, rule });
}

/** Why did we fall back? Never logs the key, the transcript or the reply. */
function logFallback(reason, { stage, latencyMs, language, err }) {
  const key = process.env.GEMINI_API_KEY;
  let message = String(err?.message ?? err ?? '');
  if (key) message = message.split(key).join('[redacted]');
  console.warn('[llm] fallback:', JSON.stringify({ reason, stage, latency_ms: latencyMs, language, detail: message.slice(0, 200) }));
}

function minutesOf(time) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(time || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Food/drink may be offered: the patient mentioned hunger/thirst, or a meal routine starts within 60 minutes. */
function foodAllowed(transcript, upcomingRoutines = [], timeOfDay = null) {
  if (mentionsHungerOrThirst(transcript)) return true;
  const now = minutesOf(timeOfDay);
  if (Number.isNaN(now)) return false;
  return (upcomingRoutines || []).some(r => {
    if (r.category !== 'meal') return false;
    const diff = minutesOf(r.time) - now;
    return diff >= 0 && diff <= MEAL_WINDOW_MIN;
  });
}

/** Static fallback in the reply shape the routes send ({text, parts}). */
function fallbackReply(transcript, language, { recent, maxWords, historyKey } = {}) {
  const fb = getFallback(transcript, language, { recent, maxWords, historyKey });
  const parts = [fb.validate, fb.reassure, fb.redirect].filter(Boolean);
  return { ...fb, text: parts.join(' '), parts, _fallback: true };
}

/** One model call with its own timeout, then every check. */
async function attempt(prompt, { language, maxWords, foodOk, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await callLLM(prompt, language, maxWords, controller.signal, { foodOk });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build a structured reply for a transcript.
 * @param {object} input
 * @param {string}   input.transcript
 * @param {string[]} input.daily_items        today's daily context items
 * @param {string[]} input.permanent_items    permanent context items
 * @param {number}   input.max_speech_seconds word cap = min(25, round(s * 2.5)), never below 15; 0 → 25
 * @param {string}   input.timeOfDay          'HH:MM' (Asia/Jakarta)
 * @param {string}   input.language           'id' | 'en'
 * @param {Array<{transcript, reply}>} [input.recent]            last exchanges (≤3, within 10 minutes)
 * @param {Array<{title, time, category}>} [input.upcoming_routines]  today's routines still ahead
 * @param {string|number} [input.patientId]   remembers this patient's recent fallback pieces
 * @returns {Promise<{text, parts, _fallback, _theme, _reason, _stage}>}
 */
async function runChain(input) {
  const {
    transcript, daily_items, permanent_items, max_speech_seconds, timeOfDay, language = 'en',
    recent = [], upcoming_routines = [], patientId = null,
  } = input;
  const maxWords = wordCapFor(max_speech_seconds);
  const foodOk = foodAllowed(transcript, upcoming_routines, timeOfDay);
  const started = Date.now();
  const promptInput = { transcript, daily_items, permanent_items, timeOfDay, language, maxWords, recent, upcoming_routines, food_ok: foodOk };
  const recentReplies = recent.map(r => r.reply).filter(Boolean);

  const fallBack = (reason, err) => {
    const latencyMs = Date.now() - started;
    logFallback(reason, { stage: 'static', latencyMs, language, err });
    stats.record({ fallback: true, reason, latencyMs, stage: 'static' });
    return { ...fallbackReply(transcript, language, { recent: recentReplies, maxWords, historyKey: patientId }), _reason: reason, _stage: 'static' };
  };
  const success = (reply, stage) => {
    stats.record({ fallback: false, latencyMs: Date.now() - started, stage });
    return { ...reply, _stage: stage };
  };

  // 1. full prompt
  let first;
  try {
    return success(await attempt(buildPrompt(promptInput), { language, maxWords, foodOk, timeoutMs: TIMEOUT_MS }), 'full');
  } catch (err) {
    first = err;
  }
  const firstReason = reasonOf(first);
  if (NON_RETRYABLE.has(statusOf(first))) return fallBack(firstReason, first);

  // 2. short retry with the rejection reason
  console.warn('[llm] full prompt failed, retrying short:', firstReason);
  try {
    const rejectedBecause = first?.rule ? describeRule(first.rule, language) : null;
    const prompt = buildShortPrompt({ ...promptInput, rejectedBecause });
    return success(await attempt(prompt, { language, maxWords, foodOk, timeoutMs: RETRY_TIMEOUT_MS }), 'retry');
  } catch (retryErr) {
    // 3. static library
    return fallBack(reasonOf(retryErr), retryErr);
  }
}

async function callLLM(prompt, language, maxWords, signal, { foodOk = true } = {}) {
  const model = getStructuredModel();
  const chain = prompt.pipe(model);
  const raw = await chain.invoke({}, { signal });
  // withStructuredOutput returns the object directly; otherwise parse from content
  let parsed;
  try {
    parsed = typeof raw === 'object' && raw !== null
      ? raw
      : JSON.parse((raw?.content || String(raw)).trim());
  } catch {
    throw rejection('empty', 'model output is not JSON', 'empty');
  }
  if (!parsed || ['validate', 'reassure', 'redirect'].every(k => !String(parsed[k] ?? '').trim())) {
    throw rejection('empty', 'model returned an empty reply', 'empty');
  }

  // Guardrails are always enforced (strict_validation does not switch them off)
  const { valid, error, rule } = validateResponse(parsed, language);
  if (!valid) throw rejection(`validation:${rule || 'unknown'}`, error, rule);

  // Per-patient cap from max_speech_seconds, on top of the validator's 25-word ceiling
  const words = ['validate', 'reassure', 'redirect'].reduce((n, k) => n + countWords(parsed[k]), 0);
  if (words > maxWords) {
    throw rejection('validation:patient_cap', `total word count ${words} exceeds patient limit of ${maxWords}`, 'patient_cap');
  }
  // Food or drink only when the person is hungry/thirsty or a meal is near
  if (!foodOk && FOOD_WORDS.test(parsed.redirect)) {
    throw rejection('validation:food_offer', 'redirect offers food or drink without hunger, thirst or a meal routine', 'food_offer');
  }

  const parts = [parsed.validate, parsed.reassure, parsed.redirect].map(tidySentence).filter(Boolean);
  const text = parts.join(' ');

  // Content safety on the way out (A4): threats, distressing facts (death, illness, hospital) → fallback path
  const safety = checkTier1(text, { kind: 'reply' });
  if (!safety.ok) throw rejection('safety', `unsafe reply (${safety.category})`, 'safety');

  return { text, parts, _fallback: false, _theme: null, _reason: null };
}

module.exports = { runChain, callLLM, foodAllowed, reasonOf, tidySentence, TIMEOUT_MS, RETRY_TIMEOUT_MS, FOOD_WORDS };
