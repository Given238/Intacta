/**
 * voiceService.js — ElevenLabs voice selection and text-to-speech (server only, FR-4.4.1).
 *
 * Voices come from env, one per language × gender, all optional:
 *   ELEVENLABS_VOICE_ID_{ID|EN}_{FEMALE|MALE}, with the legacy ELEVENLABS_VOICE_ID_{ID|EN} as fallback.
 * Voice IDs and the API key never leave the server: /api/voices only reports whether an option is available.
 */

const LANGUAGES = ['id', 'en'];
const VOICE_GENDERS = ['female', 'male'];
const DEFAULT_GENDER = 'female';
const DEFAULT_MODEL_ID = 'eleven_multilingual_v2';
const TTS_MAX_CHARS = 300;
const ELEVENLABS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const FIRST_BYTE_TIMEOUT_MS = 8000;

class TtsError extends Error {
  /** @param {string} code  tts_not_configured | voice_not_configured | tts_upstream | tts_timeout */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Voice ID for a language and gender. Order: exact match → legacy per-language ID →
 * same language, other gender. Unknown language → en; unknown gender → female. Null when none is set.
 */
function resolveVoiceId(language, gender, env = process.env) {
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const g = VOICE_GENDERS.includes(gender) ? gender : DEFAULT_GENDER;
  const other = g === 'female' ? 'male' : 'female';
  const L = lang.toUpperCase();
  return pick(env[`ELEVENLABS_VOICE_ID_${L}_${g.toUpperCase()}`])
      || pick(env[`ELEVENLABS_VOICE_ID_${L}`])
      || pick(env[`ELEVENLABS_VOICE_ID_${L}_${other.toUpperCase()}`]);
}

/** True only when this exact gender has its own voice (or the legacy per-language one). */
function hasOwnVoice(language, gender, env = process.env) {
  const L = language.toUpperCase();
  return Boolean(pick(env[`ELEVENLABS_VOICE_ID_${L}_${gender.toUpperCase()}`]) || pick(env[`ELEVENLABS_VOICE_ID_${L}`]));
}

/** Options for the portal dropdown. Never contains a voice ID. */
function listVoiceOptions(env = process.env) {
  const keySet = Boolean(pick(env.ELEVENLABS_API_KEY));
  return LANGUAGES.flatMap(language => VOICE_GENDERS.map(gender => ({
    language,
    gender,
    available: keySet && hasOwnVoice(language, gender, env),
  })));
}

/** Remove secrets from an upstream error message before it is logged. */
function redact(message, env = process.env) {
  let out = String(message ?? '');
  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith('ELEVENLABS_') && pick(v) && v.length >= 8) out = out.split(v).join('[redacted]');
  }
  return out;
}

/**
 * Start an ElevenLabs stream. Resolves with the fetch Response (ok, body = audio/mpeg) once the
 * first headers arrive; throws TtsError otherwise. The caller pipes the body to the client.
 */
async function synthesizeStream({ text, language, gender, playbackSpeed }, { env = process.env, fetchImpl = fetch, signal } = {}) {
  const apiKey = pick(env.ELEVENLABS_API_KEY);
  if (!apiKey) throw new TtsError('TTS is not configured', 'tts_not_configured');
  const voiceId = resolveVoiceId(language, gender, env);
  if (!voiceId) throw new TtsError('No voice configured for this language', 'voice_not_configured');

  const speed = Number(playbackSpeed);
  const body = {
    text,
    model_id: pick(env.ELEVENLABS_MODEL_ID) || DEFAULT_MODEL_ID,
    // ElevenLabs speed range is 0.7–1.2; patient_settings keeps 0.85–1.0.
    ...(speed > 0 && speed !== 1 ? { voice_settings: { speed: Math.min(1.2, Math.max(0.7, speed)) } } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FIRST_BYTE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  let res;
  try {
    res = await fetchImpl(`${ELEVENLABS_URL}/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const code = err.name === 'AbortError' ? 'tts_timeout' : 'tts_upstream';
    throw new TtsError(redact(`ElevenLabs request failed: ${err.message}`, env), code);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (!res.ok || !res.body) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new TtsError(redact(`ElevenLabs ${res.status}: ${detail}`, env), 'tts_upstream');
  }
  return res;
}

module.exports = {
  LANGUAGES,
  VOICE_GENDERS,
  DEFAULT_GENDER,
  TTS_MAX_CHARS,
  TtsError,
  resolveVoiceId,
  listVoiceOptions,
  synthesizeStream,
  redact,
};
