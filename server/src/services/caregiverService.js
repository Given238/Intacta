/**
 * caregiverService.js — the signed-in caregiver's own profile (name, email).
 * Code-paired caregivers start with name and email NULL (migration 004).
 */

const { query } = require('../db/query');

class CaregiverError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code   = code;
  }
}

async function getProfile(caregiverId) {
  const result = await query('SELECT id, name, email FROM caregivers WHERE id = $1', [caregiverId]);
  return result.rows[0] || null;
}

/**
 * Only the fields present in `changes` are written. A name is saved with its safety verdict (changes.nameVerdict,
 * from the gate); a cleared name clears the verdict. Throws CaregiverError 409 when the email belongs to someone else.
 */
async function updateProfile(caregiverId, changes) {
  const values = {};
  for (const f of ['name', 'email']) if (Object.prototype.hasOwnProperty.call(changes, f)) values[f] = changes[f];
  if ('name' in values) {
    values.name_safety_version = values.name ? changes.nameVerdict?.safety_version ?? null : null;
    values.name_safety_verdict = values.name ? changes.nameVerdict?.safety_verdict ?? null : null;
  }
  const fields = Object.keys(values);
  const sets   = fields.map((f, i) => `${f} = $${i + 1}`);
  const params = [...fields.map(f => values[f]), caregiverId];
  try {
    const result = await query(
      `UPDATE caregivers SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id, name, email`,
      params
    );
    return result.rows[0] || null;
  } catch (err) {
    if (err.code === '23505') throw new CaregiverError('Email is already in use', 409, 'email_taken');
    throw err;
  }
}

/** TTS voices configured on the server (ElevenLabs voice IDs per patient language). */
module.exports = { getProfile, updateProfile, CaregiverError };
