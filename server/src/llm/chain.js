/**
 * chain.js — LLM response chain with validation, retry, and fallback.
 * Enforces 1.2s hard timeout via AbortController.
 */

const { getStructuredModel } = require('./model');
const { buildPrompt, wordCapFor } = require('./prompts');
const { validateResponse, countWords } = require('./validator');
const { getFallback } = require('./fallbacks');

const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 1200;

/**
 * Dev-only: why did we fall back? Never logs the key itself, only whether it is set.
 */
function logFallback(stage, err) {
  if (process.env.NODE_ENV === 'production') return;
  const key = process.env.GEMINI_API_KEY;
  let message = String(err?.message ?? err ?? '');
  if (key) message = message.split(key).join('[redacted]');
  const status = err?.status ?? err?.response?.status ?? Number(message.match(/\[(\d{3})[ \]]/)?.[1]) ?? null;
  console.warn('[llm] fallback reason:', JSON.stringify({
    stage,
    name: err?.name ?? null,
    message: message.slice(0, 400),
    status: status || null,
    gemini_api_key_set: Boolean(key),
  }));
}

/**
 * Build structured LLM response for a given transcript and context.
 * @param {object} input
 * @param {string}   input.transcript
 * @param {string[]} input.daily_items      today's daily context items
 * @param {string[]} input.permanent_items  permanent context items
 * @param {number}   input.max_speech_seconds  word cap = min(25, round(s * 2.5)); 0 → 25
 * @param {string}   input.timeOfDay
 * @param {string}   input.language  'id' | 'en'
 * @returns {Promise<{text: string, parts: string[], _fallback: boolean, _theme: string}>}
 */
async function runChain(input) {
  const { transcript, daily_items, permanent_items, max_speech_seconds, timeOfDay, language = 'en' } = input;
  const maxWords = wordCapFor(max_speech_seconds);

  // One budget for the first attempt and the retry (FR-4.3.2: ≤1.2s or fallback)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const isAbort = (err) => err.name === 'AbortError' || /abort/i.test(err.message ?? '');

  try {
    const prompt = buildPrompt({ transcript, daily_items, permanent_items, timeOfDay, language, maxWords });
    try {
      return await callLLM(prompt, language, maxWords, controller.signal);
    } catch (err) {
      if (isAbort(err)) {
        logFallback('timeout', err);
        return { ...getFallback(transcript, language), _fallback: true };
      }
      logFallback('first_attempt (retrying)', err);
      // Retry once
      return await callLLM(prompt, language, maxWords, controller.signal);
    }
  } catch (err) {
    logFallback('retry', err);
    return { ...getFallback(transcript, language), _fallback: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function callLLM(prompt, language, maxWords, signal) {
  const model = getStructuredModel();
  const chain = prompt.pipe(model);
  const raw = await chain.invoke({}, { signal });
  // withStructuredOutput returns the object directly; otherwise parse from content
  const parsed = typeof raw === 'object' && raw !== null
    ? raw
    : JSON.parse((raw?.content || String(raw)).trim());

  // Guardrails are always enforced (strict_validation does not switch them off)
  const { valid, error } = validateResponse(parsed, language);
  if (!valid) {
    throw new Error(`Validation failed: ${error}`);
  }
  // Per-patient cap from max_speech_seconds, on top of the validator's 25-word ceiling
  const words = ['validate', 'reassure', 'redirect'].reduce((n, k) => n + countWords(parsed[k]), 0);
  if (words > maxWords) {
    throw new Error(`Validation failed: total word count ${words} exceeds patient limit of ${maxWords}`);
  }

  const parts = [parsed.validate, parsed.reassure, parsed.redirect].filter(Boolean);
  const text = parts.join(' ');

  return { text, parts, _fallback: false, _theme: null };
}

module.exports = { runChain, callLLM, TIMEOUT_MS };
