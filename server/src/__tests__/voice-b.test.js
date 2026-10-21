/**
 * Part B (microphone): POST /api/respond with multipart audio → server STT → existing chain.
 * Runs a real Express app on an ephemeral port so multer parses a real multipart body.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));
jest.mock('../llm/chain', () => ({ runChain: jest.fn() }));
jest.mock('../llm/contextLoader', () => ({
  loadPatientContext: jest.fn(),
  loadRecentExchanges: jest.fn(async () => []),
  loadUpcomingRoutines: jest.fn(async () => []),
  jakartaTimeOfDay: jest.fn(() => '15:30'),
}));
jest.mock('../llm/interactionLogger', () => ({ logInteraction: jest.fn() }));
jest.mock('../services/sttService', () => {
  const actual = jest.requireActual('../services/sttService');
  return { ...actual, transcribe: jest.fn() };
});

const express = require('express');
const { query: mockQuery } = require('../db/query');
const { runChain } = require('../llm/chain');
const { loadPatientContext } = require('../llm/contextLoader');
const { logInteraction } = require('../llm/interactionLogger');
const stt = require('../services/sttService');
const respondRoutes = require('../routes/respond');

const actualStt = jest.requireActual('../services/sttService');

let server;
let base;
const io = { to: jest.fn(() => ({ volatile: { emit: jest.fn() } })) };

beforeAll(async () => {
  const app = express();
  app.set('io', io);
  app.use(express.json());
  app.use('/api/respond', respondRoutes);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(r => server.close(r)));

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [{ device_id: 3, patient_id: 5, language: 'id' }] }); // device auth
  loadPatientContext.mockResolvedValue({ language: 'id', daily_items: ['Timothy pulang jam 5'], permanent_items: [], max_speech_seconds: 10 });
  runChain.mockResolvedValue({ text: 'Kamu aman.', parts: ['Kamu aman.'] });
  logInteraction.mockResolvedValue({ id: 1, created_at: '2026-10-12T10:00:00.000Z' });
});

const WAV = Buffer.from('RIFF....WAVEfmt fake-audio-bytes');

function postAudio({ source = 'voice', bytes = WAV } = {}) {
  const form = new FormData();
  form.append('source', source);
  form.append('audio', new Blob([bytes], { type: 'audio/wav' }), 'speech.wav');
  return fetch(`${base}/api/respond`, { method: 'POST', headers: { 'x-device-token': 'tok' }, body: form });
}

describe('POST /api/respond with audio', () => {
  it('transcribes, runs the existing chain on the transcript only, logs source voice, returns {transcript, text, parts}', async () => {
    stt.transcribe.mockResolvedValue({ transcript: ' Timothy di mana? ', model: 'm' });
    const res = await postAudio();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ transcript: 'Timothy di mana?', text: 'Kamu aman.', parts: ['Kamu aman.'] });
    expect(typeof body.meta.stt_ms).toBe('number');

    const [audioArg, opts] = stt.transcribe.mock.calls[0];
    expect(Buffer.isBuffer(audioArg)).toBe(true);
    expect(audioArg.equals(WAV)).toBe(true);
    expect(opts).toEqual({ mimeType: 'audio/wav', language: 'id' });

    const chainInput = runChain.mock.calls[0][0];
    expect(chainInput.transcript).toBe('Timothy di mana?');
    expect(Object.values(chainInput).some(v => Buffer.isBuffer(v))).toBe(false); // audio never reaches the chain
    expect(logInteraction).toHaveBeenCalledWith(expect.objectContaining({ patientId: 5, transcript: 'Timothy di mana?', source: 'voice' }));
  });

  it.each(['', '   ', '[noise]', '(silence)', 'hmm', 'uh, um...', '.'])('gives no reply and logs nothing for transcript %j', async (t) => {
    stt.transcribe.mockResolvedValue({ transcript: t, model: 'm' });
    const res = await postAudio();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ transcript: '', text: null, parts: [], meta: { no_speech: true } });
    expect(runChain).not.toHaveBeenCalled();
    expect(logInteraction).not.toHaveBeenCalled();
  });

  it('502 with no reply and no log when transcription fails', async () => {
    stt.transcribe.mockRejectedValue(new actualStt.SttError('Gemini 500: boom', 'stt_upstream', 500));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await postAudio();
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Transcription failed', code: 'stt_upstream' });
    expect(runChain).not.toHaveBeenCalled();
    expect(logInteraction).not.toHaveBeenCalled();
  });

  it('rejects audio with a non-voice source and oversize uploads', async () => {
    expect((await postAudio({ source: 'typed' })).status).toBe(400);
    const big = await postAudio({ bytes: Buffer.alloc(respondRoutes.MAX_AUDIO_BYTES + 1) });
    expect(big.status).toBe(413);
    expect(stt.transcribe).not.toHaveBeenCalled();
  });

  it('JSON typed input still works and returns the transcript', async () => {
    const res = await fetch(`${base}/api/respond`, {
      method: 'POST',
      headers: { 'x-device-token': 'tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: 'Halo', source: 'typed' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ transcript: 'Halo', text: 'Kamu aman.' });
    expect(stt.transcribe).not.toHaveBeenCalled();
  });
});

describe('isJunkTranscript', () => {
  it.each([
    ['', true], ['  ', true], ['...', true], ['a', true], ['[music]', true], ['(background noise)', true],
    ['<inaudible>', true], ['Um... uh', true], ['[tidak ada suara]', true],
    ['Ya', false], ['Timothy di mana?', false], ['I want to go home', false], ['hmm, where is my bag', false],
  ])('%j → %s', (t, junk) => {
    expect(actualStt.isJunkTranscript(t)).toBe(junk);
  });
});

describe('transcribe (Gemini request)', () => {
  const okFetch = (text) => jest.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

  it('uses GEMINI_STT_MODEL, else GEMINI_MODEL; key only in the header; audio inline', async () => {
    const fetchImpl = okFetch('{"transcript":"Halo"}');
    const env = { GEMINI_API_KEY: 'test-key-123456', GEMINI_MODEL: 'chat-model', GEMINI_STT_MODEL: 'stt-model' };
    const r = await actualStt.transcribe(Buffer.from('abc'), { mimeType: 'audio/wav', language: 'id' }, { env, fetchImpl });
    expect(r).toEqual({ transcript: 'Halo', model: 'stt-model' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/models\/stt-model:generateContent$/);
    expect(url).not.toContain('test-key');
    expect(init.headers['x-goog-api-key']).toBe('test-key-123456');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'audio/wav', data: Buffer.from('abc').toString('base64') });
    expect(body.contents[0].parts[0].text).toMatch(/Indonesian/);
    expect(actualStt.sttModel({ GEMINI_MODEL: 'chat-model' })).toBe('chat-model');
  });

  it('empty candidate → empty transcript; missing key → stt_not_configured; HTTP error → stt_upstream without the key', async () => {
    const env = { GEMINI_API_KEY: 'test-key-123456' };
    expect((await actualStt.transcribe(Buffer.from('x'), {}, { env, fetchImpl: jest.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) }) })).transcript).toBe('');
    await expect(actualStt.transcribe(Buffer.from('x'), {}, { env: {} })).rejects.toMatchObject({ code: 'stt_not_configured' });
    const bad = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'bad key test-key-123456' } }) });
    const err = await actualStt.transcribe(Buffer.from('x'), {}, { env, fetchImpl: bad }).catch(e => e);
    expect(err.code).toBe('stt_upstream');
    expect(err.message).not.toContain('test-key-123456');
  });
});
