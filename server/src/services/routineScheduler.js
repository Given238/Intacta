/**
 * routineScheduler.js — fires routines at their time on the Asia/Jakarta clock.
 *
 * Every TICK_MS the server looks for active routines whose days include today's weekday and whose
 * trigger_time has been reached today, and that have not fired today (routines.last_fired_on).
 *   - terminal online  → emit routine:trigger {id, title, audio_script, category} to patient:{id},
 *                        log an interaction (source 'routine', transcript = title, ai_response = script),
 *                        mark fired
 *   - terminal offline → wait; delivered on the next tick or on reconnect (deliverPending), as long as
 *                        it is at most GRACE_MIN minutes late
 *   - later than that  → skipped, logged as missed (ai_response {missed: true}), marked fired
 *   - due before the scheduler started (server was down, or first deploy) → marked handled for today
 *                        without a "missed" log: nothing could have delivered it
 * "Today", the weekday and the minute always come from Intl with timeZone Asia/Jakarta, never the
 * server's local time. Marking is an atomic claim, so a routine can never fire twice on one day.
 * Every routine needs a stored safety verdict for the current SAFETY_VERSION (storedSafety.js) before it is considered:
 * a blocked or not-yet-screened one is never fired, spoken or logged as missed.
 */

const { query } = require('../db/query');
const { logInteraction } = require('../llm/interactionLogger');
const { isUsable, withPending, rescreenRoutine, ensureScreened } = require('./storedSafety');

const TIME_ZONE = 'Asia/Jakarta';
const TICK_MS = 30_000;
const GRACE_MIN = 10;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const clockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
});

/** Asia/Jakarta wall clock for an instant: {dateKey 'YYYY-MM-DD', minutes since midnight, weekday 0=Sun..6=Sat}. */
function jakartaClock(date = new Date()) {
  const p = Object.fromEntries(clockFormat.formatToParts(date).map(x => [x.type, x.value]));
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: WEEKDAYS[p.weekday],
  };
}

