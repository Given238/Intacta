/**
 * Phase 3b backend tests — context items, settings, patient status, interactions,
 * routine title/days, broadcast:message, voice:test and the per-patient word cap.
 * db/query, audit and the interaction logger are mocked; queries are answered by SQL text.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));
jest.mock('../services/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../llm/interactionLogger', () => ({ logInteraction: jest.fn() }));
jest.mock('../llm/model', () => ({ getStructuredModel: jest.fn() }));

const { RunnableLambda } = require('@langchain/core/runnables');
const { query: mockQuery } = require('../db/query');
const { logAudit }         = require('../services/audit');
const { logInteraction }   = require('../llm/interactionLogger');
const { getStructuredModel } = require('../llm/model');

const contextItems = require('../controllers/contextItemsController');
const settingsCtl  = require('../controllers/settingsController');
const patientCtl   = require('../controllers/patientController');
const devicesCtl   = require('../controllers/devicesController');
const routinesCtl  = require('../controllers/routinesController');
const { handleBroadcast, handleVoiceTest } = require('../socket');
const {
  createContextItemSchema, updateContextItemSchema, putSettingsSchema,
  createRoutineSchema, updateRoutineSchema, contextItemsQuerySchema, interactionsQuerySchema,
  validateQuery,
} = require('../validators');
const { buildPrompt, wordCapFor } = require('../llm/prompts');
const { runChain } = require('../llm/chain');
const { loadPatientContext } = require('../llm/contextLoader');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  res.send   = jest.fn(() => res);
  return res;
}

function makeIO() {
  const emitted = [];
  return {
    emitted,
    to(room) {
      return {
        emit(event, data) { emitted.push({ room, event, data, volatile: false }); },
        volatile: { emit(event, data) { emitted.push({ room, event, data, volatile: true }); } },
      };
    },
  };
}

const appWith = (io) => ({ get: (k) => (k === 'io' ? io : undefined) });

/** Answer db queries by matching SQL text; unmatched queries return no rows. */
function routeQueries(routes) {
  mockQuery.mockImplementation(async (sql) => {
    const hit = routes.find(([re]) => re.test(sql));
    return hit ? { rows: typeof hit[1] === 'function' ? hit[1]() : hit[1] } : { rows: [] };
  });
}

// caregiver 1 owns patient 5; patient 6 belongs to caregiver 999
const OWNER = [/SELECT caregiver_id FROM patients WHERE id/, () => []];
function owns(patientCaregiver) {
  return [/SELECT caregiver_id FROM patients WHERE id/, [{ caregiver_id: patientCaregiver }]];
}
const SNAPSHOT_ROUTES = [
  [/SELECT name, language FROM patients/, [{ name: 'Eleanor Vance', language: 'en' }]],
  [/FROM context_items WHERE/, [{ id: 1, scope: 'daily', text: 'Soup at 1' }, { id: 2, scope: 'permanent', text: 'Depe' }]],
];

beforeEach(() => {
  mockQuery.mockReset();
  logAudit.mockReset();
  logInteraction.mockReset();
});

