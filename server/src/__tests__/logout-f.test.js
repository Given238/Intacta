/**
 * Part F: logout = revoke the session + leave the care team (migration 010).
 * db/query is answered by a small stateful fake (caregiver_sessions, patient_caregivers, caregivers, devices), so
 * pairing → logout → REST / socket auth → re-pairing run through the real services. audit is mocked.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));
jest.mock('../services/audit', () => ({ logAudit: jest.fn() }));

const jwt = require('jsonwebtoken');
const { query: mockQuery } = require('../db/query');
const { logAudit } = require('../services/audit');
const safety = require('../services/contentSafety');
const authenticate = require('../middleware/auth');
const { optionalAuthenticate, authenticateForLogout } = require('../middleware/auth');
const authController = require('../controllers/authController');
const devicesController = require('../controllers/devicesController');
const sessions = require('../services/sessionService');
const logoutService = require('../services/logoutService');
const setupSocket = require('../socket');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const HOUR = 3600_000;

// ── Fake database ───────────────────────────────────────────────────────────────
let db;
function freshDb() {
  db = {
    nextCaregiver: 100,
    sessions: new Map(),   // id → {id, caregiver_id, patient_id, expires_at (ms), revoked_at}
    team: [],              // {patient_id, caregiver_id, paired_at (ms), left_at}
    caregivers: new Map(), // id → {id, name, name_safety_version, name_safety_verdict}
    patients: new Map([[5, { id: 5, caregiver_id: 1, language: 'id' }]]),
    devices: [{ id: 3, patient_id: 5, pairing_code: null, code_used_at: null, code_expires_at: Date.now() + HOUR }],
    deletes: 0,
  };
  addCaregiver(1, 'Rina');
}
function addCaregiver(id, name) {
  db.caregivers.set(id, { id, name, name_safety_version: safety.SAFETY_VERSION, name_safety_verdict: name ? 'allow' : null });
}
const isActive = (s, cg, pid) => s.caregiver_id === cg && (s.patient_id === pid || s.patient_id == null)
  && !s.revoked_at && s.expires_at > Date.now();
const activeTeam = (pid) => db.team.filter(m => m.patient_id === pid && !m.left_at);

const handlers = [
  [/^INSERT INTO caregiver_sessions \(id, caregiver_id, patient_id, expires_at\) VALUES/, ([id, cg, pid, exp]) => {
    db.sessions.set(id, { id, caregiver_id: cg, patient_id: pid, expires_at: exp * 1000, revoked_at: null });
    return [];
  }],
  [/INSERT INTO caregiver_sessions \(id, caregiver_id, patient_id, expires_at, revoked_at\)/, ([id, cg, pid, exp]) => {
    const s = db.sessions.get(id);
    if (!s) { db.sessions.set(id, { id, caregiver_id: cg, patient_id: pid, expires_at: exp * 1000, revoked_at: Date.now() }); return [{ id }]; }
    if (s.revoked_at) return [];
    s.revoked_at = Date.now();
    return [{ id }];
  }],
  [/SELECT revoked_at FROM caregiver_sessions WHERE id = \$1/, ([id]) => {
    const s = db.sessions.get(id);
    return s ? [{ revoked_at: s.revoked_at }] : [];
  }],
  [/UPDATE patient_caregivers pc SET left_at = NOW\(\)\s+WHERE pc.caregiver_id = \$1/, ([cg, pids]) => {
    const changed = db.team.filter(m => m.caregiver_id === cg && pids.includes(m.patient_id) && !m.left_at
      && ![...db.sessions.values()].some(s => isActive(s, cg, m.patient_id)));
    changed.forEach(m => { m.left_at = Date.now(); });
    return changed.map(m => ({ patient_id: m.patient_id }));
  }],
  [/UPDATE patient_caregivers pc SET left_at = NOW\(\)\s+WHERE pc.left_at IS NULL/, ([secs]) => {
    const all = [...db.sessions.values()];
    const changed = db.team.filter(m => !m.left_at
      && !all.some(s => isActive(s, m.caregiver_id, m.patient_id))
      && (all.some(s => s.caregiver_id === m.caregiver_id && (s.patient_id === m.patient_id || s.patient_id == null))
          || m.paired_at < Date.now() - secs * 1000));
    changed.forEach(m => { m.left_at = Date.now(); });
    return changed.map(m => ({ patient_id: m.patient_id, caregiver_id: m.caregiver_id }));
  }],
  [/INSERT INTO patient_caregivers/, ([pid, cg]) => {
    const m = db.team.find(x => x.patient_id === pid && x.caregiver_id === cg);
    if (m) { m.paired_at = Date.now(); m.left_at = null; } else db.team.push({ patient_id: pid, caregiver_id: cg, paired_at: Date.now(), left_at: null });
    return [];
  }],
  [/FROM patient_caregivers pc JOIN caregivers c/, ([pid]) => activeTeam(pid)
    .sort((a, b) => b.paired_at - a.paired_at || b.caregiver_id - a.caregiver_id)
    .map(m => db.caregivers.get(m.caregiver_id))],
  [/SELECT id FROM patients WHERE caregiver_id = \$1\s+UNION/, ([cg]) => {
    const ids = new Set([...db.patients.values()].filter(p => p.caregiver_id === cg).map(p => p.id));
    db.team.filter(m => m.caregiver_id === cg && !m.left_at).forEach(m => ids.add(m.patient_id));
    return [...ids].map(id => ({ id }));
  }],
  [/^SELECT id FROM patients WHERE caregiver_id = \$1 OR EXISTS/, ([cg]) => [...db.patients.values()]
    .filter(p => p.caregiver_id === cg || activeTeam(p.id).some(m => m.caregiver_id === cg)).map(p => ({ id: p.id }))],
  [/SELECT id FROM devices WHERE patient_id = \$1/, ([pid]) => db.devices.filter(d => d.patient_id === pid).map(d => ({ id: d.id }))],
  // pairing
  [/FROM devices\s+WHERE pairing_code = \$1/, ([hash]) => db.devices.filter(d => d.pairing_code === hash)
    .map(d => ({ id: d.id, patient_id: d.patient_id, code_used_at: d.code_used_at, is_live: d.code_expires_at > Date.now() }))],
  [/UPDATE devices SET code_used_at = NOW\(\)/, ([id]) => {
    const d = db.devices.find(x => x.id === id && !x.code_used_at);
    if (!d) return [];
    d.code_used_at = Date.now();
    return [{ id }];
  }],
  [/SELECT id, caregiver_id, language FROM patients WHERE id = \$1/, ([id]) => (db.patients.has(id) ? [db.patients.get(id)] : [])],
  [/INSERT INTO caregivers \(name\) VALUES \(NULL\) RETURNING id/, () => {
    const id = ++db.nextCaregiver;
    addCaregiver(id, null);
    return [{ id }];
  }],
  [/INSERT INTO patients/, () => { throw new Error('a second patient must never be created'); }],
  [/SET patient_id = \$1/, ([pid, id]) => {
    db.devices.find(d => d.id === id).patient_id = pid;
    return [{ name: 'Tablet' }];
  }],
  [/^DELETE/i, () => { db.deletes++; return []; }],
];

function useFakeDb() {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const hit = handlers.find(([re]) => re.test(sql.trim()));
    return { rows: hit ? hit[1](params, sql) : [] };
  });
}

// ── Fakes for io / req / res ───────────────────────────────────────────────────
function makeIO() {
  const emitted = [];
  const disconnected = [];
  return {
    emitted, disconnected,
    to(room) { return { emit(event, data) { emitted.push({ room, event, data }); } }; },
    in(room) { return { socketsJoin() {}, disconnectSockets(close) { disconnected.push({ room, close }); } }; },
  };
}
function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json   = jest.fn(() => res);
  return res;
}
const updates = (io, room) => io.emitted.filter(e => e.event === 'caregiver:updated'
  && [].concat(e.room).includes(room)).map(e => e.data);
const lastUpdate = (io, room) => updates(io, room).at(-1);

let ipSeq = 0;
/** Terminal shows a code → the caregiver pairs on the phone (no Authorization header). → the caregiver JWT. */
async function pairPhone(io, code = 'ABCDEF') {
  const d = db.devices[0];
  d.pairing_code = require('../services/pairingService').hashCode(code);
  d.code_used_at = null;
  d.code_expires_at = Date.now() + HOUR;
  const res = makeRes();
  await devicesController.pairDevice({ ip: `10.7.0.${++ipSeq}`, body: { code }, app: { get: () => io } }, res);
  const body = res.json.mock.calls[0][0];
  expect(body).toMatchObject({ success: true, patient_id: 5 });
  return body.token;
}

