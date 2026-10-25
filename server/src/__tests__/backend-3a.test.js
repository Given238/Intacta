/**
 * Phase 3a backend tests — exercise the real controllers, route handler and
 * socket handlers with db/query, audit and the LLM chain mocked.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));
jest.mock('../services/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../llm/chain', () => ({ runChain: jest.fn() }));
jest.mock('../llm/contextLoader', () => ({
  loadPatientContext: jest.fn(),
  loadRecentExchanges: jest.fn(async () => []),
  loadUpcomingRoutines: jest.fn(async () => []),
  jakartaTimeOfDay: jest.fn(() => '15:30'),
}));
jest.mock('../llm/interactionLogger', () => ({ logInteraction: jest.fn() }));

const { query: mockQuery } = require('../db/query');
const { logAudit }          = require('../services/audit');
const { runChain }          = require('../llm/chain');
const { loadPatientContext } = require('../llm/contextLoader');
const { logInteraction }    = require('../llm/interactionLogger');

const routinesController = require('../controllers/routinesController');
const devicesController  = require('../controllers/devicesController');
const setupSocket        = require('../socket');
const { handleDeviceStatus } = setupSocket;
const respondRouter      = require('../routes/respond');
const { SCREENED } = require('./safetyTestUtils');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

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
  const joins   = [];
  return {
    emitted,
    joins,
    to(room) {
      return {
        emit(event, data) { emitted.push({ room, event, data, volatile: false }); },
        volatile: { emit(event, data) { emitted.push({ room, event, data, volatile: true }); } },
      };
    },
    in(room) {
      return { socketsJoin(target) { joins.push({ from: room, to: target }); } };
    },
  };
}

function appWith(io) {
  return { get: (k) => (k === 'io' ? io : undefined) };
}

/** Answer db queries by matching SQL text, so parallel queries need no fixed order. */
function routeQueries(routes) {
  mockQuery.mockImplementation(async (sql) => {
    const hit = routes.find(([re]) => re.test(sql));
    return hit ? { rows: typeof hit[1] === 'function' ? hit[1]() : hit[1] } : { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  logAudit.mockReset();
});

// ── 1. Socket dual auth + rooms ──────────────────────────────────────────────
describe('Socket.IO dual auth and room joins', () => {
  function boot() {
    let mw, onConnection;
    const io = { use: (fn) => { mw = fn; }, on: (_e, fn) => { onConnection = fn; } };
    setupSocket(io);
    return { mw, onConnection };
  }
  function makeSocket(auth) {
    const rooms = new Set();
    return {
      id: 's1', handshake: { auth }, rooms,
      join: (r) => rooms.add(r), emit: jest.fn(), on: jest.fn(),
    };
  }

  it('accepts a caregiver JWT', async () => {
    const jwt = require('jsonwebtoken');
    const { mw } = boot();
    const socket = makeSocket({ token: jwt.sign({ caregiverId: 7 }, process.env.JWT_SECRET) });
    const next = jest.fn();
    await mw(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socket.authType).toBe('caregiver');
    expect(socket.caregiverId).toBe(7);
  });

  it('unpaired device joins device:{id} only', async () => {
    const { mw, onConnection } = boot();
    mockQuery.mockResolvedValueOnce({ rows: [{ device_id: 42, patient_id: null, language: null }] });
    const socket = makeSocket({ device_token: 'tok' });
    const next = jest.fn();
    await mw(socket, next);
    expect(next).toHaveBeenCalledWith();
    await onConnection(socket);
    expect([...socket.rooms]).toEqual(['device:42']);
  });

  it('paired device (reconnect) joins device and patient rooms and gets context:sync + settings:sync', async () => {
    const { mw, onConnection } = boot();
    routeQueries([
      [/FROM devices d/,          [{ device_id: 10, patient_id: 5, language: 'id' }]],
      [/SELECT name, language/,   [{ name: 'Eleanor', language: 'id' }]],
      [/FROM context_items/,      [{ id: 1, scope: 'daily', text: 'Soup at 1', ...SCREENED }]],
      [/patient_settings/,        [{ max_speech_seconds: 8 }]],
    ]);
    const socket = makeSocket({ deviceToken: 'tok' });
    await mw(socket, jest.fn());
    await onConnection(socket);
    expect(socket.rooms.has('device:10')).toBe(true);
    expect(socket.rooms.has('patient:5')).toBe(true);
    expect(socket.emit).toHaveBeenCalledWith('context:sync', {
      payload: { patient_name: 'Eleanor', language: 'id', daily: [{ id: 1, text: 'Soup at 1' }], permanent: [] },
      updated_at: expect.any(String),
    });
    expect(socket.emit).toHaveBeenCalledWith('settings:sync', expect.objectContaining({
      payload: expect.objectContaining({ max_speech_seconds: 8, strict_validation: true }),
    }));
  });

  it('rejects an unknown device token', async () => {
    const { mw } = boot();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const next = jest.fn();
    await mw(makeSocket({ deviceToken: 'bad' }), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// ── 2. Pairing ───────────────────────────────────────────────────────────────
describe('POST /api/devices/register + /api/devices/pair', () => {
  it('register returns a device_token and a 6-char code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    const res = makeRes();
    await devicesController.registerDevice({ body: { device_id: 'terminal-uuid-1234' } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.device_token).toMatch(/^[0-9a-f]{64}$/);
    expect(body.code).toHaveLength(6);
    expect(mockQuery.mock.calls[0][1][3]).toBe(body.device_token);
  });

  it('register with Postgres unreachable → typed 503 db_unavailable', async () => {
    const down = Object.assign(new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })], ''), {});
    mockQuery.mockRejectedValueOnce(down);
    const res = makeRes();
    await devicesController.registerDevice({ body: { device_id: 'terminal-uuid-1234' } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe('db_unavailable');
  });

  const { hashCode } = require('../services/pairingService');
  const DEVICE_ROW = { id: 3, patient_id: null, code_used_at: null, is_live: true };
  let ipSeq = 0;
  const pairReq = (extra = {}) => ({
    ip: `10.0.0.${++ipSeq}`, body: { code: 'abcdef' }, app: appWith(makeIO()), ...extra,
  });

  it('register stores the code as a SHA-256 hash and clears code_used_at', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3 }] });
    const res = makeRes();
    await devicesController.registerDevice({ body: { device_id: 'terminal-uuid-1234' } }, res);
    const { code } = res.json.mock.calls[0][0];
    expect(mockQuery.mock.calls[0][1][1]).toBe(hashCode(code));
    expect(mockQuery.mock.calls[0][0]).toMatch(/code_used_at = NULL/);
  });

  it('pair without login creates caregiver + patient, joins patient:{id}, emits device:paired, returns a scoped JWT', async () => {
    const jwt = require('jsonwebtoken');
    routeQueries([
      [/FROM devices\s+WHERE pairing_code = \$1/, [DEVICE_ROW]],
      [/SET code_used_at = NOW\(\)/, [{ id: 3 }]],
      [/INSERT INTO caregivers/, [{ id: 5, caregiver_id: 9, language: 'id' }]],
      [/SET patient_id = \$1/, [{ name: 'Tablet' }]],
      [/SELECT name, language FROM patients/, [{ name: 'Patient', language: 'id' }]],
      [/patient_settings/, [{}]],
    ]);
    const io = makeIO();
    const res = makeRes();
    await devicesController.pairDevice(pairReq({ app: appWith(io) }), res);

    // looked up by the hash of the normalised code
    expect(mockQuery.mock.calls[0][1]).toEqual([hashCode('ABCDEF')]);
    expect(io.joins).toContainEqual({ from: 'device:3', to: 'patient:5' });
    expect(io.emitted).toContainEqual(expect.objectContaining({
      room: 'device:3', event: 'device:paired', data: { patient_id: 5, language: 'id', caregiver_name: null, caregiver_count: 0 },
    }));
    expect(io.emitted.map(e => `${e.room} ${e.event}`)).toEqual(expect.arrayContaining([
      'device:3 context:sync', 'device:3 settings:sync',
    ]));
    const body = res.json.mock.calls[0][0];
    expect(body).toEqual(expect.objectContaining({
      success: true, patient_id: 5, language: 'id', device_name: 'Tablet',
    }));
    expect(jwt.verify(body.token, process.env.JWT_SECRET)).toEqual(
      expect.objectContaining({ caregiverId: 9, patientId: 5 })
    );
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ caregiverId: 9, action: 'device.pair' }));
  });

  it("pair with a caregiver JWT links to that caregiver's patient (no new caregiver)", async () => {
    routeQueries([
      [/FROM devices\s+WHERE pairing_code = \$1/, [DEVICE_ROW]],
      [/SET code_used_at = NOW\(\)/, [{ id: 3 }]],
      [/FROM patients WHERE caregiver_id/, [{ id: 8, caregiver_id: 1, language: 'en' }]],
      [/SET patient_id = \$1/, [{ name: 'Tablet - Ruang Tamu' }]],
    ]);
    const res = makeRes();
    await devicesController.pairDevice(pairReq({ caregiverId: 1 }), res);
    expect(res.json.mock.calls[0][0]).toEqual(expect.objectContaining({
      patient_id: 8, language: 'en', device_name: 'Tablet - Ruang Tamu',
    }));
    expect(mockQuery.mock.calls.some(c => /INSERT INTO caregivers/.test(c[0]))).toBe(false);
  });

  it.each([
    ['unknown code',      400, 'invalid_code', []],
    ['expired code',      410, 'code_expired', [{ ...DEVICE_ROW, is_live: false }]],
    ['already-used code', 409, 'code_used',    [{ ...DEVICE_ROW, code_used_at: new Date() }]],
  ])('pair with an %s → %i %s', async (_label, status, code, rows) => {
    routeQueries([[/FROM devices\s+WHERE pairing_code = \$1/, rows]]);
    const res = makeRes();
    await devicesController.pairDevice(pairReq(), res);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json.mock.calls[0][0].code).toBe(code);
  });

  it('pair loses the race for a code → 409 code_used', async () => {
    routeQueries([
      [/FROM devices\s+WHERE pairing_code = \$1/, [DEVICE_ROW]],
      [/SET code_used_at = NOW\(\)/, []],
    ]);
    const res = makeRes();
    await devicesController.pairDevice(pairReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('pair with a malformed code → 400 before touching the db', async () => {
    const res = makeRes();
    await devicesController.pairDevice(pairReq({ body: { code: 'abc' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('pair is rate-limited to 5/min/IP', async () => {
    routeQueries([[/FROM devices/, []]]);
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = makeRes();
      await devicesController.pairDevice(pairReq({ ip: '10.9.9.9' }), res);
      statuses.push(res.status.mock.calls[0][0]);
    }
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it('/pair is public: optional auth passes without a header, rejects a bad one', () => {
    const { optionalAuthenticate } = require('../middleware/auth');
    const next = jest.fn();
    optionalAuthenticate({ headers: {} }, makeRes(), next);
    expect(next).toHaveBeenCalled();
    const res = makeRes();
    optionalAuthenticate({ headers: { authorization: 'Bearer nope' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    const src = require('fs').readFileSync(require.resolve('../routes/devices.js'), 'utf8');
    expect(src).toMatch(/router\.post\('\/pair', optionalAuthenticate, pairDevice\)/);
  });
});

// ── 3. Device context ────────────────────────────────────────────────────────
describe('GET /api/device/context', () => {
  it('returns today\'s daily + permanent items, language and updated_at', async () => {
    routeQueries([
      [/SELECT name, language/, [{ name: 'Eleanor', language: 'en' }]],
      [/FROM context_items/, [
        { id: 1, scope: 'daily', text: 'Soup at 1', ...SCREENED },
        { id: 2, scope: 'permanent', text: 'Depe the dog', ...SCREENED },
      ]],
    ]);
    const res = makeRes();
    await devicesController.getDeviceContext({ patientId: 5 }, res);
    expect(res.json).toHaveBeenCalledWith({
      context: {
        patient_name: 'Eleanor',
        daily: [{ id: 1, text: 'Soup at 1' }],
        permanent: [{ id: 2, text: 'Depe the dog' }],
      },
      language: 'en',
      updated_at: expect.any(String),
      caregiver_name: null,
      caregiver_count: 0,
    });
    // daily items are limited to today
    expect(mockQuery.mock.calls.find(c => /context_items/.test(c[0]))[0]).toMatch(/context_date = CURRENT_DATE/);
  });

  it('is mounted at /api/device/context', () => {
    const src = require('fs').readFileSync(require.resolve('../routes/device.js'), 'utf8');
    expect(src).toMatch(/router\.get\('\/context', getDeviceContext\)/);
    const index = require('fs').readFileSync(require.resolve('../index.js'), 'utf8');
    expect(index).toMatch(/app\.use\('\/api\/device',\s+deviceRoutes\)/);
  });
});

// ── 5. /api/respond source ──────────────────────────────────────────────────
describe('POST /api/respond source', () => {
  const handler = respondRouter.stack[0].route.stack.at(-1).handle;

  beforeEach(() => {
    loadPatientContext.mockResolvedValue({ language: 'en', daily_items: [], permanent_items: [], max_speech_seconds: 10 });
    runChain.mockResolvedValue({ text: 'ok', parts: [] });
    logInteraction.mockResolvedValue({ created_at: 'T' });
  });

  it.each(['voice', 'typed', 'routine', 'broadcast'])('accepts and logs source=%s', async (source) => {
    logInteraction.mockClear();
    const res = makeRes();
    await handler({ patientId: 5, body: { transcript: 'hi', source }, app: appWith(makeIO()) }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(logInteraction).toHaveBeenCalledWith(expect.objectContaining({ source }));
  });

  it('rejects an invalid source with 400', async () => {
    const res = makeRes();
    await handler({ patientId: 5, body: { transcript: 'hi', source: 'sms' }, app: appWith(makeIO()) }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ── 6. Ownership: 403 vs 404 ────────────────────────────────────────────────
describe('routines controller — ownership', () => {
  it('getRoutine: 404 for non-existent routine', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = makeRes();
    await routinesController.getRoutine({ caregiverId: 1, params: { id: '99' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it.each([
    ['getRoutine',    { params: { id: '1' } }],
    ['updateRoutine', { params: { id: '1' }, body: {} }],
    ['deleteRoutine', { params: { id: '1' } }],
    ['listRoutines',  { query: { patientId: '5' } }],
    ['createRoutine', { body: { patientId: 5, trigger_time: '08:00', category: 'meal' } }],
  ])('%s: 403 for another caregiver\'s patient', async (fn, req) => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, caregiver_id: 999 }] });
    const res = makeRes();
    await routinesController[fn]({ caregiverId: 1, ...req }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('getRoutine: 200 when caregiver owns the patient', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, caregiver_id: 1 }] });
    const res = makeRes();
    await routinesController.getRoutine({ caregiverId: 1, params: { id: '1' } }, res);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ routine: { id: 1 } });
  });

  it('createRoutine: 201 and audit log without throwing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 5, caregiver_id: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 2 }] });
    const res = makeRes();
    await routinesController.createRoutine(
      { caregiverId: 1, body: { patientId: 5, trigger_time: '08:00', category: 'meal' } }, res
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'routine.create' }));
  });
});

// ── 7. device:status ────────────────────────────────────────────────────────
describe('Socket.IO device:status handler', () => {
  it('updates devices and emits device:status to the patient room', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ patient_id: 5 }] });
    const io = makeIO();
    await handleDeviceStatus(io, { deviceId: 10, patientId: null, emit: jest.fn() })({ online: true, battery: 87, power: 'ac' });
    expect(mockQuery.mock.calls[0][0]).toMatch(/UPDATE devices/);
    expect(mockQuery.mock.calls[0][1]).toEqual([true, 87, 10]);
    expect(io.emitted).toContainEqual(expect.objectContaining({
      room: 'patient:5', event: 'device:status',
      data: { device_id: 10, online: true, battery: 87, power: 'ac' },
    }));
  });

  it('rejects battery outside 0–100', async () => {
    const socket = { deviceId: 10, emit: jest.fn() };
    await handleDeviceStatus(makeIO(), socket)({ online: true, battery: 150 });
    expect(socket.emit).toHaveBeenCalledWith('error', { message: expect.stringContaining('battery') });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
