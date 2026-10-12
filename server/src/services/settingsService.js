/**
 * settingsService.js — patient_settings, with defaults for patients that have no row yet.
 * strict_validation is stored for the portal toggle only: the server enforces the
 * clinical guardrails on every response regardless of its value.
 * The legacy voice_id column is no longer read or written: the voice is chosen by voice_gender and
 * the ElevenLabs IDs live only in env (services/voiceService.js), so no ID reaches a client.
 */

const { query } = require('../db/query');

const DEFAULT_SETTINGS = Object.freeze({
  strict_validation:  true,
  max_speech_seconds: 10,
  voice_gender:       'female',
  playback_speed:     1.0,
  volume_db:          65,
});

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

function normalize(row) {
  const pick = (k) => (row[k] == null ? DEFAULT_SETTINGS[k] : row[k]);
  return {
    strict_validation:  pick('strict_validation'),
    max_speech_seconds: pick('max_speech_seconds'),
    voice_gender:       pick('voice_gender'),
    playback_speed:     Number(pick('playback_speed')), // NUMERIC arrives from pg as a string
    volume_db:          pick('volume_db'),
    updated_at:         row.updated_at || null,
  };
}

/** Returns null when the patient does not exist. */
async function getSettings(patientId) {
  const result = await query(
    `SELECT s.*
     FROM patients p LEFT JOIN patient_settings s ON s.patient_id = p.id
     WHERE p.id = $1`,
    [patientId]
  );
  if (result.rows.length === 0) return null;
  return normalize(result.rows[0]);
}

/** Upserts only the provided keys (whitelisted) and returns the full settings. */
async function updateSettings(patientId, changes) {
  const keys = SETTING_KEYS.filter(k => changes[k] !== undefined);
  const cols         = keys.map(k => `, ${k}`).join('');
  const placeholders = keys.map((_, i) => `, $${i + 2}`).join('');
  const updates      = keys.map(k => `${k} = EXCLUDED.${k}, `).join('') + 'updated_at = NOW()';
  const result = await query(
    `INSERT INTO patient_settings (patient_id${cols})
     VALUES ($1${placeholders})
     ON CONFLICT (patient_id) DO UPDATE SET ${updates}
     RETURNING *`,
    [patientId, ...keys.map(k => changes[k])]
  );
  return normalize(result.rows[0]);
}

/** The settings:sync event body { payload, updated_at }, or null when the patient does not exist. */
async function buildSettingsSync(patientId, settings) {
  const s = settings || await getSettings(patientId);
  if (!s) return null;
  const { updated_at, ...payload } = s;
  return { payload, updated_at: updated_at || new Date().toISOString() };
}

/** Non-volatile so the terminal always ends up with the latest settings. */
async function emitSettingsSync(io, patientId, settings) {
  if (!io) return;
  const body = await buildSettingsSync(patientId, settings);
  if (body) io.to(`patient:${patientId}`).emit('settings:sync', body);
}

module.exports = { DEFAULT_SETTINGS, getSettings, updateSettings, buildSettingsSync, emitSettingsSync };
