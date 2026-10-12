/**
 * Portal C2 backend changes (caregiver screens: Context, Patient, Routines, Settings).
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));
jest.mock('../services/audit', () => ({ logAudit: jest.fn() }));
jest.mock('../llm/interactionLogger', () => ({ logInteraction: jest.fn() }));

const { query: mockQuery } = require('../db/query');
const setupSocket = require('../socket');

function fakeServer() {
  const handlers = {};
  return { handlers, use: jest.fn(), on: (event, fn) => { handlers[event] = fn; } };
}

describe('caregiver socket connection', () => {
  afterEach(() => jest.resetAllMocks());

  it('registers broadcast:message and voice:test before the patient-room query resolves', () => {
    mockQuery.mockReturnValue(new Promise(() => {})); // DB never answers
    const io = fakeServer();
    setupSocket(io);
    const socket = { id: 's1', authType: 'caregiver', caregiverId: 1, on: jest.fn(), join: jest.fn(), emit: jest.fn() };
    io.handlers.connection(socket); // not awaited: the query is still pending
    const events = socket.on.mock.calls.map(([event]) => event);
    expect(events).toEqual(expect.arrayContaining(['broadcast:message', 'voice:test']));
  });
});

// ── Caregiver profile + voices (Settings screen) ──────────────────────────────
const { logAudit } = require('../services/audit');
const caregiverCtl = require('../controllers/caregiverController');
const { updateCaregiverSchema } = require('../validators');

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json   = (b) => { res.body = b; return res; };
  return res;
}

describe('GET/PUT /api/caregiver', () => {
  afterEach(() => jest.resetAllMocks());

  it('returns the signed-in caregiver only', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 7, name: 'Timothy', email: null }] });
    const res = mockRes();
    await caregiverCtl.getMe({ caregiverId: 7 }, res);
    expect(res.body).toEqual({ caregiver: { id: 7, name: 'Timothy', email: null } });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE id = $1'), [7]);
  });

  it('updates only the given fields for the JWT caregiver and audits', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 7, name: 'Tim', email: 'tim@example.com' }] });
    const res = mockRes();
    await caregiverCtl.putMe({ caregiverId: 7, body: { name: 'Tim' } }, res);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/SET name = \$1 WHERE id = \$2/), ['Tim', 7]);
    expect(res.body.caregiver.name).toBe('Tim');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ caregiverId: 7, action: 'caregiver.update' }));
  });

  it('maps a duplicate email to 409 email_taken', async () => {
    mockQuery.mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }));
    const res = mockRes();
    await caregiverCtl.putMe({ caregiverId: 7, body: { email: 'taken@example.com' } }, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('email_taken');
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('validates the body', () => {
    expect(updateCaregiverSchema.safeParse({}).success).toBe(false);
    expect(updateCaregiverSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(updateCaregiverSchema.safeParse({ name: '  ' }).success).toBe(false);
    expect(updateCaregiverSchema.safeParse({ name: 'Tim', email: 'TIM@Example.com' }).data.email).toBe('tim@example.com');
  });
});

describe('GET /api/settings/voices', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('lists only the configured voice IDs', () => {
    process.env.ELEVENLABS_VOICE_ID_ID = 'voice-id-1';
    delete process.env.ELEVENLABS_VOICE_ID_EN;
    const res = mockRes();
    caregiverCtl.getVoices({}, res);
    expect(res.body).toEqual({ voices: [{ language: 'id', id: 'voice-id-1' }] });
  });
});
