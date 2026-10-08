/**
 * audit.js — Audit log service.
 * Every caregiver mutation must write an audit entry with caregiver_id + ISO-8601 timestamp.
 */

const { query } = require('../db/query');

async function logAudit({ caregiverId, action, payload = null }) {
  try {
    await query(
      `INSERT INTO audit_logs (caregiver_id, action, payload, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [caregiverId, action, payload ? JSON.stringify(payload) : null]
    );
  } catch (err) {
    // Audit failures must never break the main request
    console.error('Audit log failed:', err.message);
  }
}

module.exports = { logAudit };
