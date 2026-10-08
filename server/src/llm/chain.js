/**
 * chain.js — LLM response chain with validation, retry, and fallback.
 * Enforces 1.2s hard timeout via AbortController.
 */

const { getModel } = require('./model');
const { buildPrompt } = require('./prompts');
const { validateResponse } = require('./validator');
const { getFallback } = require('./fallbacks');

const TIMEOUT_MS = 1200;

/**
 * Build structured LLM response for a given transcript and context.
 * @param {object} input
 * @param {string} input.transcript
 * @param {string} input.visitor_name
 * @param {string} input.arrival_time
 * @param {string} input.passive_cue
 * @param {string} input.timeOfDay
 * @param {string} input.language  'id' | 'en'
 * @returns {Promise<{text: string, parts: string[], _fallback: boolean, _theme: string}>}
 */
async function runChain(input) {
  const { transcript, visitor_name, arrival_time, passive_cue, timeOfDay, language = 'en' } = input;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const model = getModel();
    const prompt = buildPrompt({ transcript, visitor_name, arrival_time, passive_cue, timeOfDay, language });

    // First attempt
    const result = await callLLM(model, prompt, language, controller.signal);
    clearTimeout(timeout);
    return result;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      console.warn('LLM timeout — using fallback');
      return { ...getFallback(transcript, language), _fallback: true };
    }

    // Retry once
    try {
      const model = getModel();
      const prompt = buildPrompt({ transcript, visitor_name, arrival_time, passive_cue, timeOfDay, language });
      const result = await callLLM(model, prompt, language, undefined);
      return result;
    } catch {
      return { ...getFallback(transcript, language), _fallback: true };
    }
  }
}

async function callLLM(model, prompt, language, signal) {
  const chain = prompt.pipe(model);
  const raw = await chain.invoke({}, { signal });
  const content = raw?.content || '';

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON from LLM: ${content.slice(0, 100)}`);
  }

  const { valid, error } = validateResponse(parsed, language);
  if (!valid) {
    throw new Error(`Validation failed: ${error}`);
  }

  const parts = [parsed.validate, parsed.reassure, parsed.redirect].filter(Boolean);
  const text = parts.join(' ');

  return { text, parts, _fallback: false, _theme: null };
}

module.exports = { runChain, TIMEOUT_MS };