/** REST auth (the real middleware) → {status, code} or {status: 200, req}. */
async function restAuth(token, mw = authenticate) {
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = makeRes();
  const next = jest.fn();
  await mw(req, res, next);
  if (next.mock.calls.length) return { status: 200, req };
  return { status: res.status.mock.calls[0][0], code: res.json.mock.calls[0][0].code };
}

async function logout(io, token, ip = `10.8.0.${++ipSeq}`) {
  const req = { headers: { authorization: `Bearer ${token}` }, ip, app: { get: () => io } };
  const res = makeRes();
  const next = jest.fn();
  authenticateForLogout(req, res, next);
  if (!next.mock.calls.length) return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  await authController.logout(req, res);
  return { status: res.status.mock.calls.length ? res.status.mock.calls[0][0] : 200, body: res.json.mock.calls[0][0] };
}

function bootSocket() {
  let mw, onConnection;
  setupSocket({ use: (fn) => { mw = fn; }, on: (_e, fn) => { onConnection = fn; } });
  return { mw, onConnection };
}
const makeSocket = (auth) => {
  const rooms = new Set();
  return { id: 's1', handshake: { auth }, rooms, join: (r) => rooms.add(r), emit: jest.fn(), on: jest.fn() };
};

beforeEach(() => {
  mockQuery.mockReset();
  logAudit.mockReset();
  sessions.clearSessionCache();
  freshDb();
  useFakeDb();
});