// ── Validation at the boundary ────────────────────────────────────────────────
describe('zod schemas', () => {
  it('context item: scope must be daily|permanent, text 1–200 chars', () => {
    expect(createContextItemSchema.safeParse({ patientId: 5, scope: 'daily', text: 'Soup' }).success).toBe(true);
    expect(createContextItemSchema.safeParse({ patientId: 5, scope: 'weekly', text: 'Soup' }).success).toBe(false);
    expect(createContextItemSchema.safeParse({ patientId: 5, scope: 'daily', text: '   ' }).success).toBe(false);
    expect(createContextItemSchema.safeParse({ patientId: 5, scope: 'daily', text: 'x'.repeat(201) }).success).toBe(false);
    expect(updateContextItemSchema.safeParse({ text: 'x'.repeat(200) }).success).toBe(true);
  });

  it('settings: ranges enforced and at least one setting required', () => {
    const ok = (b) => putSettingsSchema.safeParse({ patientId: 5, ...b }).success;
    expect(ok({ max_speech_seconds: 0 })).toBe(true);
    expect(ok({ max_speech_seconds: 15 })).toBe(true);
    expect(ok({ max_speech_seconds: 16 })).toBe(false);
    expect(ok({ playback_speed: 0.85 })).toBe(true);
    expect(ok({ playback_speed: 0.8 })).toBe(false);
    expect(ok({ playback_speed: 1.1 })).toBe(false);
    expect(ok({ volume_db: 60 })).toBe(true);
    expect(ok({ volume_db: 71 })).toBe(false);
    expect(ok({ strict_validation: false })).toBe(true);
    expect(ok({})).toBe(false);
  });

  it('routines: title + days (0=Sun..6=Sat, unique, non-empty)', () => {
    const base = { patientId: 5, trigger_time: '08:00', category: 'meal' };
    expect(createRoutineSchema.safeParse({ ...base, title: 'Lunch Time', days: [1, 3, 5] }).success).toBe(true);
    expect(createRoutineSchema.safeParse(base).success).toBe(true);
    expect(createRoutineSchema.safeParse({ ...base, days: [7] }).success).toBe(false);
    expect(createRoutineSchema.safeParse({ ...base, days: [1, 1] }).success).toBe(false);
    expect(createRoutineSchema.safeParse({ ...base, days: [] }).success).toBe(false);
    expect(updateRoutineSchema.safeParse({ days: [0, 6] }).success).toBe(true);
  });

  it('query strings: patientId coerced, scope and paging validated with a field-level 400', () => {
    expect(contextItemsQuerySchema.safeParse({ patientId: '5', scope: 'permanent' }).data).toEqual({ patientId: 5, scope: 'permanent' });
    expect(interactionsQuerySchema.safeParse({ patientId: '5' }).data).toEqual({ patientId: 5, limit: 20 });
    expect(interactionsQuerySchema.safeParse({ patientId: '5', limit: '500' }).success).toBe(false);
    const res = makeRes();
    const next = jest.fn();
    validateQuery(contextItemsQuerySchema)({ query: { patientId: 'abc' } }, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].errors[0].path).toBe('patientId');
    expect(next).not.toHaveBeenCalled();
  });
});

