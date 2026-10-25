/**
 * Part D backend: care team (several caregivers per patient), the caregiver name on the terminal
 * ("Connected · {name}"), caregiver:updated, and the name gate (person-name validation + content safety, kind
 * display_name). db/query and audit are mocked; the classifier is a fake.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));
jest.mock('../services/audit', () => ({ logAudit: jest.fn() }));

const jwt = require('jsonwebtoken');
const { query: mockQuery } = require('../db/query');
const { logAudit } = require('../services/audit');
const safety = require('../services/contentSafety');
const devicesController = require('../controllers/devicesController');
const caregiverCtl = require('../controllers/caregiverController');
const { patientAccess } = require('../services/ownership');
const careTeam = require('../services/careTeamService');
const { updateCaregiverSchema } = require('../validators');
const setupSocket = require('../socket');
const { hashCode } = require('../services/pairingService');
const { ALLOW, BLOCK, SCREENED } = require('./safetyTestUtils');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}

function makeIO() {
  const emitted = [];
  const joins = [];
  return {
    emitted, joins,
    to(room) { return { emit(event, data) { emitted.push({ room, event, data }); } }; },
    in(room) { return { socketsJoin(target) { joins.push({ from: room, to: target }); } }; },
  };
}

function routeQueries(routes) {
  mockQuery.mockImplementation(async (sql, params) => {
    const hit = routes.find(([re]) => re.test(sql));
    if (!hit) return { rows: [] };
    return { rows: typeof hit[1] === 'function' ? hit[1](params, sql) : hit[1] };
  });
}

const sqlCalls = (re) => mockQuery.mock.calls.filter(([sql]) => re.test(sql));

// A caregiver row with a current, allowed name verdict
const NAMED = (id, name) => ({ id, name, name_safety_version: safety.SAFETY_VERSION, name_safety_verdict: 'allow' });
const TEAM = (rows) => [/FROM patient_caregivers pc JOIN caregivers c/, rows];

let ipSeq = 0;
const pairReq = (io, extra = {}) => ({
  ip: `10.1.0.${++ipSeq}`, body: { code: 'abcdef' }, app: { get: () => io }, ...extra,
});
const PAIRED_DEVICE = { id: 3, patient_id: 5, code_used_at: null, is_live: true };
const NEW_DEVICE = { ...PAIRED_DEVICE, patient_id: null };

beforeEach(() => {
  mockQuery.mockReset();
  logAudit.mockReset();
  safety.setClassifier(async () => ALLOW);
});
afterAll(() => safety.setClassifier(undefined));

// ── D1: a second caregiver pairs ────────────────────────────────────────────────
describe('a second caregiver pairs a device that already has a patient', () => {
  it('without login: a NEW caregiver joins the existing patient (no second patient, no shared login)', async () => {
    routeQueries([
      [/FROM devices\s+WHERE pairing_code = \$1/, [PAIRED_DEVICE]],
      [/SET code_used_at = NOW\(\)/, [{ id: 3 }]],
      [/SELECT id, caregiver_id, language FROM patients WHERE id = \$1/, [{ id: 5, caregiver_id: 1, language: 'id' }]],
      [/INSERT INTO caregivers \(name\) VALUES \(NULL\) RETURNING id/, [{ id: 22 }]],
      [/SET patient_id = \$1/, [{ name: 'Tablet' }]],
      TEAM([NAMED(22, null), NAMED(1, 'Rina')]),
    ]);
    const io = makeIO();
    const res = makeRes();
    await devicesController.pairDevice(pairReq(io), res);

    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ success: true, patient_id: 5 });
    expect(jwt.verify(body.token, process.env.JWT_SECRET)).toMatchObject({ caregiverId: 22, patientId: 5 });
    expect(sqlCalls(/INSERT INTO patients/)).toHaveLength(0);
    expect(sqlCalls(/INSERT INTO patient_caregivers/)[0][1]).toEqual([5, 22]);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      caregiverId: 22, action: 'device.pair', payload: expect.objectContaining({ joined_existing: true, created_patient: false }),
    }));
  });

  it('with a caregiver JWT: that caregiver joins the device\'s patient (the device is not moved)', async () => {
    routeQueries([
      [/FROM devices\s+WHERE pairing_code = \$1/, [PAIRED_DEVICE]],
      [/SET code_used_at = NOW\(\)/, [{ id: 3 }]],
      [/SELECT id, caregiver_id, language FROM patients WHERE id = \$1/, [{ id: 5, caregiver_id: 1, language: 'id' }]],
      [/SET patient_id = \$1/, [{ name: 'Tablet' }]],
    ]);
    const res = makeRes();
    await devicesController.pairDevice(pairReq(makeIO(), { caregiverId: 7 }), res);
    expect(jwt.verify(res.json.mock.calls[0][0].token, process.env.JWT_SECRET)).toMatchObject({ caregiverId: 7, patientId: 5 });
    expect(sqlCalls(/INSERT INTO caregivers/)).toHaveLength(0);
    expect(sqlCalls(/INSERT INTO patient_caregivers/)[0][1]).toEqual([5, 7]);
  });

  it('a first pairing (new device, no login) creates caregiver + patient and puts the caregiver on the team', async () => {
    routeQueries([
      [/FROM devices\s+WHERE pairing_code = \$1/, [NEW_DEVICE]],
      [/SET code_used_at = NOW\(\)/, [{ id: 3 }]],
      [/WITH cg AS/, [{ id: 5, caregiver_id: 9, language: 'id' }]],
      [/SET patient_id = \$1/, [{ name: 'Tablet' }]],
    ]);
    const res = makeRes();
    await devicesController.pairDevice(pairReq(makeIO()), res);
    expect(jwt.verify(res.json.mock.calls[0][0].token, process.env.JWT_SECRET)).toMatchObject({ caregiverId: 9, patientId: 5 });
    expect(sqlCalls(/INSERT INTO patient_caregivers/)[0][1]).toEqual([5, 9]);
  });

  it('a team member has access to the patient (owner or member → 200, others → 403)', async () => {
    routeQueries([[/FROM patients WHERE id = \$1/, (params) => [{ caregiver_id: 1, is_member: params[1] === 22 }]]]);
    expect(await patientAccess(5, 1)).toBe(200);
    expect(await patientAccess(5, 22)).toBe(200);
    expect(await patientAccess(5, 99)).toBe(403);
  });
});

// ── D1: payloads ─────────────────────────────────────────────────────────────────
describe('caregiver name + count in device:paired, GET /api/device/context and caregiver:updated', () => {
  const pairRoutes = (team) => [
    [/FROM devices\s+WHERE pairing_code = \$1/, [PAIRED_DEVICE]],
    [/SET code_used_at = NOW\(\)/, [{ id: 3 }]],
    [/SELECT id, caregiver_id, language FROM patients WHERE id = \$1/, [{ id: 5, caregiver_id: 1, language: 'id' }]],
    [/SET patient_id = \$1/, [{ name: 'Tablet' }]],
    [/SELECT id FROM devices WHERE patient_id/, [{ id: 3 }, { id: 4 }]],
    TEAM(team),
  ];

  it('device:paired carries the most recently paired caregiver\'s name and the team size', async () => {
    routeQueries(pairRoutes([NAMED(7, 'Budi Santoso'), NAMED(1, 'Rina')]));
    const io = makeIO();
    await devicesController.pairDevice(pairReq(io, { caregiverId: 7 }), makeRes());
    expect(io.emitted).toContainEqual({
      room: 'device:3', event: 'device:paired',
      data: { patient_id: 5, language: 'id', caregiver_name: 'Budi Santoso', caregiver_count: 2 },
    });
  });

  it('pairing emits caregiver:updated {name, count} to the patient room and every device of the patient', async () => {
    routeQueries(pairRoutes([NAMED(7, 'Budi'), NAMED(1, 'Rina')]));
    const io = makeIO();
    await devicesController.pairDevice(pairReq(io, { caregiverId: 7 }), makeRes());
    expect(io.emitted).toContainEqual({
      room: ['patient:5', 'device:3', 'device:4'], event: 'caregiver:updated', data: { name: 'Budi', count: 2 },
    });
  });

  it('GET /api/device/context includes caregiver_name and caregiver_count (correct after a reload)', async () => {
    routeQueries([
      [/SELECT name, language/, [{ name: 'Oma', language: 'id' }]],
      [/FROM context_items/, [{ id: 1, scope: 'daily', text: 'Soup at 1', ...SCREENED }]],
      TEAM([NAMED(7, 'Budi'), NAMED(1, 'Rina'), NAMED(2, 'Sari')]),
    ]);
    const res = makeRes();
    await devicesController.getDeviceContext({ patientId: 5 }, res);
    expect(res.json.mock.calls[0][0]).toMatchObject({ caregiver_name: 'Budi', caregiver_count: 3, language: 'id' });
  });

  it('no name (unset) → caregiver_name null', async () => {
    routeQueries([TEAM([NAMED(7, null)])]);
    expect(await careTeam.caregiverSummary(5)).toEqual({ name: null, count: 1 });
  });

  it('a blocked or unscreened name is never shown; an unscreened one is re-screened in the background', async () => {
    routeQueries([TEAM([{ id: 7, name: 'Ada bom besok', name_safety_version: safety.SAFETY_VERSION, name_safety_verdict: 'block' }])]);
    expect(await careTeam.caregiverSummary(5)).toEqual({ name: null, count: 1 });

    const classifier = jest.fn(async () => ALLOW);
    safety.setClassifier(classifier);
    const listener = jest.fn();
    careTeam.setRescreenListener(listener);
    routeQueries([TEAM([{ id: 8, name: 'Rina', name_safety_version: null, name_safety_verdict: null }])]);
    expect(await careTeam.caregiverSummary(5)).toEqual({ name: null, count: 1 }); // not waited for
    await careTeam.rescreenName({ id: 8, name: 'Rina' });
    expect(classifier).toHaveBeenCalledWith('Rina', expect.objectContaining({ kind: 'display_name' }), expect.anything());
    expect(sqlCalls(/UPDATE caregivers SET name_safety_version/)[0][1]).toEqual([safety.SAFETY_VERSION, 'allow', 8, 'Rina']);
    expect(listener).toHaveBeenCalledWith(8);
  });

  it('a terminal that connects gets caregiver:updated; an unpaired one gets {name:null, count:0}', async () => {
    let mw, onConnection;
    setupSocket({ use: (fn) => { mw = fn; }, on: (_e, fn) => { onConnection = fn; } });
    const makeSocket = () => ({ id: 's', handshake: { auth: { deviceToken: 'tok' } }, join: jest.fn(), emit: jest.fn(), on: jest.fn() });

    routeQueries([[/FROM devices d/, [{ device_id: 42, patient_id: null, language: null }]]]);
    const unpaired = makeSocket();
    await mw(unpaired, jest.fn());
    await onConnection(unpaired);
    expect(unpaired.emit).toHaveBeenCalledWith('caregiver:updated', { name: null, count: 0 });

    routeQueries([
      [/FROM devices d/, [{ device_id: 10, patient_id: 5, language: 'id' }]],
      [/SELECT name, language/, [{ name: 'Oma', language: 'id' }]],
      TEAM([NAMED(7, 'Budi'), NAMED(1, 'Rina')]),
    ]);
    const paired = makeSocket();
    await mw(paired, jest.fn());
    await onConnection(paired);
    expect(paired.emit).toHaveBeenCalledWith('caregiver:updated', { name: 'Budi', count: 2 });
  });
});

// ── D4: a fresh code without unpairing ──────────────────────────────────────────
describe('POST /api/device/pairing-code (long press on the chip)', () => {
  it('stores a new hashed code for this device and keeps the patient link and token', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = makeRes();
    await devicesController.requestPairingCode({ deviceId: 3 }, res);
    const { code, expires_at } = res.json.mock.calls[0][0];
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(Date.parse(expires_at)).toBeGreaterThan(Date.now());
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toMatch(/patient_id|token_hash/);
    expect(params).toEqual([hashCode(code), expect.any(Date), 3]);
  });

  it('is mounted behind the device token', () => {
    const src = require('fs').readFileSync(require.resolve('../routes/device.js'), 'utf8');
    expect(src).toMatch(/router\.use\(authenticateDevice\)/);
    expect(src).toMatch(/router\.post\('\/pairing-code', requestPairingCode\)/);
  });
});

// ── D2: the name gate ──────────────────────────────────────────────────────────
describe('caregiver name: person-name validation', () => {
  const parse = (name) => updateCaregiverSchema.safeParse({ name });

  it.each(['Rina', 'Budi Santoso', 'Mary-Jane', "O'Brien", 'Dr. Sari', 'José Müller', 'Ni Luh'])('accepts %s', (name) => {
    expect(parse(name).success).toBe(true);
  });

  it('normalises: trims, collapses spaces, typographic apostrophe → \'', () => {
    expect(parse('  Anne   Marie ').data.name).toBe('Anne Marie');
    expect(parse('O’Brien').data.name).toBe("O'Brien");
  });

  it('empty or null → null (shown as "Caregiver")', () => {
    expect(parse('').data.name).toBeNull();
    expect(parse('   ').data.name).toBeNull();
    expect(parse(null).data.name).toBeNull();
  });

  it.each([
    ['R', 'too short'], ['A'.repeat(41), 'too long'], ['Rina123', 'digits'], ['<b>Rina</b>', 'markup'],
    ['Rina!', 'punctuation'], ['@rina', 'symbol'], ['-Rina', 'leading hyphen'], ['Rina 😀', 'emoji'],
  ])('rejects %s (%s) with a field error on name', (name) => {
    const r = parse(name);
    expect(r.success).toBe(false);
    expect(r.error.errors[0].path).toEqual(['name']);
  });
});

describe('PUT /api/caregiver name: safety gate (kind display_name), fail closed', () => {
  const put = async (body, io = makeIO()) => {
    const res = makeRes();
    await caregiverCtl.putMe({ caregiverId: 7, body: updateCaregiverSchema.parse(body), app: { get: () => io } }, res);
    return res;
  };

  it('"Ada bom besok" as a name is refused: 422 unsafe_content, nothing saved, audited without the text', async () => {
    safety.setClassifier(async (text) => (text === 'Ada bom besok' ? BLOCK('fear_inducing') : ALLOW));
    const res = await put({ name: 'Ada bom besok' });
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json.mock.calls[0][0]).toMatchObject({ code: 'unsafe_content', category: 'fear_inducing' });
    expect(sqlCalls(/UPDATE caregivers/)).toHaveLength(0);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'content.blocked', payload: { kind: 'display_name', category: 'fear_inducing' } }));
    expect(JSON.stringify(logAudit.mock.calls)).not.toMatch(/bom/);
  });

  it('no verdict (classifier down) → 503 safety_unavailable, nothing saved', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    safety.setClassifier(async () => { throw new Error('classifier HTTP 503'); });
    const res = await put({ name: 'Rina' });
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json.mock.calls[0][0].code).toBe('safety_unavailable');
    expect(sqlCalls(/UPDATE caregivers/)).toHaveLength(0);
    console.warn.mockRestore();
  });

  it('a safe name is saved with its verdict and caregiver:updated goes to every team the caregiver is on', async () => {
    const classifier = jest.fn(async () => ALLOW);
    safety.setClassifier(classifier);
    routeQueries([
      [/UPDATE caregivers SET/, [{ id: 7, name: 'Budi', email: null }]],
      [/UNION SELECT patient_id/, [{ id: 5 }]],
      [/SELECT id FROM devices WHERE patient_id/, [{ id: 3 }]],
      TEAM([NAMED(7, 'Budi')]),
    ]);
    const io = makeIO();
    const res = await put({ name: 'Budi' }, io);
    expect(res.json.mock.calls[0][0]).toEqual({ caregiver: { id: 7, name: 'Budi', email: null } });
    expect(classifier).toHaveBeenCalledWith('Budi', expect.objectContaining({ kind: 'display_name' }), expect.anything());
    const [sql, params] = sqlCalls(/UPDATE caregivers SET/)[0];
    expect(sql).toMatch(/name = \$1, name_safety_version = \$2, name_safety_verdict = \$3/);
    expect(params).toEqual(['Budi', safety.SAFETY_VERSION, 'allow', 7]);
    expect(io.emitted).toContainEqual({ room: ['patient:5', 'device:3'], event: 'caregiver:updated', data: { name: 'Budi', count: 1 } });
  });

  it('clearing the name needs no classifier call and clears the verdict', async () => {
    const classifier = jest.fn(async () => ALLOW);
    safety.setClassifier(classifier);
    routeQueries([[/UPDATE caregivers SET/, [{ id: 7, name: null, email: null }]]]);
    await put({ name: '' });
    expect(classifier).not.toHaveBeenCalled();
    expect(sqlCalls(/UPDATE caregivers SET/)[0][1]).toEqual([null, null, null, 7]);
  });

  it('an email-only change is not safety-checked and sends no caregiver:updated', async () => {
    const classifier = jest.fn(async () => ALLOW);
    safety.setClassifier(classifier);
    routeQueries([[/UPDATE caregivers SET/, [{ id: 7, name: 'Budi', email: 'b@x.id' }]]]);
    const io = makeIO();
    await put({ email: 'b@x.id' }, io);
    expect(classifier).not.toHaveBeenCalled();
    expect(io.emitted).toEqual([]);
  });

  it('display_name is a patient-facing kind (sensitive facts and not-ok-to-show are blocked)', () => {
    expect(safety.KINDS).toContain('display_name');
    expect(safety.SPOKEN_KINDS).toContain('display_name');
    expect(safety.classifierPrompt('Rina', { kind: 'display_name' })).toMatch(/kind=display_name:/);
  });
});