// ── Tokens and revocation ──────────────────────────────────────────────────────
describe('caregiver sessions', () => {
  it('pairing issues a JWT with a jti and a session row for that patient', async () => {
    const token = await pairPhone(makeIO());
    const payload = jwt.decode(token);
    expect(payload).toMatchObject({ caregiverId: 101, patientId: 5, jti: expect.any(String) });
    expect(db.sessions.get(payload.jti)).toMatchObject({ caregiver_id: 101, patient_id: 5, revoked_at: null });
    expect((await restAuth(token)).status).toBe(200);
  });

  it('logout revokes the token: 401 session_revoked afterwards on REST (also /pair\'s optional auth)', async () => {
    const io = makeIO();
    const token = await pairPhone(io);
    expect((await logout(io, token)).status).toBe(200);
    expect(await restAuth(token)).toEqual({ status: 401, code: 'session_revoked' });
    expect(await restAuth(token, optionalAuthenticate)).toEqual({ status: 401, code: 'session_revoked' });
    // also after the cache is gone (another process start): the row decides
    sessions.clearSessionCache();
    expect(await restAuth(token)).toEqual({ status: 401, code: 'session_revoked' });
  });

  it('logout revokes the token on the socket handshake (connect_error data.code session_revoked)', async () => {
    const io = makeIO();
    const token = await pairPhone(io);
    const { mw } = bootSocket();
    const before = jest.fn();
    await mw(makeSocket({ token }), before);
    expect(before).toHaveBeenCalledWith();

    await logout(io, token);
    const after = jest.fn();
    await mw(makeSocket({ token }), after);
    const err = after.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/session revoked/);
    expect(err.data).toEqual({ code: 'session_revoked' });
  });

  it('a caregiver socket joins its session room (what logout disconnects)', async () => {
    const token = await pairPhone(makeIO());
    const { mw, onConnection } = bootSocket();
    const socket = makeSocket({ token });
    await mw(socket, jest.fn());
    await onConnection(socket);
    expect(socket.rooms.has(`session:${jwt.decode(token).jti}`)).toBe(true);
    expect(socket.rooms.has('patient:5')).toBe(true);
  });

  it('a jti token whose row is missing is refused (fail closed)', async () => {
    const token = jwt.sign({ caregiverId: 1, patientId: 5 }, process.env.JWT_SECRET, { jwtid: 'not-in-db', expiresIn: '1h' });
    expect(await restAuth(token)).toEqual({ status: 401, code: 'session_revoked' });
  });

  it('a pre-010 token (no jti) keeps working until it expires, and logout still revokes it (denylist by hash)', async () => {
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: Date.now(), left_at: null });
    const legacy = jwt.sign({ caregiverId: 1, patientId: 5 }, process.env.JWT_SECRET, { expiresIn: '24h' });
    expect((await restAuth(legacy)).status).toBe(200);
    const io = makeIO();
    expect((await logout(io, legacy)).status).toBe(200);
    const row = [...db.sessions.values()][0];
    expect(row.id).toMatch(/^legacy:[0-9a-f]{64}$/);
    expect(row.id).not.toContain(legacy);
    expect(await restAuth(legacy)).toEqual({ status: 401, code: 'session_revoked' });
    expect(activeTeam(5)).toHaveLength(0);
  });

  it('the revocation check is cached (one lookup for repeated requests)', async () => {
    const token = await pairPhone(makeIO());
    sessions.clearSessionCache();
    mockQuery.mockClear();
    for (let i = 0; i < 5; i++) expect((await restAuth(token)).status).toBe(200);
    expect(mockQuery.mock.calls.filter(([sql]) => /FROM caregiver_sessions/.test(sql))).toHaveLength(1);
  });

  it('database down during the check → 503 auth_unavailable, never 401 (the caregiver is not logged out)', async () => {
    const token = await pairPhone(makeIO());
    sessions.clearSessionCache();
    mockQuery.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    expect(await restAuth(token)).toEqual({ status: 503, code: 'auth_unavailable' });
  });

  it('email/password login issues a session not scoped to a patient', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('secret-pass', 4);
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementation(async (sql, params) => (/FROM caregivers WHERE email/.test(sql)
      ? { rows: [{ id: 1, email: 'a@b.c', password_hash: hash }] } : base(sql, params)));
    const res = makeRes();
    await authController.login({ body: { email: 'a@b.c', password: 'secret-pass' } }, res);
    const { token } = res.json.mock.calls[0][0];
    const { jti, patientId } = jwt.decode(token);
    expect(patientId).toBeUndefined();
    expect(db.sessions.get(jti)).toMatchObject({ caregiver_id: 1, patient_id: null });
  });
});

