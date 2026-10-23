/**
 * Part C: routine scheduler — Asia/Jakarta matching, once per day, offline grace / missed, validation.
 */

jest.mock('../config/db', () => ({}));
jest.mock('../db/query', () => ({ query: jest.fn() }));
jest.mock('../llm/interactionLogger', () => ({ logInteraction: jest.fn() }));

const { query: mockQuery } = require('../db/query');
const { logInteraction } = require('../llm/interactionLogger');
const sched = require('../services/routineScheduler');
const { createRoutineSchema, updateRoutineSchema } = require('../validators');
const { SCREENED } = require('./safetyTestUtils');

// 2026-10-11 is a Sunday. Jakarta = UTC+7 (no DST).
const utc = (iso) => new Date(iso);

describe('jakartaClock (Intl, Asia/Jakarta, independent of the server timezone)', () => {
  it('converts a UTC instant to Jakarta date, minute and weekday', () => {
    expect(sched.jakartaClock(utc('2026-10-12T01:30:00Z'))).toEqual({ dateKey: '2026-10-12', minutes: 8 * 60 + 30, weekday: 1 });
  });

  it('crosses midnight at 17:00 UTC: the Jakarta date and weekday change, the UTC ones do not', () => {
    expect(sched.jakartaClock(utc('2026-10-11T16:59:00Z'))).toEqual({ dateKey: '2026-10-11', minutes: 23 * 60 + 59, weekday: 0 });
    expect(sched.jakartaClock(utc('2026-10-11T17:00:00Z'))).toEqual({ dateKey: '2026-10-12', minutes: 0, weekday: 1 });
  });

  it('crosses a month and year boundary', () => {
    expect(sched.jakartaClock(utc('2026-12-31T17:05:00Z'))).toEqual({ dateKey: '2027-01-01', minutes: 5, weekday: 5 });
  });

  it('ignores process.env.TZ', () => {
    const saved = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      expect(sched.jakartaClock(utc('2026-10-12T01:30:00Z')).dateKey).toBe('2026-10-12');
    } finally {
      if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
    }
  });
});

describe('classifyRoutine', () => {
  const monday0800 = sched.jakartaClock(utc('2026-10-12T01:00:00Z')); // Mon 08:00 WIB
  const at = (iso) => sched.jakartaClock(utc(iso));
  const routine = (over = {}) => ({ id: 1, is_active: true, days: [0, 1, 2, 3, 4, 5, 6], trigger_time: '08:00:00', last_fired_on: null, ...over });

  it('fires at the matching HH:MM (pg TIME with seconds or HH:MM)', () => {
    expect(sched.classifyRoutine(routine(), monday0800)).toBe('deliver');
    expect(sched.classifyRoutine(routine({ trigger_time: '08:00' }), monday0800)).toBe('deliver');
  });

  it('is not due before its minute', () => {
    expect(sched.classifyRoutine(routine({ trigger_time: '08:01:00' }), monday0800)).toBe('not_due');
  });

  it('stays deliverable for 10 minutes, then counts as missed', () => {
    expect(sched.classifyRoutine(routine(), at('2026-10-12T01:10:00Z'))).toBe('deliver');
    expect(sched.classifyRoutine(routine(), at('2026-10-12T01:11:00Z'))).toBe('missed');
  });

  it('only on its weekdays (0=Sun..6=Sat); empty/null days means every day', () => {
    expect(sched.classifyRoutine(routine({ days: [1] }), monday0800)).toBe('deliver');
    expect(sched.classifyRoutine(routine({ days: [0, 2, 3, 4, 5, 6] }), monday0800)).toBe('not_due');
    expect(sched.classifyRoutine(routine({ days: null }), monday0800)).toBe('deliver');
    expect(sched.classifyRoutine(routine({ days: [] }), monday0800)).toBe('deliver');
  });

  it('uses the Jakarta weekday near midnight, not the UTC one', () => {
    // 00:05 Monday in Jakarta is still Sunday 17:05 UTC
    const mondayJustAfterMidnight = at('2026-10-11T17:05:00Z');
    expect(sched.classifyRoutine(routine({ trigger_time: '00:05:00', days: [1] }), mondayJustAfterMidnight)).toBe('deliver');
    expect(sched.classifyRoutine(routine({ trigger_time: '00:05:00', days: [0] }), mondayJustAfterMidnight)).toBe('not_due');
  });

  it('fires once per day: done when last_fired_on is today (string or pg Date), due again the next day', () => {
    expect(sched.classifyRoutine(routine({ last_fired_on: '2026-10-12' }), monday0800)).toBe('done');
    expect(sched.classifyRoutine(routine({ last_fired_on: new Date(2026, 9, 12) }), monday0800)).toBe('done');
    expect(sched.classifyRoutine(routine({ last_fired_on: '2026-10-11' }), monday0800)).toBe('deliver');
  });

  it('skips inactive routines and malformed times', () => {
    expect(sched.classifyRoutine(routine({ is_active: false }), monday0800)).toBe('not_due');
    expect(sched.classifyRoutine(routine({ trigger_time: '8am' }), monday0800)).toBe('not_due');
  });
});

