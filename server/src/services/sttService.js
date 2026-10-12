/**
 * sttService.js — server-side speech-to-text with Gemini audio input (works on every browser,
 * iPad Safari included). The audio is only sent to Gemini for transcription and never reaches the
 * LLM reply chain; callers drop the buffer right after (FR-4.2.5).
 *
 * Model: GEMINI_STT_MODEL, else GEMINI_MODEL. Key in the x-goog-api-key header (never in a URL).
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 6000;

class SttError extends Error {
  /** @param {string} code  stt_not_configured | stt_timeout | stt_upstream | stt_bad_response */
  constructor(message, code, status = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const LANGUAGE_NAMES = { id: 'Indonesian (Bahasa Indonesia)', en: 'English' };

function sttModel(env = process.env) {
  return (env.GEMINI_STT_MODEL || '').trim() || (env.GEMINI_MODEL || '').trim() || 'gemini-2.5-flash-lite';
}

function buildPrompt(language) {
  const name = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.en;
  return [
    `Transcribe the speech in this audio exactly as spoken. The speaker is an older adult speaking ${name}.`,
    'Write only the words that were said, in the language they were said, with normal punctuation.',
    'Do not translate, summarise, answer, correct or add anything.',
    'If there is no clear human speech (silence, breathing, background noise, music, TV, or unintelligible sounds), return an empty transcript.',
  ].join(' ');
}

// Bracketed/parenthesised tags models emit for non-speech, and filler-only utterances.
const NOISE_TAG = /^[\s([{<]*(noise|silence|music|inaudible|unintelligible|background( noise)?|no speech|blank_audio|breathing|cough(ing)?|laugh(ing|ter)?|sigh|tidak ada (suara|ucapan)|hening|suara latar)[\s)\]}>.]*$/i;
const FILLER_ONLY = /^(?:(?:uh+|um+|hm+|mm+|ah+|eh+|oh+|em+|erm+|hmm+)[\s,.!?…-]*)+$/i;

/** True when a transcript should get no reply (empty, punctuation-only, noise tags, fillers). */
function isJunkTranscript(text) {
  const t = String(text ?? '').trim();
  if (!t) return true;
  const letters = t.replace(/[^\p{L}\p{N}]/gu, '');
  if (letters.length < 2) return true;
  if (NOISE_TAG.test(t)) return true;
  if (FILLER_ONLY.test(t)) return true;
  return false;
}

function redact(message, env = process.env) {
  let out = String(message ?? '');
  const key = env.GEMINI_API_KEY;
  if (key && key.length >= 8) out = out.split(key).join('[redacted]');
  return out;
}

/**
 * @param {Buffer} audio      WAV (or any Gemini-supported audio) bytes
 * @param {object} opts
 * @param {string} opts.mimeType   e.g. 'audio/wav'
 * @param {string} opts.language   'id' | 'en'
 * @returns {Promise<{transcript: string, model: string}>}  transcript '' for silence/noise
 */
async function transcribe(audio, { mimeType = 'audio/wav', language = 'en' } = {}, { env = process.env, fetchImpl = fetch, timeoutMs } = {}) {
  const key = (env.GEMINI_API_KEY || '').trim();
  if (!key) throw new SttError('GEMINI_API_KEY is not set', 'stt_not_configured');
  const model = sttModel(env);
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: buildPrompt(language) },
        { inline_data: { mime_type: mimeType, data: Buffer.from(audio).toString('base64') } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 256,
      responseMimeType: 'application/json',
      responseSchema: { type: 'OBJECT', properties: { transcript: { type: 'STRING' } }, required: ['transcript'] },
    },
  };

  const controller = new AbortController();
  const limit = timeoutMs || Number(env.STT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), limit);
  let res;
  let json;
  try {
    res = await fetchImpl(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    json = await res.json().catch(() => null);
  } catch (err) {
    if (err.name === 'AbortError') throw new SttError(`transcription timed out after ${limit} ms`, 'stt_timeout');
    throw new SttError(redact(`transcription request failed: ${err.message}`, env), 'stt_upstream');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const msg = json?.error?.message || res.statusText || '';
    throw new SttError(redact(`Gemini ${res.status}: ${msg}`.slice(0, 300), env), 'stt_upstream', res.status);
  }
  const raw = (json?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!raw) return { transcript: '', model }; // blocked / empty candidate: treat as no speech
  let transcript;
  try {
    transcript = JSON.parse(raw).transcript;
  } catch {
    throw new SttError('transcription response was not JSON', 'stt_bad_response');
  }
  return { transcript: typeof transcript === 'string' ? transcript.trim() : '', model };
}

module.exports = { transcribe, isJunkTranscript, sttModel, buildPrompt, SttError };