// ── Logout: care team, events, sockets, audit ─────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('marks the membership as left and tells the terminal + portals (count 0 → the buttons return)', async () => {
    db.patients.get(5).caregiver_id = 101; // the only caregiver: this phone
    const io = makeIO();
    const token = await pairPhone(io);
    expect(lastUpdate(io, 'device:3')).toEqual({ name: null, count: 1 });

    const { status, body } = await logout(io, token);
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: true, already_logged_out: false, left_patients: [5] });
    expect(db.team.find(m => m.caregiver_id === 101).left_at).toEqual(expect.any(Number));
    expect(lastUpdate(io, 'device:3')).toEqual({ name: null, count: 0 });
    expect(lastUpdate(io, 'patient:5')).toEqual({ name: null, count: 0 });
  });

  it('two caregivers: one logs out → the other remains and the chip shows their name', async () => {
    const io = makeIO();
    db.caregivers.get(1).name = 'Rina';
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: Date.now() - 60_000, left_at: null });
    const rinaToken = await sessions.issueCaregiverToken({ caregiverId: 1, patientId: 5 });
    const budiToken = await pairPhone(io);
    db.caregivers.get(101).name = 'Budi';
    expect(activeTeam(5)).toHaveLength(2);

    await logout(io, budiToken);
    expect(lastUpdate(io, 'device:3')).toEqual({ name: 'Rina', count: 1 });
    expect((await restAuth(rinaToken)).status).toBe(200);

    // the last one leaves → count 0
    await logout(io, rinaToken);
    expect(lastUpdate(io, 'device:3')).toEqual({ name: null, count: 0 });
  });

  it('another active session for the same patient keeps the caregiver on the team', async () => {
    const io = makeIO();
    const phone = await pairPhone(io);
    const laptop = await sessions.issueCaregiverToken({ caregiverId: 101, patientId: 5 });
    const { body } = await logout(io, phone);
    expect(body.left_patients).toEqual([]);
    expect(activeTeam(5).map(m => m.caregiver_id)).toContain(101);
    expect((await restAuth(laptop)).status).toBe(200);
    expect(await restAuth(phone)).toEqual({ status: 401, code: 'session_revoked' });
  });

  it('force-disconnects every socket of the revoked session (after telling them why)', async () => {
    const io = makeIO();
    const token = await pairPhone(io);
    await logout(io, token);
    const room = `session:${jwt.decode(token).jti}`;
    expect(io.emitted).toContainEqual({ room, event: 'session:revoked', data: { reason: 'logout' } });
    expect(io.disconnected).toEqual([{ room, close: true }]);
  });

  it('is idempotent: a second call answers 200 and audits once', async () => {
    const io = makeIO();
    const token = await pairPhone(io);
    logAudit.mockClear();
    const first = await logout(io, token);
    const second = await logout(io, token);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ success: true, already_logged_out: true });
    const audits = logAudit.mock.calls.filter(([a]) => a.action === 'caregiver.logout');
    expect(audits).toHaveLength(1);
    expect(audits[0][0]).toMatchObject({
      caregiverId: 101,
      payload: { caregiver_id: 101, patient_id: 5, session: jwt.decode(token).jti },
    });
  });

  it('accepts an expired token (a delayed offline logout), rejects a forged one', async () => {
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: Date.now() - 2 * HOUR, left_at: null });
    const expired = jwt.sign({ caregiverId: 1, patientId: 5, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);
    expect((await logout(makeIO(), expired)).status).toBe(200);
    expect(activeTeam(5)).toHaveLength(0);
    const forged = jwt.sign({ caregiverId: 1, patientId: 5 }, 'not-the-secret');
    expect((await logout(makeIO(), forged)).status).toBe(401);
  });

  it('keeps the patient, notes, routines and history: nothing is deleted', async () => {
    const io = makeIO();
    const token = await pairPhone(io);
    await logout(io, token);
    expect(db.deletes).toBe(0);
    expect(mockQuery.mock.calls.some(([sql]) => /\bDELETE\b|\bDROP\b/i.test(sql))).toBe(false);
    expect(db.patients.has(5)).toBe(true);
    expect(db.devices[0].patient_id).toBe(5);
  });

  it('a login token (no patient) leaves every team of that caregiver', async () => {
    db.patients.set(6, { id: 6, caregiver_id: 9, language: 'en' });
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: Date.now(), left_at: null });
    db.team.push({ patient_id: 6, caregiver_id: 1, paired_at: Date.now(), left_at: null });
    const token = await sessions.issueCaregiverToken({ caregiverId: 1 });
    const { body } = await logout(makeIO(), token);
    expect(body.left_patients.sort()).toEqual([5, 6]);
  });

  it('is rate-limited per IP (11th call in a minute → 429)', async () => {
    const token = await pairPhone(makeIO());
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await logout(makeIO(), token, '10.99.0.1')).status);
    expect(statuses.slice(0, 10).every(s => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('the route is wired with the logout-only auth', () => {
    const src = require('fs').readFileSync(require.resolve('../routes/auth.js'), 'utf8');
    expect(src).toMatch(/router\.post\('\/logout', authenticateForLogout, logout\)/);
  });
});