describe('initialLastFiredOn (create / re-time)', () => {
  const monday0900 = sched.jakartaClock(utc('2026-10-12T02:00:00Z'));
  it('a time already past today counts as handled today (not fired late, not logged missed)', () => {
    expect(sched.initialLastFiredOn('08:00', [1], monday0900)).toBe('2026-10-12');
  });
  it('a time still ahead today, or a day other than today, stays null', () => {
    expect(sched.initialLastFiredOn('10:00', [1], monday0900)).toBeNull();
    expect(sched.initialLastFiredOn('08:00', [2], monday0900)).toBeNull();
  });
});

describe('runTick', () => {
  const NOW = utc('2026-10-12T01:00:00Z'); // Mon 08:00 WIB
  let emitted;
  let claimable;
  let io;

  const ROUTINES = [
    { id: 11, patient_id: 5, title: 'Breakfast', days: [1], trigger_time: '08:00:00', category: 'meal', audio_script: 'Time for breakfast.', display_text: null, is_active: true, last_fired_on: null, ...SCREENED },
    { id: 12, patient_id: 5, title: 'Pills', days: [1], trigger_time: '07:40:00', category: 'medication', audio_script: 'Time for your pills.', display_text: null, is_active: true, last_fired_on: null, ...SCREENED },
    { id: 13, patient_id: 5, title: 'Walk', days: [1], trigger_time: '09:00:00', category: 'other', audio_script: 'Walk.', display_text: null, is_active: true, last_fired_on: null, ...SCREENED },
  ];

  function fakeIo(onlinePatients) {
    return {
      in: (room) => ({
        fetchSockets: async () => (onlinePatients.some(p => room === `patient:${p}`) ? [{ rooms: new Set(['sid', 'device:3', room]) }] : [{ rooms: new Set(['caregiver-socket', room]) }]),
      }),
      to: (room) => ({ emit: (event, data) => emitted.push({ room, event, data }) }),
    };
  }

  beforeEach(() => {
    jest.resetAllMocks();
    emitted = [];
    claimable = new Set([11, 12, 13]);
    mockQuery.mockImplementation(async (sql, params) => {
      if (/^\s*SELECT/.test(sql)) return { rows: params[1] ? ROUTINES.filter(r => r.patient_id === params[1]) : ROUTINES };
      if (/UPDATE routines SET last_fired_on/.test(sql)) {
        const ok = claimable.delete(params[0]); // second claim on the same day fails
        return { rows: ok ? [{ id: params[0] }] : [] };
      }
      throw new Error(`unexpected SQL ${sql}`);
    });
    logInteraction.mockResolvedValue({ id: 1, created_at: '2026-10-12T01:00:01.000Z' });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('terminal online: emits routine:trigger, logs source routine (transcript = title, reply = script), claims with the Jakarta date', async () => {
    io = fakeIo([5]);
    const r = await sched.runTick(io, { now: NOW });
    expect(r).toEqual({ delivered: [11], missed: [12], waiting: [], stale: [], blocked: [] });
    expect(emitted).toContainEqual({ room: 'patient:5', event: 'routine:trigger', data: { id: 11, title: 'Breakfast', audio_script: 'Time for breakfast.', category: 'meal' } });
    expect(logInteraction).toHaveBeenCalledWith({ patientId: 5, transcript: 'Breakfast', aiResponse: { text: 'Time for breakfast.', parts: ['Time for breakfast.'] }, source: 'routine', latencyMs: 0 });
    const claimCall = mockQuery.mock.calls.find(([sql]) => /UPDATE routines/.test(sql));
    expect(claimCall[1]).toEqual([11, '2026-10-12']);
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-10-12']); // not-fired-today filter uses the Jakarta date
  });

  it('never fires twice on the same day (atomic claim)', async () => {
    io = fakeIo([5]);
    await sched.runTick(io, { now: NOW });
    emitted = [];
    const again = await sched.runTick(io, { now: utc('2026-10-12T01:00:30Z') });
    expect(again.delivered).toEqual([]);
    expect(emitted.filter(e => e.event === 'routine:trigger')).toEqual([]);
  });

  it('terminal offline within 10 minutes: waits (no emit, no claim), then delivers on reconnect', async () => {
    io = fakeIo([]);
    const r = await sched.runTick(io, { now: utc('2026-10-12T01:04:00Z') });
    expect(r.waiting).toEqual([11]);
    expect(emitted.filter(e => e.event === 'routine:trigger')).toEqual([]);
    expect(claimable.has(11)).toBe(true);

    io = fakeIo([5]); // terminal reconnects at 08:06
    const p = await sched.deliverPending(io, 5, { now: utc('2026-10-12T01:06:00Z') });
    expect(p.delivered).toEqual([11]);
    expect(emitted.some(e => e.event === 'routine:trigger' && e.data.id === 11)).toBe(true);
  });

  it('terminal offline for more than 10 minutes: skipped and logged as missed, never delivered later', async () => {
    io = fakeIo([]);
    const r = await sched.runTick(io, { now: utc('2026-10-12T01:11:00Z') });
    expect(r.missed).toEqual(expect.arrayContaining([11, 12]));
    expect(logInteraction).toHaveBeenCalledWith(expect.objectContaining({
      transcript: 'Breakfast', source: 'routine', aiResponse: { missed: true, reason: 'terminal_offline', script: 'Time for breakfast.' },
    }));
    expect(emitted.filter(e => e.event === 'routine:trigger')).toEqual([]);
    expect(emitted.some(e => e.event === 'interaction:new' && e.data.ai_response.missed)).toBe(true);

    io = fakeIo([5]);
    const later = await sched.deliverPending(io, 5, { now: utc('2026-10-12T01:12:00Z') });
    expect(later.delivered).toEqual([]);
  });

  it('routines due before the scheduler started are marked handled without a missed log', async () => {
    io = fakeIo([]);
    const r = await sched.runTick(io, { now: utc('2026-10-12T01:30:00Z'), startedAt: utc('2026-10-12T01:20:00Z') }); // started 08:20
    expect(r.stale).toEqual(expect.arrayContaining([11, 12])); // 08:00 and 07:40, both before 08:20
    expect(r.missed).toEqual([]);
    expect(logInteraction).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('a scheduler started on an earlier day still logs the misses of today', async () => {
    io = fakeIo([]);
    const r = await sched.runTick(io, { now: utc('2026-10-12T01:30:00Z'), startedAt: utc('2026-10-11T10:00:00Z') });
    expect(r.missed).toEqual(expect.arrayContaining([11, 12]));
  });

  it('a routine with no audio_script speaks its display_text or title', () => {
    expect(sched.scriptOf({ audio_script: ' ', display_text: 'Lunch', title: 'L' })).toBe('Lunch');
    expect(sched.scriptOf({ audio_script: null, display_text: null, title: 'Lunch time' })).toBe('Lunch time');
  });
});

describe('routine time validation', () => {
  it.each(['07:05', '00:00', '23:59'])('accepts %s', (t) => {
    expect(createRoutineSchema.safeParse({ patientId: 1, trigger_time: t, category: 'meal' }).success).toBe(true);
  });
  it.each(['24:00', '7:00', '07:60', '07:05:00', '0705', '', '7pm'])('rejects %j with a field error', (t) => {
    const r = createRoutineSchema.safeParse({ patientId: 1, trigger_time: t, category: 'meal' });
    expect(r.success).toBe(false);
    expect(r.error.errors[0].path).toEqual(['trigger_time']);
    expect(updateRoutineSchema.safeParse({ trigger_time: t }).success).toBe(false);
  });
});
