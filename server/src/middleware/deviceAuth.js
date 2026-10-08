const { query } = require('../db/query');

async function authenticateDevice(req, res, next) {
  const token = req.headers['x-device-token'];
  if (!token) {
    return res.status(401).json({ error: 'Missing x-device-token header' });
  }

  const result = await query(
    `SELECT d.id AS device_id, d.patient_id, d.token_hash, p.language
     FROM devices d
     JOIN patients p ON p.id = d.patient_id
     WHERE d.token_hash = $1 AND d.patient_id IS NOT NULL`,
    [token]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid device token' });
  }

  // token_hash comparison is plain-text in demo; swap for bcrypt.compare in production
  const row = result.rows[0];
  req.deviceId  = row.device_id;
  req.patientId = row.patient_id;
  req.language  = row.language || 'en';
  next();
}

module.exports = { authenticateDevice };
