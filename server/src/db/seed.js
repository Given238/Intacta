/**
 * seed.js — Demo seed matching the Figma portal.
 * Creates: caregiver Timothy Eugene, patient Eleanor Vance (en), paired device
 * "Tablet - Ruang Tamu", today's daily + permanent context items, titled routines,
 * default patient settings.
 * Safe to re-run: the caregiver's single demo patient is updated in place and its
 * context items / routines are replaced.
 */

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool   = require('../config/db');

const CAREGIVER = { email: 'caregiver@intacta.demo', password: 'demo1234', name: 'Timothy Eugene' };
const PATIENT   = { name: 'Eleanor Vance', language: 'en' };
const DEVICE    = { uid: 'demo-terminal-eleanor', name: 'Tablet - Ruang Tamu' };
const LEGACY_DEVICE_UIDS = ['demo-terminal-ibu-sari'];

const DAILY_ITEMS = [
  'Timothy (son) comes home at 5.00 P.M to take over shift',
  'Neighbour dropping off fresh soup around 1:00 P.M.',
];
const PERMANENT_ITEMS = [
  'Timothy Eugene (Son / Primary Caregiver). Depe (Therapy Dog - needs yard walk 2x/day)',
];

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// TODO(wire): add the remaining routines from Figma Routines frame 60:30 (only these two were specified)
const ROUTINES = [
  {
    title: 'Breakfast & Morning Meds', trigger_time: '08:00', category: 'medication', days: ALL_DAYS,
    audio_script: 'Good morning, Eleanor. Breakfast is ready, and your morning medicine is waiting with it.',
  },
  {
    title: 'Lunch Time', trigger_time: '12:30', category: 'meal', days: ALL_DAYS,
    audio_script: 'It is lunch time, Eleanor. A warm meal is ready for you at the table.',
  },
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Caregiver ─────────────────────────────────────────────────────────────
    const password_hash = await bcrypt.hash(CAREGIVER.password, 10);
    const cg = await client.query(`
      INSERT INTO caregivers (email, password_hash, name)
      VALUES ($1, $2, $3)
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
      RETURNING id
    `, [CAREGIVER.email, password_hash, CAREGIVER.name]);
    const caregiverId = cg.rows[0].id;
    console.log(`  ✓ caregiver: ${CAREGIVER.name} <${CAREGIVER.email}> (id=${caregiverId})`);

    // ── Patient (pairing uses the caregiver's first patient, so keep exactly one) ─
    const existing = await client.query(
      'SELECT id FROM patients WHERE caregiver_id = $1 ORDER BY id LIMIT 1',
      [caregiverId]
    );
    let patientId;
    if (existing.rows.length > 0) {
      patientId = existing.rows[0].id;
      await client.query(
        'UPDATE patients SET name = $1, language = $2 WHERE id = $3',
        [PATIENT.name, PATIENT.language, patientId]
      );
    } else {
      const pt = await client.query(
        'INSERT INTO patients (caregiver_id, name, language) VALUES ($1, $2, $3) RETURNING id',
        [caregiverId, PATIENT.name, PATIENT.language]
      );
      patientId = pt.rows[0].id;
    }
    console.log(`  ✓ patient: ${PATIENT.name} (id=${patientId}, language=${PATIENT.language})`);

    // ── Device ────────────────────────────────────────────────────────────────
    await client.query('DELETE FROM devices WHERE device_uid = ANY($1)', [LEGACY_DEVICE_UIDS]);
    const deviceToken = crypto.randomBytes(32).toString('hex');
    // token_hash stores the plain token in the demo; swap for a hash in production
    await client.query(`
      INSERT INTO devices (device_uid, name, patient_id, token_hash, is_online, battery)
      VALUES ($1, $2, $3, $4, false, 100)
      ON CONFLICT (device_uid) DO UPDATE
        SET name = EXCLUDED.name, patient_id = EXCLUDED.patient_id, token_hash = EXCLUDED.token_hash
    `, [DEVICE.uid, DEVICE.name, patientId, deviceToken]);
    console.log(`  ✓ device: ${DEVICE.name} (uid=${DEVICE.uid})`);

    // ── Context items ─────────────────────────────────────────────────────────
    await client.query('DELETE FROM context_items WHERE patient_id = $1', [patientId]);
    for (const text of DAILY_ITEMS) {
      await client.query(
        `INSERT INTO context_items (patient_id, scope, text, context_date) VALUES ($1, 'daily', $2, CURRENT_DATE)`,
        [patientId, text]
      );
    }
    for (const text of PERMANENT_ITEMS) {
      await client.query(
        `INSERT INTO context_items (patient_id, scope, text) VALUES ($1, 'permanent', $2)`,
        [patientId, text]
      );
    }
    console.log(`  ✓ context items: ${DAILY_ITEMS.length} daily, ${PERMANENT_ITEMS.length} permanent`);

    // ── Routines ──────────────────────────────────────────────────────────────
    await client.query('DELETE FROM routines WHERE patient_id = $1', [patientId]);
    for (const r of ROUTINES) {
      await client.query(
        `INSERT INTO routines (patient_id, title, days, trigger_time, category, audio_script, display_text, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $2, true)`,
        [patientId, r.title, r.days, r.trigger_time, r.category, r.audio_script]
      );
    }
    console.log(`  ✓ routines: ${ROUTINES.map(r => `${r.trigger_time} ${r.title}`).join(', ')}`);

    // ── Settings (defaults) ───────────────────────────────────────────────────
    await client.query(`
      INSERT INTO patient_settings (patient_id) VALUES ($1)
      ON CONFLICT (patient_id) DO NOTHING
    `, [patientId]);
    console.log('  ✓ patient settings (defaults)');

    await client.query('COMMIT');
    console.log('\nSeed complete.');
    console.log('─────────────────────────────────────────');
    console.log('  Caregiver login: POST /api/auth/login');
    console.log(`    { "email": "${CAREGIVER.email}", "password": "${CAREGIVER.password}" }`);
    console.log('  Device token (x-device-token header / socket auth.device_token):');
    console.log(`    ${deviceToken}`);
    console.log('─────────────────────────────────────────');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
