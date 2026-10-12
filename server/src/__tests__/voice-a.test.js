/**
 * Part A (audio out): voice selection, /api/voices, /api/tts.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));

const { query: mockQuery } = require('../db/query');
const { resolveVoiceId, listVoiceOptions, synthesizeStream, TtsError, redact } = require('../services/voiceService');
const ttsCtl = require('../controllers/ttsController');
const { deviceOrCaregiver } = require('../routes/tts');
const { ttsQuerySchema, putSettingsSchema } = require('../validators');

const ALL = {
  ELEVENLABS_VOICE_ID_ID_FEMALE: 'id-female-0001',
  ELEVENLABS_VOICE_ID_ID_MALE:   'id-male-0002',
  ELEVENLABS_VOICE_ID_EN_FEMALE: 'en-female-0003',
  ELEVENLABS_VOICE_ID_EN_MALE:   'en-male-0004',
  ELEVENLABS_VOICE_ID_ID:        'id-legacy-0005',
  ELEVENLABS_VOICE_ID_EN:        'en-legacy-0006',
};

function mockRes() {
  const res = { statusCode: 200, body: undefined, headers: {}, handlers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json   = (b) => { res.body = b; return res; };
  res.set    = (h) => { Object.assign(res.headers, h); return res; };
  res.on     = (e, fn) => { res.handlers[e] = fn; return res; };
  return res;
}

describe('resolveVoiceId', () => {
  it('picks the exact language + gender voice', () => {
    expect(resolveVoiceId('id', 'female', ALL)).toBe('id-female-0001');
    expect(resolveVoiceId('id', 'male', ALL)).toBe('id-male-0002');
    expect(resolveVoiceId('en', 'female', ALL)).toBe('en-female-0003');
    expect(resolveVoiceId('en', 'male', ALL)).toBe('en-male-0004');
  });

  it('falls back to the legacy per-language voice', () => {
    const env = { ELEVENLABS_VOICE_ID_ID: 'id-legacy-0005', ELEVENLABS_VOICE_ID_EN_MALE: 'en-male-0004', ELEVENLABS_VOICE_ID_EN: 'en-legacy-0006' };
    expect(resolveVoiceId('id', 'male', env)).toBe('id-legacy-0005');
    expect(resolveVoiceId('en', 'female', env)).toBe('en-legacy-0006');
    expect(resolveVoiceId('en', 'male', env)).toBe('en-male-0004');
  });

  it('falls back to the other gender of the same language when nothing else is set', () => {
    expect(resolveVoiceId('id', 'male', { ELEVENLABS_VOICE_ID_ID_FEMALE: 'id-female-0001' })).toBe('id-female-0001');
    expect(resolveVoiceId('en', 'female', { ELEVENLABS_VOICE_ID_EN_MALE: 'en-male-0004' })).toBe('en-male-0004');
  });

  it('never crosses languages', () => {
    expect(resolveVoiceId('id', 'female', { ELEVENLABS_VOICE_ID_EN_FEMALE: 'en-female-0003' })).toBeNull();
  });

  it('defaults an unknown gender to female and an unknown language to en', () => {
    expect(resolveVoiceId('id', undefined, ALL)).toBe('id-female-0001');
    expect(resolveVoiceId('fr', 'male', ALL)).toBe('en-male-0004');
  });

  it('ignores empty and whitespace values', () => {
    expect(resolveVoiceId('en', 'female', { ELEVENLABS_VOICE_ID_EN_FEMALE: '  ', ELEVENLABS_VOICE_ID_EN: '' })).toBeNull();
  });
});

describe('GET /api/voices', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('lists language × gender with an available flag and never a voice ID', () => {
    for (const k of Object.keys(process.env)) if (k.startsWith('ELEVENLABS_')) delete process.env[k];
    Object.assign(process.env, { ELEVENLABS_API_KEY: 'sk_test_key_123456', ELEVENLABS_VOICE_ID_ID_FEMALE: 'id-female-0001', ELEVENLABS_VOICE_ID_EN: 'en-legacy-0006' });
    const res = mockRes();
    ttsCtl.getVoices({}, res);
    expect(res.body).toEqual({ voices: [
      { language: 'id', gender: 'female', available: true },
      { language: 'id', gender: 'male',   available: false },
      { language: 'en', gender: 'female', available: true },
      { language: 'en', gender: 'male',   available: true },
    ] });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/0001|0006|sk_test/);
    expect(res.body.voices.every(v => Object.keys(v).sort().join() === 'available,gender,language')).toBe(true);
  });

  it('marks every option unavailable without an API key', () => {
    expect(listVoiceOptions(ALL).every(v => v.available === false)).toBe(true);
  });
});

describe('/api/tts validation', () => {
  it('requires text, trims it, and caps it at 300 characters', () => {
    expect(ttsQuerySchema.safeParse({}).success).toBe(false);
    expect(ttsQuerySchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(ttsQuerySchema.safeParse({ text: 'a'.repeat(301) }).success).toBe(false);
    expect(ttsQuerySchema.safeParse({ text: 'a'.repeat(300) }).success).toBe(true);
    expect(ttsQuerySchema.safeParse({ text: '  hi ' }).data.text).toBe('hi');
  });

  it('accepts voice_gender female|male in PUT /api/settings', () => {
    expect(putSettingsSchema.safeParse({ patientId: 1, voice_gender: 'male' }).success).toBe(true);
    expect(putSettingsSchema.safeParse({ patientId: 1, voice_gender: 'robot' }).success).toBe(false);
  });

  it('401 without a device token or JWT', () => {
    const res = mockRes();
    const next = jest.fn();
    deviceOrCaregiver({ headers: {}, query: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('takes the device token from ?token= for <audio> elements', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ device_id: 3, patient_id: 5, language: 'id' }] });
    const req = { headers: {}, query: { token: 'tok' } };
    const next = jest.fn();
    await deviceOrCaregiver(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req).toMatchObject({ deviceId: 3, patientId: 5, language: 'id' });
  });

  it('caregiver requests need a patientId', async () => {
    const res = mockRes();
    await ttsCtl.getTts({ caregiverId: 1, validQuery: { text: 'hello' } }, res);
    expect(res.statusCode).toBe(400);
  });

  it('caregiver requests are ownership-checked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ caregiver_id: 999 }] });
    const res = mockRes();
    await ttsCtl.getTts({ caregiverId: 1, validQuery: { text: 'hello', patientId: 5 } }, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('/api/tts without a key or voice', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    ttsCtl.resetRateLimits();
    for (const k of Object.keys(process.env)) if (k.startsWith('ELEVENLABS_')) delete process.env[k];
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{}] }); // settings row → defaults
  });
  afterEach(() => { process.env = { ...saved }; });

  const deviceReq = (id = 3) => ({ deviceId: id, patientId: 5, language: 'en', validQuery: { text: 'You are safe.' } });

  it('503 tts_not_configured when ELEVENLABS_API_KEY is missing', async () => {
    const res = mockRes();
    await ttsCtl.getTts(deviceReq(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: 'Voice unavailable', code: 'tts_not_configured' });
  });

  it('503 voice_not_configured when the language has no voice', async () => {
    process.env.ELEVENLABS_API_KEY = 'sk_test_key_123456';
    process.env.ELEVENLABS_VOICE_ID_ID_FEMALE = 'id-female-0001';
    const res = mockRes();
    await ttsCtl.getTts(deviceReq(), res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('voice_not_configured');
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test|0001/);
  });

  it('rate-limits per device', async () => {
    for (let i = 0; i < ttsCtl.RATE_LIMIT; i++) await ttsCtl.getTts(deviceReq(), mockRes());
    const limited = mockRes();
    await ttsCtl.getTts(deviceReq(), limited);
    expect(limited.statusCode).toBe(429);
    const other = mockRes();
    await ttsCtl.getTts(deviceReq(4), other);
    expect(other.statusCode).toBe(503); // another device has its own budget
  });
});

describe('synthesizeStream', () => {
  const env = { ELEVENLABS_API_KEY: 'sk_test_key_123456', ELEVENLABS_VOICE_ID_EN_MALE: 'en-male-0004' };

  it('calls ElevenLabs with the resolved voice, model and speed; key only in the header', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, body: {} });
    await synthesizeStream({ text: 'Hi', language: 'en', gender: 'male', playbackSpeed: 0.9 }, { env, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/text-to-speech/en-male-0004/stream');
    expect(url).not.toContain('sk_test');
    expect(init.headers['xi-api-key']).toBe('sk_test_key_123456');
    expect(JSON.parse(init.body)).toEqual({ text: 'Hi', model_id: 'eleven_multilingual_v2', voice_settings: { speed: 0.9 } });
  });

  it('turns an upstream error into a TtsError with secrets redacted', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key sk_test_key_123456 for en-male-0004' });
    const err = await synthesizeStream({ text: 'Hi', language: 'en', gender: 'male' }, { env, fetchImpl }).catch(e => e);
    expect(err).toBeInstanceOf(TtsError);
    expect(err.code).toBe('tts_upstream');
    expect(err.message).not.toMatch(/sk_test|0004/);
  });

  it('redact() removes every ElevenLabs env value', () => {
    expect(redact('x en-male-0004 y', env)).toBe('x [redacted] y');
  });
});