// ── /api/context-items ───────────────────────────────────────────────────────
describe('CRUD /api/context-items', () => {
  it('GET lists items with the scope filter', async () => {
    routeQueries([owns(1), [/FROM context_items WHERE/, [{ id: 2, scope: 'permanent', text: 'Depe' }]]]);
    const res = makeRes();
    await contextItems.listContextItems({ caregiverId: 1, validQuery: { patientId: 5, scope: 'permanent' } }, res);
    expect(res.json).toHaveBeenCalledWith({ items: [{ id: 2, scope: 'permanent', text: 'Depe' }] });
    const call = mockQuery.mock.calls.find(c => /context_items/.test(c[0]));
    expect(call[0]).toMatch(/scope = \$2/);
    expect(call[1]).toEqual([5, 'permanent']);
  });

  it.each([[404, []], [403, [{ caregiver_id: 999 }]]])('GET returns %i for a patient the caregiver does not own', async (code, rows) => {
    routeQueries([[/SELECT caregiver_id FROM patients WHERE id/, rows]]);
    const res = makeRes();
    await contextItems.listContextItems({ caregiverId: 1, validQuery: { patientId: 6 } }, res);
    expect(res.status).toHaveBeenCalledWith(code);
    expect(mockQuery.mock.calls.some(c => /context_items/.test(c[0]))).toBe(false);
  });

  it('POST creates, audits and emits a non-volatile context:sync to patient:{id}', async () => {
    routeQueries([
      owns(1),
      [/INSERT INTO context_items/, [{ id: 3, patient_id: 5, scope: 'daily', text: 'Soup at 1' }]],
      ...SNAPSHOT_ROUTES,
    ]);
    const io = makeIO();
    const res = makeRes();
    await contextItems.createContextItem({
      caregiverId: 1, body: { patientId: 5, scope: 'daily', text: 'Soup at 1' }, app: appWith(io),
    }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ caregiverId: 1, action: 'context_item.create' }));
    expect(io.emitted).toEqual([{
      room: 'patient:5', event: 'context:sync', volatile: false,
      data: {
        payload: {
          patient_name: 'Eleanor Vance', language: 'en',
          daily: [{ id: 1, text: 'Soup at 1' }], permanent: [{ id: 2, text: 'Depe' }],
        },
        updated_at: expect.any(String),
      },
    }]);
  });

  it('POST returns 403 for another caregiver\'s patient and writes nothing', async () => {
    routeQueries([owns(999)]);
    const io = makeIO();
    const res = makeRes();
    await contextItems.createContextItem({
      caregiverId: 1, body: { patientId: 6, scope: 'daily', text: 'x' }, app: appWith(io),
    }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(c => /INSERT/.test(c[0]))).toBe(false);
    expect(io.emitted).toEqual([]);
  });

  it('PUT updates own item, audits and emits context:sync', async () => {
    routeQueries([
      [/FROM context_items ci JOIN patients/, [{ id: 3, patient_id: 5, scope: 'daily', text: 'old', caregiver_id: 1 }]],
      [/UPDATE context_items/, [{ id: 3, patient_id: 5, scope: 'daily', text: 'new' }]],
      ...SNAPSHOT_ROUTES,
    ]);
    const io = makeIO();
    const res = makeRes();
    await contextItems.updateContextItem({ caregiverId: 1, params: { id: '3' }, body: { text: 'new' }, app: appWith(io) }, res);
    expect(res.json).toHaveBeenCalledWith({ item: { id: 3, patient_id: 5, scope: 'daily', text: 'new' } });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'context_item.update' }));
    expect(io.emitted[0]).toEqual(expect.objectContaining({ room: 'patient:5', event: 'context:sync', volatile: false }));
  });

  it.each([
    ['updateContextItem', { body: { text: 'x' } }],
    ['deleteContextItem', {}],
  ])('%s: 403 for another caregiver\'s item, 404 for a missing one, 400 for a bad id', async (fn, extra) => {
    routeQueries([[/FROM context_items ci JOIN patients/, [{ id: 3, patient_id: 6, caregiver_id: 999 }]]]);
    let res = makeRes();
    await contextItems[fn]({ caregiverId: 1, params: { id: '3' }, app: appWith(makeIO()), ...extra }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockQuery.mock.calls.some(c => /UPDATE|DELETE/.test(c[0]))).toBe(false);

    routeQueries([]);
    res = makeRes();
    await contextItems[fn]({ caregiverId: 1, params: { id: '3' }, app: appWith(makeIO()), ...extra }, res);
    expect(res.status).toHaveBeenCalledWith(404);

    res = makeRes();
    await contextItems[fn]({ caregiverId: 1, params: { id: 'abc' }, app: appWith(makeIO()), ...extra }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('DELETE removes own item, audits, emits context:sync and returns 204', async () => {
    routeQueries([
      [/FROM context_items ci JOIN patients/, [{ id: 3, patient_id: 5, caregiver_id: 1 }]],
      ...SNAPSHOT_ROUTES,
    ]);
    const io = makeIO();
    const res = makeRes();
    await contextItems.deleteContextItem({ caregiverId: 1, params: { id: '3' }, app: appWith(io) }, res);
    expect(mockQuery.mock.calls.some(c => /DELETE FROM context_items/.test(c[0]))).toBe(true);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'context_item.delete' }));
    expect(io.emitted[0]).toEqual(expect.objectContaining({ event: 'context:sync', volatile: false }));
  });

  it('DB error → typed 500, never thrown', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const res = makeRes();
    await contextItems.listContextItems({ caregiverId: 1, validQuery: { patientId: 5 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── /api/settings ────────────────────────────────────────────────────────────
describe('GET/PUT /api/settings', () => {
  it('GET returns defaults when the patient has no settings row', async () => {
    routeQueries([owns(1), [/patient_settings/, [{}]]]);
    const res = makeRes();
    await settingsCtl.getSettings({ caregiverId: 1, validQuery: { patientId: 5 } }, res);
    expect(res.json).toHaveBeenCalledWith({ settings: {
      strict_validation: true, max_speech_seconds: 10, voice_gender: 'female',
      playback_speed: 1, volume_db: 65, updated_at: null,
    } });
  });

  it.each([[404, []], [403, [{ caregiver_id: 999 }]]])('GET returns %i when not the owner', async (code, rows) => {
    routeQueries([[/SELECT caregiver_id FROM patients WHERE id/, rows]]);
    const res = makeRes();
    await settingsCtl.getSettings({ caregiverId: 1, validQuery: { patientId: 6 } }, res);
    expect(res.status).toHaveBeenCalledWith(code);
  });

  it('PUT upserts only the provided keys, audits and emits non-volatile settings:sync', async () => {
    routeQueries([
      owns(1),
      [/INSERT INTO patient_settings/, [{ patient_id: 5, strict_validation: false, max_speech_seconds: 6, playback_speed: '0.90', volume_db: 65, updated_at: 'T' }]],
    ]);
    const io = makeIO();
    const res = makeRes();
    await settingsCtl.putSettings({
      caregiverId: 1, body: { patientId: 5, strict_validation: false, max_speech_seconds: 6 }, app: appWith(io),
    }, res);
    const [sql, params] = mockQuery.mock.calls.find(c => /INSERT INTO patient_settings/.test(c[0]));
    expect(sql).toMatch(/\(patient_id, strict_validation, max_speech_seconds\)/);
    expect(sql).not.toMatch(/volume_db/);
    expect(params).toEqual([5, false, 6]);
    expect(res.json.mock.calls[0][0].settings).toEqual(expect.objectContaining({ playback_speed: 0.9, max_speech_seconds: 6 }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'settings.update' }));
    expect(io.emitted).toEqual([expect.objectContaining({
      room: 'patient:5', event: 'settings:sync', volatile: false,
      data: { payload: expect.objectContaining({ strict_validation: false, max_speech_seconds: 6 }), updated_at: 'T' },
    })]);
  });

  it('PUT returns 403 for another caregiver\'s patient', async () => {
    routeQueries([owns(999)]);
    const io = makeIO();
    const res = makeRes();
    await settingsCtl.putSettings({ caregiverId: 1, body: { patientId: 6, volume_db: 70 }, app: appWith(io) }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(io.emitted).toEqual([]);
  });
});

// ── /api/patient/status and /api/interactions ────────────────────────────────
describe('GET /api/patient/status', () => {
  it('returns patient name, device name, online and battery', async () => {
    routeQueries([owns(1), [/LEFT JOIN LATERAL/, [{
      patient_id: 5, patient_name: 'Eleanor Vance', language: 'en',
      device_id: 9, device_name: 'Tablet - Ruang Tamu', is_online: true, battery: 82, last_seen_at: 'T',
    }]]]);
    const res = makeRes();
    await patientCtl.getPatientStatus({ caregiverId: 1, validQuery: { patientId: 5 } }, res);
    expect(res.json).toHaveBeenCalledWith({ status: {
      patient_id: 5, patient_name: 'Eleanor Vance', language: 'en',
      device: { id: 9, name: 'Tablet - Ruang Tamu', online: true, battery: 82, last_seen_at: 'T' },
    } });
  });

  it('device is null when no device is paired', async () => {
    routeQueries([owns(1), [/LEFT JOIN LATERAL/, [{ patient_id: 5, patient_name: 'Eleanor Vance', language: 'en', device_id: null }]]]);
    const res = makeRes();
    await patientCtl.getPatientStatus({ caregiverId: 1, validQuery: { patientId: 5 } }, res);
    expect(res.json.mock.calls[0][0].status.device).toBeNull();
  });

  it.each([[404, []], [403, [{ caregiver_id: 999 }]]])('returns %i when not the owner', async (code, rows) => {
    routeQueries([[/SELECT caregiver_id FROM patients WHERE id/, rows]]);
    const res = makeRes();
    await patientCtl.getPatientStatus({ caregiverId: 1, validQuery: { patientId: 6 } }, res);
    expect(res.status).toHaveBeenCalledWith(code);
  });
});

describe('GET /api/interactions (paged)', () => {
  const rows = (ids) => ids.map(id => ({ id, transcript: `t${id}`, source: 'voice' }));

  it('returns newest first with next_before when more pages exist', async () => {
    routeQueries([owns(1), [/FROM interaction_logs/, rows([10, 9, 8])]]);
    const res = makeRes();
    await patientCtl.listInteractions({ caregiverId: 1, validQuery: { patientId: 5, limit: 2 } }, res);
    expect(res.json).toHaveBeenCalledWith({ interactions: rows([10, 9]), next_before: 9 });
    const [sql, params] = mockQuery.mock.calls.find(c => /interaction_logs/.test(c[0]));
    expect(sql).toMatch(/ORDER BY id DESC/);
    expect(params).toEqual([5, 3]);
  });

  it('uses the before cursor and ends with next_before null', async () => {
    routeQueries([owns(1), [/FROM interaction_logs/, rows([8])]]);
    const res = makeRes();
    await patientCtl.listInteractions({ caregiverId: 1, validQuery: { patientId: 5, limit: 2, before: 9 } }, res);
    expect(res.json).toHaveBeenCalledWith({ interactions: rows([8]), next_before: null });
    const [sql, params] = mockQuery.mock.calls.find(c => /interaction_logs/.test(c[0]));
    expect(sql).toMatch(/id < \$3/);
    expect(params).toEqual([5, 3, 9]);
  });

  it('returns 403 for another caregiver\'s patient', async () => {
    routeQueries([owns(999)]);
    const res = makeRes();
    await patientCtl.listInteractions({ caregiverId: 1, validQuery: { patientId: 6, limit: 20 } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ── Terminal settings ────────────────────────────────────────────────────────
describe('GET /api/device/settings', () => {
  it('returns the paired patient\'s settings', async () => {
    routeQueries([[/patient_settings/, [{ max_speech_seconds: 12, volume_db: 68, playback_speed: '0.95' }]]]);
    const res = makeRes();
    await devicesCtl.getDeviceSettings({ patientId: 5 }, res);
    expect(res.json.mock.calls[0][0].settings).toEqual(expect.objectContaining({
      max_speech_seconds: 12, volume_db: 68, playback_speed: 0.95, strict_validation: true,
    }));
  });
});

// ── Routines title + days ────────────────────────────────────────────────────
describe('routines accept title and days', () => {
  it('create stores title and days', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, caregiver_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Lunch Time', days: [1, 2] }] });
    const res = makeRes();
    await routinesCtl.createRoutine({ caregiverId: 1, body: {
      patientId: 5, title: 'Lunch Time', days: [1, 2], trigger_time: '12:30', category: 'meal',
    } }, res);
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/title, days/);
    expect(params.slice(0, 3)).toEqual([5, 'Lunch Time', [1, 2]]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('create without days defaults to every day', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, caregiver_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await routinesCtl.createRoutine({ caregiverId: 1, body: { patientId: 5, trigger_time: '12:30', category: 'meal' } }, makeRes());
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/COALESCE\(\$3::smallint\[\], '\{0,1,2,3,4,5,6\}'\)/);
    expect(params[2]).toBeNull();
  });

  it('update passes title and days', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1, caregiver_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] });
    await routinesCtl.updateRoutine({ caregiverId: 1, params: { id: '1' }, body: { title: 'Brunch', days: [0, 6] } }, makeRes());
    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/title = COALESCE\(\$6, title\)/);
    expect(params.slice(5)).toEqual(['Brunch', [0, 6], '1']);
  });
});

// ── Socket: broadcast:message and voice:test ─────────────────────────────────
describe('Socket broadcast:message', () => {
  it('emits broadcast:message + interaction:new to patient:{id}, logs source=broadcast and audits', async () => {
    routeQueries([owns(1)]);
    logInteraction.mockResolvedValue({ created_at: 'T' });
    const io = makeIO();
    const ack = jest.fn();
    await handleBroadcast(io, { caregiverId: 1, emit: jest.fn() })({ patientId: 5, text: '  Dinner is at six.  ' }, ack);
    expect(io.emitted).toEqual([
      { room: 'patient:5', event: 'broadcast:message', volatile: false, data: { text: 'Dinner is at six.', created_at: 'T' } },
      expect.objectContaining({ room: 'patient:5', event: 'interaction:new', data: expect.objectContaining({ source: 'broadcast' }) }),
    ]);
    expect(logInteraction).toHaveBeenCalledWith(expect.objectContaining({ patientId: 5, source: 'broadcast' }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ caregiverId: 1, action: 'broadcast.send' }));
    expect(ack).toHaveBeenCalledWith({ success: true });
  });

  it('refuses another caregiver\'s patient', async () => {
    routeQueries([owns(999)]);
    const io = makeIO();
    const ack = jest.fn();
    await handleBroadcast(io, { caregiverId: 1, emit: jest.fn() })({ patientId: 6, text: 'Hi' }, ack);
    expect(io.emitted).toEqual([]);
    expect(logInteraction).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledWith({ success: false, error: 'Access denied to this patient' });
  });

  it.each([[''], ['   '], ['x'.repeat(201)], [undefined]])('rejects text %p', async (text) => {
    const io = makeIO();
    const ack = jest.fn();
    await handleBroadcast(io, { caregiverId: 1, emit: jest.fn() })({ patientId: 5, text }, ack);
    expect(io.emitted).toEqual([]);
    expect(ack).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('Socket voice:test', () => {
  it('emits voice:test with the patient\'s voice settings in their language', async () => {
    routeQueries([
      owns(1),
      [/patient_settings/, [{ voice_id: 'legacy-id', voice_gender: 'male', playback_speed: '0.90', volume_db: 62 }]],
      [/SELECT name, language FROM patients/, [{ name: 'Ibu', language: 'id' }]],
    ]);
    const io = makeIO();
    const ack = jest.fn();
    await handleVoiceTest(io, { caregiverId: 1, emit: jest.fn() })({ patientId: 5 }, ack);
    expect(io.emitted).toEqual([{
      room: 'patient:5', event: 'voice:test', volatile: false,
      data: { text: 'Halo. Seperti inilah suara saya.', language: 'id', voice_gender: 'male', playback_speed: 0.9, volume_db: 62 },
    }]);
    expect(ack).toHaveBeenCalledWith({ success: true });
  });

  it('refuses another caregiver\'s patient and a missing patientId', async () => {
    routeQueries([owns(999)]);
    const io = makeIO();
    const ack = jest.fn();
    await handleVoiceTest(io, { caregiverId: 1, emit: jest.fn() })({ patientId: 6 }, ack);
    await handleVoiceTest(io, { caregiverId: 1, emit: jest.fn() })({}, ack);
    expect(io.emitted).toEqual([]);
    expect(ack).toHaveBeenNthCalledWith(1, expect.objectContaining({ success: false }));
    expect(ack).toHaveBeenNthCalledWith(2, expect.objectContaining({ success: false }));
  });
});

// ── LLM: context items in the prompt + word cap ──────────────────────────────
describe('LLM prompt and word cap', () => {
  it('wordCapFor = min(25, round(s * 2.5)); 0 or missing → 25', () => {
    expect(wordCapFor(0)).toBe(25);
    expect(wordCapFor(null)).toBe(25);
    expect(wordCapFor(undefined)).toBe(25);
    expect(wordCapFor(4)).toBe(10);
    expect(wordCapFor(5)).toBe(13); // 12.5 rounds up
    expect(wordCapFor(10)).toBe(25);
    expect(wordCapFor(15)).toBe(25);
  });

  it('prompt contains today\'s daily + permanent items and the cap, and formats without template errors', async () => {
    const prompt = buildPrompt({
      transcript: 'Where is {Timothy}?', language: 'en', maxWords: 15, timeOfDay: '14:00',
      daily_items: ['Neighbour dropping off fresh soup around 1:00 P.M.'],
      permanent_items: ['Depe (Therapy Dog - needs yard walk 2x/day)'],
    });
    const text = await prompt.format({});
    expect(text).toMatch(/Maximum 15 words/);
    expect(text).toMatch(/Today's context:\n- Neighbour dropping off fresh soup around 1:00 P\.M\./);
    expect(text).toMatch(/Permanent context:\n- Depe \(Therapy Dog - needs yard walk 2x\/day\)/);
    expect(text).toMatch(/"validate":/);
    expect(text).toMatch(/\{Timothy\}/);
  });

  it('FR-4.3.5: no items → generic context line, never an error', async () => {
    const text = await buildPrompt({ transcript: 'Halo', language: 'id', daily_items: [], permanent_items: undefined }).format({});
    expect(text).toMatch(/Tidak ada konteks dari caregiver hari ini\./);
    expect(text).toMatch(/Maksimum 25 kata/);
  });

  it('contextLoader returns items + max_speech_seconds and never strict_validation', async () => {
    routeQueries([...SNAPSHOT_ROUTES, [/patient_settings/, [{ max_speech_seconds: 4, strict_validation: false }]]]);
    const ctx = await loadPatientContext(5);
    expect(ctx).toEqual({ language: 'en', daily_items: ['Soup at 1'], permanent_items: ['Depe'], max_speech_seconds: 4 });
  });

  function modelReturning(...responses) {
    let i = 0;
    getStructuredModel.mockReturnValue(RunnableLambda.from(async () => responses[Math.min(i++, responses.length - 1)]));
  }
  const SHORT = { validate: 'I hear you.', reassure: 'Timothy comes at five.', redirect: 'Let us sit.' }; // 10 words
  const LONG  = { validate: 'I can hear that you miss him a lot today.', reassure: 'Timothy comes home at five o clock.', redirect: 'Let us sit together.' }; // 21 words

  it('accepts a response within the patient cap', async () => {
    modelReturning(SHORT);
    const out = await runChain({ transcript: 'Where is Timothy', language: 'en', max_speech_seconds: 4, daily_items: [], permanent_items: [] });
    expect(out._fallback).toBe(false);
    expect(out.text).toBe('I hear you. Timothy comes at five. Let us sit.');
  });

  it('retries once when over the patient cap, then uses the retry', async () => {
    modelReturning(LONG, SHORT);
    const out = await runChain({ transcript: 'Where is Timothy', language: 'en', max_speech_seconds: 4 });
    expect(out._fallback).toBe(false);
    expect(out.text).toBe('I hear you. Timothy comes at five. Let us sit.');
  });

  it('falls back after a double rejection over the patient cap (guardrails always on)', async () => {
    modelReturning(LONG, LONG);
    const out = await runChain({ transcript: 'Where is Timothy', language: 'en', max_speech_seconds: 4 });
    expect(out._fallback).toBe(true);
  });

  it('still rejects questions when max_speech_seconds allows 25 words', async () => {
    modelReturning({ ...SHORT, redirect: 'Shall we sit?' });
    const out = await runChain({ transcript: 'hello', language: 'en', max_speech_seconds: 0 });
    expect(out._fallback).toBe(true);
  });
});