// ── Re-pairing after logout ──────────────────────────────────────────────────
describe('pairing again after logout', () => {
  it('a new caregiver joins the SAME patient (no second patient) and the terminal shows Connected again', async () => {
    db.patients.get(5).caregiver_id = 101;
    const io = makeIO();
    const first = await pairPhone(io, 'ABCDEF');
    await logout(io, first);
    expect(lastUpdate(io, 'device:3')).toEqual({ name: null, count: 0 });

    const second = await pairPhone(io, 'GHJKLM');
    expect(jwt.decode(second)).toMatchObject({ caregiverId: 102, patientId: 5 });
    expect(db.patients.size).toBe(1); // INSERT INTO patients would have thrown
    expect(io.emitted).toContainEqual(expect.objectContaining({
      room: 'device:3', event: 'device:paired', data: expect.objectContaining({ patient_id: 5, caregiver_count: 1 }),
    }));
    expect(lastUpdate(io, 'device:3')).toEqual({ name: null, count: 1 });
    expect(db.deletes).toBe(0); // notes / routines untouched
  });

  it('a caregiver who left and pairs again with a JWT rejoins (left_at cleared)', async () => {
    const io = makeIO();
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: Date.now(), left_at: Date.now() });
    const { addToCareTeam } = require('../services/careTeamService');
    await addToCareTeam(5, 1);
    expect(activeTeam(5).map(m => m.caregiver_id)).toEqual([1]);
    const sql = mockQuery.mock.calls.find(([s]) => /INSERT INTO patient_caregivers/.test(s))[0];
    expect(sql).toMatch(/left_at = NULL/);
    expect(io.emitted).toEqual([]);
  });
});