/** 'HH:MM' or 'HH:MM:SS' → minutes since midnight; NaN when malformed. */
function timeToMinutes(value) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(value ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** pg DATE may arrive as a Date (local midnight) or a string; normalise to 'YYYY-MM-DD'. */
function dateKeyOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/**
 * What to do with one routine right now.
 * @param {object} [opts.started]  jakartaClock() of the scheduler start; a routine due before it is 'stale'
 * @returns {'not_due'|'done'|'deliver'|'missed'|'stale'}
 *   not_due  inactive, not today's weekday, bad time, or its time has not come yet
 *   done     already fired (or logged missed) today
 *   deliver  due and at most `graceMin` minutes late: send if the terminal is online, else wait
 *   missed   more than `graceMin` minutes late and never delivered today
 */
function classifyRoutine(routine, clock, { graceMin = GRACE_MIN, started = null } = {}) {
  if (!routine || routine.is_active === false) return 'not_due';
  const days = Array.isArray(routine.days) && routine.days.length ? routine.days.map(Number) : ALL_DAYS;
  if (!days.includes(clock.weekday)) return 'not_due';
  if (dateKeyOf(routine.last_fired_on) === clock.dateKey) return 'done';
  const at = timeToMinutes(routine.trigger_time);
  if (Number.isNaN(at)) return 'not_due';
  const late = clock.minutes - at;
  if (late < 0) return 'not_due';
  if (late <= graceMin) return 'deliver';
  const dueBeforeStart = started && started.dateKey === clock.dateKey && at < started.minutes;
  return dueBeforeStart ? 'stale' : 'missed';
}

/**
 * last_fired_on for a routine created or re-timed now: if its time has already passed today it counts
 * as handled today (otherwise it would immediately be logged as missed); null when it is still ahead.
 */
function initialLastFiredOn(triggerTime, days, clock = jakartaClock()) {
  const at = timeToMinutes(triggerTime);
  const onToday = (Array.isArray(days) && days.length ? days : ALL_DAYS).includes(clock.weekday);
  return onToday && !Number.isNaN(at) && at < clock.minutes ? clock.dateKey : null;
}

/** Script the terminal speaks: audio_script, else display_text, else title. */
function scriptOf(r) {
  return [r.audio_script, r.display_text, r.title].map(s => (typeof s === 'string' ? s.trim() : '')).find(Boolean) || '';
}

/**
 * Brings a stored routine's safety verdict up to the current SAFETY_VERSION (classifier re-screen of its spoken
 * fields, stored in safety_* / blocked_category). wait=false re-screens in the background and returns the row as is.
 * Returns the routine with safety_pending set; only isUsable(routine) ones may fire or reach a prompt.
 */
async function recheckRoutine(r, { wait = true } = {}) {
  if (!r) return r;
  const [checked] = await ensureScreened([r], rescreenRoutine, { wait });
  return withPending(checked);
}

/** Is a terminal socket (device:* room) in this patient's room? */
async function terminalOnline(io, patientId) {
  const sockets = await io.in(`patient:${patientId}`).fetchSockets();
  return sockets.some(s => [...s.rooms].some(room => room.startsWith('device:')));
}

/** Atomic once-a-day claim. Returns true only for the caller that set last_fired_on. */
async function claim(routineId, dateKey) {
  const r = await query(
    'UPDATE routines SET last_fired_on = $2 WHERE id = $1 AND last_fired_on IS DISTINCT FROM $2::date RETURNING id',
    [routineId, dateKey]
  );
  return r.rows.length > 0;
}

async function deliver(io, r, clock) {
  if (!(await claim(r.id, clock.dateKey))) return false;
  const script = scriptOf(r);
  const title = r.title || r.display_text || r.category;
  io.to(`patient:${r.patient_id}`).emit('routine:trigger', { id: r.id, title, audio_script: script, category: r.category });
  const aiResponse = { text: script, parts: script ? [script] : [] };
  let created_at = new Date().toISOString();
  try {
    const log = await logInteraction({ patientId: r.patient_id, transcript: title, aiResponse, source: 'routine', latencyMs: 0 });
    if (log?.created_at) created_at = log.created_at;
  } catch (err) {
    console.error('[routines] interaction log failed:', err.message);
  }
  io.to(`patient:${r.patient_id}`).emit('interaction:new', { transcript: title, ai_response: aiResponse, source: 'routine', created_at });
  console.log(`[routines] fired routine ${r.id} for patient ${r.patient_id} (${clock.dateKey})`);
  return true;
}

async function markMissed(io, r, clock) {
  if (!(await claim(r.id, clock.dateKey))) return false;
  const title = r.title || r.display_text || r.category;
  const aiResponse = { missed: true, reason: 'terminal_offline', script: scriptOf(r) };
  let created_at = new Date().toISOString();
  try {
    const log = await logInteraction({ patientId: r.patient_id, transcript: title, aiResponse, source: 'routine', latencyMs: 0 });
    if (log?.created_at) created_at = log.created_at;
  } catch (err) {
    console.error('[routines] missed log failed:', err.message);
  }
  io.to(`patient:${r.patient_id}`).emit('interaction:new', { transcript: title, ai_response: aiResponse, source: 'routine', created_at });
  console.warn(`[routines] missed routine ${r.id} for patient ${r.patient_id}: terminal offline for more than ${GRACE_MIN} min`);
  return true;
}

/**
 * One scheduler pass (all patients, or one on terminal reconnect).
 * @returns {Promise<{delivered: number[], missed: number[], waiting: number[]}>}
 */
async function runTick(io, { now = new Date(), patientId = null, startedAt = schedulerStartedAt } = {}) {
  const clock = jakartaClock(now);
  const started = startedAt ? jakartaClock(startedAt) : null;
  const params = [clock.dateKey];
  let sql = `SELECT id, patient_id, title, days, trigger_time, category, audio_script, display_text, is_active, last_fired_on,
                    blocked_category, safety_version, safety_verdict
             FROM routines
             WHERE is_active = true AND (last_fired_on IS NULL OR last_fired_on <> $1::date)`;
  if (patientId) {
    sql += ' AND patient_id = $2';
    params.push(patientId);
  }
  const { rows } = await query(sql, params);
  const result = { delivered: [], missed: [], waiting: [], stale: [], blocked: [] };
  const online = new Map();
  for (const row of rows) {
    const r = await recheckRoutine(row, { wait: false }); // the tick never waits for the classifier
    if (!isUsable(r)) {
      result.blocked.push(r.id); // blocked, or not screened yet (it fires on a later tick once allowed)
      continue;
    }
    const action = classifyRoutine(r, clock, { started });
    try {
      if (action === 'deliver') {
        if (!online.has(r.patient_id)) online.set(r.patient_id, await terminalOnline(io, r.patient_id));
        if (online.get(r.patient_id)) {
          if (await deliver(io, r, clock)) result.delivered.push(r.id);
        } else {
          result.waiting.push(r.id);
        }
      } else if (action === 'missed') {
        if (await markMissed(io, r, clock)) result.missed.push(r.id);
      } else if (action === 'stale') {
        if (await claim(r.id, clock.dateKey)) result.stale.push(r.id);
      }
    } catch (err) {
      console.error(`[routines] routine ${r.id} failed:`, err.message);
    }
  }
  return result;
}

/** On terminal (re)connect: deliver anything due in the last GRACE_MIN minutes right away. */
async function deliverPending(io, patientId, opts = {}) {
  try {
    return await runTick(io, { ...opts, patientId });
  } catch (err) {
    console.error('[routines] deliverPending failed:', err.message);
    return null;
  }
}

let timer = null;
let schedulerStartedAt = null; // null (tests, scripts): no 'stale' rule

function startRoutineScheduler(io, { intervalMs = TICK_MS } = {}) {
  if (timer) return timer;
  schedulerStartedAt = new Date();
  const tick = () => runTick(io).catch(err => console.error('[routines] tick failed:', err.message));
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  console.log(`[routines] scheduler started (every ${intervalMs / 1000}s, ${TIME_ZONE})`);
  return timer;
}

function stopRoutineScheduler() {
  clearInterval(timer);
  timer = null;
  schedulerStartedAt = null;
}

module.exports = {
  TIME_ZONE,
  TICK_MS,
  GRACE_MIN,
  jakartaClock,
  timeToMinutes,
  classifyRoutine,
  initialLastFiredOn,
  scriptOf,
  recheckRoutine,
  runTick,
  deliverPending,
  startRoutineScheduler,
  stopRoutineScheduler,
};
