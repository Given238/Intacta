const { query } = require('../db/query');
const { loadContextSnapshot } = require('../services/contextService');
const { getSettings } = require('../services/settingsService');
const { jakartaClock, timeToMinutes, recheckRoutine } = require('../services/routineScheduler');
const { isUsable } = require('../services/storedSafety');

const RECENT_LIMIT = 3;
const RECENT_WINDOW_MIN = 10;

/**
 * Everything the LLM pipeline needs for one patient: language, today's daily
 * items, permanent items and max_speech_seconds. Returns null when the patient does not exist.
 * strict_validation is deliberately not loaded: guardrails are always enforced.
 * Blocked and unscreened context items are already left out by the snapshot; sensitive notes come apart.
 */
async function loadPatientContext(patientId) {
  const [snapshot, settings] = await Promise.all([
    loadContextSnapshot(patientId),
    getSettings(patientId),
  ]);
  if (!snapshot) return null;
  return {
    language:           snapshot.language,
    daily_items:        snapshot.daily.map(i => i.text),
    permanent_items:    snapshot.permanent.map(i => i.text),
    sensitive_items:    snapshot.sensitive.map(i => i.text),
    max_speech_seconds: settings ? settings.max_speech_seconds : null,
  };
}

/** The last ≤3 voice/typed exchanges of the last 10 minutes, newest first: [{transcript, reply}]. */
async function loadRecentExchanges(patientId) {
  const result = await query(
    `SELECT transcript, ai_response FROM interaction_logs
     WHERE patient_id = $1 AND source IN ('voice', 'typed')
       AND created_at > NOW() - ($2 || ' minutes')::interval
     ORDER BY id DESC LIMIT $3`,
    [patientId, String(RECENT_WINDOW_MIN), RECENT_LIMIT]
  );
  return result.rows.map(r => {
    let ai = r.ai_response;
    if (typeof ai === 'string') {
      try { ai = JSON.parse(ai); } catch { ai = { text: ai }; }
    }
    return { transcript: r.transcript || '', reply: ai?.text || '' };
  }).filter(r => r.reply);
}

/** Today's active routines still ahead on the Asia/Jakarta clock (title + time + category only; blocked ones left out). */
async function loadUpcomingRoutines(patientId, now = new Date()) {
  const clock = jakartaClock(now);
  const result = await query(
    `SELECT id, title, days, trigger_time, category, audio_script, display_text, blocked_category, safety_version, safety_verdict
     FROM routines WHERE patient_id = $1 AND is_active = true ORDER BY trigger_time ASC`,
    [patientId]
  );
  const upcoming = [];
  for (const row of result.rows) {
    const r = await recheckRoutine(row, { wait: false });
    if (!isUsable(r)) continue;
    const days = Array.isArray(r.days) && r.days.length ? r.days.map(Number) : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(clock.weekday)) continue;
    const at = timeToMinutes(r.trigger_time);
    if (Number.isNaN(at) || at < clock.minutes) continue;
    upcoming.push({ title: r.title || r.display_text || r.category, time: String(r.trigger_time).slice(0, 5), category: r.category });
  }
  return upcoming;
}

/** 'HH:MM' on the Asia/Jakarta clock. */
function jakartaTimeOfDay(now = new Date()) {
  const { minutes } = jakartaClock(now);
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

module.exports = { loadPatientContext, loadRecentExchanges, loadUpcomingRoutines, jakartaTimeOfDay };