// ── Stale cleanup job ────────────────────────────────────────────────────────
describe('stale membership cleanup', () => {
  it('members whose sessions all expired or were revoked leave; caregiver:updated per changed patient', async () => {
    const now = Date.now();
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: now - 30 * HOUR, left_at: null });
    db.team.push({ patient_id: 5, caregiver_id: 2, paired_at: now - HOUR, left_at: null });
    db.team.push({ patient_id: 5, caregiver_id: 3, paired_at: now - HOUR, left_at: null });
    addCaregiver(2, 'Sari'); addCaregiver(3, 'Tono');
    db.sessions.set('a', { id: 'a', caregiver_id: 1, patient_id: 5, expires_at: now - 6 * HOUR, revoked_at: null });
    db.sessions.set('b', { id: 'b', caregiver_id: 2, patient_id: 5, expires_at: now + 20 * HOUR, revoked_at: now - 1000 });
    db.sessions.set('c', { id: 'c', caregiver_id: 3, patient_id: 5, expires_at: now + 20 * HOUR, revoked_at: null });

    const io = makeIO();
    const left = await logoutService.cleanupStaleMemberships(io);
    expect(left.map(r => r.caregiver_id).sort()).toEqual([1, 2]);
    expect(activeTeam(5).map(m => m.caregiver_id)).toEqual([3]);
    expect(updates(io, 'device:3')).toEqual([{ name: 'Tono', count: 1 }]);
    expect(updates(io, 'patient:5')).toEqual([{ name: 'Tono', count: 1 }]);
  });

  it('pre-010 members (no session row) leave only after one token lifetime', async () => {
    const now = Date.now();
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: now - 25 * HOUR, left_at: null });
    db.team.push({ patient_id: 5, caregiver_id: 2, paired_at: now - 2 * HOUR, left_at: null });
    addCaregiver(2, 'Sari');
    const left = await logoutService.cleanupStaleMemberships(makeIO());
    expect(left).toEqual([{ patient_id: 5, caregiver_id: 1 }]);
    const call = mockQuery.mock.calls.find(([sql]) => /WHERE pc.left_at IS NULL/.test(sql));
    expect(call[1]).toEqual([24 * 3600]);
  });

  it('nothing stale → no change, no events', async () => {
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: Date.now() - 30 * HOUR, left_at: null });
    await sessions.issueCaregiverToken({ caregiverId: 1 }); // an active login session covers patient 5
    const io = makeIO();
    expect(await logoutService.cleanupStaleMemberships(io)).toEqual([]);
    expect(io.emitted).toEqual([]);
  });

  it('runs are serialized: a call during a run joins it (one UPDATE)', async () => {
    db.team.push({ patient_id: 5, caregiver_id: 1, paired_at: Date.now() - 30 * HOUR, left_at: null });
    const io = makeIO();
    const [a, b] = [logoutService.runStaleCleanup(io), logoutService.runStaleCleanup(io)];
    expect(a).toBe(b);
    await a;
    expect(mockQuery.mock.calls.filter(([sql]) => /WHERE pc.left_at IS NULL/.test(sql))).toHaveLength(1);
    await logoutService.runStaleCleanup(io); // a later run is a new pass
    expect(mockQuery.mock.calls.filter(([sql]) => /WHERE pc.left_at IS NULL/.test(sql))).toHaveLength(2);
  });

  it('a failing pass is logged, never thrown (the timer keeps going)', async () => {
    mockQuery.mockRejectedValue(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(logoutService.runStaleCleanup(makeIO())).resolves.toEqual([]);
    expect(spy).toHaveBeenCalledWith('[care-team] stale cleanup failed:', 'db down');
    spy.mockRestore();
  });

  it('starts hourly and runs once at start-up', () => {
    jest.useFakeTimers();
    const spy = jest.spyOn(global, 'setInterval');
    try {
      logoutService.startStaleCleanup(makeIO());
      expect(spy).toHaveBeenCalledWith(expect.any(Function), logoutService.CLEANUP_MS);
      expect(logoutService.CLEANUP_MS).toBe(3600_000);
      expect(mockQuery.mock.calls.some(([sql]) => /WHERE pc.left_at IS NULL/.test(sql))).toBe(true);
      const src = require('fs').readFileSync(require.resolve('../index.js'), 'utf8');
      expect(src).toMatch(/startStaleCleanup\(io\)/);
    } finally {
      logoutService.stopStaleCleanup();
      spy.mockRestore();
      jest.useRealTimers();
    }
  });
});

// ── Ownership after leaving ─────────────────────────────────────────────────
describe('a member who left', () => {
  it('no longer passes the care-team check and is not counted', () => {
    const { memberSql } = require('../services/ownership');
    expect(memberSql('patients.id', '$2')).toMatch(/left_at IS NULL/);
    const src = require('fs').readFileSync(require.resolve('../services/careTeamService.js'), 'utf8');
    expect(src).toMatch(/WHERE pc.patient_id = \$1 AND pc.left_at IS NULL/);
  });
});
