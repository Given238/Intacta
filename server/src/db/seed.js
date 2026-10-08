/**
 * seed.js — Demo seed for Intacta.
 * Creates: demo caregiver, demo patient "Ibu Sari", a paired device,
 * and today's daily context (visitor Budi, 11:00 AM, cue).
 * Safe to re-run (uses ON CONFLICT DO NOTHING / DO UPDATE where appropriate).
 */

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool   = require('../config/db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Caregiver ─────────────────────────────────────────────────────────────
    const caregiverEmail    = 'caregiver@intacta.demo';
    const caregiverPassword = 'demo1234';
    const password_hash     = await bcrypt.hash(caregiverPassword, 10);

    const cg = await client.query(`
      INSERT INTO caregivers (email, password_hash, name)
      VALUES ($1, $2, 'Demo Caregiver')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [caregiverEmail, password_hash]);
    const caregiverId = cg.rows[0].id;
    console.log(`  ✓ caregiver: ${caregiverEmail} / ${caregiverPassword} (id=${caregiverId})`);

    // ── Patient ──────────────────────────────────────────────────────────────
    const patientName = 'Ibu Sari';
    const patientLang = 'id';

    const pt = await client.query(`
      INSERT INTO patients (caregiver_id, name, language)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [caregiverId, patientName, patientLang]);
    const patientRow = pt.rows[0];
    if (!patientRow) {
      // already exists — look it up
      const existing = await client.query(
        'SELECT id FROM patients WHERE caregiver_id = $1 AND name = $2',
        [caregiverId, patientName]
      );
      patientRow = existing.rows[0];
    }
    const patientId = patientRow.id;
    console.log(`  ✓ patient: ${patientName} (id=${patientId}, language=${patientLang})`);

    // ── Device ────────────────────────────────────────────────────────────────
    const deviceToken   = crypto.randomBytes(32).toString('hex');
    const deviceUid     = 'demo-terminal-ibu-sari';  // stable terminal identifier
    // token_hash stores plain token in demo; swap for bcrypt in production
    await client.query(`
      INSERT INTO devices (device_uid, patient_id, token_hash, is_online)
      VALUES ($1, $2, $3, false)
      ON CONFLICT (device_uid) DO UPDATE SET token_hash = EXCLUDED.token_hash
    `, [deviceUid, patientId, deviceToken]);
    console.log(`  ✓ device uid: ${deviceUid}`);
    console.log(`  ✓ device token (plain — DEMO ONLY): ${deviceToken}`);
    console.log(`    Use x-device-token: ${deviceToken} for terminal auth`);

    // ── Daily Context ─────────────────────────────────────────────────────────
    await client.query(`
      INSERT INTO daily_contexts (patient_id, context_date, visitor_name, arrival_time, passive_cue, updated_at)
      VALUES ($1, CURRENT_DATE, 'Budi', '11:00', 'Budi sedang membeli makanan kesukaan Ibu', NOW())
      ON CONFLICT (patient_id, context_date) DO UPDATE
        SET visitor_name = EXCLUDED.visitor_name,
            arrival_time = EXCLUDED.arrival_time,
            passive_cue  = EXCLUDED.passive_cue,
            updated_at   = NOW()
    `, [patientId]);
    console.log(`  ✓ daily context: visitor="Budi", arrival="11:00", cue="Budi sedang membeli makanan kesukaan Ibu"`);

    await client.query('COMMIT');
    console.log('\nSeed complete.');
    console.log('─────────────────────────────────────────');
    console.log('  Caregiver login: POST /api/auth/login');
    console.log('    { "email": "caregiver@intacta.demo", "password": "demo1234" }');
    console.log('  Device token (x-device-token header):');
    console.log(`    ${deviceToken}`);
    console.log('─────────────────────────────────────────');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
